// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeTranscriptParser — bounded-fallback + version-guard tests (SD-047, #47).
 *
 * Guards the compaction-freeze fix: the tail-miss fallback now reads at most
 * {@link FALLBACK_READ_MAX_BYTES} (2 MB) instead of the whole file, is issued at
 * most once per transcript file-version, and CACHES its result so a recovered
 * turn is re-served on every suppressed refresh (the freeze is gone, the meter is
 * not blanked). All fixtures are real temp `.jsonl` files so `stat()` size/mtime
 * are real; no `vi.spyOn` on private module internals (they are same-module
 * functions, un-interceptable under ESM) — every assertion is behavioural or via
 * the exported test-only size accessor.
 *
 * Scope: parser-integration cases (T1 boundary, T2 suppression, T3 recovery-then-
 * refresh, T4 branch-(D) rollback via injected reader, T5 version-change, T6 fail-
 * closed, T8 concurrency). The guard-storage unit tests — eviction/cap (AC6, was
 * T7) and the provisional/rollback lifecycle — live in `fallbackGuard.test.ts`.
 *
 * @see docs/designs/47-context-meter-freeze.md §8 (test plan T1–T8)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  FALLBACK_READ_MAX_BYTES,
  TAIL_THRESHOLD_BYTES,
  parseTranscript
} from './ClaudeTranscriptParser'
import {
  __resetFallbackGuardForTests,
  __fallbackGuardSizeForTests,
  getFallbackResult
} from './fallbackGuard'

// The parser's real thresholds — imported (not re-declared) so the fixtures place
// turns in a chosen band relative to EOF and can never drift from source.
const TAIL_BYTES = TAIL_THRESHOLD_BYTES
const FALLBACK_BYTES = FALLBACK_READ_MAX_BYTES

/** Every fixture line is padded to this exact byte width (equal-length swaps). */
const LINE_WIDTH = 512

let tmpDir: string

beforeEach(async () => {
  __resetFallbackGuardForTests()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-fallback-'))
})

afterEach(async () => {
  __resetFallbackGuardForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/**
 * Serialise `obj` and pad it with a `_pad` string to EXACTLY `width` bytes, so
 * every line is the same width and a filler↔turn swap preserves total file size
 * (required to keep the `${size}:${mtimeMs}` version key stable across a rewrite).
 * `_pad` is an unknown top-level field the parser ignores.
 */
function padLine(obj: Record<string, unknown>, width = LINE_WIDTH): string {
  const base = JSON.stringify({ ...obj, _pad: '' })
  const pad = width - base.length
  if (pad < 0) throw new Error(`LINE_WIDTH too small for ${base.length}-byte line`)
  return JSON.stringify({ ...obj, _pad: 'p'.repeat(pad) })
}

/** A non-usable filler record (ignored by the scan) padded to LINE_WIDTH. */
function fillerLine(): string {
  return padLine({ type: 'user', message: { role: 'user', content: 'f' } })
}

/** A usable main-session assistant turn padded to LINE_WIDTH. */
function turnLine(input = 4242): string {
  return padLine({
    type: 'assistant',
    isSidechain: false,
    message: { model: 'claude-opus-4-8', usage: { input_tokens: input } }
  })
}

/**
 * Build `n` LINE_WIDTH-byte lines; the line at index `turnAt` (if any) is a
 * usable turn, the rest filler. With fixed-width lines the byte distance from a
 * turn to EOF is `(n - 1 - turnAt) * (LINE_WIDTH + 1)` — used to place a turn in
 * the 256 KB–2 MB "fallback band" or beyond the 2 MB window.
 */
function buildContent(n: number, turnAt: number | null, turnInput = 4242): string {
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    lines.push(i === turnAt ? turnLine(turnInput) : fillerLine())
  }
  return lines.join('\n')
}

/** Write `content` to a temp `.jsonl` and return its absolute path. */
async function writeTranscript(content: string, name = 'session.jsonl'): Promise<string> {
  const file = path.join(tmpDir, name)
  await fs.writeFile(file, content, 'utf8')
  return file
}

/** Pin a file's mtime (and atime) to a fixed instant so its version key is stable. */
const PINNED = new Date(1_700_000_000_000)
async function pinMtime(file: string): Promise<void> {
  await fs.utimes(file, PINNED, PINNED)
}

// A turn ~1000 lines from EOF (~0.5 MB): past the 256 KB tail, inside the 2 MB
// fallback window → recoverable by the bounded read.
const IN_BAND_N = 2000
const IN_BAND_AT = 1000

// A turn ~4200 lines from EOF (~2.15 MB) in a >2 MB file: beyond the 2 MB
// fallback window → NOT recoverable, proving the whole-file read is gone.
const OUT_OF_BAND_N = 4300
const OUT_OF_BAND_AT = 100

// A no-turn fixture just over the 256 KB tail so the fallback fires but finds
// nothing usable even inside 2 MB.
const NO_TURN_N = 520

describe('bounded-fallback read (AC1)', () => {
  it('T1: recovers a turn in the 256 KB–2 MB band but NOT one beyond 2 MB', async () => {
    // (a) in-band → recovered.
    const inBand = await writeTranscript(buildContent(IN_BAND_N, IN_BAND_AT, 4242), 'in-band.jsonl')
    const inStat = await fs.stat(inBand)
    expect(inStat.size).toBeGreaterThan(TAIL_BYTES)
    expect(inStat.size).toBeLessThan(FALLBACK_BYTES)
    expect(await parseTranscript(inBand)).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 4242 })

    // (b) same turn placed >2 MB from EOF in a >2 MB file → not recovered.
    const outBand = await writeTranscript(
      buildContent(OUT_OF_BAND_N, OUT_OF_BAND_AT, 4242),
      'out-of-band.jsonl'
    )
    const outStat = await fs.stat(outBand)
    expect(outStat.size).toBeGreaterThan(FALLBACK_BYTES)
    expect(await parseTranscript(outBand)).toBeNull()
  })
})

