// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** The safety net (#478 S1, N2, N3, L4, G8): `check` finds what events missed, and nothing else. */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'

describe('FreshnessTracker – safety net', () => {
  it('N3: a check with no change reads nothing and publishes nothing', async () => {
    const tab = new TextTab()
    await tab.open()
    await tab.run(100)
    const reads = tab.reads
    const states = tab.states.length

    for (let i = 0; i < 10; i++) {
      tab.tracker.check('focus')
      await tab.run(100)
    }

    expect(tab.reads).toBe(reads)
    expect(tab.states.length).toBe(states)
  })

  it('N3: a touch-only change (same bytes) is silent', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.source.muted = true
    tab.disk.touch(FILE)
    tab.tracker.check('focus')
    await tab.run(200)
    expect(tab.applied).toEqual([])
  })

  it('S1/G8: a write no event reported (a dead watch, sleep) is shown on focus or resume', async () => {
    for (const reason of ['focus', 'resume', 'shown', 'save'] as const) {
      const tab = new TextTab()
      await tab.open()
      tab.source.muted = true
      tab.disk.write(FILE, `missed (${reason})`)
      tab.tracker.check(reason)
      await tab.run(200)
      expect(tab.shown).toBe(`missed (${reason})`)
    }
  })

  it('N2: an edited tab with a missed outside write gets the conflict on focus, buffer kept', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.edit('my edits')
    tab.source.muted = true
    tab.disk.write(FILE, 'outside')
    tab.tracker.check('focus')
    await tab.run(200)

    expect(tab.state.content).toEqual({ kind: 'changed', mode: 'held' })
    expect(tab.buffer).toBe('my edits')
    expect(tab.shown).toBe('v0')
  })

  it('L4: a same-size copy that keeps the mtime is caught by the check', async () => {
    const tab = new TextTab({ initialText: 'aaaa' })
    await tab.open()
    tab.source.muted = true
    tab.disk.write(FILE, 'bbbb', { keepMtime: true })
    tab.tracker.check('focus')
    await tab.run(200)
    expect(tab.shown).toBe('bbbb')
  })

  it('a hidden tab that defers marks the change and reads it when shown', async () => {
    const tab = new TextTab({ profile: 'image', deferWhenHidden: true })
    await tab.open()
    tab.setVisible(false)
    tab.disk.write(FILE, 'v1')
    await tab.run(300)

    expect(tab.state.content).toEqual({ kind: 'changed', mode: 'deferred' })
    expect(tab.applied).toEqual([])

    tab.setVisible(true)
    await tab.run(200)
    expect(tab.shown).toBe('v1')
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('keepLocal adopts the disk version: the next check is silent and the conflict clears', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.edit('mine')
    tab.disk.write(FILE, 'theirs')
    await tab.run(200)
    expect(tab.state.content).toEqual({ kind: 'changed', mode: 'held' })

    await tab.tracker.keepLocal()
    expect(tab.state.content).toEqual({ kind: 'fresh' })
    tab.tracker.check('focus')
    await tab.run(200)
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('Reload applies the disk version over held local edits', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.edit('mine')
    tab.disk.write(FILE, 'theirs')
    await tab.run(200)

    await tab.tracker.reload()
    await tab.run(200)
    expect(tab.shown).toBe('theirs')
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })
})
