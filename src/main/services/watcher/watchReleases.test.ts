// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * WatchReleases (#486): which entries a release holds, by the watch layer's
 * path rules; nesting and overlap; adoption of an entry created mid-release;
 * the subscribe wait and its ceiling. Over a fake host – the real service is
 * `FileWatcherService.release.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import { HOLD_TIMEOUT_MS, WatchReleases, type ReArm, type ReleaseHost } from './watchReleases'
import type { WatchEntry } from './watchTypes'

const ROOT = path.resolve('/proj')
const at = (...segments: string[]): string => path.join(ROOT, ...segments)

function entry(filePath: string, armed = true): WatchEntry {
  return {
    key: filePath.toLowerCase(),
    filePath,
    profile: 'editor',
    watcher: armed ? ({} as WatchEntry['watcher']) : null,
    suspended: false,
    identity: null,
    arming: null,
    ready: null,
    subs: new Set()
  }
}

function fakeHost(entries: WatchEntry[], caseSensitive = true) {
  const held: string[] = []
  const rearmed: string[] = []
  const host: ReleaseHost = {
    entries: () => entries,
    caseSensitive: () => caseSensitive,
    hold: async (e) => {
      held.push(e.filePath)
      e.watcher = null
      e.suspended = true
    },
    rearm: async (e) => {
      rearmed.push(e.filePath)
      e.suspended = false
    }
  }
  return { host, held, rearmed }
}

describe('WatchReleases (#486)', () => {
  afterEach(() => vi.useRealTimers())

  it('holds the entries at and below the path only, and re-arms them when the release ends', async () => {
    const entries = [entry(at('docs', 'a.md')), entry(at('docs', 'deep', 'b.md')), entry(at('docs2', 'c.md')), entry(at('top.md'))]
    const { host, held, rearmed } = fakeHost(entries)
    const releases = new WatchReleases(host)

    const rearm = await releases.releaseUnder(at('docs'))
    expect(held.sort()).toEqual([at('docs', 'a.md'), at('docs', 'deep', 'b.md')].sort())
    expect(releases.countOpen(at('docs'))).toBe(0)
    expect(releases.countOpen(ROOT)).toBe(2)
    expect(rearmed).toEqual([])

    await rearm()
    expect(rearmed.sort()).toEqual(held.sort())
    await rearm() // a second call is a no-op
    expect(rearmed).toHaveLength(2)
  })

  it('time-boxes a watcher close that never settles, and the re-arm still arms the entry', async () => {
    vi.useFakeTimers()
    const stuck = entry(at('docs', 'a.md'))
    const { host, rearmed } = fakeHost([stuck])
    host.hold = () => new Promise<void>(() => {})
    const releases = new WatchReleases(host)

    const released: { rearm?: ReArm } = {}
    void releases.releaseUnder(at('docs')).then((rearm) => {
      released.rearm = rearm
    })
    await vi.advanceTimersByTimeAsync(HOLD_TIMEOUT_MS - 1)
    expect(released.rearm).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(released.rearm).toBeDefined()

    await released.rearm?.()
    expect(rearmed).toEqual([stuck.filePath])
    expect(releases.isHolding(stuck)).toBe(false)
  })

  it('holds a file’s own watch when the file itself is deleted', async () => {
    const { host, held } = fakeHost([entry(at('a.md')), entry(at('a.md.bak'))])
    await new WatchReleases(host).releaseUnder(at('a.md'))
    expect(held).toEqual([at('a.md')])
  })

  it('matches by the session’s case rule: another spelling covers the file when names ignore case', async () => {
    const file = at('Docs', 'A.md')
    const insensitive = fakeHost([entry(file)], false)
    await new WatchReleases(insensitive.host).releaseUnder(at('DOCS'))
    expect(insensitive.held).toEqual([file])

    const sensitive = fakeHost([entry(file)], true)
    await new WatchReleases(sensitive.host).releaseUnder(at('DOCS'))
    expect(sensitive.held).toEqual([])
  })

  it('two overlapping releases: an entry is held once and re-armed only when the last one ends', async () => {
    const { host, held, rearmed } = fakeHost([entry(at('docs', 'deep', 'b.md')), entry(at('docs', 'a.md'))])
    const releases = new WatchReleases(host)
    const outer = await releases.releaseUnder(at('docs'))
    const inner = await releases.releaseUnder(at('docs', 'deep'))
    expect(held).toHaveLength(2)

    await outer()
    expect(rearmed).toEqual([at('docs', 'a.md')])
    await inner()
    expect(rearmed).toEqual([at('docs', 'a.md'), at('docs', 'deep', 'b.md')])
  })

  it('adopts an entry created under a release in force, and re-arms it with the rest', async () => {
    const entries: WatchEntry[] = []
    const { host, rearmed } = fakeHost(entries)
    const releases = new WatchReleases(host)
    const rearm = await releases.releaseUnder(at('docs'))

    const inside = entry(at('docs', 'new.md'), false)
    const outside = entry(at('other.md'), false)
    entries.push(inside, outside)
    expect(releases.adopt(inside)).toBe(true)
    expect(releases.adopt(outside)).toBe(false)
    expect(releases.isHolding(inside)).toBe(true)

    await rearm()
    expect(rearmed).toEqual([at('docs', 'new.md')])
    expect(releases.isHolding(inside)).toBe(false)
  })

  it('waitFor answers at once outside a release, and when the release ends inside one', async () => {
    const { host } = fakeHost([])
    const releases = new WatchReleases(host)
    await releases.waitFor(at('docs', 'a.md'))

    const rearm = await releases.releaseUnder(at('docs'))
    let waited = false
    const waiting = releases.waitFor(at('docs', 'a.md')).then(() => {
      waited = true
    })
    await releases.waitFor(at('other.md'))
    await Promise.resolve()
    expect(waited).toBe(false)

    await rearm()
    await waiting
    expect(waited).toBe(true)
  })

  it('waitFor gives up at the ceiling when a release never ends', async () => {
    vi.useFakeTimers()
    const { host } = fakeHost([])
    const releases = new WatchReleases(host, 1_000)
    await releases.releaseUnder(at('docs'))
    let waited = false
    const waiting = releases.waitFor(at('docs', 'a.md')).then(() => {
      waited = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(waited).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(waited).toBe(true)
  })
})
