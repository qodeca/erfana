// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the preview watch pool (Issue #74, work item 30; #478 plan S17).
 *
 * The pool is one in-process owner on the shared watch layer, each file a
 * freshness tracker on its one source. The freshness core's fake source and
 * fake disk stand in for `FileWatcherService` and the file system, so the
 * pool's refcounting, its one owner and one focus member, its fan-out of
 * changes and confirmed deletes, its safety-net check (S1, L4) and its
 * catch-up on a page's load are pinned without chokidar. What the tracker
 * itself guarantees (ids, restart, queued, deletes) is the shared contract's
 * (`previewWatchPool.contract.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ app: undefined, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createFakeClock, type FakeClock } from '../../../shared/freshness/__test__/fakeClock'
import { FakeDisk } from '../../../shared/freshness/__test__/fakeDisk'
import { FakeSource } from '../../../shared/freshness/__test__/fakeSource'
import type { Checkable } from '../../../shared/freshness/freshnessRegistry'
import { asMainSource, readStamp } from '../freshness/__test__/trackedWatchHarness'
import {
  createPreviewWatchPool,
  WATCH_CATCH_UP_SLACK_MS,
  type PreviewWatchPoolDeps
} from './PreviewWatchPool'

let clock: FakeClock
let disk: FakeDisk
let source: FakeSource
let checks: Set<Checkable>
let ownerCheck: (() => void) | undefined
let sourceDisposed: boolean
let owners: number

beforeEach(() => {
  clock = createFakeClock()
  disk = new FakeDisk(clock)
  source = new FakeSource(disk)
  checks = new Set()
  ownerCheck = undefined
  sourceDisposed = false
  owners = 0
  for (const name of ['a.css', 'b.css', 'c.js']) disk.write(`/proj/${name}`, `${name} v1`, { silent: true })
})

function makePool(extra: Partial<PreviewWatchPoolDeps> = {}) {
  let nextId = 0
  return createPreviewWatchPool({
    newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
    register: (member) => {
      checks.add(member)
      return () => checks.delete(member)
    },
    clock,
    read: (path) => readStamp(disk, path),
    createSource: (options) => {
      ownerCheck = options.onCheck
      owners += 1
      return asMainSource(source, options.ownerName, () => {
        sourceDisposed = true
      })
    },
    ...extra
  })
}

const flush = (): Promise<void> => clock.run(0)
/** Past the delete confirmation and the read retries. */
const settled = (): Promise<void> => clock.run(3_000)

describe('createPreviewWatchPool', () => {
  it('subscribes each distinct path once, with the preview profile', async () => {
    const pool = makePool()
    pool.acquire('/proj/a.css', () => {})
    pool.acquire('/proj/b.css', () => {})
    await flush()
    expect(source.subscribeCalls.map((call) => [call.filePath, call.profile])).toEqual([
      ['/proj/a.css', 'preview'],
      ['/proj/b.css', 'preview']
    ])
    expect(pool.size).toBe(2)
  })

  it('refcounts a re-acquired path instead of subscribing twice', async () => {
    const pool = makePool()
    expect(pool.acquire('/proj/a.css', () => {})).toBe(true)
    expect(pool.acquire('/proj/a.css', () => {})).toBe(true)
    await flush()
    expect(source.subscribeCalls).toHaveLength(1)

    await pool.release('/proj/a.css')
    expect(source.unsubscribeCalls).toEqual([])
    expect(pool.size).toBe(1)

    await pool.release('/proj/a.css')
    expect(source.unsubscribeCalls).toEqual([source.subscribeCalls[0].watchId])
    expect(pool.size).toBe(0)
  })

  it('follows every file on one owner, with one focus member', async () => {
    const pool = makePool()
    pool.acquire('/proj/a.css', () => {})
    pool.acquire('/proj/b.css', () => {})
    pool.acquire('/proj/c.js', () => {})
    await flush()
    expect(owners).toBe(1)
    expect(checks.size).toBe(1)
    expect(source.subscriptions.size).toBe(3)
  })

  it('fires onChange on a change, keeping the original handler across a bump', async () => {
    const pool = makePool()
    const first = vi.fn()
    const second = vi.fn()
    pool.acquire('/proj/a.css', first)
    pool.acquire('/proj/a.css', second)
    await flush()

    disk.write('/proj/a.css', 'a.css v2')
    await flush()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('fires onChange on a delete only once it is confirmed, and again when the file is back (G4, F11)', async () => {
    const pool = makePool()
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange)
    await flush()

    disk.remove('/proj/a.css')
    await clock.run(100)
    expect(onChange).not.toHaveBeenCalled()
    await settled()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(pool.state('/proj/a.css')?.content).toEqual({ kind: 'deleted' })

    disk.write('/proj/a.css', 'a.css back', { silent: true })
    await clock.run(8_000)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(pool.state('/proj/a.css')?.content).toEqual({ kind: 'fresh' })
  })

  it('a delete and recreate inside the confirm window reports only the new content (G4)', async () => {
    const pool = makePool()
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange)
    await flush()

    disk.remove('/proj/a.css')
    disk.write('/proj/a.css', 'a.css recreated')
    await settled()
    expect(pool.state('/proj/a.css')?.content).toEqual({ kind: 'fresh' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('accepts a file past the bucket as queued, and reports a change once it gets its slot (G9)', async () => {
    const pool = makePool()
    const onChange = vi.fn()
    source.scriptSubscribe({ kind: 'queued' })
    expect(pool.acquire('/proj/a.css', onChange)).toBe(true)
    await flush()
    expect(pool.state('/proj/a.css')?.watch).toEqual({ kind: 'queued' })

    disk.write('/proj/a.css', 'a.css v2', { silent: true })
    source.promote(source.subscribeCalls[0].watchId)
    await settled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a check reports a file whose content changed unheard – an mtime-keeping copy too (S1, L4)', async () => {
    const pool = makePool()
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange)
    await flush()

    // Nothing changed: no reload
    pool.recheck()
    await flush()
    expect(onChange).not.toHaveBeenCalled()

    disk.write('/proj/a.css', 'copied', { silent: true, keepMtime: true })
    for (const member of checks) member.check('focus')
    await settled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a power resume reaches the pool as its owner check (G8)', async () => {
    const pool = makePool()
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange)
    await flush()
    disk.write('/proj/a.css', 'during sleep', { silent: true })
    ownerCheck?.()
    await settled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('after a restart, reports only a file that changed meanwhile (G1)', async () => {
    const pool = makePool()
    const a = vi.fn()
    const b = vi.fn()
    pool.acquire('/proj/a.css', a)
    pool.acquire('/proj/b.css', b)
    await flush()
    disk.write('/proj/a.css', 'a.css v2', { silent: true })
    for (const call of source.subscribeCalls) source.emit({ watchId: call.watchId, kind: 'restarted' })
    await settled()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('restarts an ended watch once with a new id, and not after a project switch', async () => {
    const pool = makePool()
    pool.acquire('/proj/a.css', () => {})
    pool.acquire('/proj/b.css', () => {})
    await flush()
    const [a, b] = source.subscribeCalls.map((call) => call.watchId)
    source.emit({ watchId: a, kind: 'ended', reason: 'watcher-error' })
    source.emit({ watchId: b, kind: 'ended', reason: 'project-switch' })
    await flush()
    expect(source.subscribeCalls.map((call) => call.filePath)).toEqual(['/proj/a.css', '/proj/b.css', '/proj/a.css'])
    expect(source.subscribeCalls[2].watchId).not.toBe(a)
  })

  it('drops a late event for a released path', async () => {
    const pool = makePool()
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange)
    await flush()
    const id = source.subscribeCalls[0].watchId
    await pool.release('/proj/a.css')
    source.emit({ watchId: id, kind: 'changed' })
    await settled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('unsubscribes a watch released while its subscribe was still answering', async () => {
    const pool = makePool()
    source.scriptSubscribe({ kind: 'hold' })
    pool.acquire('/proj/a.css', () => {})
    await flush()
    await pool.release('/proj/a.css')
    source.releaseHeld()
    await flush()
    expect(source.subscriptions.size).toBe(0)
  })

  it('close() releases everything, leaves the focus check and ends its owner', async () => {
    const pool = makePool()
    pool.acquire('/proj/a.css', () => {})
    pool.acquire('/proj/a.css', () => {})
    pool.acquire('/proj/b.css', () => {})
    await flush()
    expect(checks.size).toBe(1)

    await pool.close()
    expect(pool.size).toBe(0)
    expect(source.subscriptions.size).toBe(0)
    expect(checks.size).toBe(0)
    expect(sourceDisposed).toBe(true)
  })

  it('release of an unknown path is a no-op', async () => {
    const pool = makePool()
    await expect(pool.release('/proj/never.css')).resolves.toBeUndefined()
  })
})


/**
 * A new watch catches up on a save made after the page's load began but before
 * it was live – the gap the link scan worker widened until the AC24 e2e lost
 * its first save every run. No stamp of the version the page loaded exists, so
 * the load time picks the tracker's baseline; from there on it is stamps.
 */
describe('createPreviewWatchPool – a new watch catches up', () => {
  const SLACK = WATCH_CATCH_UP_SLACK_MS
  /** `a.css`'s mtime, written fresh for each test. */
  let savedAt: number

  beforeEach(async () => {
    await clock.run(1_000)
    disk.write('/proj/a.css', 'a.css saved', { silent: true })
    savedAt = disk.stamp('/proj/a.css')?.mtimeMs ?? 0
  })

  async function open(changedSince: number, extra: Partial<PreviewWatchPoolDeps> = {}) {
    const pool = makePool(extra)
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange, { changedSince })
    await settled()
    return { pool, onChange }
  }

  it('reports a file saved after the load began, once, when the watch is live', async () => {
    source.scriptSubscribe({ kind: 'hold' })
    const { onChange } = await open(savedAt - 200)
    // Not before the watch is live
    expect(onChange).not.toHaveBeenCalled()
    source.releaseHeld()
    await settled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("allows a stamp's coarser clock: a file stamped just before the load began is reported", async () => {
    const { onChange } = await open(savedAt + SLACK - 1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports nothing for a file unchanged since before the load began', async () => {
    const { onChange } = await open(savedAt + SLACK + 1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports nothing for a file stamped in the future', async () => {
    const future = async (path: string): ReturnType<typeof readStamp> => {
      const outcome = await readStamp(disk, path)
      if (outcome.status !== 'ok') return outcome
      const stamp = { ...outcome.stamp, mtimeMs: clock.now() + SLACK + 1 }
      return { status: 'ok', version: stamp, stamp }
    }
    const { onChange } = await open(savedAt - 200, { read: future })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports a write between the baseline and the watch going live, by stamp', async () => {
    source.scriptSubscribe({ kind: 'hold' })
    const pool = makePool()
    const onChange = vi.fn()
    pool.acquire('/proj/b.css', onChange)
    await flush()
    disk.write('/proj/b.css', 'b.css v2', { silent: true })
    source.releaseHeld()
    await settled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('checks nothing for a watch already held', async () => {
    const pool = makePool()
    const first = vi.fn()
    pool.acquire('/proj/a.css', first)
    await settled()
    // A refcount bump opens no watch, so it has no gap of its own to check.
    pool.acquire('/proj/a.css', vi.fn(), { changedSince: savedAt - 200 })
    await settled()
    expect(first).not.toHaveBeenCalled()
  })

  it('reports nothing for a watch released before it was live', async () => {
    source.scriptSubscribe({ kind: 'hold' })
    const pool = makePool()
    const onChange = vi.fn()
    pool.acquire('/proj/a.css', onChange, { changedSince: savedAt - 200 })
    await flush()
    await pool.release('/proj/a.css')
    source.releaseHeld()
    await settled()
    expect(onChange).not.toHaveBeenCalled()
    expect(source.subscriptions.size).toBe(0)
  })
})
