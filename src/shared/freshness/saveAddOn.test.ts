// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** The save add-on (#478 L1, L3, L5, N1, N5, F7, F16). */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'
import type { FreshnessTracker } from './FreshnessTracker'
import { createSaveAddOn, type SaveTrigger } from './saveAddOn'

/** A text tab that can save the way the editor does: on `written` the buffer is the disk text. */
function editorTab(tab: TextTab = new TextTab()) {
  const addOn = createSaveAddOn({
    filePath: FILE,
    source: tab.source,
    tracker: tab.tracker as unknown as FreshnessTracker<unknown>,
  })
  const save = async (content: string, trigger: SaveTrigger = 'autosave') => {
    tab.edit(content)
    const reply = await addOn.save({ content, trigger })
    if (reply.status === 'written') {
      tab.shown = content
      tab.buffer = undefined
    }
    return reply
  }
  return { tab, save }
}

describe('saveAddOn', () => {
  it('N1: an autosave is silent – no read, no conflict, no reload', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    await tab.run(100)
    const reads = tab.reads

    const reply = await save('typed text')
    await tab.run(500)

    expect(reply.status).toBe('written')
    expect(tab.disk.content(FILE)).toBe('typed text')
    expect(tab.reads).toBe(reads)
    expect(tab.applied).toEqual([])
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('pauses only its own subscription and always resumes it', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    await save('x')
    expect(tab.source.pauseCalls).toEqual([tab.tracker.watchId])
    expect(tab.source.subscriptions.get(tab.tracker.watchId as string)?.paused).toBe(false)
  })

  it('L1: an outside change before the commit check is the conflict, and nothing is overwritten', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    tab.source.holdNextWrite()
    const saving = save('my autosave')
    await tab.clock.flush()
    tab.disk.write(FILE, 'outside write mid-save')
    tab.source.releaseWrite()
    const reply = await saving
    await tab.run(500)

    expect(reply.status).toBe('changed-on-disk')
    expect(tab.disk.content(FILE)).toBe('outside write mid-save')
    expect(tab.state.content).toEqual({ kind: 'changed', mode: 'held', notSaved: true })
  })

  it('L1: an outside change that lands after the commit is delivered after the resume', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    const resume = tab.source.resumeWatch.bind(tab.source)
    tab.source.resumeWatch = async (watchId: string) => {
      tab.disk.write(FILE, 'outside after commit') // the tab is still paused: missed
      return resume(watchId)
    }

    await save('saved')
    await tab.run(500)

    expect(tab.shown).toBe('outside after commit')
    expect(tab.state.content).toEqual({ kind: 'fresh' })
  })

  it('L3: save A, save B, then an outside write of A is shown', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    await save('A')
    await save('B')
    await tab.run(300)

    tab.disk.write(FILE, 'A')
    await tab.run(300)

    expect(tab.shown).toBe('A')
    expect(tab.applied).toEqual(['A'])
  })

  it('L5: a save in tab A is an outside change for tab B on the same file; A stays silent', async () => {
    const a = new TextTab()
    await a.open()
    const { save } = editorTab(a)
    // Tab B shares A's disk and source, with its own tracker
    const { FreshnessTracker: Tracker } = await import('./FreshnessTracker')
    const { textReadOutcome } = await import('./textOutcome')
    const bApplied: string[] = []
    let ids = 100
    const b = new Tracker({
      filePath: FILE,
      profile: 'editor',
      source: a.source,
      clock: a.clock,
      newId: () => `b-${++ids}`,
      rule: {
        read: async () => textReadOutcome(await a.source.readText(FILE)),
        readNow: () => true,
        apply: (version) => {
          bApplied.push(version.text)
          return 'applied'
        },
      },
    })
    void b.begin(a.disk.stamp(FILE))
    await a.run(50)

    await save('saved in A')
    await a.run(500)

    expect(bApplied).toEqual(['saved in A'])
    expect(a.applied).toEqual([])
    expect(a.state.content).toEqual({ kind: 'fresh' })
    b.dispose()
  })

  it('a change dropped during the pause (no event at all) is found by the check after the resume', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    const resume = tab.source.resumeWatch.bind(tab.source)
    tab.source.resumeWatch = async (watchId: string) => {
      // main's pause timer fired and the change it saw was dropped: no event will ever come
      tab.source.muted = true
      tab.disk.write(FILE, 'theirs')
      tab.source.muted = false
      await resume(watchId)
      return { missed: true }
    }

    const reply = await save('mine')
    await tab.run(300)

    expect(reply.status).toBe('written')
    expect(tab.shown).toBe('theirs')
  })

  describe('F7: only autosave is conditional', () => {
    it('autosave sends the last stamp', async () => {
      const { tab, save } = editorTab()
      await tab.open()
      const stamp = tab.tracker.lastStamp
      await save('auto', 'autosave')
      expect(tab.source.writeCalls[0].expectedStamp).toEqual(stamp)
    })

    it.each(['explicit', 'restore'] as const)('a %s save writes unconditionally', async (trigger) => {
      const { tab, save } = editorTab()
      await tab.open()
      tab.source.muted = true
      tab.disk.write(FILE, 'outside')
      const reply = await save('mine', trigger)
      expect(tab.source.writeCalls[0].expectedStamp).toBeUndefined()
      expect(reply.status).toBe('written')
      expect(tab.disk.content(FILE)).toBe('mine')
    })

    it('Cmd+S in the conflict state overwrites, and the conflict clears', async () => {
      const { tab, save } = editorTab()
      await tab.open()
      tab.edit('mine')
      tab.disk.write(FILE, 'theirs')
      await tab.run(300)
      expect(tab.state.content.kind).toBe('changed')

      const reply = await save('mine', 'explicit')
      await tab.run(300)
      expect(reply.status).toBe('written')
      expect(tab.state.content).toEqual({ kind: 'fresh' })
      expect(tab.disk.content(FILE)).toBe('mine')
    })

    it('no expected stamp in the deleted state: Save-to-restore brings the file back and the tab follows it', async () => {
      const { tab, save } = editorTab()
      await tab.open()
      tab.disk.remove(FILE)
      await tab.run(600)
      expect(tab.state.content).toEqual({ kind: 'deleted' })

      const reply = await save('restored', 'autosave')
      await tab.run(500)

      expect(tab.source.writeCalls[0].expectedStamp).toBeUndefined()
      expect(reply.status).toBe('written')
      expect(tab.state.content).toEqual({ kind: 'fresh' })
      tab.disk.write(FILE, 'outside after restore')
      await tab.run(300)
      expect(tab.shown).toBe('outside after restore')
    })
  })

  it('S3: an outside write during the pause is shown even when a focus check is running at resume', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    await tab.run(100)

    // A focus check starts after our write: its probe sees our version, then answers late
    let releaseProbe: () => void = () => {}
    const probe = tab.source.probe.bind(tab.source)
    const resume = tab.source.resumeWatch.bind(tab.source)
    tab.source.resumeWatch = async (watchId) => {
      tab.source.probe = async (filePath, knownHash) => {
        const reply = await probe(filePath, knownHash)
        await new Promise<void>((resolve) => (releaseProbe = resolve))
        return reply
      }
      tab.tracker.check('focus')
      await tab.clock.flush()
      tab.source.probe = probe
      tab.disk.write(FILE, 'outside during the pause') // paused: missed, no event
      return resume(watchId)
    }

    const reply = await save('my save')
    expect(reply.status).toBe('written')
    releaseProbe()
    await tab.run(500)

    expect(tab.shown).toBe('outside during the pause')
  })

  it('a failed write rejects, and the pause is still released', async () => {
    const { tab, save } = editorTab()
    await tab.open()
    tab.source.writeText = async () => {
      throw new Error('EACCES')
    }
    await expect(save('x')).rejects.toThrow('EACCES')
    expect(tab.source.subscriptions.get(tab.tracker.watchId as string)?.paused).toBe(false)
  })
})
