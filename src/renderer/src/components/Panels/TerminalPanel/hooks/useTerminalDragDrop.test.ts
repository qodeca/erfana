// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTerminalDragDrop Hook
 *
 * @module TerminalPanel/hooks/useTerminalDragDrop.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTerminalDragDrop } from './useTerminalDragDrop'

// Mock dependencies
vi.mock('../../../../stores/useTerminalStore', () => ({
  useTerminalStore: {
    getState: () => ({
      sendToTerminal: vi.fn().mockResolvedValue(true)
    })
  }
}))

vi.mock('../../../../utils/toastHelpers', () => ({
  showWarningToast: vi.fn()
}))

vi.mock('../../../../utils/shellPathEscape', () => ({
  formatPathsForTerminal: vi.fn((paths: string[]) => paths.join(' '))
}))

vi.mock('../../../../utils/domGeometry', () => ({
  isPointInElement: vi.fn(() => false)
}))

vi.mock('../../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

describe('useTerminalDragDrop', () => {
  const mockTerminalPanelRef = { current: document.createElement('div') }
  const mockTerminalIdRef = { current: 'terminal-1' }
  const mockXtermRef = { current: { focus: vi.fn() } as unknown as { current: null } }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any attached handlers
    vi.restoreAllMocks()
  })

  it('initializes with isDropTarget false', () => {
    const { result } = renderHook(() =>
      useTerminalDragDrop({
        terminalPanelRef: mockTerminalPanelRef,
        terminalIdRef: mockTerminalIdRef,
        xtermRef: mockXtermRef as React.RefObject<null>,
        enabled: true
      })
    )

    expect(result.current.isDropTarget).toBe(false)
  })

  it('provides setIsDropTarget for manual state control', () => {
    const { result } = renderHook(() =>
      useTerminalDragDrop({
        terminalPanelRef: mockTerminalPanelRef,
        terminalIdRef: mockTerminalIdRef,
        xtermRef: mockXtermRef as React.RefObject<null>,
        enabled: true
      })
    )

    act(() => {
      result.current.setIsDropTarget(true)
    })

    expect(result.current.isDropTarget).toBe(true)
  })

  it('attaches drag handlers to document when enabled', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

    const { result } = renderHook(() =>
      useTerminalDragDrop({
        terminalPanelRef: mockTerminalPanelRef,
        terminalIdRef: mockTerminalIdRef,
        xtermRef: mockXtermRef as React.RefObject<null>,
        enabled: true
      })
    )

    act(() => {
      result.current.attachDragHandlers()
    })

    expect(addEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function), {
      capture: true
    })
    expect(addEventListenerSpy).toHaveBeenCalledWith('dragenter', expect.any(Function), {
      capture: true
    })
    expect(addEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function), {
      capture: true
    })
    expect(addEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function), { capture: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('dragend', expect.any(Function), {
      capture: true
    })

    // Cleanup
    act(() => {
      result.current.cleanupDragHandlers()
    })
  })

  it('does not attach handlers when disabled', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

    const { result } = renderHook(() =>
      useTerminalDragDrop({
        terminalPanelRef: mockTerminalPanelRef,
        terminalIdRef: mockTerminalIdRef,
        xtermRef: mockXtermRef as React.RefObject<null>,
        enabled: false
      })
    )

    act(() => {
      result.current.attachDragHandlers()
    })

    expect(addEventListenerSpy).not.toHaveBeenCalled()
  })

  it('removes handlers on cleanup', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

    const { result } = renderHook(() =>
      useTerminalDragDrop({
        terminalPanelRef: mockTerminalPanelRef,
        terminalIdRef: mockTerminalIdRef,
        xtermRef: mockXtermRef as React.RefObject<null>,
        enabled: true
      })
    )

    act(() => {
      result.current.attachDragHandlers()
    })

    act(() => {
      result.current.cleanupDragHandlers()
    })

    expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function), {
      capture: true
    })
    expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function), {
      capture: true
    })
  })

  it('dragHandlersRef is null after cleanup', () => {
    const { result } = renderHook(() =>
      useTerminalDragDrop({
        terminalPanelRef: mockTerminalPanelRef,
        terminalIdRef: mockTerminalIdRef,
        xtermRef: mockXtermRef as React.RefObject<null>,
        enabled: true
      })
    )

    act(() => {
      result.current.attachDragHandlers()
    })

    expect(result.current.dragHandlersRef.current).not.toBeNull()

    act(() => {
      result.current.cleanupDragHandlers()
    })

    expect(result.current.dragHandlersRef.current).toBeNull()
  })

  it('cleanup is safe to call multiple times', () => {
    const { result } = renderHook(() =>
      useTerminalDragDrop({
        terminalPanelRef: mockTerminalPanelRef,
        terminalIdRef: mockTerminalIdRef,
        xtermRef: mockXtermRef as React.RefObject<null>,
        enabled: true
      })
    )

    // Cleanup without attaching should not throw
    expect(() => {
      act(() => {
        result.current.cleanupDragHandlers()
        result.current.cleanupDragHandlers()
      })
    }).not.toThrow()
  })
})
