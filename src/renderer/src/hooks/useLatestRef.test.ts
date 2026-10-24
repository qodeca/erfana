// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Tests for useLatestRef: the ref is stable, holds the latest committed value,
 * and is already current when the same commit's effects run.
 *
 * @see useLatestRef.ts
 */

import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { useLatestRef } from './useLatestRef'

describe('useLatestRef', () => {
  it('starts with the first value', () => {
    const { result } = renderHook(() => useLatestRef('first'))
    expect(result.current.current).toBe('first')
  })

  it('keeps one ref object across renders and points it at the latest value', () => {
    const { result, rerender } = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 1 }
    })
    const firstRef = result.current

    rerender({ value: 2 })

    expect(result.current).toBe(firstRef)
    expect(result.current.current).toBe(2)
  })

  it('is current before a passive effect of the same commit reads it', () => {
    const seen: number[] = []
    const { rerender } = renderHook(
      ({ value }) => {
        const ref = useLatestRef(value)
        // Re-runs on every value change and reads only through the ref, the
        // way a subscription callback would.
        useEffect(() => {
          seen.push(ref.current)
        }, [ref, value])
      },
      { initialProps: { value: 1 } }
    )

    rerender({ value: 2 })
    rerender({ value: 3 })

    expect(seen).toEqual([1, 2, 3])
  })

  it('lets a callback subscribed once call the newest function', () => {
    const calls: string[] = []
    let fire: (() => void) | null = null
    const { rerender } = renderHook(
      ({ onEvent }) => {
        const onEventRef = useLatestRef(onEvent)
        useEffect(() => {
          fire = () => onEventRef.current()
        }, [onEventRef])
      },
      { initialProps: { onEvent: () => calls.push('a') } }
    )

    rerender({ onEvent: () => calls.push('b') })
    fire!()

    expect(calls).toEqual(['b'])
  })
})
