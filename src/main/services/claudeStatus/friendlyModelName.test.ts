// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * friendlyModelName tests
 *
 * Covers the override table, generic derivation, dated-id handling, raw
 * fallback, and the §10 sanitization (control-char strip + length cap).
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §10
 */
import { describe, it, expect } from 'vitest'
import { friendlyModelName } from './friendlyModelName'

describe('friendlyModelName - override table', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['claude-opus-4-8', 'Opus 4.8'],
    ['claude-opus-4-7', 'Opus 4.7'],
    ['claude-opus-4-6', 'Opus 4.6'],
    ['claude-sonnet-4-6', 'Sonnet 4.6'],
    ['claude-sonnet-4-5', 'Sonnet 4.5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-haiku-4-5', 'Haiku 4.5']
  ]

  it.each(cases)('maps %s → %s', (input, expected) => {
    expect(friendlyModelName(input)).toBe(expected)
  })
})

describe('friendlyModelName - generic derivation', () => {
  it('derives a future undated id', () => {
    expect(friendlyModelName('claude-opus-5-0')).toBe('Opus 5.0')
  })

  it('derives another family', () => {
    expect(friendlyModelName('claude-sonnet-5-2')).toBe('Sonnet 5.2')
  })

  it('drops a trailing 8-digit date segment', () => {
    expect(friendlyModelName('claude-opus-5-0-20260101')).toBe('Opus 5.0')
  })

  it('handles multi-digit version parts', () => {
    expect(friendlyModelName('claude-haiku-10-12')).toBe('Haiku 10.12')
  })
})

describe('friendlyModelName - raw fallback', () => {
  it('returns the sanitized raw id for an unknown/garbage id', () => {
    expect(friendlyModelName('gpt-4o')).toBe('gpt-4o')
  })

  it('returns the raw id when the version shape does not match', () => {
    expect(friendlyModelName('claude-opus')).toBe('claude-opus')
  })

  it('does not treat a non-8-digit trailing number as a date', () => {
    // `-2026` is not an 8-digit date, so the whole thing fails the pattern
    expect(friendlyModelName('claude-opus-5-0-2026')).toBe('claude-opus-5-0-2026')
  })
})

describe('friendlyModelName - §10 sanitization', () => {
  it('strips control characters and newlines before matching', () => {
    expect(friendlyModelName('claude-opus-4-8\n')).toBe('Opus 4.8')
    expect(friendlyModelName('claude\t-opus-4-8')).not.toContain('\t')
  })

  it('strips embedded control chars from an otherwise-garbage id', () => {
    const result = friendlyModelName('weird\u0000model\u0007id')
    expect(result).toBe('weirdmodelid')
  })

  it('truncates an overlong id to 64 characters', () => {
    const long = 'x'.repeat(200)
    const result = friendlyModelName(long)
    expect(result).toHaveLength(64)
  })

  it('truncates after stripping controls (cap applies to clean text)', () => {
    const noisy = '\u0001'.repeat(100) + 'y'.repeat(100)
    const result = friendlyModelName(noisy)
    expect(result).toBe('y'.repeat(64))
  })
})
