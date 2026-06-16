// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useDividerPosition Hook
 *
 * Tests the resizable divider position management including state updates,
 * localStorage persistence, and resize end callbacks.
 *
 * Test groups:
 * - Initial state (4 tests)
 * - Vertical divider resize (3 tests)
 * - Horizontal divider resize (3 tests)
 * - Resize end callback (3 tests)
 * - localStorage persistence (5 tests)
 * - Edge cases (3 tests)
 *
 * Total: 21 tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDividerPosition } from './useDividerPosition'

describe('useDividerPosition', () => {
  let localStorageMock: { [key: string]: string }

  beforeEach(() => {
    localStorageMock = {}

    // Mock localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      return localStorageMock[key] ?? null
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      localStorageMock[key] = value
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => {
      delete localStorageMock[key]
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('returns default position of 50 when localStorage is empty', () => {
      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(50)
      expect(result.current.dividerPositionHorizontal).toBe(50)
    })

    it('loads vertical position from localStorage', () => {
      localStorageMock['markdown-editor-divider-position'] = '30'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(30)
    })

    it('loads horizontal position from localStorage', () => {
      localStorageMock['markdown-editor-divider-position-horizontal'] = '70'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPositionHorizontal).toBe(70)
    })

    it('provides all expected handlers', () => {
      const { result } = renderHook(() => useDividerPosition())

      expect(typeof result.current.handleDividerResize).toBe('function')
      expect(typeof result.current.handleDividerResizeHorizontal).toBe('function')
      expect(typeof result.current.handleDividerResizeEnd).toBe('function')
    })
  })

  describe('vertical divider resize', () => {
    it('updates position when handleDividerResize is called', () => {
      const { result } = renderHook(() => useDividerPosition())

      act(() => {
        result.current.handleDividerResize(25)
      })

      expect(result.current.dividerPosition).toBe(25)
    })

    it('persists position to localStorage', () => {
      const { result } = renderHook(() => useDividerPosition())

      act(() => {
        result.current.handleDividerResize(35)
      })

      expect(localStorageMock['markdown-editor-divider-position']).toBe('35')
    })

    it('does not affect horizontal position', () => {
      const { result } = renderHook(() => useDividerPosition())
      const originalHorizontal = result.current.dividerPositionHorizontal

      act(() => {
        result.current.handleDividerResize(75)
      })

      expect(result.current.dividerPositionHorizontal).toBe(originalHorizontal)
    })
  })

  describe('horizontal divider resize', () => {
    it('updates position when handleDividerResizeHorizontal is called', () => {
      const { result } = renderHook(() => useDividerPosition())

      act(() => {
        result.current.handleDividerResizeHorizontal(40)
      })

      expect(result.current.dividerPositionHorizontal).toBe(40)
    })

    it('persists position to localStorage', () => {
      const { result } = renderHook(() => useDividerPosition())

      act(() => {
        result.current.handleDividerResizeHorizontal(60)
      })

      expect(localStorageMock['markdown-editor-divider-position-horizontal']).toBe('60')
    })

    it('does not affect vertical position', () => {
      const { result } = renderHook(() => useDividerPosition())
      const originalVertical = result.current.dividerPosition

      act(() => {
        result.current.handleDividerResizeHorizontal(80)
      })

      expect(result.current.dividerPosition).toBe(originalVertical)
    })
  })

  describe('resize end callback', () => {
    it('calls onResizeEnd when handleDividerResizeEnd is called', () => {
      const onResizeEnd = vi.fn()
      const { result } = renderHook(() => useDividerPosition({ onResizeEnd }))

      act(() => {
        result.current.handleDividerResizeEnd()
      })

      expect(onResizeEnd).toHaveBeenCalledTimes(1)
    })

    it('does not throw when no onResizeEnd callback provided', () => {
      const { result } = renderHook(() => useDividerPosition())

      expect(() => {
        act(() => {
          result.current.handleDividerResizeEnd()
        })
      }).not.toThrow()
    })

    it('calls callback multiple times', () => {
      const onResizeEnd = vi.fn()
      const { result } = renderHook(() => useDividerPosition({ onResizeEnd }))

      act(() => {
        result.current.handleDividerResizeEnd()
        result.current.handleDividerResizeEnd()
        result.current.handleDividerResizeEnd()
      })

      expect(onResizeEnd).toHaveBeenCalledTimes(3)
    })
  })

  describe('localStorage persistence', () => {
    it('ignores invalid localStorage values (NaN)', () => {
      localStorageMock['markdown-editor-divider-position'] = 'invalid'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(50)
    })

    it('ignores negative localStorage values', () => {
      localStorageMock['markdown-editor-divider-position'] = '-10'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(50)
    })

    it('ignores values greater than 100', () => {
      localStorageMock['markdown-editor-divider-position'] = '150'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(50)
    })

    it('accepts boundary value 0', () => {
      localStorageMock['markdown-editor-divider-position'] = '0'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(0)
    })

    it('accepts boundary value 100', () => {
      localStorageMock['markdown-editor-divider-position'] = '100'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(100)
    })
  })

  describe('edge cases', () => {
    it('handles localStorage.getItem throwing error', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      const { result } = renderHook(() => useDividerPosition())

      // Should fall back to default
      expect(result.current.dividerPosition).toBe(50)
    })

    it('handles localStorage.setItem throwing error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      const { result } = renderHook(() => useDividerPosition())

      // Should not throw, just silently fail persistence
      expect(() => {
        act(() => {
          result.current.handleDividerResize(25)
        })
      }).not.toThrow()

      // State should still update in memory
      expect(result.current.dividerPosition).toBe(25)
    })

    it('handles decimal position values', () => {
      localStorageMock['markdown-editor-divider-position'] = '33.33'

      const { result } = renderHook(() => useDividerPosition())

      expect(result.current.dividerPosition).toBe(33.33)
    })
  })
})