describe('version-guard suppression (AC2)', () => {
  it('T2: skips the read and re-serves the cached result for an unchanged version', async () => {
    // R1: no-turn fixture over the tail → fallback finds nothing → caches null.
    const file = await writeTranscript(buildContent(IN_BAND_N, null), 'stable.jsonl')
    await pinMtime(file)
    const statBefore = await fs.stat(file)
    const versionKeyBefore = `${statBefore.size}:${statBefore.mtimeMs}`
    const r1 = await parseTranscript(file)
    expect(r1).toBeNull()

    // Rewrite with EQUAL-length content that injects a valid in-band turn, and
    // re-pin mtime → identical `${size}:${mtimeMs}` version key.
    await fs.writeFile(file, buildContent(IN_BAND_N, IN_BAND_AT, 4242), 'utf8')
    await pinMtime(file)

    // Assert the two version keys are ACTUALLY equal, so the suppression below is
    // asserted (same key ⇒ cache HIT) rather than inferred from a possibly-vacuous
    // null (e.g. an accidental size/mtime drift would make R2 a fresh read).
    const statAfter = await fs.stat(file)
    const versionKeyAfter = `${statAfter.size}:${statAfter.mtimeMs}`
    expect(versionKeyAfter).toBe(versionKeyBefore)

    // R2 must re-serve the cached null (the read was skipped), NOT the new turn.
    const r2 = await parseTranscript(file)
    expect(r2).toEqual(r1)
    expect(r2).toBeNull()

    // Sanity: the injected turn IS genuinely recoverable — clearing the guard
    // (new "version" logically) recovers it, proving R2 was a true suppression.
    __resetFallbackGuardForTests()
    expect(await parseTranscript(file)).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 4242 })
  })

  it('T3: re-serves a recovered turn on a second refresh of the same version (blocker)', async () => {
    const file = await writeTranscript(buildContent(IN_BAND_N, IN_BAND_AT, 4242))
    const first = await parseTranscript(file)
    const second = await parseTranscript(file)
    expect(first).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 4242 })
    // The blocker guarded here: the second call must NOT return null (which would
    // make runRefresh hide the bar after a one-shot recovery).
    expect(second).toEqual(first)
    expect(__fallbackGuardSizeForTests()).toBe(1)
  })

  it('T4: branch (D) — a failed BOUNDED read rolls back and is NOT cached; a later readable refresh recovers (major)', async () => {
    // Now that parseTranscript takes an injectable reader, drive the exact branch
    // (D) split the missing-file case could not: the TAIL read succeeds (truncated,
    // no usable turn → fallback fires) but the BOUNDED (2 MB) read returns null on a
    // STABLE version. That exercises the provisional-insert → rollback path, not the
    // early `read === null` return. All in-memory; no fs, no spies on internals.
    const stableVersion = { size: 5_000_000, mtimeMs: 1_700_000_000_000 }
    const versionKey = `${stableVersion.size}:${stableVersion.mtimeMs}`
    const file = path.join(tmpDir, 'branch-d.jsonl')

    // Injected-reader signature mirrors the parser's private readRelevantText.
    type ReadResult = { text: string; truncated: boolean; size: number; mtimeMs: number }
    type ReadFn = (filePath: string, maxBytes: number) => Promise<ReadResult | null>

    // Tail read yields text with NO usable turn; bounded read fails (null).
    const failingReader: ReadFn = async (_f, maxBytes) => {
      if (maxBytes <= TAIL_BYTES) {
        return { text: fillerLine(), truncated: true, ...stableVersion }
      }
      return null // bounded read fails transiently
    }

    // (a) returns null without throwing.
    await expect(parseTranscript(file, undefined, failingReader)).resolves.toBeNull()
    // (b) the failure was NOT cached — the provisional entry was rolled back.
    expect(__fallbackGuardSizeForTests()).toBe(0)
    expect(getFallbackResult(file, versionKey)).toBeUndefined()

    // (c) a subsequent refresh with a WORKING reader (same stable version) recovers
    //     the turn — proving the transient failure did not permanently suppress it.
    //     The reader is wrapped in a counter so the bounded (2 MB) read invocation
    //     count can be asserted directly (see (d)).
    let boundedReads = 0
    const workingReader: ReadFn = async (_f, maxBytes) => {
      if (maxBytes <= TAIL_BYTES) {
        return { text: fillerLine(), truncated: true, ...stableVersion }
      }
      boundedReads++
      return { text: turnLine(777), truncated: true, ...stableVersion }
    }
    const recovered = { modelId: 'claude-opus-4-8', usedTokens: 777 }
    await expect(parseTranscript(file, undefined, workingReader)).resolves.toEqual(recovered)

    // (d) at-most-once bounded read per version: repeated refreshes on the SAME
    //     stable version re-serve the cached turn (branch A) and never re-issue the
    //     2 MB read — the invariant asserted directly, not inferred from cache size.
    await expect(parseTranscript(file, undefined, workingReader)).resolves.toEqual(recovered)
    await expect(parseTranscript(file, undefined, workingReader)).resolves.toEqual(recovered)
    expect(boundedReads).toBe(1)
  })

  it('T4b: a THROWING bounded read rolls back the provisional and fails closed to null (never poisons the cache)', async () => {
    // Fix 1: if the bounded read (or scan/log) THROWS between the provisional
    // insert and the finalize/rollback, parseTranscript must (a) resolve null
    // without rejecting, (b) leave NO provisional entry behind (rolled back on the
    // throw path), and (c) not permanently poison the version — a later working
    // reader on the SAME version must still recover the turn.
    const stableVersion = { size: 5_000_000, mtimeMs: 1_700_000_000_000 }
    const versionKey = `${stableVersion.size}:${stableVersion.mtimeMs}`
    const file = path.join(tmpDir, 'throwing.jsonl')

    type ReadResult = { text: string; truncated: boolean; size: number; mtimeMs: number }
    type ReadFn = (filePath: string, maxBytes: number) => Promise<ReadResult | null>

    // Tail read yields a truncated no-turn window; the bounded (2 MB) read THROWS.
    const throwingReader: ReadFn = async (_f, maxBytes) => {
      if (maxBytes <= TAIL_BYTES) {
        return { text: fillerLine(), truncated: true, ...stableVersion }
      }
      throw new Error('simulated bounded-read failure')
    }

    // (a) resolves null, does not reject/throw.
    await expect(parseTranscript(file, undefined, throwingReader)).resolves.toBeNull()
    // (b) the provisional entry was rolled back on the throw path — nothing cached.
    expect(__fallbackGuardSizeForTests()).toBe(0)
    expect(getFallbackResult(file, versionKey)).toBeUndefined()

    // (c) the version is NOT permanently poisoned: a subsequent working reader on
    //     the same stable version recovers the turn.
    const workingReader: ReadFn = async (_f, maxBytes) => {
      if (maxBytes <= TAIL_BYTES) {
        return { text: fillerLine(), truncated: true, ...stableVersion }
      }
      return { text: turnLine(555), truncated: true, ...stableVersion }
    }
    await expect(parseTranscript(file, undefined, workingReader)).resolves.toEqual({
      modelId: 'claude-opus-4-8',
      usedTokens: 555
    })
  })
})

