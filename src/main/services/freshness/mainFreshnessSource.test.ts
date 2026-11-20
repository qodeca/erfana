// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A main source is an in-process owner on the one watch layer (#478 plan S17,
 * F2): its subscriptions draw from the profile's bucket and queue past it
 * (G9 for the preview and the comments), its events arrive through the owner
 * callback, a wake reaches it as `onCheck` (G8), a project switch ends it
 * (G1), and `dispose` leaves nothing behind – not even a subscribe still
 * answering. A real `FileWatcherService` over fake chokidar, Electron and disk;
 * module-scope mocks, hence a file of its own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('chokidar', async () => (await import('../watcher/__test__/fakeWatchLayer')).fakeChokidarModule())
vi.mock('electron', async () => (await import('../watcher/__test__/fakeWatchLayer')).fakeElectronModule())
vi.mock('fs/promises', async importOriginal =>
  (await import('../watcher/__test__/fakeWatchLayer')).fakeFsPromisesModule(importOriginal)
)
vi.mock('../LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { FileWatcherService } from '../FileWatcherService'
import { testSession } from '../watcher/__test__/testSession'
import { FAKE_STAMP, fakeLayer, resetFakeWatchLayer, watcherOn } from '../watcher/__test__/fakeWatchLayer'
import type { WatchEvent } from '../../../shared/freshness/freshnessTypes'
import { WATCH_BUCKETS } from '../../../shared/freshness/timingProfiles'
import { FileStamper } from './fileStamp'
import { createMainFreshnessSource, type MainFreshnessSource } from './mainFreshnessSource'

const ROOT = path.resolve(path.sep, 'proj')
const file = (n: number): string => path.join(ROOT, `f${n}.css`)
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let fws: FileWatcherService
let session: ReturnType<typeof testSession>
const sources: MainFreshnessSource[] = []

beforeEach(() => {
  resetFakeWatchLayer()
  for (let n = 0; n < 80; n++) fakeLayer.disk.set(file(n), { ino: n + 1 })
  session = testSession(ROOT)
  fws = new FileWatcherService({ session, stampFile: async () => FAKE_STAMP })
})

afterEach(async () => {
  await Promise.all(sources.splice(0).map(source => source.dispose()))
  await fws.dispose()
})

function source(ownerName: string, onCheck?: () => void): { source: MainFreshnessSource; events: WatchEvent[] } {
  const events: WatchEvent[] = []
  const made = createMainFreshnessSource({ ownerName, watcher: fws, ...(onCheck ? { onCheck } : {}) })
  made.onEvent(event => events.push(event))
  sources.push(made)
  return { source: made, events }
}

describe('createMainFreshnessSource (#478 S17)', () => {
  it('follows a file as an in-process owner: events reach its listeners, never a window', async () => {
    const { source: preview, events } = source('preview-entry')
    await expect(preview.subscribe({ watchId: id(1), filePath: file(1), profile: 'preview' })).resolves.toEqual({
      status: 'started',
      stamp: FAKE_STAMP,
      liveRefresh: 'full'
    })
    watcherOn(file(1))?.fire('change')
    await vi.waitFor(() => expect(events).toEqual([{ watchId: id(1), kind: 'changed' }]))
    expect(fakeLayer.sends).toEqual([])
    expect(fws.getStats().buckets.preview).toEqual({ active: 1, waiting: 0 })
  })

  it('holds one preview owner to 16 files, queueing the 17th, and starts it when a slot frees (G9)', async () => {
    const { source: pool, events } = source('preview-pool')
    const cap = WATCH_BUCKETS.preview.perOwnerCap
    for (let n = 0; n < cap; n++) await pool.subscribe({ watchId: id(n), filePath: file(n), profile: 'preview' })
    await expect(pool.subscribe({ watchId: id(cap), filePath: file(cap), profile: 'preview' })).resolves.toEqual({
      status: 'queued'
    })

    // Another view is another owner: it is not held back by the first one's cap
    const { source: other } = source('preview-pool')
    await expect(other.subscribe({ watchId: id(70), filePath: file(70), profile: 'preview' })).resolves.toMatchObject({
      status: 'started'
    })

    await pool.unsubscribe(id(0))
    await vi.waitFor(() =>
      expect(events).toContainEqual({ watchId: id(cap), kind: 'started', stamp: FAKE_STAMP, liveRefresh: 'full' })
    )
  })

  it('holds every preview owner together to the bucket total, and frees a slot for another view on release', async () => {
    fws.setBucketCap('preview', 2)
    const { source: viewA } = source('preview-pool')
    const { source: viewB, events } = source('preview-pool')
    await viewA.subscribe({ watchId: id(1), filePath: file(1), profile: 'preview' })
    await viewA.subscribe({ watchId: id(2), filePath: file(2), profile: 'preview' })
    // View B is far under its own cap, but the views together are at the ceiling
    await expect(viewB.subscribe({ watchId: id(3), filePath: file(3), profile: 'preview' })).resolves.toEqual({
      status: 'queued'
    })
    await viewA.unsubscribe(id(1))
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ watchId: id(3), kind: 'started' })))
  })

  it('queues a comment watch past the comments bucket (G9 for comments)', async () => {
    fws.setBucketCap('comments', 2)
    const { source: comments } = source('comments')
    await comments.subscribe({ watchId: id(1), filePath: file(1), profile: 'comments' })
    await comments.subscribe({ watchId: id(2), filePath: file(2), profile: 'comments' })
    await expect(comments.subscribe({ watchId: id(3), filePath: file(3), profile: 'comments' })).resolves.toEqual({
      status: 'queued'
    })
    expect(fws.getStats().buckets.comments).toEqual({ active: 2, waiting: 1 })
  })

  it('hears a power resume as its check (G8)', async () => {
    const onCheck = vi.fn()
    const { source: comments } = source('comments', onCheck)
    await comments.subscribe({ watchId: id(1), filePath: file(1), profile: 'comments' })
    fws.checkInProcessOwners()
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it('is ended by a project switch like every other owner (G1)', async () => {
    const { source: preview, events } = source('preview-entry')
    await preview.subscribe({ watchId: id(1), filePath: file(1), profile: 'preview' })
    await fws.suspendAll()
    await fws.endSuspended(session.switchTo(path.resolve(path.sep, 'other')))
    expect(events).toEqual([{ watchId: id(1), kind: 'ended', reason: 'project-switch' }])
    expect(fws.getStats().totalWatched).toBe(0)
  })

  it('leaves no watch on dispose, nor one a subscribe still answering would add', async () => {
    const { source: pool } = source('preview-pool')
    await pool.subscribe({ watchId: id(1), filePath: file(1), profile: 'preview' })
    fakeLayer.autoReady = false
    const answering = pool.subscribe({ watchId: id(2), filePath: file(2), profile: 'preview' })
    await vi.waitFor(() => expect(watcherOn(file(2))).toBeDefined())

    const disposing = pool.dispose()
    watcherOn(file(2))?.ready()
    await disposing
    // Refused by the layer (the owner was dropped mid-answer) or by the source itself
    await expect(answering).resolves.toMatchObject({ status: 'refused' })
    expect(fws.getStats().totalWatched).toBe(0)
    await expect(pool.subscribe({ watchId: id(3), filePath: file(3), profile: 'preview' })).resolves.toEqual({
      status: 'refused',
      code: 'WATCH_FAILED'
    })
  })

  it('checks a path again before every probe and read: a name linked out of the project is never stamped, and its watch ends (SEC2)', async () => {
    const stamper = new FileStamper()
    const stamp = vi.spyOn(stamper, 'stamp')
    const events: WatchEvent[] = []
    const comments = createMainFreshnessSource({ ownerName: 'comments', watcher: fws, stamper })
    comments.onEvent(event => events.push(event))
    sources.push(comments)
    await comments.subscribe({ watchId: id(1), filePath: file(1), profile: 'comments' })

    const outside = path.resolve(path.sep, 'elsewhere', 'secret.txt')
    fakeLayer.disk.set(outside, { ino: 999 })
    fakeLayer.links.set(file(1), outside)
    await expect(comments.probe(file(1))).resolves.toEqual({ status: 'unsupported', code: 'outside-project' })
    await expect(comments.readText(file(1))).resolves.toEqual({ status: 'unsupported' })
    await expect(comments.readStamp(file(1))).resolves.toEqual({ status: 'failed' })
    expect(stamp).not.toHaveBeenCalled()
    expect(events).toEqual([{ watchId: id(1), kind: 'ended', reason: 'outside-project' }])

    // A file that is simply gone is a delete, not an escape: no watch is ended for it
    fakeLayer.disk.delete(file(2))
    await expect(comments.probe(file(2))).resolves.toEqual({ status: 'missing' })
  })

  it('tells a delete-pending file from an escape: a realpath errno opens nothing and ends no watch (R2-1)', async () => {
    const stamper = new FileStamper()
    const stamp = vi.spyOn(stamper, 'stamp')
    const unsubscribe = vi.spyOn(fws, 'unsubscribe')
    const events: WatchEvent[] = []
    const preview = createMainFreshnessSource({ ownerName: 'preview-entry', watcher: fws, stamper })
    preview.onEvent(event => events.push(event))
    sources.push(preview)
    await preview.subscribe({ watchId: id(1), filePath: file(1), profile: 'preview' })

    // Windows answers EPERM to `realpath` while a deleted file is still held open
    fakeLayer.disk.set(file(1), 'EPERM')
    await expect(preview.probe(file(1))).resolves.toEqual({ status: 'unreadable', code: 'unresolved' })
    await expect(preview.readText(file(1))).resolves.toEqual({ status: 'busy' })
    await expect(preview.readStamp(file(1))).resolves.toEqual({ status: 'busy' })
    expect(stamp).not.toHaveBeenCalled()
    expect(events).toEqual([])
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(fws.getStats().buckets.preview).toEqual({ active: 1, waiting: 0 })

    // A path that resolves outside the project still ends the watch
    const outside = path.resolve(path.sep, 'elsewhere', 'secret.css')
    fakeLayer.disk.set(file(1), { ino: 2 })
    fakeLayer.disk.set(outside, { ino: 999 })
    fakeLayer.links.set(file(1), outside)
    await expect(preview.probe(file(1))).resolves.toEqual({ status: 'unsupported', code: 'outside-project' })
    expect(events).toEqual([{ watchId: id(1), kind: 'ended', reason: 'outside-project' }])
    expect(stamp).not.toHaveBeenCalled()
  })

  it("follows a file on a network or WSL volume `limited`, in the reply and in a queued watch's `started` (G7)", async () => {
    const events: WatchEvent[] = []
    const pool = createMainFreshnessSource({ ownerName: 'preview-pool', watcher: fws, volumeKind: async () => 'network' })
    pool.onEvent(event => events.push(event))
    sources.push(pool)
    const cap = WATCH_BUCKETS.preview.perOwnerCap
    await expect(pool.subscribe({ watchId: id(0), filePath: file(0), profile: 'preview' })).resolves.toEqual({
      status: 'started',
      stamp: FAKE_STAMP,
      liveRefresh: 'limited'
    })
    for (let n = 1; n < cap; n++) await pool.subscribe({ watchId: id(n), filePath: file(n), profile: 'preview' })
    await expect(pool.subscribe({ watchId: id(cap), filePath: file(cap), profile: 'preview' })).resolves.toEqual({
      status: 'queued'
    })

    await pool.unsubscribe(id(0))
    await vi.waitFor(() =>
      expect(events).toContainEqual({ watchId: id(cap), kind: 'started', stamp: FAKE_STAMP, liveRefresh: 'limited' })
    )
  })
})
