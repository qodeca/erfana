// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { createTerminalStore } from './useTerminalStore'
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
