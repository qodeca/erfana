// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** Content states (#478 C1, L2, F1): refusals block the tab read-only, a good write recovers. */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'
import { isContentBlocked } from './FreshnessTracker'
import type { ProbeReply } from './freshnessTypes'

describe('FreshnessTracker – content', () => {
  it.each(['binary', 'unsupported-encoding', 'too-large'] as const)(
    'C1: a %s read blocks the tab (read-only) and a later good write recovers',
    async (reason) => {
      const tab = new TextTab()
      await tab.open()
      tab.disk.block(FILE, reason)
      tab.disk.write(FILE, 'refused content')
      await tab.run(200)

      expect(tab.state.content).toEqual({ kind: 'unavailable', reason })
      expect(isContentBlocked(tab.state)).toBe(true)
      expect(tab.shown).toBe('v0')

      tab.disk.block(FILE, undefined)
      tab.disk.write(FILE, 'good again')
      await tab.run(300)
      expect(tab.state.content).toEqual({ kind: 'fresh' })
      expect(isContentBlocked(tab.state)).toBe(false)
      expect(tab.shown).toBe('good again')
    }
  )

  it('L2: a read that fails 3 times then succeeds is applied, with no notice', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.failNextReads(FILE, 3)
    tab.disk.write(FILE, 'after the lock')
    await tab.run(1_500)

    expect(tab.shown).toBe('after the lock')
    expect(tab.states.some((s) => s.content.kind === 'unavailable')).toBe(false)
  })

  it('L2: a read that fails 4 times shows unreadable; Reload after the lock recovers', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.failNextReads(FILE, 4)
    tab.disk.write(FILE, 'locked')
    await tab.run(2_000)
    expect(tab.state.content).toEqual({ kind: 'unavailable', reason: 'unreadable' })

    await tab.tracker.reload()
    await tab.run(300)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
    expect(tab.shown).toBe('locked')
  })

  it('S6: an unreadable tab whose bytes did not move reads again on the next check', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.failNextReads(FILE, 4) // an antivirus lock over a change event with no new bytes
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'changed' })
    await tab.run(2_000)
    expect(tab.state.content).toEqual({ kind: 'unavailable', reason: 'unreadable' })

    tab.tracker.check('focus') // the lock is gone
    await tab.run(300)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('K1: a path that stays unresolved (probe unreadable, read busy) ends unreadable; a later check recovers', async () => {
    const tab = new TextTab()
    await tab.open()
    // A dead share: main cannot resolve the path, so the probe cannot tell and every read is busy
    let dead = true
    const probe = tab.source.probe.bind(tab.source)
    tab.source.probe = (filePath: string, knownHash?: string): Promise<ProbeReply> =>
      dead ? Promise.resolve({ status: 'unreadable', code: 'EIO' }) : probe(filePath, knownHash)
    tab.disk.busyNextReads(FILE, Number.MAX_SAFE_INTEGER)
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'changed' })

    await tab.run(20_000)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
    await tab.run(2_000)
    expect(tab.state.content).toEqual({ kind: 'unavailable', reason: 'unreadable' })

    dead = false
    tab.disk.busyNextReads(FILE, 0)
    tab.tracker.check('focus')
    await tab.run(300)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('Reload on a too-large file tries again (owner decision Q2)', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.block(FILE, 'too-large')
    tab.disk.write(FILE, 'huge')
    await tab.run(200)
    const reads = tab.reads

    await tab.tracker.reload()
    await tab.run(200)
    expect(tab.reads).toBeGreaterThan(reads)
    expect(tab.state.content).toEqual({ kind: 'unavailable', reason: 'too-large' })
  })
})
