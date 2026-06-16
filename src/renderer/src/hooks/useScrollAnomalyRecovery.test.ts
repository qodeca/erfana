// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useScrollAnomalyRecovery Hook Tests
 *
 * Tests for the scroll anomaly detection and recovery hook.
 * Uses renderHook for isolated hook testing.
 *
 * Issue #22: Updated tests for fixed-interval queue approach
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScrollAnomalyRecovery } from './useScrollAnomalyRecovery'
import type { Terminal } from '@xterm/xterm'

// Mock requestAnimationFrame for testing
const mockRAF = vi.fn((cb: FrameRequestCallback) => {
  cb(0)
  return 0
})

describe('useScrollAnomalyRecovery', () => {
  const mockScrollToBottom = vi.fn()

  // Create mock xterm instance
  const createMockXterm = (viewportY = 0, baseY = 0) => ({
    buffer: {
      active: {
        viewportY,
        baseY
      }
    },
    scrollToBottom: mockScrollToBottom,
    scrollToLine: vi.fn()
  }) as unknown as Terminal

  // Create mock terminal ref (container element for scroll event listeners)
  const createMockTerminalRef = () => {
    const container = document.createElement('div')
    return { current: container }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Mock requestAnimationFrame to execute synchronously
    vi.stubGlobal('requestAnimationFrame', mockRAF)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns wrapOnDataHandler function', () => {
    const xtermRef = { current: createMockXterm() }
    const terminalRef = createMockTerminalRef()

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef)
    )

    expect(result.current.wrapOnDataHandler).toBeDefined()
    expect(typeof result.current.wrapOnDataHandler).toBe('function')
  })

  it('returns resetQueue function', () => {
    const xtermRef = { current: createMockXterm() }
    const terminalRef = createMockTerminalRef()

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef)
    )

    expect(result.current.resetQueue).toBeDefined()
    expect(typeof result.current.resetQueue).toBe('function')
  })

  it('calls original handler when disabled', () => {
    const xtermRef = { current: createMockXterm() }
    const terminalRef = createMockTerminalRef()
    const originalHandler = vi.fn()

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef, { enabled: false })
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)
    const testData = { terminalId: 'test', data: 'hello' }

    wrappedHandler(testData)

    expect(originalHandler).toHaveBeenCalledWith(testData)
    expect(mockScrollToBottom).not.toHaveBeenCalled()
  })

  it('calls original handler when xterm is null', () => {
    const xtermRef = { current: null }
    const terminalRef = createMockTerminalRef()
    const originalHandler = vi.fn()

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef)
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)
    const testData = { terminalId: 'test', data: 'hello' }

    wrappedHandler(testData)

    expect(originalHandler).toHaveBeenCalledWith(testData)
  })

  it('wraps handler and calls original', () => {
    const mockXterm = createMockXterm(100, 100)
    const xtermRef = { current: mockXterm }
    const terminalRef = createMockTerminalRef()
    const originalHandler = vi.fn()

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef)
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)
    const testData = { terminalId: 'test', data: 'hello' }

    wrappedHandler(testData)

    expect(originalHandler).toHaveBeenCalledWith(testData)
  })

  describe('Issue #22: Fixed-interval queue approach', () => {
    it('queues anomalies and recovers after interval', async () => {
      const mockXterm = createMockXterm(100, 100) // Start at bottom
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()
      const onRecovery = vi.fn()

      // Only trigger anomaly on specific calls
      let triggerAnomaly = false
      const originalHandler = vi.fn().mockImplementation(() => {
        if (triggerAnomaly) {
          mockXterm.buffer.active.viewportY = 0
        }
      })

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      // First call to establish lastDataTs (no anomaly)
      wrappedHandler({ terminalId: 'test', data: 'first' })

      // Enable anomaly for subsequent calls
      triggerAnomaly = true
      mockXterm.buffer.active.viewportY = 100

      // Second call triggers anomaly detection
      wrappedHandler({ terminalId: 'test', data: 'second' })

      // Run RAF to detect anomaly
      await act(async () => {
        vi.advanceTimersByTime(0)
        await Promise.resolve()
      })

      // Recovery should NOT have happened yet (no immediate debounce)
      expect(mockScrollToBottom).not.toHaveBeenCalled()

      // Run interval (500ms default)
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      // Now recovery should have happened
      expect(mockScrollToBottom).toHaveBeenCalled()
      expect(onRecovery).toHaveBeenCalledWith(1) // 1 anomaly detected
    })

    it('batches multiple anomalies into single recovery', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()
      const onRecovery = vi.fn()

      // Only trigger anomaly after init
      let triggerAnomaly = false
      const originalHandler = vi.fn().mockImplementation(() => {
        if (triggerAnomaly) {
          mockXterm.buffer.active.viewportY = 0
        }
      })

      // Use explicit config with 500ms interval so all 5 anomalies batch together
      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, {
          onRecovery,
          config: { recoveryIntervalMs: 500 }
        })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      // First call to establish lastDataTs (no anomaly)
      wrappedHandler({ terminalId: 'test', data: 'init' })
      triggerAnomaly = true

      // Trigger 5 rapid anomalies (each at 50ms apart = 250ms total, before 500ms interval)
      for (let i = 0; i < 5; i++) {
        mockXterm.buffer.active.viewportY = 100
        wrappedHandler({ terminalId: 'test', data: `data-${i}` })
        await act(async () => {
          vi.advanceTimersByTime(50) // Less than interval
        })
      }

      // Run full interval
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      // Should only call recovery once with count of all anomalies
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
      expect(onRecovery).toHaveBeenCalledTimes(1)
      expect(onRecovery).toHaveBeenCalledWith(5) // All 5 anomalies batched
    })

    it('does not lose anomalies during async scroll', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()
      const onRecovery = vi.fn()

      // Track when scrollToBottom is called to simulate timing
      let scrollCallCount = 0
      mockScrollToBottom.mockImplementation(() => {
        scrollCallCount++
      })

      // Only trigger anomaly after init
      let triggerAnomaly = false
      const originalHandler = vi.fn().mockImplementation(() => {
        if (triggerAnomaly) {
          mockXterm.buffer.active.viewportY = 0
        }
      })

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      // First call to establish lastDataTs (no anomaly)
      wrappedHandler({ terminalId: 'test', data: 'init' })
      triggerAnomaly = true

      // Trigger anomaly
      mockXterm.buffer.active.viewportY = 100
      wrappedHandler({ terminalId: 'test', data: 'data-1' })

      // First interval fires
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      expect(scrollCallCount).toBe(1)
      expect(onRecovery).toHaveBeenCalledWith(1)

      // Trigger another anomaly right after (simulating anomaly during scroll)
      mockXterm.buffer.active.viewportY = 100
      wrappedHandler({ terminalId: 'test', data: 'data-2' })

      // Second interval fires
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      // Second anomaly should also be recovered
      expect(scrollCallCount).toBe(2)
      expect(onRecovery).toHaveBeenLastCalledWith(1)
    })

    it('respects custom recoveryIntervalMs', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()
      const onRecovery = vi.fn()
      const originalHandler = vi.fn().mockImplementation(() => {
        mockXterm.buffer.active.viewportY = 0
      })

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, {
          onRecovery,
          config: {
            recoveryIntervalMs: 1000 // Longer interval
          }
        })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      wrappedHandler({ terminalId: 'test', data: 'first' })
      mockXterm.buffer.active.viewportY = 100
      wrappedHandler({ terminalId: 'test', data: 'second' })

      // After 500ms (default), should NOT have recovered yet
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(mockScrollToBottom).not.toHaveBeenCalled()

      // After 1000ms, should have recovered
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(mockScrollToBottom).toHaveBeenCalled()
    })

    it('does nothing when no anomalies detected', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()
      const onRecovery = vi.fn()
      const originalHandler = vi.fn() // No jump simulation

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      wrappedHandler({ terminalId: 'test', data: 'first' })
      wrappedHandler({ terminalId: 'test', data: 'second' })

      // Run multiple intervals
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      // No recovery should have happened
      expect(mockScrollToBottom).not.toHaveBeenCalled()
      expect(onRecovery).not.toHaveBeenCalled()
    })

    it('resetQueue clears pending anomalies (issue #22)', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()
      const onRecovery = vi.fn()

      let triggerAnomaly = false
      const originalHandler = vi.fn().mockImplementation(() => {
        if (triggerAnomaly) {
          mockXterm.buffer.active.viewportY = 0
        }
      })

      // Use explicit config with longer interval so anomalies queue up before reset
      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, {
          onRecovery,
          config: { recoveryIntervalMs: 500 }
        })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      // First call to establish lastDataTs (no anomaly)
      wrappedHandler({ terminalId: 'test', data: 'init' })
      triggerAnomaly = true

      // Trigger 3 anomalies (all within 150ms, before 500ms interval)
      for (let i = 0; i < 3; i++) {
        mockXterm.buffer.active.viewportY = 100
        wrappedHandler({ terminalId: 'test', data: `data-${i}` })
        await act(async () => {
          vi.advanceTimersByTime(50) // Less than interval
        })
      }

      // Reset the queue before interval fires (we're at 150ms, interval is 500ms)
      act(() => {
        result.current.resetQueue()
      })

      // Run interval
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      // Should NOT have recovered because queue was cleared
      expect(mockScrollToBottom).not.toHaveBeenCalled()
      expect(onRecovery).not.toHaveBeenCalled()
    })
  })

  it('does NOT trigger recovery when user recently scrolled', async () => {
    // This test verifies that user scroll events prevent auto-recovery
    const mockXterm = createMockXterm(100, 100)
    const xtermRef = { current: mockXterm }
    const terminalRef = createMockTerminalRef()

    // Mount the container in document so events work properly
    document.body.appendChild(terminalRef.current)

    const onRecovery = vi.fn()
    let jumpOnWrite = false
    const originalHandler = vi.fn().mockImplementation(() => {
      if (jumpOnWrite) {
        mockXterm.buffer.active.viewportY = 0
      }
    })

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

    // First call to establish lastDataTs
    wrappedHandler({ terminalId: 'test', data: 'first' })

    // Simulate user scroll on container - this sets lastUserScrollTs
    terminalRef.current.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))

    // Enable jump for second call
    jumpOnWrite = true
    mockXterm.buffer.active.viewportY = 100 // Reset before capture
    wrappedHandler({ terminalId: 'test', data: 'second' })

    // Run interval
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    // Should NOT recover because user scroll timestamp is recent
    // With fake timers, Date.now() doesn't advance, so the scroll is always "recent"
    expect(mockScrollToBottom).not.toHaveBeenCalled()
    expect(onRecovery).not.toHaveBeenCalled()

    // Cleanup
    document.body.removeChild(terminalRef.current)
  })

  describe('Issue #22: Keyboard scroll detection', () => {
    it('detects Page Up as user scroll', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()

      document.body.appendChild(terminalRef.current)

      const onRecovery = vi.fn()

      // Only trigger anomaly after keyboard event
      let triggerAnomaly = false
      const originalHandler = vi.fn().mockImplementation(() => {
        if (triggerAnomaly) {
          mockXterm.buffer.active.viewportY = 0
        }
      })

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      // Establish lastDataTs (no anomaly)
      wrappedHandler({ terminalId: 'test', data: 'first' })

      // Simulate Page Up keypress on container
      terminalRef.current.tabIndex = 0
      terminalRef.current.focus()
      terminalRef.current.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))

      // Now enable anomaly
      triggerAnomaly = true
      mockXterm.buffer.active.viewportY = 100
      wrappedHandler({ terminalId: 'test', data: 'second' })

      // Run interval
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      // Should NOT recover because Page Up counts as user scroll
      expect(mockScrollToBottom).not.toHaveBeenCalled()

      document.body.removeChild(terminalRef.current)
    })

    it('detects Arrow Down as user scroll', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()

      document.body.appendChild(terminalRef.current)

      const onRecovery = vi.fn()

      let triggerAnomaly = false
      const originalHandler = vi.fn().mockImplementation(() => {
        if (triggerAnomaly) {
          mockXterm.buffer.active.viewportY = 0
        }
      })

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      wrappedHandler({ terminalId: 'test', data: 'first' })

      terminalRef.current.tabIndex = 0
      terminalRef.current.focus()
      terminalRef.current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

      triggerAnomaly = true
      mockXterm.buffer.active.viewportY = 100
      wrappedHandler({ terminalId: 'test', data: 'second' })

      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(mockScrollToBottom).not.toHaveBeenCalled()

      document.body.removeChild(terminalRef.current)
    })

    it('ignores non-scroll keys', async () => {
      const mockXterm = createMockXterm(100, 100)
      const xtermRef = { current: mockXterm }
      const terminalRef = createMockTerminalRef()

      document.body.appendChild(terminalRef.current)

      const onRecovery = vi.fn()

      let triggerAnomaly = false
      const originalHandler = vi.fn().mockImplementation(() => {
        if (triggerAnomaly) {
          mockXterm.buffer.active.viewportY = 0
        }
      })

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
      )

      const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

      wrappedHandler({ terminalId: 'test', data: 'first' })

      // Simulate regular key (not a scroll key)
      terminalRef.current.tabIndex = 0
      terminalRef.current.focus()
      terminalRef.current.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

      triggerAnomaly = true
      mockXterm.buffer.active.viewportY = 100
      wrappedHandler({ terminalId: 'test', data: 'second' })

      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      // SHOULD recover because 'a' is not a scroll key
      expect(mockScrollToBottom).toHaveBeenCalled()

      document.body.removeChild(terminalRef.current)
    })
  })

  it('does NOT trigger recovery for small jumps', async () => {
    const mockXterm = createMockXterm(10, 100) // Near top already
    const xtermRef = { current: mockXterm }
    const terminalRef = createMockTerminalRef()
    const onRecovery = vi.fn()
    const originalHandler = vi.fn().mockImplementation(() => {
      mockXterm.buffer.active.viewportY = 5 // Small jump
    })

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

    wrappedHandler({ terminalId: 'test', data: 'first' })
    mockXterm.buffer.active.viewportY = 10
    wrappedHandler({ terminalId: 'test', data: 'second' })

    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    expect(mockScrollToBottom).not.toHaveBeenCalled()
    expect(onRecovery).not.toHaveBeenCalled()
  })

  it('cleans up interval on unmount', () => {
    const mockXterm = createMockXterm(100, 100)
    const xtermRef = { current: mockXterm }
    const terminalRef = createMockTerminalRef()
    const originalHandler = vi.fn().mockImplementation(() => {
      mockXterm.buffer.active.viewportY = 0
    })

    const { result, unmount } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef)
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

    // Trigger anomaly
    wrappedHandler({ terminalId: 'test', data: 'first' })
    mockXterm.buffer.active.viewportY = 100
    wrappedHandler({ terminalId: 'test', data: 'second' })

    // Unmount before interval completes
    unmount()

    // Run timers - should not throw
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // scrollToBottom should not be called after unmount
  })

  describe('injected lastUserScrollTsRef', () => {
    it('uses injected ref when provided (B1)', () => {
      const xtermRef = { current: createMockXterm() }
      const terminalRef = createMockTerminalRef()
      const injectedRef = { current: 0 }

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, {
          lastUserScrollTsRef: injectedRef
        })
      )

      // Returned ref should be the same object as injected ref
      expect(result.current.lastUserScrollTsRef).toBe(injectedRef)
    })

    it('creates internal fallback ref when no injection (B2)', () => {
      const xtermRef = { current: createMockXterm() }
      const terminalRef = createMockTerminalRef()

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef)
      )

      // Should still return a ref (internally created)
      expect(result.current.lastUserScrollTsRef).toBeDefined()
      expect(result.current.lastUserScrollTsRef.current).toBe(0)
    })

    it('resetAll zeroes the injected ref (B3)', () => {
      const xtermRef = { current: createMockXterm() }
      const terminalRef = createMockTerminalRef()
      const injectedRef = { current: 5000 }

      const { result } = renderHook(() =>
        useScrollAnomalyRecovery(xtermRef, terminalRef, {
          lastUserScrollTsRef: injectedRef
        })
      )

      act(() => {
        result.current.resetAll()
      })

      // Injected ref should be zeroed
      expect(injectedRef.current).toBe(0)
    })
  })

  it('cancels previous RAF when new data arrives rapidly', async () => {
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    const mockXterm = createMockXterm(100, 100)
    const xtermRef = { current: mockXterm }
    const terminalRef = createMockTerminalRef()
    const originalHandler = vi.fn()

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef)
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

    // First data event
    wrappedHandler({ terminalId: 'test', data: 'first' })

    // Second data event (should cancel first RAF)
    wrappedHandler({ terminalId: 'test', data: 'second' })

    // cancelAnimationFrame should have been called
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
})
