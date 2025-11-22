/**
 * useScrollAnomalyRecovery Hook Tests
 *
 * Tests for the scroll anomaly detection and recovery hook.
 * Uses renderHook for isolated hook testing.
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
    scrollToBottom: mockScrollToBottom
  }) as unknown as Terminal

  // Create mock terminal ref with viewport element
  const createMockTerminalRef = () => {
    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'
    const container = document.createElement('div')
    container.appendChild(viewport)
    return { current: container }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Mock requestAnimationFrame to execute synchronously
    vi.stubGlobal('requestAnimationFrame', mockRAF)
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

  it('detects anomaly and triggers recovery after debounce', async () => {
    const mockXterm = createMockXterm(100, 100) // Start at bottom
    const xtermRef = { current: mockXterm }
    const terminalRef = createMockTerminalRef()
    const onRecovery = vi.fn()
    const originalHandler = vi.fn().mockImplementation(() => {
      // Simulate scroll jump during write
      mockXterm.buffer.active.viewportY = 0
    })

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

    // First call to establish lastDataTs
    wrappedHandler({ terminalId: 'test', data: 'first' })

    // Reset for second call
    mockXterm.buffer.active.viewportY = 100

    // Second call triggers anomaly detection
    wrappedHandler({ terminalId: 'test', data: 'second' })

    // Run RAF
    await act(async () => {
      vi.advanceTimersByTime(0)
      await Promise.resolve() // Allow RAF to process
    })

    // Run debounce timeout
    await act(async () => {
      vi.advanceTimersByTime(150)
    })

    expect(mockScrollToBottom).toHaveBeenCalled()
    expect(onRecovery).toHaveBeenCalled()
  })

  it('does NOT trigger recovery when user recently scrolled', async () => {
    // This test verifies that user scroll events prevent auto-recovery
    // The pure logic for this is tested in scrollAnomalyDetector.test.ts
    // Here we verify the viewport listener integration

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

    // Simulate user scroll on viewport - this sets lastUserScrollTs
    const viewport = terminalRef.current.querySelector('.xterm-viewport')
    expect(viewport).toBeTruthy()
    viewport!.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))

    // Enable jump for second call
    jumpOnWrite = true
    mockXterm.buffer.active.viewportY = 100 // Reset before capture
    wrappedHandler({ terminalId: 'test', data: 'second' })

    // Run debounce
    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    // Should NOT recover because user scroll timestamp is recent
    // With fake timers, Date.now() doesn't advance, so the scroll is always "recent"
    expect(mockScrollToBottom).not.toHaveBeenCalled()
    expect(onRecovery).not.toHaveBeenCalled()

    // Cleanup
    document.body.removeChild(terminalRef.current)
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
      vi.advanceTimersByTime(200)
    })

    expect(mockScrollToBottom).not.toHaveBeenCalled()
    expect(onRecovery).not.toHaveBeenCalled()
  })

  it('respects custom config', async () => {
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
          recoveryDebounceMs: 500 // Longer debounce
        }
      })
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

    wrappedHandler({ terminalId: 'test', data: 'first' })
    mockXterm.buffer.active.viewportY = 100
    wrappedHandler({ terminalId: 'test', data: 'second' })

    // After 100ms (default), should NOT have recovered yet
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(mockScrollToBottom).not.toHaveBeenCalled()

    // After 500ms, should have recovered
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(mockScrollToBottom).toHaveBeenCalled()
  })

  it('debounces multiple rapid anomalies', async () => {
    const mockXterm = createMockXterm(100, 100)
    const xtermRef = { current: mockXterm }
    const terminalRef = createMockTerminalRef()
    const onRecovery = vi.fn()
    const originalHandler = vi.fn().mockImplementation(() => {
      mockXterm.buffer.active.viewportY = 0
    })

    const { result } = renderHook(() =>
      useScrollAnomalyRecovery(xtermRef, terminalRef, { onRecovery })
    )

    const wrappedHandler = result.current.wrapOnDataHandler(originalHandler)

    // First call to establish lastDataTs
    wrappedHandler({ terminalId: 'test', data: 'init' })

    // Trigger 5 rapid anomalies
    for (let i = 0; i < 5; i++) {
      mockXterm.buffer.active.viewportY = 100
      wrappedHandler({ terminalId: 'test', data: `data-${i}` })
      await act(async () => {
        vi.advanceTimersByTime(20) // Less than debounce
      })
    }

    // Run full debounce
    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    // Should only call once due to debounce
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1)
    expect(onRecovery).toHaveBeenCalledTimes(1)
  })

  it('cleans up timeout on unmount', () => {
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

    // Trigger anomaly to start timeout
    wrappedHandler({ terminalId: 'test', data: 'first' })
    mockXterm.buffer.active.viewportY = 100
    wrappedHandler({ terminalId: 'test', data: 'second' })

    // Unmount before timeout completes
    unmount()

    // Run timers - should not throw
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // scrollToBottom should not be called after unmount
    // (the ref check in timeout should handle this)
  })
})
