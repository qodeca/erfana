// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * What a tab hears when the project tree deletes a folder above its file
 * (#486): main lets go of the watch for the delete – nothing is sent
 * meanwhile – then arms it again. A file gone by then is sent `deleted` (the
 * deleted notice, and the way back when the file returns); a file still there
 * after a failed delete is sent `restarted`, a check that shows nothing when
 * the disk did not change.
 */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – a watch released around a delete', () => {
  it('silence, then `deleted`: the deleted notice, and the file back is followed again', async () => {
    const tab = new TextTab()
    await tab.open()
    const watchId = tab.tracker.watchId as string

    tab.source.muted = true // released: nothing reaches the tab
    tab.disk.remove(FILE)
    await tab.run(200)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
    tab.source.muted = false
    tab.source.emit({ watchId, kind: 'deleted' }) // armed again on a file that is gone
    await tab.run(600)
    expect(tab.state.content).toEqual({ kind: 'deleted' })

    tab.disk.write(FILE, 'restored from the Recycle Bin')
    await tab.run(1_000)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
    expect(tab.shown).toBe('restored from the Recycle Bin')
  })

  it('a failed delete: `restarted` on an unchanged file shows no change and keeps following', async () => {
    const tab = new TextTab()
    await tab.open()
    const watchId = tab.tracker.watchId as string
    const applied = tab.applied.length

    tab.source.emit({ watchId, kind: 'restarted' })
    await tab.run(1_000)
    expect(tab.states.some((s) => s.content.kind !== 'fresh')).toBe(false)
    expect(tab.applied).toHaveLength(applied)
    expect(tab.state.watch).toEqual({ kind: 'active', live: 'full' })

    tab.disk.write(FILE, 'later write')
    await tab.run(200)
    expect(tab.shown).toBe('later write')
  })

  it('a failed delete during which the file changed: `restarted` catches the change up', async () => {
    const tab = new TextTab()
    await tab.open()
    const watchId = tab.tracker.watchId as string

    tab.source.muted = true
    tab.disk.write(FILE, 'written while released')
    tab.source.muted = false
    tab.source.emit({ watchId, kind: 'restarted' })
    await tab.run(1_000)
    expect(tab.shown).toBe('written while released')
  })
})
