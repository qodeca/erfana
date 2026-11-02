// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAWER_FULL_BELOW_PX, useNarrowPanel } from './useNarrowPanel'

describe('useNarrowPanel', () => {
  let resized: () => void
  let box: { width: number; height: number }
  const root = { current: { getBoundingClientRect: () => box } as unknown as HTMLElement }

  beforeEach(() => {
    box = { width: DRAWER_FULL_BELOW_PX, height: 500 }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe(): void {}
        disconnect(): void {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('turns narrow under the limit and back at the limit', () => {
    const { result } = renderHook(() => useNarrowPanel(root, true))
    expect(result.current).toBe(false)
    box = { width: DRAWER_FULL_BELOW_PX - 1, height: 500 }
    act(() => resized())
    expect(result.current).toBe(true)
    box = { width: DRAWER_FULL_BELOW_PX, height: 500 }
    act(() => resized())
    expect(result.current).toBe(false)
  })

  it('keeps the last answer while a hidden tab measures 0×0', () => {
    box = { width: 300, height: 500 }
    const { result } = renderHook(() => useNarrowPanel(root, true))
    expect(result.current).toBe(true)
    box = { width: 0, height: 0 }
    act(() => resized())
    expect(result.current).toBe(true)
  })
})
