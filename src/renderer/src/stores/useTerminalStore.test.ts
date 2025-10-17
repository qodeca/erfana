import { describe, it, expect } from 'vitest'
import { useTerminalStore } from './useTerminalStore'

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
