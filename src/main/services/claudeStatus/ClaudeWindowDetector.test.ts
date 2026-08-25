// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeWindowDetector tests.
 *
 * Covers the hybrid 200k-vs-1M detection: the settings `[1m]` signal (even under
 * 200k usage), the used>200k threshold, and the defensive fall-throughs for a
 * missing / malformed / oversize settings file.
 *
 * Since #41 it also carries the capability-registry suites (AC1, AC3, AC4, the
 * AC5a/b/c invariance split, AC7) and the classification table that replaced the
 * deleted `modelNativelySupportsExtended`. Detection PROVENANCE — which rule
 * decided, and whether the verdict is corroborated — lives in the sibling
 * `ClaudeWindowDetector.provenance.test.ts`.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/216-claude-status-bar.md §2, §8, §10
 * @see docs/designs/41-model-capability-registry.md §7, §8, §9.3
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectWindowSize,
  EXTENDED_THRESHOLD,
  EXTENDED_WINDOW,
  STANDARD_WINDOW,
  __resetSettingsCacheForTests
} from './ClaudeWindowDetector'
import { windowForModelId } from './modelId'

let tmpDir: string

beforeEach(async () => {
  __resetSettingsCacheForTests()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-window-'))
})

afterEach(async () => {
  __resetSettingsCacheForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Write a settings.json with the given object body; return its path. */
async function writeSettings(body: unknown): Promise<string> {
  const file = path.join(tmpDir, 'settings.json')
  await fs.writeFile(file, JSON.stringify(body), 'utf8')
  return file
}

/** Write raw (possibly malformed) settings content; return its path. */
async function writeRawSettings(raw: string): Promise<string> {
  const file = path.join(tmpDir, 'settings.json')
  await fs.writeFile(file, raw, 'utf8')
  return file
}

describe('detectWindowSize', () => {
  it('exposes the documented constants', () => {
    expect(STANDARD_WINDOW).toBe(200000)
    expect(EXTENDED_WINDOW).toBe(1000000)
    expect(EXTENDED_THRESHOLD).toBe(200000)
  })

  it('returns 1M when settings model is "opus[1m]" even under 200k usage', async () => {
    const settingsPath = await writeSettings({ model: 'opus[1m]' })
    expect(await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it('returns 1M when settings model is "claude-opus-4-5[1m]" (older Opus, 1m override)', async () => {
    const settingsPath = await writeSettings({ model: 'claude-opus-4-5[1m]' })
    expect(await detectWindowSize('claude-opus-4-5', 0, false, { settingsPath })).toBe(EXTENDED_WINDOW)
  })

  it('returns 200k for plain "opus" (older) model with low usage', async () => {
    const settingsPath = await writeSettings({ model: 'opus' })
    expect(await detectWindowSize('claude-opus-4-5', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('returns 200k when no settings file and usage is low (older model)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('returns 1M when no settings file but usage exceeds 200k (threshold)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-sonnet-4-5', 250_000, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it('does NOT cross at exactly 200k (strictly greater-than)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-sonnet-4-5', 200_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
    expect(await detectWindowSize('claude-sonnet-4-5', 200_001, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it('falls through on malformed settings JSON (usage decides)', async () => {
    const settingsPath = await writeRawSettings('{ this is not json')
    expect(await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
    expect(await detectWindowSize('claude-sonnet-4-5', 300_000, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it('ignores an oversize settings file (>1 MB) and falls through', async () => {
    // Build a settings file >1 MB that DOES contain "[1m]"; the size cap must
    // cause it to be ignored, so low usage on a non-1M model yields 200k.
    const padding = 'x'.repeat(1024 * 1024 + 10)
    const settingsPath = await writeRawSettings(
      JSON.stringify({ model: 'opus[1m]', pad: padding })
    )
    expect(await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('treats a non-string model as no signal', async () => {
    const settingsPath = await writeSettings({ model: 123 })
    expect(await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('treats a missing model key as no signal', async () => {
    const settingsPath = await writeSettings({ theme: 'dark' })
    expect(await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })
})

describe('detectWindowSize forceExtended hint (fresh /model …[1m] override)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 1M for a 200k-family model with forceExtended and never reads settings', async () => {
    const settingsPath = await writeSettings({ model: 'opus' })
    const readSpy = vi.spyOn(fs, 'readFile')

    expect(await detectWindowSize('claude-sonnet-4-6', 1000, true, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )

    // Highest-priority in-memory signal short-circuits before any file read.
    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath)).toHaveLength(0)
  })

  it('preserves existing behavior when forceExtended is false (200k-family, low usage)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-sonnet-4-6', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('preserves existing behavior when forceExtended is omitted (default false)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-sonnet-4-6', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })
})

describe('detectWindowSize model-capability registry (per-model published windows)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('UAT case: claude-opus-4-8 under 200k with NO settings file → 1M', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-opus-4-8', 95_329, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it('UAT case: does NOT read settings.json for an auto-1M Opus model', async () => {
    // A known-1M model short-circuits BEFORE the file read (PERF-2 common path).
    const settingsPath = await writeSettings({ model: 'opus' })
    const readSpy = vi.spyOn(fs, 'readFile')

    expect(await detectWindowSize('claude-opus-4-8', 95_329, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )

    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath)).toHaveLength(0)
  })

  it('claude-opus-4-7 → 1M', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-opus-4-7', 0, false, { settingsPath })).toBe(EXTENDED_WINDOW)
  })

  // Issue #41 §9.2: flipped from 1M. Erfana meters the Claude Code layer, where
  // Opus 4.6 without extended context compacts at the 200K boundary and is
  // excluded from "Opus 4.7 and later" — the API layer's 1M does not transfer.
  it('claude-opus-4-6 → 200k', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-opus-4-6', 0, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('claude-opus-4-5 under 200k → 200k (not auto-upgraded)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-opus-4-5', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('claude-opus-4-1 → 200k', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-opus-4-1', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('claude-sonnet-4-6 under 200k with no settings → 200k (1M-capable but not auto)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-sonnet-4-6', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('claude-sonnet-4-6 with settings model "sonnet[1m]" → 1M (explicit override)', async () => {
    const settingsPath = await writeSettings({ model: 'sonnet[1m]' })
    expect(await detectWindowSize('claude-sonnet-4-6', 50_000, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it('claude-haiku-4-5-20251001 → 200k', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-haiku-4-5-20251001', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('unknown/garbage modelId under 200k → 200k', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('totally-bogus-id', 50_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )
  })

  it('unknown/garbage modelId over 200k → 1M (threshold override still works)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('totally-bogus-id', 250_000, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it('claude-mythos-preview → 1M (allowlisted 1M-native)', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-mythos-preview', 0, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })
})

describe('windowForModelId classification (the registry the detector consults)', () => {
  // Previously routed through `modelNativelySupportsExtended`, a boolean wrapper
  // kept only so tests could mock it. No production caller, so it was deleted and
  // these now name the real policy entry point.
  const cases: ReadonlyArray<[id: string, isExtended: boolean]> = [
    // 4.6 is NOT auto-upgraded on the metered layer (#41 §9.2).
    ['claude-opus-4-5', false],
    ['claude-opus-4-6', false],
    ['claude-opus-4-7', true],
    ['claude-opus-4-8', true],
    ['claude-opus-4-9', true], // bounded extrapolation past the newest entry
    ['claude-opus-5-0', true],
    ['claude-opus-4-1', false],
    // All Sonnet below 5, and all Haiku, stay 200k.
    ['claude-sonnet-4-6', false],
    ['claude-sonnet-4-5', false],
    ['claude-haiku-4-5-20251001', false],
    // Dated snapshots resolve through their undated alias; casing is normalised.
    ['claude-opus-4-8-20260115', true],
    ['CLAUDE-OPUS-4-8', true],
    ['claude-mythos-preview', true], // the undecomposable-id allowlist
    // Garbage and unparseable ids get no 1M answer.
    ['totally-bogus-id', false],
    ['', false],
    ['claude-opus', false],
    ['claude-opus-x-y', false]
  ]

  it.each(cases)('%s → extended window: %s', (id, isExtended) => {
    expect(windowForModelId(id) === EXTENDED_WINDOW).toBe(isExtended)
  })
})

describe('detectWindowSize settings cache (short TTL)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads settings.json once across two calls within the TTL', async () => {
    const settingsPath = await writeSettings({ model: 'opus[1m]' })
    const readSpy = vi.spyOn(fs, 'readFile')
    let nowMs = 1000

    const first = await detectWindowSize('claude-sonnet-4-5', 50_000, false, {
      settingsPath,
      now: () => nowMs
    })
    const readsAfterFirst = readSpy.mock.calls.filter((c) => c[0] === settingsPath).length

    nowMs = 1000 + 4999 // still inside the 5000ms TTL
    const second = await detectWindowSize('claude-sonnet-4-5', 50_000, false, {
      settingsPath,
      now: () => nowMs
    })

    expect(first).toBe(EXTENDED_WINDOW)
    expect(second).toBe(EXTENDED_WINDOW)
    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath).length).toBe(readsAfterFirst)
  })

  it('re-reads settings.json after the TTL elapses', async () => {
    const settingsPath = await writeSettings({ model: 'opus[1m]' })
    const readSpy = vi.spyOn(fs, 'readFile')
    let nowMs = 1000

    await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath, now: () => nowMs })
    const readsAfterFirst = readSpy.mock.calls.filter((c) => c[0] === settingsPath).length

    nowMs = 1000 + 5001 // just past the TTL
    await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath, now: () => nowMs })

    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath).length).toBe(
      readsAfterFirst + 1
    )
  })

  it('never reads settings.json when tokens already imply 1M', async () => {
    const settingsPath = await writeSettings({ model: 'opus' })
    const readSpy = vi.spyOn(fs, 'readFile')

    expect(await detectWindowSize('claude-sonnet-4-5', 250_000, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )

    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath)).toHaveLength(0)
  })

  it('__resetSettingsCacheForTests forces a fresh read', async () => {
    const settingsPath = await writeSettings({ model: 'opus[1m]' })
    const readSpy = vi.spyOn(fs, 'readFile')
    const nowMs = 1000

    await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath, now: () => nowMs })
    const readsAfterFirst = readSpy.mock.calls.filter((c) => c[0] === settingsPath).length

    __resetSettingsCacheForTests()
    await detectWindowSize('claude-sonnet-4-5', 50_000, false, { settingsPath, now: () => nowMs })

    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath).length).toBe(
      readsAfterFirst + 1
    )
  })
})

describe('#41 capability registry - AC1/AC3/AC4/AC5/AC7', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('AC1: answers claude-opus-5 from the registry with NO filesystem access', async () => {
    // Oracle note (#41 F11): an ABSENT settings path makes this spy vacuous —
    // `fs.stat` throws before `fs.readFile` is reached, so a zero-read assertion
    // passes on every path, including a broken registry. So use a REAL
    // settings.json whose `model` carries no `[1m]` (it therefore cannot be the
    // source of the 1M answer) and spy on BOTH calls. Control test below.
    const settingsPath = await writeSettings({ model: 'opus' })
    const statSpy = vi.spyOn(fs, 'stat')
    const readSpy = vi.spyOn(fs, 'readFile')

    expect(await detectWindowSize('claude-opus-5', 12_000, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )

    expect(statSpy.mock.calls.filter((c) => c[0] === settingsPath)).toHaveLength(0)
    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath)).toHaveLength(0)
  })

  it('AC1 oracle control: identical fixtures DO reach the file for a 200k model', async () => {
    const settingsPath = await writeSettings({ model: 'opus' })
    const statSpy = vi.spyOn(fs, 'stat')
    const readSpy = vi.spyOn(fs, 'readFile')

    expect(await detectWindowSize('claude-haiku-4-5', 12_000, false, { settingsPath })).toBe(
      STANDARD_WINDOW
    )

    expect(statSpy.mock.calls.filter((c) => c[0] === settingsPath).length).toBeGreaterThan(0)
    expect(readSpy.mock.calls.filter((c) => c[0] === settingsPath).length).toBeGreaterThan(0)
  })

  // Hand-authored from design §7.1; the FULL exact-map sweep (AC4) and the full
  // heuristic table (AC3) live in `modelId.test.ts`, where the registry is the
  // system under test. These rows pin that the answers flow through the detector.
  const registryCases: ReadonlyArray<[string, number]> = [
    ['claude-opus-5', EXTENDED_WINDOW],
    ['claude-sonnet-5', EXTENDED_WINDOW],
    ['claude-fable-5', EXTENDED_WINDOW],
    ['claude-mythos-preview', EXTENDED_WINDOW],
    ['claude-opus-4-6', STANDARD_WINDOW],
    ['claude-haiku-4-5', STANDARD_WINDOW],
    ['claude-opus-6', EXTENDED_WINDOW],
    ['claude-opus-7', STANDARD_WINDOW],
    ['claude-zephyr-9', STANDARD_WINDOW],
    ['claude-opus-4', STANDARD_WINDOW],
    ['claude-opus-3', STANDARD_WINDOW]
  ]

  it.each(registryCases)('AC3/AC4: %s at low usage reports %i', async (modelId, expected) => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize(modelId, 12_000, false, { settingsPath })).toBe(expected)
  })

  // AC5 is TWO claims the original single test conflated: invariance holds for
  // registry-1M models and deliberately does NOT hold for registry-200k ones.
  const AC5_SWEEP = [0, 199_999, 200_000, 200_001, 250_000]

  it.each(['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5'])(
    'AC5a: %s (registry-1M) reports the SAME window at every usage point',
    async (modelId) => {
      // Three families, not one row, so this pins the RULE.
      const settingsPath = path.join(tmpDir, 'absent.json')
      const results = await Promise.all(
        AC5_SWEEP.map((used) => detectWindowSize(modelId, used, false, { settingsPath }))
      )

      expect(new Set(results).size).toBe(1)
      expect(results).toEqual(AC5_SWEEP.map(() => EXTENDED_WINDOW))
    }
  )

  it.each(['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'])(
    'AC5b: %s (registry-200k) is invariant BELOW the boundary and must flip above it',
    async (modelId) => {
      // The half of AC5 deliberately NOT invariant: a 200k window cannot hold
      // 200_001 tokens, so R2 must override the registry or the meter pins red at
      // 100%. All three rows are registry-RESOLVED, which is why the AC's original
      // wording was false.
      const settingsPath = path.join(tmpDir, 'absent.json')
      for (const used of [0, 199_999, 200_000]) {
        expect(await detectWindowSize(modelId, used, false, { settingsPath })).toBe(STANDARD_WINDOW)
      }

      expect(await detectWindowSize(modelId, 200_001, false, { settingsPath })).toBe(
        EXTENDED_WINDOW
      )
    }
  )

  it('AC5c: an id with NO registry opinion reaches the flip by a different path', async () => {
    // Mechanism differs from AC5b: an unknown family means the registry declines
    // and the verdict falls through R4 before R2 upgrades it, whereas AC5b's rows
    // are answered by the exact map. One loop over both hides a one-route break.
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(windowForModelId('claude-zephyr-9')).toBeNull()

    for (const used of [0, 199_999, 200_000]) {
      expect(await detectWindowSize('claude-zephyr-9', used, false, { settingsPath })).toBe(
        STANDARD_WINDOW
      )
    }
    expect(await detectWindowSize('claude-zephyr-9', 200_001, false, { settingsPath })).toBe(
      EXTENDED_WINDOW
    )
  })

  it("AC7: opts.forceStandard outranks a registry that says 1M (R0')", async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(
      await detectWindowSize('claude-opus-5', 12_000, false, { settingsPath, forceStandard: true })
    ).toBe(STANDARD_WINDOW)
    // R0 still outranks R0': an explicit `[1m]` selection wins.
    expect(
      await detectWindowSize('claude-opus-5', 12_000, true, { settingsPath, forceStandard: true })
    ).toBe(EXTENDED_WINDOW)
  })
})
