// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * fallbackGuard — file-version result-cache unit tests (SD-047, #47).
 *
 * Exercises the caching module in isolation (no filesystem, no parser): the
 * provisional→finalise→rollback lifecycle, cache HIT/MISS by version, and the FIFO
 * eviction cap (AC6). The parser-integration behaviour (T1–T8) lives in
 * `ClaudeTranscriptParser.fallbackGuard.test.ts`.
 *
 * @see docs/designs/47-context-meter-freeze.md §3.2, §4
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ParsedTurn } from './ClaudeTranscriptParser'
import {
  MAX_FALLBACK_GUARD_ENTRIES,
  __fallbackGuardSizeForTests,
  __resetFallbackGuardForTests,
  finalizeFallbackResult,
  getFallbackResult,
  recordFallbackProvisional,
  rollbackFallbackProvisional
} from './fallbackGuard'

// Imported from source (not a local literal) so the cap can't silently drift.
const MAX_ENTRIES = MAX_FALLBACK_GUARD_ENTRIES

const TURN: ParsedTurn = { modelId: 'claude-opus-4-8', usedTokens: 4242 }

beforeEach(() => {
  __resetFallbackGuardForTests()
})

describe('getFallbackResult', () => {
  it('returns undefined on a miss (unknown path)', () => {
    expect(getFallbackResult('/a.jsonl', 'v1')).toBeUndefined()
  })

  it('returns undefined when the version does not match', () => {
    finalizeFallbackResult('/a.jsonl', 'v1', TURN)
    expect(getFallbackResult('/a.jsonl', 'v2')).toBeUndefined()
  })

  it('returns the cached result on a version match', () => {
    finalizeFallbackResult('/a.jsonl', 'v1', TURN)
    expect(getFallbackResult('/a.jsonl', 'v1')).toEqual({
      version: 'v1',
      turn: TURN,
      provisional: false
    })
  })
})

describe('provisional lifecycle', () => {
  it('recordFallbackProvisional inserts a provisional { turn: null } placeholder', () => {
    recordFallbackProvisional('/a.jsonl', 'v1')
    expect(getFallbackResult('/a.jsonl', 'v1')).toEqual({
      version: 'v1',
      turn: null,
      provisional: true
    })
    expect(__fallbackGuardSizeForTests()).toBe(1)
  })

  it('finalizeFallbackResult overwrites the placeholder in place (no size growth) and clears provisional', () => {
    recordFallbackProvisional('/a.jsonl', 'v1')
    finalizeFallbackResult('/a.jsonl', 'v1', TURN)
    expect(getFallbackResult('/a.jsonl', 'v1')).toEqual({
      version: 'v1',
      turn: TURN,
      provisional: false
    })
    expect(__fallbackGuardSizeForTests()).toBe(1)
  })

  it('finalizeFallbackResult can cache a genuine no-turn null (finalized, not provisional)', () => {
    recordFallbackProvisional('/a.jsonl', 'v1')
    finalizeFallbackResult('/a.jsonl', 'v1', null)
    expect(getFallbackResult('/a.jsonl', 'v1')).toEqual({
      version: 'v1',
      turn: null,
      provisional: false
    })
  })
})