describe('version change re-enables recovery (AC3)', () => {
  it('T5: a new size/mtime triggers a fresh read reflecting the new content', async () => {
    const file = await writeTranscript(buildContent(IN_BAND_N, IN_BAND_AT, 1000))
    expect(await parseTranscript(file)).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 1000 })

    // Change the file (different size AND content) → new version key → fresh read.
    await fs.writeFile(file, buildContent(IN_BAND_N + 100, IN_BAND_AT, 2000), 'utf8')
    const refreshed = await parseTranscript(file)
    expect(refreshed).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 2000 })
  })
})

describe('fail-closed contract (AC5)', () => {
  it('T6: returns null without throwing when nothing usable exists within 2 MB', async () => {
    const file = await writeTranscript(buildContent(NO_TURN_N, null))
    const stat = await fs.stat(file)
    expect(stat.size).toBeGreaterThan(TAIL_BYTES) // fallback fires
    await expect(parseTranscript(file)).resolves.toBeNull()
    // A repeat call (cached null) still returns null, still no throw.
    await expect(parseTranscript(file)).resolves.toBeNull()
  })
})

describe('concurrency (AC2)', () => {
  it('T8: overlapping refreshes issue the bounded read exactly once (dedup by read count)', async () => {
    // Inject a counting reader (like T4) so the at-most-once invariant is asserted
    // DIRECTLY by the bounded-read invocation count, not inferred from the guard
    // size. Two overlapping parseTranscript calls for the same stable version must
    // share a single 2 MB read: the first inserts the provisional entry (no `await`
    // between get and set), the second sees it and does not re-issue the read.
    const stableVersion = { size: 5_000_000, mtimeMs: 1_700_000_000_000 }
    const file = path.join(tmpDir, 'concurrency.jsonl')

    type ReadResult = { text: string; truncated: boolean; size: number; mtimeMs: number }
    type ReadFn = (filePath: string, maxBytes: number) => Promise<ReadResult | null>

    let boundedReads = 0
    // Tail read yields a truncated no-turn window → fallback fires; the bounded read
    // also finds nothing usable (null result) but must run at most once.
    const countingReader: ReadFn = async (_f, maxBytes) => {
      if (maxBytes <= TAIL_BYTES) {
        return { text: fillerLine(), truncated: true, ...stableVersion }
      }
      boundedReads++
      return { text: fillerLine(), truncated: true, ...stableVersion }
    }

    const [a, b] = await Promise.all([
      parseTranscript(file, undefined, countingReader),
      parseTranscript(file, undefined, countingReader)
    ])
    expect(a).toBeNull()
    expect(b).toBe(a)
    // The invariant: the bounded (2 MB) read is issued exactly once across both
    // overlapping calls — deterministic, no real timers.
    expect(boundedReads).toBe(1)
    // Exactly one guard entry for the single file-version — no torn/duplicate state.
    expect(__fallbackGuardSizeForTests()).toBe(1)
  })
})
