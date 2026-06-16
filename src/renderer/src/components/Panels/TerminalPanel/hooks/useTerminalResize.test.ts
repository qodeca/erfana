// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTerminalResize Hook
 *
 * @module TerminalPanel/hooks/useTerminalResize.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTerminalResize } from './useTerminalResize'

// Mock logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

// Mock ResizeObserver
const mockResizeObserverObserve = vi.fn()
const mockResizeObserverDisconnect = vi.fn()
const mockResizeObserverCallback = vi.fn()

vi.stubGlobal(
  'ResizeObserver',
  vi.fn((callback: ResizeObserverCallback) => {
    mockResizeObserverCallback.mockImplementation(callback)
    return {
      observe: mockResizeObserverObserve,
      disconnect: mockResizeObserverDisconnect,
      unobserve: vi.fn()
    }
  })
)

describe('useTerminalResize', () => {
  const mockFit = vi.fn()
  const mockResizePty = vi.fn()

  const createMockRefs = (terminalId: string | null = 'terminal-1') => ({
    terminalRef: { current: document.createElement('div') },
    fitAddonRef: { current: { fit: mockFit } as unknown as { current: null } },
    xtermRef: {
      current: { cols: 80, rows: 24 } as unknown as { current: null }
    },
    terminalId,
    resizePty: mockResizePty
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not set up observer when terminalId is null', () => {
    const refs = createMockRefs(null)

    renderHook(() =>
      useTerminalResize({
        ...refs,
        terminalRef: refs.terminalRef as React.RefObject<HTMLDivElement | null>,
        fitAddonRef: refs.fitAddonRef as React.RefObject<null>,
        xtermRef: refs.xtermRef as React.RefObject<null>
      })
    )

    expect(mockResizeObserverObserve).not.toHaveBeenCalled()
  })

  it('sets up ResizeObserver when terminal is ready', () => {
    const refs = createMockRefs('terminal-1')

    renderHook(() =>
      useTerminalResize({
        ...refs,
        terminalRef: refs.terminalRef as React.RefObject<HTMLDivElement | null>,
        fitAddonRef: refs.fitAddonRef as React.RefObject<null>,
        xtermRef: refs.xtermRef as React.RefObject<null>
      })
    )

    expect(mockResizeObserverObserve).toHaveBeenCalledWith(refs.terminalRef.current)
  })

  it('disconnects observer on cleanup', () => {
    const refs = createMockRefs('terminal-1')

    const { unmount } = renderHook(() =>
      useTerminalResize({
        ...refs,
        terminalRef: refs.terminalRef as React.RefObject<HTMLDivElement | null>,
        fitAddonRef: refs.fitAddonRef as React.RefObject<null>,
        xtermRef: refs.xtermRef as React.RefObject<null>
      })
    )

    unmount()

    expect(mockResizeObserverDisconnect).toHaveBeenCalled()
  })

  it('calls fitAddon.fit on initial timeout', () => {
    const refs = createMockRefs('terminal-1')

    renderHook(() =>
      useTerminalResize({
        ...refs,
        terminalRef: refs.terminalRef as React.RefObject<HTMLDivElement | null>,
        fitAddonRef: refs.fitAddonRef as React.RefObject<null>,
        xtermRef: refs.xtermRef as React.RefObject<null>
      })
    )

    // Fast-forward past initial delay
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(mockFit).toHaveBeenCalled()
  })

  it('calls resizePty when dimensions change significantly', () => {
    const refs = createMockRefs('terminal-1')
     
    ;(refs.xtermRef.current as any).cols = 100
     
    ;(refs.xtermRef.current as any).rows = 30

    renderHook(() =>
      useTerminalResize({
        ...refs,
        terminalRef: refs.terminalRef as React.RefObject<HTMLDivElement | null>,
        fitAddonRef: refs.fitAddonRef as React.RefObject<null>,
        xtermRef: refs.xtermRef as React.RefObject<null>
      })
    )

    // Fast-forward past initial delay
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(mockResizePty).toHaveBeenCalledWith('terminal-1', 100, 30)
  })

  it('provides triggerResize function', () => {
    const refs = createMockRefs('terminal-1')

    const { result } = renderHook(() =>
      useTerminalResize({
        ...refs,
        terminalRef: refs.terminalRef as React.RefObject<HTMLDivElement | null>,
        fitAddonRef: refs.fitAddonRef as React.RefObject<null>,
        xtermRef: refs.xtermRef as React.RefObject<null>
      })
    )

    expect(typeof result.current.triggerResize).toBe('function')

    act(() => {
      result.current.triggerResize()
    })

    expect(mockFit).toHaveBeenCalled()
  })

  it('clears pending timeouts on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    const refs = createMockRefs('terminal-1')

    const { unmount } = renderHook(() =>
      useTerminalResize({
        ...refs,
        terminalRef: refs.terminalRef as React.RefObject<HTMLDivElement | null>,
        fitAddonRef: refs.fitAddonRef as React.RefObject<null>,
        xtermRef: refs.xtermRef as React.RefObject<null>
      })
    )

    unmount()

    // Should have cleared the initial timeout
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
