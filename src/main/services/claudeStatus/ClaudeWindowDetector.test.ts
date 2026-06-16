// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeWindowDetector tests.
 *
 * Covers the hybrid 200k-vs-1M detection: the settings `[1m]` signal (even under
 * 200k usage), the used>200k threshold, and the defensive fall-throughs for a
 * missing / malformed / oversize settings file.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §8, §10
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectWindowSize,
  modelNativelySupportsExtended,
  EXTENDED_THRESHOLD,
  EXTENDED_WINDOW,
  STANDARD_WINDOW,
  __resetSettingsCacheForTests
} from './ClaudeWindowDetector'

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

describe('detectWindowSize model-capability registry (Opus 4.6+ auto-1M)', () => {
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

  it('claude-opus-4-6 → 1M', async () => {
    const settingsPath = path.join(tmpDir, 'absent.json')
    expect(await detectWindowSize('claude-opus-4-6', 0, false, { settingsPath })).toBe(EXTENDED_WINDOW)
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

describe('modelNativelySupportsExtended', () => {
  it('returns false for Opus 4.5 (boundary, not auto-upgraded)', () => {
    expect(modelNativelySupportsExtended('claude-opus-4-5')).toBe(false)
  })

  it('returns true for Opus 4.6 (boundary, first auto-upgraded)', () => {
    expect(modelNativelySupportsExtended('claude-opus-4-6')).toBe(true)
  })

  it('returns true for Opus 4.7 / 4.8', () => {
    expect(modelNativelySupportsExtended('claude-opus-4-7')).toBe(true)
    expect(modelNativelySupportsExtended('claude-opus-4-8')).toBe(true)
  })

  it('returns true for a future Opus 4.9 / 5.0', () => {
    expect(modelNativelySupportsExtended('claude-opus-4-9')).toBe(true)
    expect(modelNativelySupportsExtended('claude-opus-5-0')).toBe(true)
  })

  it('returns false for Opus 4.1 (older)', () => {
    expect(modelNativelySupportsExtended('claude-opus-4-1')).toBe(false)
  })

  it('returns false for all Sonnet (incl. 4.6 — not auto)', () => {
    expect(modelNativelySupportsExtended('claude-sonnet-4-6')).toBe(false)
    expect(modelNativelySupportsExtended('claude-sonnet-4-5')).toBe(false)
  })

  it('returns false for all Haiku', () => {
    expect(modelNativelySupportsExtended('claude-haiku-4-5-20251001')).toBe(false)
  })

  it('returns false for garbage / unparseable ids', () => {
    expect(modelNativelySupportsExtended('totally-bogus-id')).toBe(false)
    expect(modelNativelySupportsExtended('')).toBe(false)
    expect(modelNativelySupportsExtended('claude-opus')).toBe(false)
    expect(modelNativelySupportsExtended('claude-opus-x-y')).toBe(false)
  })

  it('tolerates dated/suffixed Opus ids and mixed case', () => {
    expect(modelNativelySupportsExtended('claude-opus-4-8-20260115')).toBe(true)
    expect(modelNativelySupportsExtended('CLAUDE-OPUS-4-8')).toBe(true)
  })

  it('returns true for the allowlisted claude-mythos-preview', () => {
    expect(modelNativelySupportsExtended('claude-mythos-preview')).toBe(true)
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
