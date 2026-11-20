// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** Subscription ids (#478, plan decisions 4–6, F25): events for a replaced id never reach the tab. */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – ids', () => {
  it('mints a new id per subscribe and drops the old one', async () => {
    const tab = new TextTab()
    await tab.open()
    const first = tab.tracker.watchId

    await tab.tracker.reload()
    await tab.run(200)

    expect(tab.tracker.watchId).not.toBe(first)
    expect(tab.source.unsubscribeCalls).toEqual([first])
  })

  it('a late event for an id replaced by Reload is dropped', async () => {
    const tab = new TextTab()
    await tab.open()
    const old = tab.tracker.watchId as string
    await tab.tracker.reload()
    await tab.run(200)
    const readsAfterReload = tab.reads

    tab.source.muted = true
    tab.disk.write(FILE, 'v1')
    tab.source.emit({ watchId: old, kind: 'changed' })
    tab.source.emit({ watchId: old, kind: 'ended', reason: 'watcher-error' })
    await tab.run(500)

    expect(tab.reads).toBe(readsAfterReload)
    expect(tab.state.watch).toEqual({ kind: 'active', live: 'full' })
  })

  it('a subscribe reply that lands after dispose unsubscribes its own id', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'hold' })
    await tab.open()
    tab.tracker.dispose()
    tab.source.releaseHeld()
    await tab.run(50)

    expect(tab.source.subscriptions.size).toBe(0)
    expect(tab.source.listenerCount).toBe(0)
  })

  it('dispose unsubscribes and leaves no timer behind', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(100)
    tab.tracker.dispose()
    await tab.run(5_000)

    expect(tab.source.subscriptions.size).toBe(0)
    expect(tab.clock.pendingTimers()).toBe(0)
  })
})
