// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * thresholds tests
 *
 * Covers the raw-percentage → band mapping (rounding-stable at boundaries) and
 * the clamped/rounded display-percentage computation.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §5, §10
 */
import { describe, it, expect } from 'vitest'
import { levelFor, clampPercent } from './thresholds'

describe('levelFor (operates on RAW percentage)', () => {
  it('returns green at 0', () => {
    expect(levelFor(0)).toBe('green')
  })

  it('returns green just below the amber boundary', () => {
    expect(levelFor(29)).toBe('green')
    expect(levelFor(29.9)).toBe('green')
  })

  it('returns amber exactly at 30', () => {
    expect(levelFor(30)).toBe('amber')
  })

  it('returns amber just below the red boundary', () => {
    expect(levelFor(59.9)).toBe('amber')
  })

  it('returns red exactly at 60', () => {
    expect(levelFor(60)).toBe('red')
  })

  it('returns red at 100', () => {
    expect(levelFor(100)).toBe('red')
  })

  it('returns red above 100 (over budget)', () => {
    expect(levelFor(150)).toBe('red')
  })

  it('does not flip band on a sub-boundary fraction (29.6 stays green)', () => {
    // The raw value, not the rounded display value, drives the band.
    expect(levelFor(29.6)).toBe('green')
  })

  it('maps the 1M token cutoffs (300k green→amber, 600k amber→red)', () => {
    const W = 1_000_000
    expect(levelFor((299_999 / W) * 100)).toBe('green')
    expect(levelFor((300_000 / W) * 100)).toBe('amber')
    expect(levelFor((599_999 / W) * 100)).toBe('amber')
    expect(levelFor((600_000 / W) * 100)).toBe('red')
  })

  it('maps the 200k token cutoffs (60k green→amber, 120k amber→red)', () => {
    const W = 200_000
    expect(levelFor((59_999 / W) * 100)).toBe('green')
    expect(levelFor((60_000 / W) * 100)).toBe('amber')
    expect(levelFor((119_999 / W) * 100)).toBe('amber')
    expect(levelFor((120_000 / W) * 100)).toBe('red')
  })
})

describe('clampPercent (rounded display integer 0–100)', () => {
  it('returns 0 for zero usage', () => {
    expect(clampPercent(0, 200000)).toBe(0)
  })

  it('computes a typical percentage and rounds', () => {
    expect(clampPercent(84000, 200000)).toBe(42)
  })

  it('floors to the integer below (never rounds up into a band)', () => {
    // 139200 / 200000 = 69.6 → floor 69 (NOT 70, which would read amber while green)
    expect(clampPercent(139200, 200000)).toBe(69)
  })

  it('floors a fractional percentage', () => {
    // 84321 / 200000 = 42.16 → 42
    expect(clampPercent(84321, 200000)).toBe(42)
  })

  it('returns 100 at exactly the window size', () => {
    expect(clampPercent(200000, 200000)).toBe(100)
  })

  it('clamps over-budget usage to 100', () => {
    expect(clampPercent(250000, 200000)).toBe(100)
  })

  it('handles the 1M window', () => {
    expect(clampPercent(950000, 1000000)).toBe(95)
  })

  it('guards a zero windowSize (returns 0, never NaN)', () => {
    expect(clampPercent(1000, 0)).toBe(0)
  })

  it('guards a negative windowSize (returns 0)', () => {
    expect(clampPercent(1000, -200000)).toBe(0)
  })

  it('clamps negative usage to 0', () => {
    expect(clampPercent(-5000, 200000)).toBe(0)
  })
})

describe('display percent and colour band agree at boundaries', () => {
  // The displayed integer (clampPercent, floored) must never sit in a band the
  // colour (levelFor, raw) hasn't reached. used/window chosen to hit each raw %.
  const W = 200000

  it('raw 29.6 → display "29" AND green', () => {
    const raw = 29.6
    const used = (raw / 100) * W // 59200
    expect(clampPercent(used, W)).toBe(29)
    expect(levelFor(raw)).toBe('green')
  })

  it('raw exactly 30 → display "30" AND amber', () => {
    const raw = 30
    const used = (raw / 100) * W // 60000
    expect(clampPercent(used, W)).toBe(30)
    expect(levelFor(raw)).toBe('amber')
  })

  it('raw 59.6 → display "59" AND amber', () => {
    const raw = 59.6
    const used = (raw / 100) * W // 119200
    expect(clampPercent(used, W)).toBe(59)
    expect(levelFor(raw)).toBe('amber')
  })

  it('raw exactly 60 → display "60" AND red', () => {
    const raw = 60
    const used = (raw / 100) * W // 120000
    expect(clampPercent(used, W)).toBe(60)
    expect(levelFor(raw)).toBe('red')
  })
})
