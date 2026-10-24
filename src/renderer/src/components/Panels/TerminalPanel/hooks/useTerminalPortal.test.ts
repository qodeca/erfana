// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTerminalPortal Hook
 *
 * @module TerminalPanel/hooks/useTerminalPortal.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { useTerminalPortal } from './useTerminalPortal'

// Mock the context
const mockOnRefitRequest = vi.fn()
vi.mock('../../../../context/TerminalPortalContext', () => ({
  useTerminalPortalOptional: vi.fn(() => ({
    portalTarget: 'main',
    diagramViewerContainerRef: { current: null },
    onRefitRequest: mockOnRefitRequest
  }))
}))

vi.mock('../../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

describe('useTerminalPortal', () => {
  const mockFit = vi.fn()
  const mockResizePty = vi.fn()

  const createMockRefs = (terminalId: string | null = 'terminal-1') => ({
    fitAddonRef: { current: { fit: mockFit } as unknown as FitAddon },
    xtermRef: {
      current: { cols: 80, rows: 24 } as unknown as Terminal
    },
    terminalId,
    resizePty: mockResizePty
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockOnRefitRequest.mockReturnValue(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns portalTarget from context', () => {
    const refs = createMockRefs()

    const { result } = renderHook(() =>
      useTerminalPortal({
        ...refs,
        fitAddonRef: refs.fitAddonRef,
        xtermRef: refs.xtermRef
      })
    )

    expect(result.current.portalTarget).toBe('main')
  })

  it('provides mainContainerRef', () => {
    const refs = createMockRefs()

    const { result } = renderHook(() =>
      useTerminalPortal({
        ...refs,
        fitAddonRef: refs.fitAddonRef,
        xtermRef: refs.xtermRef
      })
    )

    expect(result.current.mainContainerRef).toBeDefined()
    expect(result.current.mainContainerRef.current).toBeNull() // Not mounted yet
  })

  it('provides terminalPanelRef', () => {
    const refs = createMockRefs()

    const { result } = renderHook(() =>
      useTerminalPortal({
        ...refs,
        fitAddonRef: refs.fitAddonRef,
        xtermRef: refs.xtermRef
      })
    )

    expect(result.current.terminalPanelRef).toBeDefined()
    expect(result.current.terminalPanelRef.current).toBeNull() // Not mounted yet
  })

  it('provides portalContext', () => {
    const refs = createMockRefs()

    const { result } = renderHook(() =>
      useTerminalPortal({
        ...refs,
        fitAddonRef: refs.fitAddonRef,
        xtermRef: refs.xtermRef
      })
    )

    expect(result.current.portalContext).toBeDefined()
  })

  it('subscribes to refit requests when context available', () => {
    const refs = createMockRefs()

    renderHook(() =>
      useTerminalPortal({
        ...refs,
        fitAddonRef: refs.fitAddonRef,
        xtermRef: refs.xtermRef
      })
    )

    expect(mockOnRefitRequest).toHaveBeenCalled()
  })

  it('calls fit on refit request', () => {
    let refitCallback: (() => void) | null = null
    mockOnRefitRequest.mockImplementation((cb: () => void) => {
      refitCallback = cb
      return () => {}
    })

    const refs = createMockRefs()

    renderHook(() =>
      useTerminalPortal({
        ...refs,
        fitAddonRef: refs.fitAddonRef,
        xtermRef: refs.xtermRef
      })
    )

    // Trigger refit
    act(() => {
      refitCallback?.()
      vi.advanceTimersByTime(50)
    })

    expect(mockFit).toHaveBeenCalled()
  })

  it('cleans up refit subscription on unmount', () => {
    const unsubscribe = vi.fn()
    mockOnRefitRequest.mockReturnValue(unsubscribe)

    const refs = createMockRefs()

    const { unmount } = renderHook(() =>
      useTerminalPortal({
        ...refs,
        fitAddonRef: refs.fitAddonRef,
        xtermRef: refs.xtermRef
      })
    )

    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
