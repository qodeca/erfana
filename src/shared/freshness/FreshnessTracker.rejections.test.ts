// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A probe or a read whose IPC call rejects never escapes the tracker (#478
 * QG-8 C3): a probe that rejects cannot tell (`unknown`), a read that rejects
 * failed (retried, then "cannot be read"), and no loop gets stuck.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ProbeReply } from './freshnessTypes'
import { FILE, TextTab } from './__test__/trackerHarness'

/** Make the tab's probes reject while `failing()` says so. */
function rejectProbesWhile(tab: TextTab, failing: () => boolean): void {
  const probe = tab.source.probe.bind(tab.source)
  tab.source.probe = (filePath: string, knownHash?: string): Promise<ProbeReply> =>
    failing() ? Promise.reject(new Error('ipc gone')) : probe(filePath, knownHash)
}

/** Let Node run its unhandled-rejection check (a real macrotask turn; the tests' clock is fake). */
const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('FreshnessTracker – rejected calls', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
  })
  afterEach(async () => {
    await nextTurn()
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toEqual([])
  })

  it('a rejected probe in the deleted state keeps the probe loop going', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(550)
    let failing = true
    rejectProbesWhile(tab, () => failing)
    await tab.run(1_600) // two probes reject

    failing = false
    tab.source.muted = true
    tab.disk.write(FILE, 'back')
    await tab.run(2_500)
    expect(tab.shown).toBe('back')
  })

  it('a rejected probe at the delete confirm is not taken for a delete, and a later answer confirms it', async () => {
    const tab = new TextTab()
    await tab.open()
    let failing = false
    rejectProbesWhile(tab, () => failing)
    tab.disk.remove(FILE)
    failing = true
    await tab.run(700)
    expect(tab.states.some((s) => s.content.kind === 'deleted')).toBe(false)

    failing = false
    await tab.run(3_000)
    expect(tab.state.content).toEqual({ kind: 'deleted' })
  })

  it('a rejected probe in a check lets the next check run', async () => {
    const tab = new TextTab()
    await tab.open()
    let failing = true
    rejectProbesWhile(tab, () => failing)
    tab.tracker.check('focus')
    await tab.run(50)

    failing = false
    tab.source.muted = true
    tab.disk.write(FILE, 'changed')
    tab.tracker.check('focus')
    await tab.run(300)
    expect(tab.shown).toBe('changed')
  })

  it('a rejected read counts as failed: retried, then the tab shows it cannot be read', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.readText = () => Promise.reject(new Error('ipc gone'))
    tab.disk.write(FILE, 'changed')
    await tab.run(3_000)

    expect(tab.state.content).toEqual({ kind: 'unavailable', reason: 'unreadable' })
  })
})
