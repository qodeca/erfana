// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useAutoSave Hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoSave } from './useAutoSave'

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic functionality', () => {
    it('should not call onSave immediately when modified', () => {
      const onSave = vi.fn()

      renderHook(() => useAutoSave(true, onSave))

      expect(onSave).not.toHaveBeenCalled()
    })

    it('should call onSave after delay when modified', () => {
      const onSave = vi.fn()

      renderHook(() => useAutoSave(true, onSave, { delay: 2000 }))

      expect(onSave).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('should not call onSave when not modified', () => {
      const onSave = vi.fn()

      renderHook(() => useAutoSave(false, onSave, { delay: 2000 }))

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(onSave).not.toHaveBeenCalled()
    })

    it('should use default delay of 2000ms', () => {
      const onSave = vi.fn()

      renderHook(() => useAutoSave(true, onSave))

      act(() => {
        vi.advanceTimersByTime(1999)
      })
      expect(onSave).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('should respect custom delay', () => {
      const onSave = vi.fn()

      renderHook(() => useAutoSave(true, onSave, { delay: 500 }))

      act(() => {
        vi.advanceTimersByTime(499)
      })
      expect(onSave).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('enabled option', () => {
    it('should not auto-save when disabled', () => {
      const onSave = vi.fn()

      renderHook(() => useAutoSave(true, onSave, { enabled: false }))

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(onSave).not.toHaveBeenCalled()
    })

    it('should auto-save when explicitly enabled', () => {
      const onSave = vi.fn()

      renderHook(() => useAutoSave(true, onSave, { enabled: true, delay: 1000 }))

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('timer reset on changes', () => {
    it('should reset timer when isModified changes', () => {
      const onSave = vi.fn()

      const { rerender } = renderHook(
        ({ isModified }) => useAutoSave(isModified, onSave, { delay: 2000 }),
        { initialProps: { isModified: true } }
      )

      // Advance halfway
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(onSave).not.toHaveBeenCalled()

      // Toggle isModified to reset timer
      rerender({ isModified: false })
      rerender({ isModified: true })

      // Original timer would have fired by now, but it was reset
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(onSave).not.toHaveBeenCalled()

      // Full delay from reset
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup', () => {
    it('should cancel timer on unmount', () => {
      const onSave = vi.fn()

      const { unmount } = renderHook(() => useAutoSave(true, onSave, { delay: 2000 }))

      unmount()

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(onSave).not.toHaveBeenCalled()
    })
  })

  describe('cancelAutoSave', () => {
    it('should provide cancelAutoSave function', () => {
      const onSave = vi.fn()

      const { result } = renderHook(() => useAutoSave(true, onSave, { delay: 2000 }))

      expect(result.current.cancelAutoSave).toBeDefined()
      expect(typeof result.current.cancelAutoSave).toBe('function')
    })

    it('should cancel pending auto-save when called', () => {
      const onSave = vi.fn()

      const { result } = renderHook(() => useAutoSave(true, onSave, { delay: 2000 }))

      // Advance partially
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Cancel
      act(() => {
        result.current.cancelAutoSave()
      })

      // Advance past original timer
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onSave).not.toHaveBeenCalled()
    })
  })

  describe('setIsAutoSaving', () => {
    it('should provide setIsAutoSaving function', () => {
      const onSave = vi.fn()

      const { result } = renderHook(() => useAutoSave(true, onSave))

      expect(result.current.setIsAutoSaving).toBeDefined()
      expect(typeof result.current.setIsAutoSaving).toBe('function')
    })

    it('should update isAutoSaving state when setIsAutoSaving is called', async () => {
      const onSave = vi.fn()

      const { result } = renderHook(() => useAutoSave(false, onSave))

      // Initially false
      expect(result.current.isAutoSaving).toBe(false)

      // Set to true
      act(() => {
        result.current.setIsAutoSaving(true)
      })
      expect(result.current.isAutoSaving).toBe(true)

      // Set back to false
      act(() => {
        result.current.setIsAutoSaving(false)
      })
      expect(result.current.isAutoSaving).toBe(false)
    })

    it('should trigger re-render when isAutoSaving changes', () => {
      const onSave = vi.fn()
      let renderCount = 0

      const { result } = renderHook(() => {
        renderCount++
        return useAutoSave(false, onSave)
      })

      const initialRenderCount = renderCount

      // Set isAutoSaving to true
      act(() => {
        result.current.setIsAutoSaving(true)
      })

      // Should have re-rendered (useState triggers re-render)
      expect(renderCount).toBeGreaterThan(initialRenderCount)
      expect(result.current.isAutoSaving).toBe(true)
    })
  })

  describe('async onSave', () => {
    it('should handle async onSave callback', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)

      renderHook(() => useAutoSave(true, onSave, { delay: 1000 }))

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('signalChange (true debounce)', () => {
    it('should expose signalChange function', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() => useAutoSave(true, onSave))

      expect(result.current.signalChange).toBeDefined()
      expect(typeof result.current.signalChange).toBe('function')
    })

    it('should reset debounce timer on each signalChange call', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() => useAutoSave(true, onSave, { delay: 2000 }))

      // Advance 1500ms (initial debounce started by useEffect)
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(onSave).not.toHaveBeenCalled()

      // Signal a change – resets debounce to 2000ms from now
      act(() => {
        result.current.signalChange()
      })

      // Advance 1500ms more (total 3000ms from start, but only 1500ms from signalChange)
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(onSave).not.toHaveBeenCalled()

      // Advance 500ms more (2000ms from signalChange) – should fire now
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('should save after delay from last signalChange during continuous typing', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() => useAutoSave(true, onSave, { delay: 2000 }))

      // Simulate continuous typing: signal every 500ms for 3 seconds
      for (let i = 0; i < 6; i++) {
        act(() => {
          vi.advanceTimersByTime(500)
          result.current.signalChange()
        })
      }
      // At t=3000: no save yet (debounce resets each time)
      expect(onSave).not.toHaveBeenCalled()

      // Stop typing, wait for debounce
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('should be a no-op when disabled', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() =>
        useAutoSave(true, onSave, { delay: 2000, enabled: false })
      )

      act(() => {
        result.current.signalChange()
      })

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(onSave).not.toHaveBeenCalled()
    })

    it('should be a no-op when isModified is false', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() =>
        useAutoSave(false, onSave, { delay: 2000 })
      )

      act(() => {
        result.current.signalChange()
      })

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(onSave).not.toHaveBeenCalled()
    })

    it('should have stable identity across re-renders', () => {
      const onSave = vi.fn()
      const { result, rerender } = renderHook(
        ({ isModified }) => useAutoSave(isModified, onSave, { delay: 2000 }),
        { initialProps: { isModified: true } }
      )

      const firstSignalChange = result.current.signalChange

      // Rerender with different isModified
      rerender({ isModified: false })
      rerender({ isModified: true })

      expect(result.current.signalChange).toBe(firstSignalChange)
    })
  })

  describe('maxInterval (failsafe)', () => {
    it('should save at maxInterval during continuous signalChange calls', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() =>
        useAutoSave(true, onSave, { delay: 2000, maxInterval: 5000 })
      )

      // Continuous typing: signal every 1000ms (keeps debounce resetting)
      for (let i = 0; i < 4; i++) {
        act(() => {
          vi.advanceTimersByTime(1000)
          result.current.signalChange()
        })
      }
      // At t=4000: no save yet (debounce keeps resetting)
      expect(onSave).not.toHaveBeenCalled()

      // At t=5000: max interval fires
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('should not use maxInterval when set to 0', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() =>
        useAutoSave(true, onSave, { delay: 2000, maxInterval: 0 })
      )

      // Continuous typing for 60s
      for (let i = 0; i < 60; i++) {
        act(() => {
          vi.advanceTimersByTime(1000)
          result.current.signalChange()
        })
      }
      // At t=60000: no save (no max interval, debounce keeps resetting)
      expect(onSave).not.toHaveBeenCalled()

      // Stop typing, wait for debounce
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('should use default maxInterval of 30000ms', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() =>
        useAutoSave(true, onSave, { delay: 2000 })
      )

      // Continuous typing: signal every 1000ms for 29s
      for (let i = 0; i < 29; i++) {
        act(() => {
          vi.advanceTimersByTime(1000)
          result.current.signalChange()
        })
      }
      expect(onSave).not.toHaveBeenCalled()

      // At t=30000: max interval fires
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('should clear both timers when isModified becomes false', () => {
      const onSave = vi.fn()
      const { result, rerender } = renderHook(
        ({ isModified }) =>
          useAutoSave(isModified, onSave, { delay: 2000, maxInterval: 5000 }),
        { initialProps: { isModified: true } }
      )

      // Signal some changes
      act(() => {
        vi.advanceTimersByTime(1000)
        result.current.signalChange()
      })

      // Modified becomes false (e.g., manual save)
      rerender({ isModified: false })

      // Advance past both timers
      act(() => {
        vi.advanceTimersByTime(10000)
      })

      // No save should have fired
      expect(onSave).not.toHaveBeenCalled()
    })

    it('should not double-save when both timers would fire at the same time', () => {
      const onSave = vi.fn()
      renderHook(() =>
        useAutoSave(true, onSave, { delay: 2000, maxInterval: 2000 })
      )

      // Both timers set for 2000ms
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // triggerSave clears both timers – should only save once
      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('backward compatibility', () => {
    it('should still fire after delay without signalChange calls', () => {
      const onSave = vi.fn()

      // Consumer does not call signalChange – old behavior
      renderHook(() => useAutoSave(true, onSave, { delay: 2000 }))

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('cancelAutoSave with maxInterval', () => {
    it('should clear both debounce and maxInterval timers', () => {
      const onSave = vi.fn()
      const { result } = renderHook(() =>
        useAutoSave(true, onSave, { delay: 2000, maxInterval: 5000 })
      )

      act(() => {
        vi.advanceTimersByTime(1000)
        result.current.signalChange()
      })

      // Cancel everything
      act(() => {
        result.current.cancelAutoSave()
      })

      // Advance past both timers
      act(() => {
        vi.advanceTimersByTime(10000)
      })

      expect(onSave).not.toHaveBeenCalled()
    })
  })
})
