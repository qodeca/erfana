// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useScrollLock Hook Tests
 *
 * Tests for the terminal scroll lock functionality:
 * - handleWheelEvent: Mouse wheel scroll interception
 * - wrapKeyHandler: Keyboard scroll-up key blocking
 * - startPollingWatcher: Scrollbar drag detection via polling
 *
 * Issue #60: Scroll lock feature tests
 *
 * Updated for SOLID compliance:
 * - DIP: Hook now takes stateAccessor parameter instead of importing store directly
 * - OCP: Configuration values are now extracted to constants and configurable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScrollLock, ScrollLockStateAccessor, IScrollableTerminal } from './useScrollLock'

describe('useScrollLock', () => {
  const mockScrollToBottom = vi.fn()

  // Create mock terminal instance (implements IScrollableTerminal interface)
  const createMockTerminal = (viewportY = 0, baseY = 0): IScrollableTerminal => ({
    buffer: {
      active: {
        viewportY,
        baseY
      }
    },
    scrollToBottom: mockScrollToBottom
  })

  // Create mock state accessor (DIP-compliant)
  const createMockStateAccessor = (scrollLocked: boolean): ScrollLockStateAccessor => ({
    getScrollLocked: () => scrollLocked
  })

  // Mutable state accessor for tests that need to change state mid-test
  const createMutableStateAccessor = (initialValue: boolean) => {
    let scrollLocked = initialValue
    return {
      accessor: {
        getScrollLocked: () => scrollLocked
      } as ScrollLockStateAccessor,
      setScrollLocked: (value: boolean) => { scrollLocked = value }
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('handleWheelEvent', () => {
    it('returns true (allow) for all wheel events when scrollLocked is false', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(false)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      // Scroll up (negative deltaY)
      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      expect(result.current.handleWheelEvent(scrollUpEvent)).toBe(true)

      // Scroll down (positive deltaY)
      const scrollDownEvent = new WheelEvent('wheel', { deltaY: 100 })
      expect(result.current.handleWheelEvent(scrollDownEvent)).toBe(true)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('returns true (allow) for scroll-down (deltaY > 0) when locked', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const scrollDownEvent = new WheelEvent('wheel', { deltaY: 100 })
      expect(result.current.handleWheelEvent(scrollDownEvent)).toBe(true)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('returns false (block) for scroll-up (deltaY < 0) when locked', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      expect(result.current.handleWheelEvent(scrollUpEvent)).toBe(false)
    })

    it('calls terminal.scrollToBottom() when blocking scroll-up', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -50 })
      result.current.handleWheelEvent(scrollUpEvent)

      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('calls onLockEngage callback on first blocked scroll (state transition)', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const onLockEngage = vi.fn()

      // Use mutable state accessor for state transition test
      const { accessor, setScrollLocked } = createMutableStateAccessor(false)

      const { result } = renderHook(() => useScrollLock(terminalRef, accessor, { onLockEngage }))

      // First scroll-up attempt (unlocked) - no callback
      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      result.current.handleWheelEvent(scrollUpEvent)
      expect(onLockEngage).not.toHaveBeenCalled()

      // Change to locked state
      setScrollLocked(true)

      // Second scroll-up attempt (locked, first time) - triggers callback
      result.current.handleWheelEvent(scrollUpEvent)
      expect(onLockEngage).toHaveBeenCalledTimes(1)

      // Third scroll-up attempt (still locked) - no callback (already engaged)
      result.current.handleWheelEvent(scrollUpEvent)
      expect(onLockEngage).toHaveBeenCalledTimes(1) // Still just once
    })

    it('does not call scrollToBottom when terminal is null', () => {
      const terminalRef = { current: null }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      expect(result.current.handleWheelEvent(scrollUpEvent)).toBe(false)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })
  })

  describe('wrapKeyHandler', () => {
    it('passes through to original handler when scrollLocked is false', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(false)
      const originalHandler = vi.fn().mockReturnValue(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' })
      expect(wrappedHandler(pageUpEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(pageUpEvent)
      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('blocks PageUp key when scrollLocked is true', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' })
      expect(wrappedHandler(pageUpEvent)).toBe(false)
      expect(originalHandler).not.toHaveBeenCalled()
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('blocks Home key when scrollLocked is true', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const homeEvent = new KeyboardEvent('keydown', { key: 'Home' })
      expect(wrappedHandler(homeEvent)).toBe(false)
      expect(originalHandler).not.toHaveBeenCalled()
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('blocks ArrowUp key when scrollLocked is true', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const arrowUpEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' })
      expect(wrappedHandler(arrowUpEvent)).toBe(false)
      expect(originalHandler).not.toHaveBeenCalled()
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('allows PageDown/ArrowDown keys (not scroll-up) when locked', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn().mockReturnValue(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      // PageDown should pass through
      const pageDownEvent = new KeyboardEvent('keydown', { key: 'PageDown' })
      expect(wrappedHandler(pageDownEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(pageDownEvent)

      originalHandler.mockClear()

      // ArrowDown should pass through
      const arrowDownEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' })
      expect(wrappedHandler(arrowDownEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(arrowDownEvent)

      // scrollToBottom should not be called for down keys
      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('calls terminal.scrollToBottom() when blocking keys', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      // Each blocked key should call scrollToBottom
      wrappedHandler(new KeyboardEvent('keydown', { key: 'PageUp' }))
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)

      wrappedHandler(new KeyboardEvent('keydown', { key: 'Home' }))
      expect(mockScrollToBottom).toHaveBeenCalledTimes(2)

      wrappedHandler(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
      expect(mockScrollToBottom).toHaveBeenCalledTimes(3)
    })

    it('passes through non-scroll keys to original handler when locked', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn().mockReturnValue(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      // Regular keys should pass through
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' })
      expect(wrappedHandler(enterEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(enterEvent)

      originalHandler.mockClear()

      const aEvent = new KeyboardEvent('keydown', { key: 'a' })
      expect(wrappedHandler(aEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(aEvent)

      originalHandler.mockClear()

      // Cmd+C should pass through
      const cmdCEvent = new KeyboardEvent('keydown', { key: 'c', metaKey: true })
      expect(wrappedHandler(cmdCEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(cmdCEvent)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('does not call scrollToBottom when terminal is null', () => {
      const terminalRef = { current: null }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' })
      expect(wrappedHandler(pageUpEvent)).toBe(false)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })
  })

  describe('startPollingWatcher', () => {
    it('returns cleanup function', () => {
      const mockTerminal = createMockTerminal(100, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(false)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const cleanup = result.current.startPollingWatcher()

      expect(typeof cleanup).toBe('function')
    })

    it('calls terminal.scrollToBottom() when viewportY < baseY and scrollLocked', () => {
      // viewportY=50, baseY=100 (scrolled up from bottom)
      const mockTerminal = createMockTerminal(50, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      result.current.startPollingWatcher()

      // Advance time by poll interval (100ms)
      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('does not call scrollToBottom when viewportY >= baseY', () => {
      // viewportY=100, baseY=100 (at bottom)
      const mockTerminal = createMockTerminal(100, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      result.current.startPollingWatcher()

      // Advance time by multiple poll intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('does not call scrollToBottom when scrollLocked is false', () => {
      // viewportY=50, baseY=100 (scrolled up, but not locked)
      const mockTerminal = createMockTerminal(50, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(false)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      result.current.startPollingWatcher()

      // Advance time by multiple poll intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('stops polling after cleanup is called', () => {
      // viewportY=50, baseY=100 (scrolled up from bottom)
      const mockTerminal = createMockTerminal(50, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      const cleanup = result.current.startPollingWatcher()

      // Advance time by one interval - should call scrollToBottom
      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)

      // Call cleanup to stop polling
      cleanup()

      // Advance time by more intervals - should NOT call scrollToBottom anymore
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Should still be just 1 call (from before cleanup)
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('uses small tolerance (1 line) to avoid micro-adjustments', () => {
      // viewportY=99, baseY=100 (1 line from bottom - within tolerance)
      const mockTerminal = createMockTerminal(99, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      result.current.startPollingWatcher()

      // Advance time by multiple intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Should not scroll because within 1-line tolerance
      expect(mockScrollToBottom).not.toHaveBeenCalled()

      // viewportY=97, baseY=100 (3 lines from bottom - exceeds tolerance)
      mockTerminal.buffer.active.viewportY = 97

      act(() => {
        vi.advanceTimersByTime(100)
      })

      // Now should scroll because exceeds tolerance
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('does nothing when terminal is null', () => {
      const terminalRef = { current: null }
      const stateAccessor = createMockStateAccessor(true)

      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      result.current.startPollingWatcher()

      // Advance time by multiple intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('requires explicit cleanup call to stop polling (by design)', () => {
      const mockTerminal = createMockTerminal(50, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      const { result, unmount } = renderHook(() => useScrollLock(terminalRef, stateAccessor))

      // IMPORTANT: startPollingWatcher returns cleanup function that MUST be called by consumer.
      // This is intentional - allows consumer to control polling lifecycle via useEffect.
      // Example usage:
      //   useEffect(() => {
      //     if (!scrollLocked) return
      //     return startPollingWatcher() // Auto-cleanup on effect cleanup
      //   }, [scrollLocked, startPollingWatcher])
      result.current.startPollingWatcher()

      // Verify polling works
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)

      // Unmount without calling cleanup - interval keeps running (expected behavior)
      unmount()

      // Polling continues because cleanup wasn't called - this validates the design
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // 6 total calls = 1 before unmount + 5 after at 100ms each
      expect(mockScrollToBottom).toHaveBeenCalledTimes(6)
    })
  })

  describe('configurable options (OCP compliance)', () => {
    it('allows custom polling interval', () => {
      const mockTerminal = createMockTerminal(50, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      // Use custom polling interval of 200ms
      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor, {
        pollingIntervalMs: 200
      }))

      result.current.startPollingWatcher()

      // After 100ms, should not have called yet (custom interval is 200ms)
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(mockScrollToBottom).not.toHaveBeenCalled()

      // After 200ms, should call once
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('allows custom scroll tolerance', () => {
      // viewportY=95, baseY=100 (5 lines from bottom)
      const mockTerminal = createMockTerminal(95, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)

      // Use custom tolerance of 10 lines (so 5 lines should not trigger scroll)
      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor, {
        scrollToleranceLines: 10
      }))

      result.current.startPollingWatcher()

      act(() => {
        vi.advanceTimersByTime(100)
      })

      // Should not scroll because within 10-line tolerance
      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('allows custom scroll-up keys', () => {
      const mockTerminal = createMockTerminal(0, 100)
      const terminalRef = { current: mockTerminal }
      const stateAccessor = createMockStateAccessor(true)
      const originalHandler = vi.fn().mockReturnValue(true)

      // Use custom keys: only 'w' and 'k' should be blocked
      const { result } = renderHook(() => useScrollLock(terminalRef, stateAccessor, {
        scrollUpKeys: ['w', 'k']
      }))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      // 'w' should be blocked (in custom list)
      const wEvent = new KeyboardEvent('keydown', { key: 'w' })
      expect(wrappedHandler(wEvent)).toBe(false)
      expect(originalHandler).not.toHaveBeenCalled()

      // 'PageUp' should pass through (not in custom list)
      const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' })
      expect(wrappedHandler(pageUpEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(pageUpEvent)
    })
  })
})
