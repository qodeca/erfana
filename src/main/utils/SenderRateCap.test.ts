// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SenderRateCap } from './SenderRateCap'

const NORMAL = { maxRecords: 3, maxBytes: 100 }
const SEVERE = { maxRecords: 2, maxBytes: 50 }

describe('SenderRateCap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to the record cap and refuses the rest', () => {
    const cap = new SenderRateCap(NORMAL, SEVERE, 1_000, vi.fn())
    expect([1, 2, 3, 4, 5].map(() => cap.allow(7, 1, false))).toEqual([
      true,
      true,
      true,
      false,
      false
    ])
  })

  it('refuses a record that would exceed the size budget, but not a smaller one', () => {
    const cap = new SenderRateCap(NORMAL, SEVERE, 1_000, vi.fn())
    expect(cap.allow(7, 60, false)).toBe(true)
    expect(cap.allow(7, 60, false)).toBe(false)
    expect(cap.allow(7, 40, false)).toBe(true)
    expect(cap.allow(7, 1, false)).toBe(false)
  })

  it('gives error and fatal records their own budget', () => {
    const cap = new SenderRateCap(NORMAL, SEVERE, 1_000, vi.fn())
    for (let i = 0; i < 10; i++) cap.allow(7, 1, false)
    expect(cap.allow(7, 1, true)).toBe(true)
    expect(cap.allow(7, 1, true)).toBe(true)
    expect(cap.allow(7, 1, true)).toBe(false)
    // and an error flood does not starve normal records either
    const other = new SenderRateCap(NORMAL, SEVERE, 1_000, vi.fn())
    for (let i = 0; i < 10; i++) other.allow(7, 1, true)
    expect(other.allow(7, 1, false)).toBe(true)
  })

  it('reports dropped counts when the window closes, even if the burst stopped', () => {
    const onSummary = vi.fn()
    const cap = new SenderRateCap(NORMAL, SEVERE, 1_000, onSummary)
    for (let i = 0; i < 5; i++) cap.allow(7, 1, false)
    for (let i = 0; i < 4; i++) cap.allow(7, 1, true)

    expect(onSummary).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(onSummary).toHaveBeenCalledWith(7, { suppressed: 2, suppressedSevere: 2, windowMs: 1_000 })
  })

  it('stays silent when nothing was dropped', () => {
    const onSummary = vi.fn()
    const cap = new SenderRateCap(NORMAL, SEVERE, 1_000, onSummary)
    cap.allow(7, 1, false)
    vi.advanceTimersByTime(1_000)
    expect(onSummary).not.toHaveBeenCalled()
  })

  it('keeps senders independent and resets after the window', () => {
    const cap = new SenderRateCap({ maxRecords: 1, maxBytes: 100 }, SEVERE, 1_000, vi.fn())
    expect(cap.allow(1, 1, false)).toBe(true)
    expect(cap.allow(2, 1, false)).toBe(true)
    expect(cap.allow(1, 1, false)).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(cap.allow(1, 1, false)).toBe(true)
  })
})
