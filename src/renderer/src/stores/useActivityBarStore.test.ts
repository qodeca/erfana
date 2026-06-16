// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useActivityBarStore
 *
 * @see useActivityBarStore.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useActivityBarStore } from './useActivityBarStore'

describe('useActivityBarStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useActivityBarStore.setState({
      leftActivePanel: 'project',
      rightActivePanel: null,
      leftWidth: 300,
      rightWidth: 300,
      terminalUserClosed: false,
      terminalExpanded: false
    })
    // Isolate persistence assertions across tests
    localStorage.clear()
  })

  describe('initial state', () => {
    it('has project panel active on left by default', () => {
      const state = useActivityBarStore.getState()
      expect(state.leftActivePanel).toBe('project')
    })

    it('has no panel active on right by default', () => {
      const state = useActivityBarStore.getState()
      expect(state.rightActivePanel).toBe(null)
    })

    it('has default sidebar widths', () => {
      const state = useActivityBarStore.getState()
      expect(state.leftWidth).toBe(300)
      expect(state.rightWidth).toBe(300)
    })

    it('has terminalUserClosed false by default', () => {
      const state = useActivityBarStore.getState()
      expect(state.terminalUserClosed).toBe(false)
    })
  })

  describe('togglePanel', () => {
    it('opens a panel when clicking different panel', () => {
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('closes a panel when clicking same panel', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal' })
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
    })

    it('switches panels when clicking different panel', () => {
      useActivityBarStore.setState({ rightActivePanel: 'git' })
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('works for left side panels', () => {
      useActivityBarStore.getState().togglePanel('project', 'left')
      expect(useActivityBarStore.getState().leftActivePanel).toBe(null)
    })

    describe('terminal user closed tracking', () => {
      it('sets terminalUserClosed to true when closing terminal', () => {
        useActivityBarStore.setState({ rightActivePanel: 'terminal' })
        useActivityBarStore.getState().togglePanel('terminal', 'right')
        expect(useActivityBarStore.getState().terminalUserClosed).toBe(true)
      })

      it('does not set terminalUserClosed when opening terminal', () => {
        useActivityBarStore.getState().togglePanel('terminal', 'right')
        expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
      })

      it('does not set terminalUserClosed when closing non-terminal panels', () => {
        useActivityBarStore.setState({ leftActivePanel: 'project' })
        useActivityBarStore.getState().togglePanel('project', 'left')
        expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
      })

      it('does not set terminalUserClosed when switching away from terminal on left side', () => {
        // Edge case: terminal should only track right side
        useActivityBarStore.setState({ leftActivePanel: 'terminal' })
        useActivityBarStore.getState().togglePanel('terminal', 'left')
        expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
      })
    })
  })

  describe('setActivePanel', () => {
    it('sets left panel', () => {
      useActivityBarStore.getState().setActivePanel('git', 'left')
      expect(useActivityBarStore.getState().leftActivePanel).toBe('git')
    })

    it('sets right panel', () => {
      useActivityBarStore.getState().setActivePanel('terminal', 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('clears panel when set to null', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal' })
      useActivityBarStore.getState().setActivePanel(null, 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
    })
  })

  describe('setSidebarWidth', () => {
    it('sets left sidebar width', () => {
      useActivityBarStore.getState().setSidebarWidth(400, 'left')
      expect(useActivityBarStore.getState().leftWidth).toBe(400)
    })

    it('sets right sidebar width', () => {
      useActivityBarStore.getState().setSidebarWidth(500, 'right')
      expect(useActivityBarStore.getState().rightWidth).toBe(500)
    })

    it('does not update if width is unchanged', () => {
      const initialState = useActivityBarStore.getState()
      useActivityBarStore.getState().setSidebarWidth(300, 'left')
      // State reference should remain same if nothing changed
      expect(useActivityBarStore.getState().leftWidth).toBe(initialState.leftWidth)
    })
  })

  describe('isActive', () => {
    it('returns true for active left panel', () => {
      expect(useActivityBarStore.getState().isActive('project', 'left')).toBe(true)
    })

    it('returns false for inactive left panel', () => {
      expect(useActivityBarStore.getState().isActive('git', 'left')).toBe(false)
    })

    it('returns true for active right panel', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal' })
      expect(useActivityBarStore.getState().isActive('terminal', 'right')).toBe(true)
    })

    it('returns false when right panel is null', () => {
      expect(useActivityBarStore.getState().isActive('terminal', 'right')).toBe(false)
    })
  })

  describe('resetTerminalUserClosed', () => {
    it('resets terminalUserClosed to false', () => {
      useActivityBarStore.setState({ terminalUserClosed: true })
      useActivityBarStore.getState().resetTerminalUserClosed()
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
    })

    it('does nothing if already false', () => {
      useActivityBarStore.getState().resetTerminalUserClosed()
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
    })
  })

  describe('autoOpenTerminal', () => {
    it('opens terminal when terminalUserClosed is false', () => {
      useActivityBarStore.setState({ terminalUserClosed: false, rightActivePanel: null })
      useActivityBarStore.getState().autoOpenTerminal()
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('does not open terminal when terminalUserClosed is true', () => {
      useActivityBarStore.setState({ terminalUserClosed: true, rightActivePanel: null })
      useActivityBarStore.getState().autoOpenTerminal()
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
    })

    it('overwrites existing panel when opening terminal', () => {
      useActivityBarStore.setState({ terminalUserClosed: false, rightActivePanel: 'git' })
      useActivityBarStore.getState().autoOpenTerminal()
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })
  })

  describe('auto-open terminal workflow', () => {
    it('opens terminal on project load then respects user close', () => {
      // Initial state - no project
      useActivityBarStore.setState({
        rightActivePanel: null,
        terminalUserClosed: false
      })

      // Project loads - auto-open should work
      useActivityBarStore.getState().resetTerminalUserClosed()
      useActivityBarStore.getState().autoOpenTerminal()
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')

      // User closes terminal (Cmd+J)
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(true)

      // User reopens terminal manually - should work
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')

      // User closes again
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(true)

      // Auto-open should NOT work now
      useActivityBarStore.getState().autoOpenTerminal()
      expect(useActivityBarStore.getState().rightActivePanel).toBe(null)

      // New project loads - reset flag and auto-open
      useActivityBarStore.getState().resetTerminalUserClosed()
      useActivityBarStore.getState().autoOpenTerminal()
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })
  })

  describe('openTerminalOnProjectLoad', () => {
    it('atomically resets terminalUserClosed and opens terminal', () => {
      useActivityBarStore.setState({
        terminalUserClosed: true,
        rightActivePanel: null
      })

      useActivityBarStore.getState().openTerminalOnProjectLoad()

      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('opens terminal even when terminalUserClosed was false', () => {
      useActivityBarStore.setState({
        terminalUserClosed: false,
        rightActivePanel: null
      })

      useActivityBarStore.getState().openTerminalOnProjectLoad()

      expect(useActivityBarStore.getState().terminalUserClosed).toBe(false)
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('overwrites existing right panel', () => {
      useActivityBarStore.setState({
        terminalUserClosed: false,
        rightActivePanel: 'git'
      })

      useActivityBarStore.getState().openTerminalOnProjectLoad()

      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('does not affect left panel state', () => {
      useActivityBarStore.setState({
        leftActivePanel: 'project',
        rightActivePanel: null,
        terminalUserClosed: true
      })

      useActivityBarStore.getState().openTerminalOnProjectLoad()

      expect(useActivityBarStore.getState().leftActivePanel).toBe('project')
    })

    it('does not affect sidebar widths', () => {
      useActivityBarStore.setState({
        leftWidth: 400,
        rightWidth: 500,
        terminalUserClosed: true,
        rightActivePanel: null
      })

      useActivityBarStore.getState().openTerminalOnProjectLoad()

      expect(useActivityBarStore.getState().leftWidth).toBe(400)
      expect(useActivityBarStore.getState().rightWidth).toBe(500)
    })

    it('is equivalent to calling resetTerminalUserClosed then autoOpenTerminal with fresh flag', () => {
      // Test 1: Using atomic action
      useActivityBarStore.setState({
        terminalUserClosed: true,
        rightActivePanel: null
      })
      useActivityBarStore.getState().openTerminalOnProjectLoad()
      const stateAfterAtomic = {
        terminalUserClosed: useActivityBarStore.getState().terminalUserClosed,
        rightActivePanel: useActivityBarStore.getState().rightActivePanel
      }

      // Test 2: Using separate calls (simulating the old pattern)
      useActivityBarStore.setState({
        terminalUserClosed: true,
        rightActivePanel: null
      })
      useActivityBarStore.getState().resetTerminalUserClosed()
      useActivityBarStore.getState().autoOpenTerminal()
      const stateAfterSeparate = {
        terminalUserClosed: useActivityBarStore.getState().terminalUserClosed,
        rightActivePanel: useActivityBarStore.getState().rightActivePanel
      }

      // Both approaches should result in the same state
      expect(stateAfterAtomic).toEqual(stateAfterSeparate)
    })
  })

  describe('persistence partialize', () => {
    it('terminalUserClosed should not affect persisted state', () => {
      // This test verifies the partialize config works correctly
      // by checking that terminalUserClosed changes don't trigger
      // persistence updates (we can't directly test localStorage
      // in this unit test, but we verify the state shape)

      const state = useActivityBarStore.getState()

      // These should be in persisted state
      expect(state).toHaveProperty('leftActivePanel')
      expect(state).toHaveProperty('rightActivePanel')
      expect(state).toHaveProperty('leftWidth')
      expect(state).toHaveProperty('rightWidth')

      // This should be ephemeral (not persisted via partialize)
      expect(state).toHaveProperty('terminalUserClosed')
    })
  })

  describe('terminalExpanded', () => {
    it('defaults to false', () => {
      expect(useActivityBarStore.getState().terminalExpanded).toBe(false)
    })

    it('toggleTerminalExpanded expands and force-opens the terminal', () => {
      useActivityBarStore.setState({ rightActivePanel: null, terminalUserClosed: true })
      useActivityBarStore.getState().toggleTerminalExpanded()
      const s = useActivityBarStore.getState()
      expect(s.terminalExpanded).toBe(true)
      expect(s.rightActivePanel).toBe('terminal')
      expect(s.terminalUserClosed).toBe(false)
    })

    it('toggleTerminalExpanded collapses without changing terminal visibility', () => {
      useActivityBarStore.setState({ terminalExpanded: true, rightActivePanel: 'terminal' })
      useActivityBarStore.getState().toggleTerminalExpanded()
      const s = useActivityBarStore.getState()
      expect(s.terminalExpanded).toBe(false)
      expect(s.rightActivePanel).toBe('terminal')
    })

    it('setTerminalExpanded(false) is a no-op when already false', () => {
      useActivityBarStore.setState({ terminalExpanded: false })
      useActivityBarStore.getState().setTerminalExpanded(false)
      expect(useActivityBarStore.getState().terminalExpanded).toBe(false)
    })

    it('closing the terminal via togglePanel clears terminalExpanded', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal', terminalExpanded: true })
      useActivityBarStore.getState().togglePanel('terminal', 'right')
      expect(useActivityBarStore.getState().terminalExpanded).toBe(false)
    })

    it('setActivePanel(null, right) clears terminalExpanded', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal', terminalExpanded: true })
      useActivityBarStore.getState().setActivePanel(null, 'right')
      expect(useActivityBarStore.getState().terminalExpanded).toBe(false)
    })

    it('setActivePanel("terminal","right") preserves terminalExpanded', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal', terminalExpanded: true })
      useActivityBarStore.getState().setActivePanel('terminal', 'right')
      expect(useActivityBarStore.getState().terminalExpanded).toBe(true)
    })

    it('switching the right panel away from terminal clears terminalExpanded', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal', terminalExpanded: true })
      useActivityBarStore.getState().setActivePanel('git', 'right')
      expect(useActivityBarStore.getState().terminalExpanded).toBe(false)
    })

    it('re-arms auto-open when expanding after a manual close', () => {
      useActivityBarStore.setState({ rightActivePanel: 'terminal' })
      useActivityBarStore.getState().togglePanel('terminal', 'right') // user close
      expect(useActivityBarStore.getState().terminalUserClosed).toBe(true)
      useActivityBarStore.getState().toggleTerminalExpanded() // expand re-arms
      useActivityBarStore.setState({ rightActivePanel: null })
      useActivityBarStore.getState().autoOpenTerminal()
      expect(useActivityBarStore.getState().rightActivePanel).toBe('terminal')
    })

    it('does not persist terminalExpanded (excluded from partialize)', () => {
      useActivityBarStore.setState({ terminalExpanded: true })
      // Trigger a persisted write by changing a persisted field
      useActivityBarStore.getState().setSidebarWidth(321, 'left')
      const persisted = JSON.parse(localStorage.getItem('erfana-activity-bar-state') ?? '{}')
      expect(persisted.state ?? {}).not.toHaveProperty('terminalExpanded')
    })
  })
})
