// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useIdleDebouncedValue – the scheduler behind the deferred Markdown preview.
 *
 * Fake timers throughout: every assertion is about *when* a value is released.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIdleDebouncedValue, type UseIdleDebouncedValueOptions } from './useIdleDebouncedValue'

type Props = { value: string; options: UseIdleDebouncedValueOptions }

function setup(initial: string, options: UseIdleDebouncedValueOptions) {
  return renderHook(({ value, options: o }: Props) => useIdleDebouncedValue(value, o), {
    initialProps: { value: initial, options }
  })
}

describe('useIdleDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the first value immediately (no delay on mount)', () => {
    const { result } = setup('a', { delayMs: 150 })
    expect(result.current).toBe('a')
  })

  it('holds a change back until the quiet period has passed', () => {
    const options = { delayMs: 150 }
    const { result, rerender } = setup('a', options)

    rerender({ value: 'ab', options })
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(149))
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('ab')
  })

  it('restarts the quiet period on every change and releases only the latest', () => {
    const options = { delayMs: 150 }
    const { result, rerender } = setup('a', options)

    rerender({ value: 'ab', options })
    act(() => vi.advanceTimersByTime(100))
    rerender({ value: 'abc', options })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(50))
    expect(result.current).toBe('abc')
  })

  it('releases at maxWait while changes keep coming faster than the delay', () => {
    const options = { delayMs: 150, maxWaitMs: 400 }
    const { result, rerender } = setup('', options)

    // A change every 80 ms – a fast typist – never leaves a 150 ms gap.
    let text = ''
    for (let i = 0; i < 5; i++) {
      text += 'x'
      rerender({ value: text, options })
      act(() => vi.advanceTimersByTime(80))
    }
    // 400 ms after the first change the latest value must be out.
    expect(result.current).toBe('xxxxx')

    // The max-wait window restarts after a release.
    rerender({ value: 'xxxxxy', options })
    act(() => vi.advanceTimersByTime(80))
    expect(result.current).toBe('xxxxx')
    act(() => vi.advanceTimersByTime(70))
    expect(result.current).toBe('xxxxxy')
  })

  it('never re-releases an equal value', () => {
    const options = { delayMs: 150 }
    const { result, rerender } = setup('a', options)

    rerender({ value: 'b', options })
    rerender({ value: 'a', options })
    expect(vi.getTimerCount()).toBe(0)
    expect(result.current).toBe('a')
  })

  it('passes every change straight through when disabled', () => {
    const options = { delayMs: 150, enabled: false }
    const { result, rerender } = setup('a', options)

    rerender({ value: 'ab', options })
    expect(result.current).toBe('ab')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not step back to an older value when switched on after pass-through', () => {
    const { result, rerender } = setup('a', { delayMs: 150, enabled: false })
    rerender({ value: 'ab', options: { delayMs: 150, enabled: false } })
    expect(result.current).toBe('ab')

    rerender({ value: 'ab', options: { delayMs: 150, enabled: true } })
    expect(result.current).toBe('ab')

    rerender({ value: 'abc', options: { delayMs: 150, enabled: true } })
    expect(result.current).toBe('ab')
    act(() => vi.advanceTimersByTime(150))
    expect(result.current).toBe('abc')
  })

  it('cancels a pending release on unmount', () => {
    const options = { delayMs: 150 }
    const { rerender, unmount } = setup('a', options)

    rerender({ value: 'ab', options })
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
