// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** Catch-up after every start (#478 G3, F25): a write made before the watch is live is never lost. */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – catch-up (G3)', () => {
  it('a write made while the subscribe waits for ready is shown once it is live', async () => {
    const tab = new TextTab()
    tab.source.muted = true // the native watcher is not ready yet: no event for this write
    tab.source.scriptSubscribe({ kind: 'hold' })
    await tab.open()

    tab.disk.write(FILE, 'written before ready')
    tab.source.releaseHeld()
    tab.source.muted = false
    await tab.run(200)

    expect(tab.shown).toBe('written before ready')
    expect(tab.state).toEqual({ watch: { kind: 'active', live: 'full' }, content: { kind: 'fresh' } })
  })

  it('F25: a change that arrives before started is folded into the catch-up, applied once', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'hold' })
    await tab.open()

    tab.disk.write(FILE, 'v1') // the event reaches the tracker before the reply
    tab.source.releaseHeld()
    await tab.run(500)

    expect(tab.applied).toEqual(['v1'])
  })

  it('no catch-up read when the disk still holds the version the tab shows', async () => {
    const tab = new TextTab()
    await tab.open()
    await tab.run(500)
    expect(tab.reads).toBe(1)
    expect(tab.applied).toEqual([])
  })

  it('catches up after a restarted event (G1: a failed project open re-arms the watch)', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.muted = true
    tab.disk.write(FILE, 'written while the watch was suspended')
    tab.source.muted = false

    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'restarted' })
    await tab.run(200)

    expect(tab.shown).toBe('written while the watch was suspended')
  })

  it('catches up after Reload', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.muted = true
    tab.disk.write(FILE, 'silent write')

    await tab.tracker.reload()
    await tab.run(200)

    expect(tab.shown).toBe('silent write')
    expect(tab.source.subscribeCalls).toHaveLength(2)
  })

  it('catches up when the file comes back (file-back path)', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(600)
    expect(tab.state.content).toEqual({ kind: 'deleted' })

    tab.source.muted = true
    tab.disk.write(FILE, 'back again')
    await tab.run(800)

    expect(tab.shown).toBe('back again')
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })
})
