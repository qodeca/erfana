// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** The restart policy (#478 G5, G1, plan decision 40). */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – restart', () => {
  it('G5: a returned file whose watch cannot restart shows stopped(restart-failed); Reload recovers', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.remove(FILE)
    await tab.run(600)
    expect(tab.state.content).toEqual({ kind: 'deleted' })

    tab.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
    tab.disk.write(FILE, 'back')
    await tab.run(1_000)

    expect(tab.shown).toBe('back')
    expect(tab.state).toEqual({ watch: { kind: 'stopped', reason: 'restart-failed' }, content: { kind: 'fresh' } })

    await tab.tracker.reload()
    await tab.run(200)
    expect(tab.state.watch).toEqual({ kind: 'active', live: 'full' })
    tab.disk.write(FILE, 'followed again')
    await tab.run(200)
    expect(tab.shown).toBe('followed again')
  })

  it('an ended watch gets one automatic restart with a new id', async () => {
    const tab = new TextTab()
    await tab.open()
    const first = tab.tracker.watchId as string

    tab.source.emit({ watchId: first, kind: 'ended', reason: 'watcher-error' })
    await tab.run(50)

    expect(tab.tracker.watchId).not.toBe(first)
    expect(tab.state.watch).toEqual({ kind: 'active', live: 'full' })
  })

  it('a second end, or a failed restart, stops the watch with its reason', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'ended', reason: 'watcher-error' })
    await tab.run(50)
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'ended', reason: 'watcher-error' })
    await tab.run(50)

    expect(tab.state.watch).toEqual({ kind: 'stopped', reason: 'watcher-error' })
    expect(tab.tracker.watchId).toBeNull()
  })

  it('a failed automatic restart shows the reason the watch ended with', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'ended', reason: 'watcher-error' })
    await tab.run(50)
    expect(tab.state.watch).toEqual({ kind: 'stopped', reason: 'watcher-error' })
  })

  it('H2: a watch main could not re-arm after a failed project switch ends in the stopped notice', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'ended', reason: 'restart-failed' })
    await tab.run(50)
    expect(tab.state.watch).toEqual({ kind: 'stopped', reason: 'restart-failed' })
  })

  it('a refusal that names the cause shows it (outside the project)', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.scriptSubscribe({ kind: 'refused', code: 'OUTSIDE_PROJECT' })
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'ended', reason: 'watcher-error' })
    await tab.run(50)
    expect(tab.state.watch).toEqual({ kind: 'stopped', reason: 'outside-project' })
  })

  it('a project switch stops the watch quietly, with no restart', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'ended', reason: 'project-switch' })
    await tab.run(50)
    expect(tab.state.watch).toEqual({ kind: 'stopped', reason: 'project-closed' })
    expect(tab.source.subscribeCalls).toHaveLength(1)
  })

  it('a refused first subscribe is retried once', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
    await tab.open()
    await tab.run(50)
    expect(tab.source.subscribeCalls).toHaveLength(2)
    expect(tab.state.watch).toEqual({ kind: 'active', live: 'full' })
  })

  it('a subscribe that throws counts as refused', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'reject', error: new Error('ipc down') }, { kind: 'reject', error: new Error('ipc down') })
    await tab.open()
    await tab.run(50)
    expect(tab.state.watch).toEqual({ kind: 'stopped', reason: 'restart-failed' })
  })

  it.each(['PAGE_CHANGED', 'PROJECT_CHANGED'] as const)('a %s refusal is quiet: no notice, no retry', async (code) => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'refused', code })
    await tab.open()
    await tab.run(50)
    expect(tab.source.subscribeCalls).toHaveLength(1)
    expect(tab.states).toEqual([])
  })
})
