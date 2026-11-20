// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A watch main has dropped, a Restore, and the file-back path (#478 QG-8: S1,
 * C2, C4). Main discards a subscription once it reports `deleted` (or refuses
 * `NOT_FOUND`); a file back by the 500 ms confirm then needs a new one.
 */
import { describe, expect, it, vi } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – dropped watch and file-back', () => {
  it('S1: delete + recreate inside the confirm after a `deleted` event re-subscribes, so a later write still shows', async () => {
    const tab = new TextTab()
    tab.source.dropOnDelete = true
    await tab.open()
    const firstId = tab.tracker.watchId
    tab.disk.remove(FILE)
    await tab.run(200)
    tab.disk.write(FILE, 'recreated') // no event: main dropped the watch
    await tab.run(800)

    expect(tab.states.some((s) => s.content.kind === 'deleted')).toBe(false)
    expect(tab.shown).toBe('recreated')
    expect(tab.tracker.watchId).not.toBe(firstId)
    tab.disk.write(FILE, 'later write')
    await tab.run(200)
    expect(tab.shown).toBe('later write')
  })

  it('S1: a NOT_FOUND refusal whose file appears inside the confirm subscribes again and follows it', async () => {
    const tab = new TextTab({ initialText: null })
    await tab.open()
    tab.disk.write(FILE, 'created')
    await tab.run(800)

    expect(tab.shown).toBe('created')
    expect(tab.state.watch).toEqual({ kind: 'active', live: 'full' })
    tab.disk.write(FILE, 'later write')
    await tab.run(200)
    expect(tab.shown).toBe('later write')
  })

  it('R2-4: a dropped watch whose confirm probe cannot tell, then reads the file, subscribes again and hears later writes', async () => {
    const tab = new TextTab()
    await tab.open()
    const firstId = tab.tracker.watchId as string
    // Delete-then-write: main reported `deleted` and dropped the watch; the new file is there
    tab.disk.write(FILE, 'rewritten', { silent: true })
    tab.source.subscriptions.delete(firstId)
    tab.source.emit({ watchId: firstId, kind: 'deleted' })
    // An AV lock right after the write: the confirm probe cannot tell
    vi.spyOn(tab.source, 'probe').mockResolvedValueOnce({ status: 'unreadable', code: 'EBUSY' })
    const calls = tab.source.subscribeCalls.length
    await tab.run(800)

    expect(tab.shown).toBe('rewritten')
    expect(tab.source.subscribeCalls.length).toBe(calls + 1)
    expect(tab.tracker.watchId).not.toBe(firstId)
    expect(tab.state).toEqual({ watch: { kind: 'active', live: 'full' }, content: { kind: 'fresh' } })
    tab.disk.write(FILE, 'later write')
    await tab.run(200)
    expect(tab.shown).toBe('later write')
  })

  it('C2: after a Restore the own write read back is fresh, even with typing since (no false conflict)', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(600)
    expect(tab.state.content).toEqual({ kind: 'deleted' })

    // Restore: write the buffer, adopt the stamp of that write
    tab.edit('restored')
    const reply = await tab.source.writeText({ filePath: FILE, content: 'restored' })
    if (reply.status !== 'written') throw new Error('restore did not write')
    tab.tracker.adoptStamp(reply.stamp)
    tab.edit('restored and typed')
    await tab.run(1_000)

    expect(tab.state.content).toEqual({ kind: 'fresh' })
    expect(tab.states.some((s) => s.content.kind === 'changed')).toBe(false)
    expect(tab.tracker.lastStamp).toEqual(reply.stamp)
  })

  it('C4: two signs of the file coming back make one subscribe', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(550) // confirmed; the probe loop asks 500 ms later
    tab.source.muted = true
    tab.disk.write(FILE, 'back')
    tab.source.scriptSubscribe({ kind: 'hold' })
    const calls = tab.source.subscribeCalls.length

    await tab.run(500) // the probe finds it: file-back, subscribe held
    tab.tracker.check('focus') // still deleted: finds it again
    await tab.run(100)
    expect(tab.source.subscribeCalls.length).toBe(calls + 1)

    tab.source.releaseHeld()
    await tab.run(300)
    expect(tab.shown).toBe('back')
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('C4: a file-back whose subscribe was replaced by a Reload does not read again', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(550)
    tab.source.muted = true
    tab.disk.write(FILE, 'back')
    tab.source.scriptSubscribe({ kind: 'hold' })
    await tab.run(500) // file-back, subscribe held
    const reads = tab.reads

    await tab.tracker.reload()
    await tab.run(300)
    tab.source.releaseHeld()
    await tab.run(500)

    expect(tab.shown).toBe('back')
    expect(tab.reads - reads).toBe(1)
  })
})
