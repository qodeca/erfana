// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useAutoOpenTerminal hook
 *
 * @see useAutoOpenTerminal.ts
 * @see Issue #55 - auto-open terminal panel feature
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoOpenTerminal } from './useAutoOpenTerminal'
import { useActivityBarStore } from '../stores/useActivityBarStore'

// Mock the ProjectManagementContext
vi.mock('../context/ProjectManagementContext', () => ({
  useProjectChangedEffect: vi.fn((callback) => {
    // Store the callback for manual triggering in tests
    mockProjectChangedCallback = callback
  })
}))

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

let mockProjectChangedCallback: ((newPath: string | null) => void) | null = null

describe('useAutoOpenTerminal', () => {
  beforeEach(() => {
    // Reset store state
    useActivityBarStore.setState({
      leftActivePanel: 'project',
      rightActivePanel: null,
      leftWidth: 300,
      rightWidth: 300,
      terminalUserClosed: false
    })
    mockProjectChangedCallback = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('registers for project change events', () => {
    renderHook(() => useAutoOpenTerminal())
    expect(mockProjectChangedCallback).not.toBe(null)
  })

  describe('when project loads (newPath is truthy)', () => {
    it('resets terminalUserClosed flag', () => {
      useActivityBarStore.setState({ terminalUserClosed: true })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('/path/to/project')

      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
    })

    it('auto-opens terminal when terminalUserClosed is false', () => {
      useActivityBarStore.setState({
        rightActivePanel: null,
        terminalUserClosed: false
      })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('/path/to/project')

      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('auto-opens terminal even if it was previously closed (flag is reset)', () => {
      useActivityBarStore.setState({
        rightActivePanel: null,
        terminalUserClosed: true
      })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('/path/to/project')

      // Flag should be reset AND terminal should be opened
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('handles different project paths', () => {
      renderHook(() => useAutoOpenTerminal())

      mockProjectChangedCallback?.('/first/project')
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')

      // Close terminal (user action)
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(true)

      // Switch to another project
      mockProjectChangedCallback?.('/second/project')
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
    })
  })

  describe('when project closes (newPath is null)', () => {
    it('does not change rightActivePanel', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal' })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.(null)

      // State should remain unchanged - existing behavior handles closing
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('does not reset terminalUserClosed flag', () => {
      useActivityBarStore.setState({ terminalUserClosed: true })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.(null)

      // Flag should remain unchanged
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(true)
    })

    it('does not auto-open terminal', () => {
      useActivityBarStore.setState({ rightActivePanel: null })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.(null)

      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
    })
  })

  describe('integration with activity bar store', () => {
    it('uses resetTerminalUserClosed action', () => {
      // Start with terminalUserClosed=true to verify it gets reset
      useActivityBarStore.setState({ terminalUserClosed: true })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('/path/to/project')

      // The action should have been called (via the store)
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
    })

    it('uses autoOpenTerminal action', () => {
      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('/path/to/project')

      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('respects existing terminal state on project load', () => {
      // If terminal is already open, it should remain open
      useActivityBarStore.setState({ rightActivePanel: 'terminal' })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('/path/to/project')

      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })
  })

  describe('empty string project path', () => {
    it('treats empty string as falsy (no auto-open)', () => {
      useActivityBarStore.setState({ rightActivePanel: null })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('')

      // Empty string is falsy, should not trigger auto-open
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
    })
  })

  describe('undefined project path handling', () => {
    it('treats undefined as falsy (no auto-open)', () => {
      useActivityBarStore.setState({ rightActivePanel: null })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.(undefined as unknown as string | null)

      // undefined is falsy, should not trigger auto-open
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
    })

    it('does not reset terminalUserClosed for undefined path', () => {
      useActivityBarStore.setState({ terminalUserClosed: true })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.(undefined as unknown as string | null)

      // Flag should remain unchanged
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(true)
    })
  })

  describe('hook lifecycle', () => {
    it('handles unmount during project change gracefully', () => {
      const { unmount } = renderHook(() => useAutoOpenTerminal())

      // Unmount hook before triggering project change
      unmount()

      // Callback should still exist but not cause errors when called
      // (React cleans up effect subscriptions on unmount)
      expect(() => {
        mockProjectChangedCallback?.('/path/to/project')
      }).not.toThrow()
    })

    it('can be re-mounted after unmount', () => {
      const { unmount } = renderHook(() => useAutoOpenTerminal())

      unmount()

      // Re-render after unmount should work
      const { unmount: unmount2 } = renderHook(() => useAutoOpenTerminal())

      // New callback should be registered
      mockProjectChangedCallback?.('/new/project')
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')

      unmount2()
    })
  })

  describe('uses atomic openTerminalOnProjectLoad action', () => {
    it('uses openTerminalOnProjectLoad instead of separate calls', () => {
      // Spy on the store action to verify it's being called
      const openTerminalOnProjectLoadSpy = vi.spyOn(
        useActivityBarStore.getState(),
        'openTerminalOnProjectLoad'
      )

      useActivityBarStore.setState({ terminalUserClosed: true, rightActivePanel: null })

      renderHook(() => useAutoOpenTerminal())
      mockProjectChangedCallback?.('/path/to/project')

      // Verify the atomic action was called
      expect(openTerminalOnProjectLoadSpy).toHaveBeenCalled()

      // Verify both state changes happened atomically
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')

      openTerminalOnProjectLoadSpy.mockRestore()
    })
  })
})
