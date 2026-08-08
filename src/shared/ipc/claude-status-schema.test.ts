// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claude Status Schema Tests
 *
 * Validates the Zod schemas for the per-terminal Claude Code status bar:
 * window-size literal union, snapshot field constraints, nullable snapshot in
 * the change payload, and the pid-free register request.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §10
 */
import { describe, it, expect } from 'vitest'
import {
  ClaudeStatusLevel,
  ClaudeWindowSize,
  ClaudeStatusSnapshotSchema,
  ClaudeStatusChangePayloadSchema,
  ClaudeStatusRegisterRequestSchema,
  ClaudeStatusNudgeRequestSchema,
  MAX_MODEL_ID_LENGTH,
  MAX_TOOLTIP_LENGTH,
  type ClaudeStatusSnapshot,
  type ClaudeStatusChangePayload,
  type ClaudeStatusRegisterRequest
} from './claude-status-schema'

const validSnapshot: ClaudeStatusSnapshot = {
  terminalId: 'term-1',
  modelId: 'claude-opus-4-8',
  friendlyName: 'Opus 4.8',
  windowSize: 200000,
  usedTokens: 84000,
  percent: 42,
  level: 'green',
  tooltip: '84k / 200k',
  inferred: false
}

describe('ClaudeStatusLevel', () => {
  it('accepts green, amber, red', () => {
    expect(ClaudeStatusLevel.parse('green')).toBe('green')
    expect(ClaudeStatusLevel.parse('amber')).toBe('amber')
    expect(ClaudeStatusLevel.parse('red')).toBe('red')
  })

  it('rejects other strings', () => {
    expect(() => ClaudeStatusLevel.parse('yellow')).toThrow()
    expect(() => ClaudeStatusLevel.parse('')).toThrow()
  })
})

describe('ClaudeWindowSize', () => {
  it('accepts 200000', () => {
    expect(ClaudeWindowSize.parse(200000)).toBe(200000)
  })

  it('accepts 1000000', () => {
    expect(ClaudeWindowSize.parse(1000000)).toBe(1000000)
  })

  it('rejects any other number', () => {
    expect(() => ClaudeWindowSize.parse(100000)).toThrow()
    expect(() => ClaudeWindowSize.parse(500000)).toThrow()
    expect(() => ClaudeWindowSize.parse(0)).toThrow()
  })

  it('rejects non-numeric values', () => {
    expect(() => ClaudeWindowSize.parse('200000')).toThrow()
    expect(() => ClaudeWindowSize.parse(null)).toThrow()
  })
})

describe('ClaudeStatusSnapshotSchema', () => {
  it('accepts a fully valid snapshot', () => {
    expect(ClaudeStatusSnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot)
  })

  it('accepts a 1M window snapshot', () => {
    const snap = { ...validSnapshot, windowSize: 1000000 as const, tooltip: '95k / 1M' }
    expect(ClaudeStatusSnapshotSchema.parse(snap).windowSize).toBe(1000000)
  })

  it('rejects empty terminalId', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, terminalId: '' })).toThrow()
  })

  it('rejects an invalid windowSize', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, windowSize: 300000 })).toThrow()
  })

  it('rejects negative usedTokens', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, usedTokens: -1 })).toThrow()
  })

  it('rejects non-integer usedTokens', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, usedTokens: 1.5 })).toThrow()
  })

  it('rejects percent below 0', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, percent: -0.1 })).toThrow()
  })

  it('rejects percent above 100', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, percent: 100.1 })).toThrow()
  })

  it('accepts percent at the 0 and 100 boundaries', () => {
    expect(ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, percent: 0 }).percent).toBe(0)
    expect(ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, percent: 100 }).percent).toBe(100)
  })

  it('rejects an invalid level', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, level: 'blue' })).toThrow()
  })

  it('rejects a missing field', () => {
    const partial: Record<string, unknown> = { ...validSnapshot }
    delete partial.tooltip
    expect(() => ClaudeStatusSnapshotSchema.parse(partial)).toThrow()
  })

  it('rejects a non-boolean inferred flag', () => {
    expect(() => ClaudeStatusSnapshotSchema.parse({ ...validSnapshot, inferred: 'yes' })).toThrow()
  })
})

