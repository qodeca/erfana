// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** The watch limit (#478 G9, F10): a queued tab is still checked, and follows live once promoted. */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – watch limit (G9)', () => {
  it('a queued subscribe shows queued; the safety net still catches a write on focus', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'queued' })
    tab.source.muted = true // no live events for a queued tab
    await tab.open()
    expect(tab.state.watch).toEqual({ kind: 'queued' })

    tab.disk.write(FILE, 'v1')
    tab.tracker.check('focus')
    await tab.run(200)

    expect(tab.shown).toBe('v1')
    expect(tab.state.watch).toEqual({ kind: 'queued' })
  })

  it('started clears the queued state quietly and catches up', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'queued' })
    tab.source.muted = true
    await tab.open()
    tab.disk.write(FILE, 'written while queued')

    tab.source.promote(tab.tracker.watchId as string)
    tab.source.muted = false
    await tab.run(200)

    expect(tab.state).toEqual({ watch: { kind: 'active', live: 'full' }, content: { kind: 'fresh' } })
    expect(tab.shown).toBe('written while queued')

    tab.disk.write(FILE, 'live again')
    await tab.run(200)
    expect(tab.shown).toBe('live again')
  })

  it('S7: a queued watch promoted onto a gone file shows it deleted, and follows it when it is back', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'queued' })
    tab.source.muted = true
    await tab.open()
    const queuedId = tab.tracker.watchId as string
    tab.disk.remove(FILE)
    // Main promotes it, finds the file gone, sends `deleted` and drops it – no `started`
    tab.source.emit({ watchId: queuedId, kind: 'deleted' })
    tab.source.subscriptions.delete(queuedId)
    await tab.run(600)
    expect(tab.state.content).toEqual({ kind: 'deleted' })

    tab.source.muted = false
    tab.disk.write(FILE, 'back', { silent: true })
    await tab.run(1_000)
    expect(tab.state).toEqual({ watch: { kind: 'active', live: 'full' }, content: { kind: 'fresh' } })
    expect(tab.shown).toBe('back')
  })

  it('F10: a conflict while queued keeps both fields', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'queued' })
    await tab.open()
    tab.edit('my edits')
    tab.disk.write(FILE, 'outside')
    tab.tracker.check('focus')
    await tab.run(200)

    expect(tab.state).toEqual({ watch: { kind: 'queued' }, content: { kind: 'changed', mode: 'held' } })
  })
})
