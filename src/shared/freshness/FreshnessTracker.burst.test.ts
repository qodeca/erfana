// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/** Bursts (#478 N4, P1, P2): throttled, last version always shown, one conflict per burst. */
import { describe, expect, it } from 'vitest'

import { FILE, TextTab } from './__test__/trackerHarness'
import type { FileStamp } from './freshnessTypes'

/** The stat-only stamp main's write gate sends with a settled change. */
function statOnly(stamp: FileStamp): FileStamp {
  return { size: stamp.size, mtimeMs: stamp.mtimeMs, ctimeMs: stamp.ctimeMs, ino: stamp.ino }
}

describe('FreshnessTracker – bursts', () => {
  it('P1: the first change is read at once', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.write(FILE, 'v1')
    await tab.clock.flush()
    expect(tab.shown).toBe('v1')
  })

  it('P2: writes every 150 ms for 10 s – shown at most every 1 s, the last version always', async () => {
    const tab = new TextTab()
    await tab.open()
    const shownAt: number[] = []
    tab.tracker.subscribe(() => undefined)
    let last = ''
    for (let i = 1; i <= 66; i++) {
      last = `v${i}`
      tab.disk.write(FILE, last)
      const before = tab.applied.length
      await tab.run(150)
      if (tab.applied.length > before) shownAt.push(tab.clock.now())
    }
    await tab.run(1_000)

    expect(tab.shown).toBe(last)
    for (let i = 1; i < shownAt.length; i++) expect(shownAt[i] - shownAt[i - 1]).toBeLessThanOrEqual(1_000)
    expect(tab.applied.length).toBeLessThan(66)
  })

  it('P3: a trailing read waits for a stream that started after its change (no partial file shown)', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.write(FILE, 'v1 END')
    await tab.run(100)
    // A second change inside the throttle window: its read trails, at 250 ms
    tab.disk.write(FILE, 'v2 END')
    await tab.run(50)
    // A writer starts streaming before the trailing read; main's gate holds its
    // change (silent) until the stream has settled
    tab.disk.write(FILE, 'v3', { silent: true })
    for (let i = 0; i < 40; i++) {
      tab.disk.append(FILE, ` chunk${i}`, { silent: true })
      await tab.run(25)
    }
    tab.disk.append(FILE, ' END')
    await tab.run(1_000)

    expect(tab.applied.filter((text) => !text.endsWith('END'))).toEqual([])
    expect(tab.shown).toMatch(/^v3 .* END$/)
  })

  it('P3: a change that reaches the tab after a new writer started is not read half-way', async () => {
    const tab = new TextTab()
    await tab.open()
    // Main's gate saw 'v1 END' settle and emits; the event reaches a busy tab late
    tab.disk.write(FILE, 'v1 END', { silent: true })
    const settledAt = statOnly(tab.disk.stamp(FILE) as FileStamp)
    // Meanwhile a new writer truncates the file and writes its first chunk
    tab.disk.write(FILE, 'v2 head', { silent: true })
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'changed', stamp: settledAt })
    for (const chunk of [' body', ' more', ' END']) {
      await tab.run(25)
      tab.disk.append(FILE, chunk, { silent: true })
    }
    await tab.run(1_000)

    expect(tab.applied.filter((text) => !text.endsWith('END'))).toEqual([])
    expect(tab.shown).toBe('v2 head body more END')
  })

  it('P1: a change whose file is still as the gate saw it settle is read at once', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.write(FILE, 'v1 END', { silent: true })
    const settledAt = statOnly(tab.disk.stamp(FILE) as FileStamp)
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'changed', stamp: settledAt })
    await tab.clock.flush()
    expect(tab.shown).toBe('v1 END')
  })

  it('P3 (F8): a forced change – the gate cap – settles before it reads a stream that ends inside the cap', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.write(FILE, 'v1', { silent: true })
    // Main reports the change before the writes settled: its gate hit the cap
    // mid-stream, or the health round re-armed a replaced file
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'changed', forced: true })
    for (let i = 0; i < 40; i++) {
      tab.disk.append(FILE, ` chunk${i}`, { silent: true })
      await tab.run(25)
    }
    tab.disk.append(FILE, ' END', { silent: true })
    await tab.run(1_000)

    expect(tab.applied.filter((text) => !text.endsWith('END'))).toEqual([])
    expect(tab.shown).toMatch(/^v1 .* END$/)
  })

  it.each([0, 5_000])(
    'P3 (F8): a 7 s stream with its forced change at %i ms ends fresh with the full text, never partial',
    async (forcedAtMs) => {
      const tab = new TextTab()
      await tab.open()
      tab.disk.write(FILE, 'HEAD', { silent: true })
      // An append every 50 ms for 7 s – past the 5 s cap of one settle attempt
      for (let t = 0; t < 7_000; t += 50) {
        if (t === forcedAtMs) tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'changed', forced: true })
        tab.disk.append(FILE, '.', { silent: true })
        await tab.clock.run(50, 10)
      }
      tab.disk.append(FILE, 'FOOT', { silent: true })
      await tab.run(1_000)

      expect(tab.applied.filter((text) => !text.endsWith('FOOT'))).toEqual([])
      expect(tab.shown).toBe(tab.disk.content(FILE))
      expect(tab.state.content).toEqual({ kind: 'fresh' })
    }
  )

  it('K1/V1: a writer that never stops ends "cannot be read right now", never a partial file', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.disk.write(FILE, 'HEAD', { silent: true })
    tab.source.emit({ watchId: tab.tracker.watchId as string, kind: 'changed', forced: true })
    const start = tab.clock.now()
    let unreadableAt: number | undefined
    // Four settle attempts of at most cap + one settle each, plus the 100 + 300 + 900 ms retry waits
    const latestMs = 4 * (5_000 + 75) + 1_300
    while (tab.clock.now() - start < latestMs + 1_000) {
      tab.disk.append(FILE, '.', { silent: true })
      await tab.run(20)
      const unreadable = tab.state.content.kind === 'unavailable'
      if (unreadable && unreadableAt === undefined) unreadableAt = tab.clock.now() - start
    }

    expect(tab.applied).toEqual([])
    expect(tab.state.content).toEqual({ kind: 'unavailable', reason: 'unreadable' })
    expect(unreadableAt).toBeGreaterThanOrEqual(4 * 5_000 + 1_300)
    expect(unreadableAt).toBeLessThanOrEqual(latestMs)
  })

  it('N4: an edited tab hit by 10 writes publishes the conflict once', async () => {
    const tab = new TextTab()
    await tab.open()
    tab.edit('mine')
    for (let i = 1; i <= 10; i++) {
      tab.disk.write(FILE, `outside ${i}`)
      await tab.run(100)
    }
    await tab.run(1_000)

    const conflicts = tab.states.filter((s) => s.content.kind === 'changed')
    expect(conflicts).toHaveLength(1)
    expect(tab.buffer).toBe('mine')
  })
})