describe('ClaudeStatusSnapshotSchema - length bounds (#41)', () => {
  // These bounds had NO assertions until now: deleting every `.max()` broke no
  // test. The inverse is what makes that dangerous — the register handler
  // `safeParse`s and DROPS the payload on failure, so if the main-side sanitizer
  // and these bounds ever diverge the status bar silently disappears with a
  // green suite. Everything below is asserted against the exported constants,
  // never a literal, so widening a bound is a deliberate two-file edit.
  const bounded: ReadonlyArray<[field: 'modelId' | 'friendlyName' | 'tooltip', max: number]> = [
    ['modelId', MAX_MODEL_ID_LENGTH],
    ['friendlyName', MAX_MODEL_ID_LENGTH],
    ['tooltip', MAX_TOOLTIP_LENGTH]
  ]

  it.each(bounded)('accepts %s at exactly its bound', (field, max) => {
    const snap = { ...validSnapshot, [field]: 'x'.repeat(max) }
    expect(ClaudeStatusSnapshotSchema.parse(snap)[field]).toHaveLength(max)
  })

  it.each(bounded)('rejects %s one character over its bound', (field, max) => {
    const snap = { ...validSnapshot, [field]: 'x'.repeat(max + 1) }
    expect(() => ClaudeStatusSnapshotSchema.parse(snap)).toThrow()
  })

  it.each(bounded)('enforces the %s bound through the change payload too', (field, max) => {
    // The payload is what actually crosses IPC; an unbounded field would not be
    // caught by asserting on the bare snapshot schema alone.
    const overLong = { ...validSnapshot, [field]: 'x'.repeat(max + 1) }
    expect(() =>
      ClaudeStatusChangePayloadSchema.parse({ terminalId: 'term-1', snapshot: overLong })
    ).toThrow()

    const atBound = { ...validSnapshot, [field]: 'x'.repeat(max) }
    expect(
      ClaudeStatusChangePayloadSchema.parse({ terminalId: 'term-1', snapshot: atBound }).snapshot
    ).not.toBeNull()
  })

  it('pins the constants themselves, so widening one is deliberate', () => {
    // The sanitizer in main truncates to MAX_MODEL_ID_LENGTH. If someone raises
    // it here without raising it there (or vice versa) the two caps diverge and
    // the bar vanishes; this and the coupling test in friendlyModelName.test.ts
    // are the pair that makes that a failing build rather than a silent hide.
    expect(MAX_MODEL_ID_LENGTH).toBe(64)
    expect(MAX_TOOLTIP_LENGTH).toBe(128)
    expect(MAX_TOOLTIP_LENGTH).toBeGreaterThan(MAX_MODEL_ID_LENGTH)
  })
})

describe('ClaudeStatusChangePayloadSchema', () => {
  it('accepts a payload with a snapshot', () => {
    const payload = { terminalId: 'term-1', snapshot: validSnapshot }
    expect(ClaudeStatusChangePayloadSchema.parse(payload)).toEqual(payload)
  })

  it('accepts a payload with a null snapshot (hide the bar)', () => {
    const payload = { terminalId: 'term-1', snapshot: null }
    expect(ClaudeStatusChangePayloadSchema.parse(payload).snapshot).toBeNull()
  })

  it('rejects a payload missing the snapshot key', () => {
    expect(() => ClaudeStatusChangePayloadSchema.parse({ terminalId: 'term-1' })).toThrow()
  })

  it('rejects an empty terminalId', () => {
    expect(() =>
      ClaudeStatusChangePayloadSchema.parse({ terminalId: '', snapshot: null })
    ).toThrow()
  })

  it('rejects an invalid embedded snapshot', () => {
    expect(() =>
      ClaudeStatusChangePayloadSchema.parse({
        terminalId: 'term-1',
        snapshot: { ...validSnapshot, windowSize: 7 }
      })
    ).toThrow()
  })
})

describe('ClaudeStatusRegisterRequestSchema', () => {
  it('accepts a terminalId-only request', () => {
    expect(ClaudeStatusRegisterRequestSchema.parse({ terminalId: 'term-1' })).toEqual({
      terminalId: 'term-1'
    })
  })

  it('rejects an empty terminalId', () => {
    expect(() => ClaudeStatusRegisterRequestSchema.parse({ terminalId: '' })).toThrow()
  })

  it('strips any renderer-supplied pid (never trusted, §10)', () => {
    const parsed = ClaudeStatusRegisterRequestSchema.parse({ terminalId: 'term-1', pid: 1234 })
    expect(parsed).toEqual({ terminalId: 'term-1' })
    expect('pid' in parsed).toBe(false)
  })
})

describe('ClaudeStatusNudgeRequestSchema', () => {
  it('reuses the terminalId-only register shape', () => {
    expect(ClaudeStatusNudgeRequestSchema).toBe(ClaudeStatusRegisterRequestSchema)
    expect(ClaudeStatusNudgeRequestSchema.parse({ terminalId: 'term-1' })).toEqual({
      terminalId: 'term-1'
    })
  })
})

describe('Type inference', () => {
  it('infers ClaudeStatusSnapshot', () => {
    const snap: ClaudeStatusSnapshot = validSnapshot
    expect(snap.friendlyName).toBe('Opus 4.8')
  })

  it('infers ClaudeStatusChangePayload', () => {
    const payload: ClaudeStatusChangePayload = { terminalId: 'term-1', snapshot: null }
    expect(payload.snapshot).toBeNull()
  })

  it('infers ClaudeStatusRegisterRequest', () => {
    const req: ClaudeStatusRegisterRequest = { terminalId: 'term-1' }
    expect(req.terminalId).toBe('term-1')
  })
})
