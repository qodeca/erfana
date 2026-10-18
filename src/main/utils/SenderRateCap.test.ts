// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SenderRateCap } from './SenderRateCap'

describe('SenderRateCap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to the cap and refuses the rest', () => {
    const cap = new SenderRateCap(3, 1_000, vi.fn())
    expect([1, 2, 3, 4, 5].map(() => cap.allow(7))).toEqual([true, true, true, false, false])
  })

  it('reports the dropped count when the window closes, even if the burst stopped', () => {
    const onSummary = vi.fn()
    const cap = new SenderRateCap(1, 1_000, onSummary)
    cap.allow(7)
    cap.allow(7)
    cap.allow(7)

    expect(onSummary).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(onSummary).toHaveBeenCalledWith(7, 2, 1_000)
  })

  it('stays silent when nothing was dropped', () => {
    const onSummary = vi.fn()
    const cap = new SenderRateCap(5, 1_000, onSummary)
    cap.allow(7)
    vi.advanceTimersByTime(1_000)
    expect(onSummary).not.toHaveBeenCalled()
  })

  it('keeps senders independent and resets after the window', () => {
    const cap = new SenderRateCap(1, 1_000, vi.fn())
    expect(cap.allow(1)).toBe(true)
    expect(cap.allow(2)).toBe(true)
    expect(cap.allow(1)).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(cap.allow(1)).toBe(true)
  })
})