describe('rollbackFallbackProvisional', () => {
  it('deletes the provisional entry for the matching version', () => {
    recordFallbackProvisional('/a.jsonl', 'v1')
    rollbackFallbackProvisional('/a.jsonl', 'v1')
    expect(getFallbackResult('/a.jsonl', 'v1')).toBeUndefined()
    expect(__fallbackGuardSizeForTests()).toBe(0)
  })

  it('does NOT delete a finalized real result (concurrent finalise not clobbered)', () => {
    // Simulates a concurrent completed read finalising a real turn for this
    // version before the failing read rolls back: rollback must be a no-op.
    finalizeFallbackResult('/a.jsonl', 'v1', TURN)
    rollbackFallbackProvisional('/a.jsonl', 'v1')
    expect(getFallbackResult('/a.jsonl', 'v1')).toEqual({
      version: 'v1',
      turn: TURN,
      provisional: false
    })
  })

  it('does NOT delete a FINALIZED no-turn null (finalized negative preserved)', () => {
    // The Fix 2 invariant: a finalized `{ turn: null }` is byte-identical in turn
    // value to a provisional placeholder, but the `provisional` flag distinguishes
    // them. Under an eviction + concurrent-re-miss + read-failure interleaving a
    // stale rollback must NOT delete this real negative (which would force a
    // redundant 2 MB re-read, breaking at-most-once).
    finalizeFallbackResult('/a.jsonl', 'v1', null)
    rollbackFallbackProvisional('/a.jsonl', 'v1')
    expect(getFallbackResult('/a.jsonl', 'v1')).toEqual({
      version: 'v1',
      turn: null,
      provisional: false
    })
    expect(__fallbackGuardSizeForTests()).toBe(1)
  })

  it('does NOT delete when the version has moved on', () => {
    recordFallbackProvisional('/a.jsonl', 'v2')
    rollbackFallbackProvisional('/a.jsonl', 'v1') // stale rollback for an old version
    expect(getFallbackResult('/a.jsonl', 'v2')).toEqual({
      version: 'v2',
      turn: null,
      provisional: true
    })
    expect(__fallbackGuardSizeForTests()).toBe(1)
  })

  it('is a no-op for an unknown path', () => {
    rollbackFallbackProvisional('/missing.jsonl', 'v1')
    expect(__fallbackGuardSizeForTests()).toBe(0)
  })
})

describe('FIFO eviction bound (AC6)', () => {
  it('never exceeds MAX_FALLBACK_GUARD_ENTRIES across many distinct paths', () => {
    for (let i = 0; i < MAX_ENTRIES + 44; i++) {
      finalizeFallbackResult(`/rotated-${i}.jsonl`, 'v1', null)
      expect(__fallbackGuardSizeForTests()).toBeLessThanOrEqual(MAX_ENTRIES)
    }
    expect(__fallbackGuardSizeForTests()).toBe(MAX_ENTRIES)
  })

  it('evicts the oldest-by-insertion (FIFO) when a new key is added at cap', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      finalizeFallbackResult(`/f-${i}.jsonl`, 'v1', null)
    }
    // At cap: adding a NEW key evicts the first-inserted (/f-0).
    finalizeFallbackResult('/f-new.jsonl', 'v1', null)
    expect(getFallbackResult('/f-0.jsonl', 'v1')).toBeUndefined() // evicted
    expect(getFallbackResult('/f-1.jsonl', 'v1')).toBeDefined() // still present
    expect(getFallbackResult('/f-new.jsonl', 'v1')).toBeDefined()
    expect(__fallbackGuardSizeForTests()).toBe(MAX_ENTRIES)
  })

  it('re-keying an existing path overwrites in place without eviction', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      finalizeFallbackResult(`/f-${i}.jsonl`, 'v1', null)
    }
    // Overwrite an existing key at cap: no eviction, no size change.
    finalizeFallbackResult('/f-0.jsonl', 'v2', TURN)
    expect(getFallbackResult('/f-0.jsonl', 'v2')).toEqual({
      version: 'v2',
      turn: TURN,
      provisional: false
    })
    expect(__fallbackGuardSizeForTests()).toBe(MAX_ENTRIES)
  })
})

describe('__resetFallbackGuardForTests', () => {
  it('clears all entries', () => {
    finalizeFallbackResult('/a.jsonl', 'v1', TURN)
    finalizeFallbackResult('/b.jsonl', 'v1', null)
    __resetFallbackGuardForTests()
    expect(__fallbackGuardSizeForTests()).toBe(0)
    expect(getFallbackResult('/a.jsonl', 'v1')).toBeUndefined()
  })
})
