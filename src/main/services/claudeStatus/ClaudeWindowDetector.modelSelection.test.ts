// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeWindowDetector — an explicit `/model <id>` with no `[1m]` marker (#383).
 *
 * Claude Code runs Opus 4.7 and later, Sonnet 5 and later, Haiku 5.5 and the
 * Fable models at 1M with no `[1m]` variant to select, so `/model claude-opus-5`
 * lands on 1M; only a model that reaches 1M through its `[1m]` variant (Opus 4.6,
 * Sonnet 4.6) or has no 1M at all (Haiku 4.5) runs at 200k after such a pick.
 * R0' used to force 200k for every pick, pinning 1M-only models at 200k.
 *
 * Every expectation below is hand-written from the Claude Code model-config page
 * and design §7.1, never derived from `modelId.ts`.
 *
 * Lives in its own file because `ClaudeWindowDetector.test.ts` sits at the
 * 500-line convention.
 *
 * @see Issue #383 - context meter shows 200k for newer Claude models and when /model names a 1M-only model
 * @see https://code.claude.com/docs/en/model-config — "a model that reaches 1M only through its `[1m]` variant, such as Opus 4.6, runs at 200K without it"
 * @see docs/designs/context-meter/41-model-capability-registry.md §8 (R0'), §9.3 (AC7)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectWindowDetail,
  EXTENDED_WINDOW,
  STANDARD_WINDOW,
  __resetSettingsCacheForTests
} from './ClaudeWindowDetector'

let tmpDir: string
let absentSettings: string

beforeEach(async () => {
  __resetSettingsCacheForTests()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-window-model-'))
  absentSettings = path.join(tmpDir, 'absent.json')
})

afterEach(async () => {
  __resetSettingsCacheForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Detect as the service does after `/model <id>` with no marker, at low usage. */
function pickWithoutMarker(modelId: string): ReturnType<typeof detectWindowDetail> {
  return detectWindowDetail(modelId, 12_000, false, {
    settingsPath: absentSettings,
    forceStandard: true
  })
}

describe('#383 - /model <id> without [1m] on a model with ONLY a 1M window', () => {
  // The first five are the ids #383 added to the table; the rest were already
  // there and were the ones the old R0' pinned at 200k.
  const extendedOnly: ReadonlyArray<[string]> = [
    ['claude-opus-5-5'],
    ['claude-sonnet-5-5'],
    ['claude-haiku-5-5'],
    ['claude-fable-5-1'],
    ['claude-mythos-5-1'],
    ['claude-opus-5'],
    ['claude-opus-4-7'],
    ['claude-sonnet-5'],
    ['claude-fable-5']
  ]

  it.each(extendedOnly)('%s reports 1M, decided by the registry (R1)', async (modelId) => {
    // Still provisional: the pick confirms the model, not the plan or provider,
    // so the meter keeps the `(inferred)` marker exactly as without `/model`.
    expect(await pickWithoutMarker(modelId)).toEqual({
      windowSize: EXTENDED_WINDOW,
      corroborated: false,
      rule: 'R1'
    })
  })

  it('a cloud-platform form of a 1M-only id is treated the same', async () => {
    expect((await pickWithoutMarker('us.anthropic.claude-opus-5-5')).windowSize).toBe(
      EXTENDED_WINDOW
    )
  })
})

describe('#383 - /model <id> without [1m] on a model that OFFERS a 200k window', () => {
  const standardAvailable: ReadonlyArray<[string]> = [
    // Dual-window: 1M only through the `[1m]` variant.
    ['claude-opus-4-6'],
    ['claude-sonnet-4-6'],
    // 200k only.
    ['claude-haiku-4-5'],
    ['claude-sonnet-4-5'],
    ['claude-opus-4-5']
  ]

  it.each(standardAvailable)('%s still reports 200k (R0\')', async (modelId) => {
    expect(await pickWithoutMarker(modelId)).toEqual({
      windowSize: STANDARD_WINDOW,
      corroborated: false,
      rule: 'R0prime'
    })
  })

  it('an explicit pick still outranks a settings.json [1m] on a dual-window model', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json')
    await fs.writeFile(settingsPath, JSON.stringify({ model: 'opus[1m]' }), 'utf8')

    const detail = await detectWindowDetail('claude-opus-4-6', 12_000, false, {
      settingsPath,
      forceStandard: true
    })

    expect(detail).toEqual({ windowSize: STANDARD_WINDOW, corroborated: false, rule: 'R0prime' })
  })

  it('an id the table has no opinion on keeps the explicit 200k pick', async () => {
    // Unknown family: the registry says nothing, so nothing contradicts the pick.
    expect((await pickWithoutMarker('claude-zephyr-9')).rule).toBe('R0prime')
  })
})
