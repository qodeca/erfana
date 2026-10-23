// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { ACTIVITY_THROTTLE_MS, createTerminalStore } from './useTerminalStore'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'

// Mock terminal operations (not used in these tests, but required for store creation)
const mockTerminalOps: ITerminalOperations = {
  write: vi.fn()
}

// Create store instance with mocked dependencies
const useTerminalStore = createTerminalStore(mockTerminalOps)

describe('useTerminalStore activity tracking', () => {
  it('tracks per-terminal activity and clears', async () => {
    const store = useTerminalStore.getState()
    // No active terminal
    expect(store.isRecentlyActive()).toBe(false)

    // Set active and mark activity
    useTerminalStore.setState({ activeTerminalId: 't1' })
    store.markActivity('t1')
    expect(useTerminalStore.getState().isRecentlyActive()).toBe(true)
    expect(useTerminalStore.getState().isRecentlyActiveId('t1', 3000)).toBe(true)

    // Clear and verify inactive
    store.clearActivity('t1')
    expect(useTerminalStore.getState().isRecentlyActive()).toBe(false)
  })

  it('records user input per terminal and reports interaction presence', () => {
    const store = useTerminalStore.getState()
    expect(store.hasUserInteracted()).toBe(false)
    useTerminalStore.setState({ activeTerminalId: 't2' })
    expect(store.hasUserInteracted()).toBe(false)
    store.markUserInput('t2')
    expect(useTerminalStore.getState().hasUserInteracted()).toBe(true)
  })
})

describe('useTerminalStore markActivity throttle (finding [30])', () => {
  it('does not replace the map or notify subscribers for every output batch', () => {
    vi.useFakeTimers()
    try {
      const store = createTerminalStore(mockTerminalOps)
      const listener = vi.fn()
      const unsubscribe = store.subscribe(listener)

      store.getState().markActivity('t1')
      const first = store.getState().activityById
      for (let i = 0; i < 1000; i++) store.getState().markActivity('t1')
      expect(listener).toHaveBeenCalledTimes(1)
      expect(store.getState().activityById).toBe(first)

      // A later batch still moves the timestamp forward
      vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS)
      store.getState().markActivity('t1')
      expect(listener).toHaveBeenCalledTimes(2)
      expect(store.getState().activityById.get('t1')).toBe(Date.now())

      // The throttle is per terminal
      store.getState().markActivity('t2')
      expect(store.getState().activityById.has('t2')).toBe(true)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useTerminalStore scrollLocked', () => {
  it('scrollLocked should default to false', () => {
    // Create a fresh store instance for this test
    const freshStore = createTerminalStore(mockTerminalOps)
    const state = freshStore.getState()

    expect(state.scrollLocked).toBe(false)
  })

  it('setScrollLocked(true) should set scrollLocked to true', () => {
    const store = useTerminalStore.getState()

    store.setScrollLocked(true)

    expect(useTerminalStore.getState().scrollLocked).toBe(true)
  })

  it('setScrollLocked(false) should set scrollLocked to false', () => {
    const store = useTerminalStore.getState()

    // First set to true
    store.setScrollLocked(true)
    expect(useTerminalStore.getState().scrollLocked).toBe(true)

    // Then set back to false
    store.setScrollLocked(false)
    expect(useTerminalStore.getState().scrollLocked).toBe(false)
  })

  it('can toggle scrollLocked state multiple times', () => {
    const store = useTerminalStore.getState()

    // Toggle sequence: false -> true -> false -> true
    expect(useTerminalStore.getState().scrollLocked).toBe(false)

    store.setScrollLocked(true)
    expect(useTerminalStore.getState().scrollLocked).toBe(true)

    store.setScrollLocked(false)
    expect(useTerminalStore.getState().scrollLocked).toBe(false)

    store.setScrollLocked(true)
    expect(useTerminalStore.getState().scrollLocked).toBe(true)
  })
})

describe('useTerminalStore formatPathsForActiveTerminal', () => {
  const path = 'C:\\Users\\Bob\u2019s Files\\proj'

  it('quotes for a powershell terminal', () => {
    useTerminalStore.getState().setActiveTerminal({ id: 't-powershell', shellKind: 'powershell' })
    expect(useTerminalStore.getState().formatPathsForActiveTerminal([path])).toBe(
      "'C:\\Users\\Bob\u2019\u2019s Files\\proj'"
    )
  })

  it('quotes for a cmd terminal', () => {
    useTerminalStore.getState().setActiveTerminal({ id: 't-cmd', shellKind: 'cmd' })
    expect(useTerminalStore.getState().formatPathsForActiveTerminal([path])).toBe(`"${path}"`)
  })

  it('quotes for a posix terminal, one path per line', () => {
    useTerminalStore.getState().setActiveTerminal({ id: 't-posix', shellKind: 'posix' })
    expect(useTerminalStore.getState().formatPathsForActiveTerminal(['/a/b', '/c d'])).toBe(
      "'/a/b'\n'/c d'"
    )
  })

  it('falls back to the platform default until the shell kind is known', () => {
    const getPlatform = vi.fn(() => 'win32')
    vi.stubGlobal('window', { api: { utils: { getPlatform } } })
    try {
      useTerminalStore.getState().setActiveTerminal({ id: 't-none', shellKind: null })
      expect(useTerminalStore.getState().formatPathsForActiveTerminal(["C:\\it's"])).toBe(
        "'C:\\it''s'"
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('useTerminalStore active terminal and shell kind', () => {
  it('sets and clears the id and the shell kind together', () => {
    useTerminalStore.getState().setActiveTerminal({ id: 't9', shellKind: 'cmd' })
    expect(useTerminalStore.getState().activeTerminalId).toBe('t9')
    expect(useTerminalStore.getState().activeShellKind).toBe('cmd')
    useTerminalStore.getState().setActiveTerminal(null)
    expect(useTerminalStore.getState().activeTerminalId).toBeNull()
    expect(useTerminalStore.getState().activeShellKind).toBeNull()
  })

  it('drops the shell kind when only the id changes', () => {
    useTerminalStore.getState().setActiveTerminal({ id: 't9', shellKind: 'cmd' })
    useTerminalStore.getState().setActiveTerminalId('t10')
    expect(useTerminalStore.getState().activeShellKind).toBeNull()
  })
})
