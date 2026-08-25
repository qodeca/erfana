// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeWindowDetector — detection PROVENANCE (`detectWindowDetail`).
 *
 * Lives in its own file because `ClaudeWindowDetector.test.ts` would otherwise
 * pass the 500-line convention. Where that file pins WHICH window each input
 * resolves to, this one pins WHY: the rule that decided, and whether the verdict
 * is corroborated by an observed/explicit signal or merely inferred from the
 * capability registry. That distinction drives the sticky bit and the
 * `(inferred)` tooltip, so it needs its own assertions rather than riding along
 * on a size comparison.
 *
 * This file previously also covered a deployment-environment rule that has been
 * REMOVED: three of its four signals were unreachable (TerminalService strips
 * `CLAUDE_CODE_*` from the spawned env), the survivor described request routing
 * rather than capacity, and it outranked the user's own explicit `[1m]`. A
 * narrowed, settings-based replacement is tracked separately.
 *
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/41-model-capability-registry.md §8 (rule order)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectWindowDetail,
  detectWindowSize,
  EXTENDED_WINDOW,
  STANDARD_WINDOW,
  __resetSettingsCacheForTests
} from './ClaudeWindowDetector'

let tmpDir: string

beforeEach(async () => {
  __resetSettingsCacheForTests()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-window-env-'))
})

afterEach(async () => {
  __resetSettingsCacheForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('#41 M4 - detectWindowDetail reports WHY, not just what', () => {
  /** Write a settings.json with the given body; return its path. */
  async function writeSettings(body: unknown): Promise<string> {
    const file = path.join(tmpDir, 'settings.json')
    await fs.writeFile(file, JSON.stringify(body), 'utf8')
    return file
  }

  it('marks a settings.json [1m] window CORROBORATED, because it is explicit', async () => {
    // The value windowIsCorroborated cannot see: it does no I/O, so only the
    // detection pass that read the file can report this. Without it the tooltip
    // labelled the user's own configuration `(inferred)`.
    const settingsPath = await writeSettings({ model: 'sonnet[1m]' })
    const detail = await detectWindowDetail('claude-sonnet-4-6', 12_000, false, { settingsPath })

    expect(detail).toEqual({ windowSize: EXTENDED_WINDOW, corroborated: true, rule: 'R3' })
  })

  it('R1m: a recognised [1m] variant on the id is CORROBORATED, like R3', async () => {
    // Sonnet 4.5's exact-map row is 200k, so a 1M answer here can only come from
    // the variant branch — the registry cannot produce it. The `[1m]` is an
    // explicit configuration, so it must not be reported as an inference and it
    // must latch, exactly as the settings.json `[1m]` does at R3.
    const settingsPath = path.join(tmpDir, 'absent.json')
    const detail = await detectWindowDetail('claude-sonnet-4-5[1m]', 1_000, false, {
      settingsPath
    })

    expect(detail).toEqual({ windowSize: EXTENDED_WINDOW, corroborated: true, rule: 'R1m' })
    // Control: without the variant the same id resolves 200k from the exact map.
    expect(await detectWindowDetail('claude-sonnet-4-5', 1_000, false, { settingsPath })).toEqual({
      windowSize: STANDARD_WINDOW,
      corroborated: false,
      rule: 'R4'
    })
  })

  it('R1m does not fire for an UNRECOGNISED variant', async () => {
    // `[thinking]` is ignored for display (a label is not an action) and must not
    // manufacture corroboration here either.
    const settingsPath = path.join(tmpDir, 'absent.json')
    const detail = await detectWindowDetail('claude-opus-5[thinking]', 1_000, false, {
      settingsPath
    })

    expect(detail).toEqual({ windowSize: EXTENDED_WINDOW, corroborated: false, rule: 'R1' })
  })

  it('marks a registry-derived window PROVISIONAL', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    const detail = await detectWindowDetail('claude-opus-5', 12_000, false, { settingsPath })

    expect(detail).toEqual({ windowSize: EXTENDED_WINDOW, corroborated: false, rule: 'R1' })
  })

  it('names the rule that decided, for every branch of the tree', async () => {
    const absent = path.join(tmpDir, 'absent.json')
    const rule = async (...args: Parameters<typeof detectWindowDetail>): Promise<string> =>
      (await detectWindowDetail(...args)).rule

    expect(await rule('claude-haiku-4-5', 250_000, false, { settingsPath: absent })).toBe('R2')
    expect(await rule('claude-haiku-4-5', 12_000, true, { settingsPath: absent })).toBe('R0')
    expect(
      await rule('claude-opus-5', 12_000, false, { settingsPath: absent, forceStandard: true })
    ).toBe('R0prime')
    expect(await rule('claude-sonnet-4-5[1m]', 12_000, false, { settingsPath: absent })).toBe(
      'R1m'
    )
    expect(await rule('claude-opus-5', 12_000, false, { settingsPath: absent })).toBe('R1')
    expect(await rule('claude-haiku-4-5', 12_000, false, { settingsPath: absent })).toBe('R4')
  })

  it('R2 outranks an explicit standard selection — the ordering the module doc warns about', async () => {
    // The one failure the module docblock names in prose and nothing tested.
    // Every other R2 assertion omits forceStandard and every R0' assertion uses
    // <=200k usage, so moving the R2 block below R0' left the whole suite green
    // while re-introducing the #41 failure class: `/model claude-opus-5` typed at
    // 250k used sets modelForcedStandard with usedTokens 250_000, R0' would then
    // report 200k, `resolveWindow` additionally clears the sticky bit on
    // forceStandard, and the meter pins at "250k / 200k" — 100%, red, stuck for
    // the session. A 200k window cannot hold 250k tokens, so the physical fact
    // must outrank the selection.
    const absent = path.join(tmpDir, 'absent.json')

    const detail = await detectWindowDetail('claude-opus-5', 250_000, false, {
      settingsPath: absent,
      forceStandard: true
    })

    expect(detail.rule).toBe('R2')
    expect(detail.windowSize).toBe(EXTENDED_WINDOW)
    expect(detail.corroborated).toBe(true)
  })

  it('detectWindowSize stays a thin wrapper returning only the size', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    const size = await detectWindowSize('claude-opus-5', 12_000, false, { settingsPath })
    const detail = await detectWindowDetail('claude-opus-5', 12_000, false, { settingsPath })

    expect(size).toBe(detail.windowSize)
    expect(typeof size).toBe('number')
  })
})
