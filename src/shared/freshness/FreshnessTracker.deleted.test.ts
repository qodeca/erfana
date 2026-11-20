// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** Delete confirmation and the way back (#478 G4, F11, F27, QG-11a V4). */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – deleted', () => {
  it('F27: a delete shows only after the 500 ms confirm', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)

    await tab.run(450)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
    await tab.run(100)
    expect(tab.state.content).toEqual({ kind: 'deleted' })
  })

  it('G4: a delete + recreate inside the confirm window never shows the banner, and the new text shows', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(200)
    tab.source.muted = true // the directory coalescer turned delete + create into nothing
    tab.disk.write(FILE, 'recreated')
    await tab.run(800)

    expect(tab.states.some((s) => s.content.kind === 'deleted')).toBe(false)
    expect(tab.shown).toBe('recreated')
  })

  it('F11: a file found back by the probe (no event) re-subscribes, and a later write is applied', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(600)
    const deletedId = tab.tracker.watchId

    tab.source.muted = true
    tab.disk.write(FILE, 'back')
    await tab.run(700)
    tab.source.muted = false

    expect(tab.tracker.watchId).not.toBe(deletedId)
    expect(tab.shown).toBe('back')
    tab.disk.write(FILE, 'later write')
    await tab.run(200)
    expect(tab.shown).toBe('later write')
  })

  it('R2-3: a file-back subscribe refused NOT_FOUND (the file flapped) goes to the confirm, and the file back by then is followed', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(600)
    const calls = tab.source.subscribeCalls.length

    tab.source.muted = true
    tab.disk.write(FILE, 'back')
    // The probe finds it, but it is gone again when the file-back subscribe asks
    tab.source.scriptSubscribe({ kind: 'refused', code: 'NOT_FOUND' })
    await tab.run(500)
    expect(tab.source.subscribeCalls.length).toBe(calls + 1)
    await tab.run(600) // the confirm finds it there: a new subscribe
    tab.source.muted = false

    expect(tab.source.subscribeCalls.length).toBe(calls + 2)
    expect(tab.states.some((s) => s.watch.kind === 'stopped')).toBe(false)
    expect(tab.state).toEqual({ watch: { kind: 'active', live: 'full' }, content: { kind: 'fresh' } })
    expect(tab.shown).toBe('back')
    tab.disk.write(FILE, 'later write')
    await tab.run(200)
    expect(tab.shown).toBe('later write')
  })

  it('any change event while deleted takes the file-back path', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(600)
    const calls = tab.source.subscribeCalls.length

    tab.disk.write(FILE, 'back via event')
    await tab.run(200)

    expect(tab.source.subscribeCalls.length).toBe(calls + 1)
    expect(tab.shown).toBe('back via event')
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('the deleted-state probe starts at 500 ms and backs off to 2 s', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(500) // confirmed
    const probesAt = (): number => tab.source.probeCalls
    const start = probesAt()

    await tab.run(500)
    expect(probesAt() - start).toBe(1)
    await tab.run(1_000)
    expect(probesAt() - start).toBe(2)
    await tab.run(2_000)
    expect(probesAt() - start).toBe(3)
    await tab.run(2_000)
    expect(probesAt() - start).toBe(4)
  })

  it('a check while deleted finds the file back', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(550)
    tab.source.muted = true
    tab.disk.write(FILE, 'back on focus')

    tab.tracker.check('focus')
    await tab.run(200)

    expect(tab.shown).toBe('back on focus')
  })

  /** A hidden image tab: deleted, then back (its catch-up read deferred, so it still shows deleted). */
  async function hiddenTabBackWhileDeleted(): Promise<TextTab> {
    const tab = new TextTab({ profile: 'image', deferWhenHidden: true })
    await tab.open()
    tab.setVisible(false)
    tab.disk.remove(FILE)
    await tab.run(600)
    tab.disk.write(FILE, 'back')
    await tab.run(200)
    expect(tab.state.content).toEqual({ kind: 'deleted' })
    return tab
  }

  it('V4: deleted again after a deferred file-back keeps probing, and the file back is followed with no check', async () => {
    const tab = await hiddenTabBackWhileDeleted()
    tab.disk.remove(FILE)
    await tab.run(100)
    const calls = tab.source.subscribeCalls.length

    tab.source.muted = true // no event: only the probe can find it
    tab.disk.write(FILE, 'back again')
    await tab.run(2_500)

    expect(tab.source.subscribeCalls.length).toBeGreaterThan(calls)
  })

  it('V4: a check that finds a deleted tab still missing restarts the probe', async () => {
    const tab = await hiddenTabBackWhileDeleted()
    tab.source.muted = true
    tab.disk.remove(FILE) // gone again, no event heard
    tab.setVisible(true) // the shown check finds it missing
    await tab.run(100)
    const calls = tab.source.subscribeCalls.length

    tab.disk.write(FILE, 'back again')
    await tab.run(2_500)
    tab.source.muted = false

    expect(tab.source.subscribeCalls.length).toBeGreaterThan(calls)
    expect(tab.shown).toBe('back again')
  })
})
