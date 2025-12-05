/**
 * useScrollLock Hook Tests
 *
 * Tests for the terminal scroll lock functionality:
 * - handleWheelEvent: Mouse wheel scroll interception
 * - wrapKeyHandler: Keyboard scroll-up key blocking
 * - startPollingWatcher: Scrollbar drag detection via polling
 *
 * Issue #60: Scroll lock feature tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScrollLock } from './useScrollLock'
import { useTerminalStore } from '../stores/useTerminalStore'
import type { Terminal } from '@xterm/xterm'

// Mock useTerminalStore
vi.mock('../stores/useTerminalStore', () => ({
  useTerminalStore: {
    getState: vi.fn()
  }
}))

describe('useScrollLock', () => {
  const mockScrollToBottom = vi.fn()

  // Create mock xterm instance
  const createMockXterm = (viewportY = 0, baseY = 0): Terminal => ({
    buffer: {
      active: {
        viewportY,
        baseY
      }
    },
    scrollToBottom: mockScrollToBottom
  }) as unknown as Terminal

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Default mock: scrollLocked = false
    vi.mocked(useTerminalStore.getState).mockReturnValue({
      scrollLocked: false
    } as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('handleWheelEvent', () => {
    it('returns true (allow) for all wheel events when scrollLocked is false', () => {
      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      // Scroll up (negative deltaY)
      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      expect(result.current.handleWheelEvent(scrollUpEvent)).toBe(true)

      // Scroll down (positive deltaY)
      const scrollDownEvent = new WheelEvent('wheel', { deltaY: 100 })
      expect(result.current.handleWheelEvent(scrollDownEvent)).toBe(true)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('returns true (allow) for scroll-down (deltaY > 0) when locked', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const scrollDownEvent = new WheelEvent('wheel', { deltaY: 100 })
      expect(result.current.handleWheelEvent(scrollDownEvent)).toBe(true)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('returns false (block) for scroll-up (deltaY < 0) when locked', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      expect(result.current.handleWheelEvent(scrollUpEvent)).toBe(false)
    })

    it('calls xterm.scrollToBottom() when blocking scroll-up', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -50 })
      result.current.handleWheelEvent(scrollUpEvent)

      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('calls onLockEngage callback on first blocked scroll (state transition)', () => {
      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const onLockEngage = vi.fn()

      // Start with unlocked
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: false
      } as any)

      const { result } = renderHook(() => useScrollLock(xtermRef, { onLockEngage }))

      // First scroll-up attempt (unlocked) - no callback
      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      result.current.handleWheelEvent(scrollUpEvent)
      expect(onLockEngage).not.toHaveBeenCalled()

      // Change to locked state
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      // Second scroll-up attempt (locked, first time) - triggers callback
      result.current.handleWheelEvent(scrollUpEvent)
      expect(onLockEngage).toHaveBeenCalledTimes(1)

      // Third scroll-up attempt (still locked) - no callback (already engaged)
      result.current.handleWheelEvent(scrollUpEvent)
      expect(onLockEngage).toHaveBeenCalledTimes(1) // Still just once
    })

    it('does not call scrollToBottom when xterm is null', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const xtermRef = { current: null }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const scrollUpEvent = new WheelEvent('wheel', { deltaY: -100 })
      expect(result.current.handleWheelEvent(scrollUpEvent)).toBe(false)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })
  })

  describe('wrapKeyHandler', () => {
    it('passes through to original handler when scrollLocked is false', () => {
      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const originalHandler = vi.fn().mockReturnValue(true)

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' })
      expect(wrappedHandler(pageUpEvent)).toBe(true)
      expect(originalHandler).toHaveBeenCalledWith(pageUpEvent)
      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('blocks PageUp key when scrollLocked is true', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' })
      expect(wrappedHandler(pageUpEvent)).toBe(false)
      expect(originalHandler).not.toHaveBeenCalled()
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('blocks Home key when scrollLocked is true', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const homeEvent = new KeyboardEvent('keydown', { key: 'Home' })
      expect(wrappedHandler(homeEvent)).toBe(false)
      expect(originalHandler).not.toHaveBeenCalled()
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('blocks ArrowUp key when scrollLocked is true', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const arrowUpEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' })
      expect(wrappedHandler(arrowUpEvent)).toBe(false)
      expect(originalHandler).not.toHaveBeenCalled()
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('allows PageDown/ArrowDown keys (not scroll-up) when locked', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const originalHandler = vi.fn().mockReturnValue(true)

      const { result } = renderHook(() => useScrollLock(xtermRef))

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

    it('calls xterm.scrollToBottom() when blocking keys', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(xtermRef))

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
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(0, 100)
      const xtermRef = { current: mockXterm }
      const originalHandler = vi.fn().mockReturnValue(true)

      const { result } = renderHook(() => useScrollLock(xtermRef))

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

    it('does not call scrollToBottom when xterm is null', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const xtermRef = { current: null }
      const originalHandler = vi.fn()

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const wrappedHandler = result.current.wrapKeyHandler(originalHandler)

      const pageUpEvent = new KeyboardEvent('keydown', { key: 'PageUp' })
      expect(wrappedHandler(pageUpEvent)).toBe(false)

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })
  })

  describe('startPollingWatcher', () => {
    it('returns cleanup function', () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      const cleanup = result.current.startPollingWatcher()

      expect(typeof cleanup).toBe('function')
    })

    it('calls xterm.scrollToBottom() when viewportY < baseY and scrollLocked', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      // viewportY=50, baseY=100 (scrolled up from bottom)
      const mockXterm = createMockXterm(50, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      result.current.startPollingWatcher()

      // Advance time by poll interval (100ms)
      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('does not call scrollToBottom when viewportY >= baseY', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      // viewportY=100, baseY=100 (at bottom)
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      result.current.startPollingWatcher()

      // Advance time by multiple poll intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('does not call scrollToBottom when scrollLocked is false', () => {
      // viewportY=50, baseY=100 (scrolled up, but not locked)
      const mockXterm = createMockXterm(50, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      result.current.startPollingWatcher()

      // Advance time by multiple poll intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('stops polling after cleanup is called', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      // viewportY=50, baseY=100 (scrolled up from bottom)
      const mockXterm = createMockXterm(50, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

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
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      // viewportY=99, baseY=100 (1 line from bottom - within tolerance)
      const mockXterm = createMockXterm(99, 100)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      result.current.startPollingWatcher()

      // Advance time by multiple intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Should not scroll because within 1-line tolerance
      expect(mockScrollToBottom).not.toHaveBeenCalled()

      // viewportY=97, baseY=100 (3 lines from bottom - exceeds tolerance)
      mockXterm.buffer.active.viewportY = 97

      act(() => {
        vi.advanceTimersByTime(100)
      })

      // Now should scroll because exceeds tolerance
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    })

    it('does nothing when xterm is null', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const xtermRef = { current: null }

      const { result } = renderHook(() => useScrollLock(xtermRef))

      result.current.startPollingWatcher()

      // Advance time by multiple intervals
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockScrollToBottom).not.toHaveBeenCalled()
    })

    it('polling continues after unmount if cleanup not called', () => {
      // Set scrollLocked to true
      vi.mocked(useTerminalStore.getState).mockReturnValue({
        scrollLocked: true
      } as any)

      const mockXterm = createMockXterm(50, 100)
      const xtermRef = { current: mockXterm }

      const { result, unmount } = renderHook(() => useScrollLock(xtermRef))

      // Note: startPollingWatcher returns cleanup function but doesn't auto-cleanup
      // Caller is responsible for managing the interval lifecycle
      result.current.startPollingWatcher()

      // Verify polling works
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)

      // Unmount the hook - interval keeps running because no cleanup was called
      unmount()

      // Advance time - polling continues (this is by design)
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Polling continues after unmount (6 total calls = 1 before + 5 after at 100ms each)
      expect(mockScrollToBottom).toHaveBeenCalledTimes(6)
    })
  })
})
