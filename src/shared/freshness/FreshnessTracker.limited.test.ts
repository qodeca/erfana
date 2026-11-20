// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** Limited live refresh (#478 G7): a visible tab on a network or WSL volume polls every 2 s. */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – limited live refresh (G7)', () => {
  it('a visible limited tab shows a write no event reported within 2 s', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'started', liveRefresh: 'limited' })
    tab.source.muted = true // network shares raise no events
    await tab.open()
    expect(tab.state.watch).toEqual({ kind: 'active', live: 'limited' })

    tab.disk.write(FILE, 'from another machine')
    await tab.run(2_100)
    expect(tab.shown).toBe('from another machine')
  })

  it('polls only while visible', async () => {
    const tab = new TextTab()
    tab.source.scriptSubscribe({ kind: 'started', liveRefresh: 'limited' })
    tab.source.muted = true
    await tab.open()
    tab.setVisible(false)
    const probes = tab.source.probeCalls

    await tab.run(10_000)
    expect(tab.source.probeCalls).toBe(probes)

    tab.disk.write(FILE, 'v1')
    tab.setVisible(true) // shown: checks at once
    await tab.run(200)
    expect(tab.shown).toBe('v1')
  })

  it('a full-refresh tab never polls', async () => {
    const tab = new TextTab()
    await tab.open()
    const probes = tab.source.probeCalls
    await tab.run(10_000)
    expect(tab.source.probeCalls).toBe(probes)
    expect(tab.clock.pendingTimers()).toBe(0)
  })
})
