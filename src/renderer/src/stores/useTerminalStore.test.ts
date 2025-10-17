import { describe, it, expect, vi } from 'vitest'
import { useTerminalStore } from './useTerminalStore'

describe('useTerminalStore activity tracking', () => {
  it('tracks last activity time and recent window', async () => {
    const store = useTerminalStore.getState()
    expect(store.isRecentlyActive()).toBe(false)
    store.setLastActivityNow()
    expect(useTerminalStore.getState().isRecentlyActive(10000)).toBe(true)

    // Advance time beyond window and verify false
    const originalNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 20000)
    expect(useTerminalStore.getState().isRecentlyActive(10000)).toBe(false)
  })
})

