// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * File watches across a project switch (#478, plan decision 18, N1, G1):
 * suspended just before the commit, resumed when a later step fails, and
 * ended by generation once the commit made a newer one current – for window
 * owners, in-process owners and waitlisted subscriptions alike. Fake chokidar,
 * Electron and disk; module-scope mocks, hence a file of its own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('chokidar', async () => (await import('./watcher/__test__/fakeWatchLayer')).fakeChokidarModule())
vi.mock('electron', async () => (await import('./watcher/__test__/fakeWatchLayer')).fakeElectronModule())
vi.mock('fs/promises', async importOriginal =>
  (await import('./watcher/__test__/fakeWatchLayer')).fakeFsPromisesModule(importOriginal)
)
vi.mock('./LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { FileWatcherService } from './FileWatcherService'
import { testSession, type TestSession } from './watcher/__test__/testSession'
import { FAKE_STAMP, eventsTo, fakeLayer, resetFakeWatchLayer, watcherOn } from './watcher/__test__/fakeWatchLayer'
import type { WatchEvent } from '../../shared/freshness/freshnessTypes'
import type { WatchOwner } from './watcher/watchTypes'

const ROOT = path.resolve(path.sep, 'proj')
const A = path.join(ROOT, 'a.md')
const B = path.join(ROOT, 'b.md')
const C = path.join(ROOT, 'c.md')
const id = (n: number): string => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`
const windowOne: WatchOwner = { kind: 'window', webContentsId: 1 }

let fws: FileWatcherService
let session: TestSession
let previewEvents: WatchEvent[]
let preview: WatchOwner

beforeEach(() => {
  resetFakeWatchLayer()
  for (const [n, file] of [A, B, C].entries()) fakeLayer.disk.set(file, { ino: n + 1 })
  session = testSession(ROOT)
  fws = new FileWatcherService({ session, stampFile: async () => FAKE_STAMP })
  previewEvents = []
  preview = { kind: 'process', ownerId: 'preview-1', onEvent: e => previewEvents.push(e) }
})

afterEach(async () => {
  vi.useRealTimers()
  await fws.dispose()
})

describe('FileWatcherService across a project switch (#478 S11)', () => {
  it('closes every native watcher on suspend and keeps the subscriptions', async () => {
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    const watcher = watcherOn(A)

    await fws.suspendAll()

    expect(watcher?.close).toHaveBeenCalledTimes(1)
    expect(fws.getStats()).toMatchObject({ totalWatched: 1, subscriptions: 1 })
  })

  it('leaves no live entry for a subscribe landing between suspend and commit (N1)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    fws.setBucketCap('tabs', 1)
    await expect(fws.subscribe({ owner: windowOne, watchId: id(9), filePath: C, profile: 'editor' })).resolves.toEqual({
      status: 'queued'
    })

    await fws.suspendAll()
    // A window and an in-process owner subscribe while suspending: inserted suspended, no watcher
    const created = fakeLayer.watchers.length
    await expect(fws.subscribe({ owner: windowOne, watchId: id(2), filePath: B, profile: 'dependent' })).resolves.toMatchObject({
      status: 'started'
    })
    await expect(fws.subscribe({ owner: preview, watchId: id(3), filePath: B, profile: 'preview' })).resolves.toMatchObject({
      status: 'started'
    })
    expect(fakeLayer.watchers).toHaveLength(created)

    await fws.endSuspended(session.switchTo(path.resolve(path.sep, 'other')))

    expect(fws.getStats()).toMatchObject({ totalWatched: 0, subscriptions: 0, waiting: 0 })
    expect(eventsTo(1)).toEqual([
      { watchId: id(1), kind: 'ended', reason: 'project-switch' },
      { watchId: id(9), kind: 'ended', reason: 'project-switch' },
      { watchId: id(2), kind: 'ended', reason: 'project-switch' }
    ])
    expect(previewEvents).toEqual([{ watchId: id(3), kind: 'ended', reason: 'project-switch' }])
    expect(fakeLayer.watchers).toHaveLength(created)
  })

  it('re-arms every suspended watch after a failed switch, those inserted while suspending too (G1)', async () => {
    // The write-finish gate reads the clock when its watcher is built
    vi.useFakeTimers()
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    await fws.suspendAll()
    await fws.subscribe({ owner: preview, watchId: id(3), filePath: B, profile: 'preview' })

    await fws.resumeSuspended()

    expect(eventsTo(1)).toEqual([{ watchId: id(1), kind: 'restarted' }])
    expect(previewEvents).toEqual([{ watchId: id(3), kind: 'restarted' }])
    expect(watcherOn(A)?.close).not.toHaveBeenCalled()
    expect(watcherOn(B)).toBeDefined()
    // Live again: an outside write is heard
    watcherOn(A)?.fire('change')
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()
    expect(eventsTo(1)).toEqual([
      { watchId: id(1), kind: 'restarted' },
      { watchId: id(1), kind: 'changed' }
    ])
  })

  it('ends a watch whose re-arm fails on resume with restart-failed, and drops it (H2)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    await fws.subscribe({ owner: preview, watchId: id(3), filePath: B, profile: 'preview' })
    await fws.suspendAll()
    // The native watcher cannot be built for a.md (EMFILE, a removed volume…)
    const chokidar = await import('chokidar')
    const watch = vi.mocked(chokidar.watch)
    const build = watch.getMockImplementation()
    watch.mockImplementation(((watched: string, ...rest: unknown[]) => {
      if (watched === A) throw new Error('EMFILE')
      return (build as (...args: unknown[]) => unknown)(watched, ...rest)
    }) as never)
    try {
      await fws.resumeSuspended()
    } finally {
      if (build) watch.mockImplementation(build)
    }

    expect(eventsTo(1)).toEqual([{ watchId: id(1), kind: 'ended', reason: 'restart-failed' }])
    expect(previewEvents).toEqual([{ watchId: id(3), kind: 'restarted' }])
    expect(fws.getStats()).toMatchObject({ totalWatched: 1, subscriptions: 1 })
  })

  it('ends a watch whose re-arm throws on resume, instead of leaving it silent (H2)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    await fws.suspendAll()
    const internals = fws as unknown as { arm: (entry: unknown) => Promise<unknown> }
    const arm = vi.spyOn(internals, 'arm').mockRejectedValueOnce(new Error('session gone'))

    await expect(fws.resumeSuspended()).resolves.toBeUndefined()

    expect(arm).toHaveBeenCalledTimes(1)
    expect(eventsTo(1)).toEqual([{ watchId: id(1), kind: 'ended', reason: 'restart-failed' }])
    expect(fws.getStats()).toMatchObject({ totalWatched: 0, subscriptions: 0 })
  })

  it('ends a watch whose file left the project while suspended as outside-project (H2)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    await fws.suspendAll()
    const outside = path.resolve(path.sep, 'elsewhere', 'a.md')
    fakeLayer.disk.set(outside, { ino: 99 })
    fakeLayer.links.set(A, outside)

    await fws.resumeSuspended()

    expect(eventsTo(1)).toEqual([{ watchId: id(1), kind: 'ended', reason: 'outside-project' }])
    expect(fws.getStats().totalWatched).toBe(0)
  })

  it('reports a file deleted while suspended as deleted on resume', async () => {
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    await fws.suspendAll()
    fakeLayer.disk.delete(A)

    await fws.resumeSuspended()

    expect(eventsTo(1)).toEqual([{ watchId: id(1), kind: 'deleted' }])
    expect(fws.getStats().totalWatched).toBe(0)
  })

  it('ends the old project’s watches as project-closed when the project closes', async () => {
    await fws.subscribe({ owner: windowOne, watchId: id(1), filePath: A, profile: 'editor' })
    await fws.suspendAll()

    await fws.endSuspended(session.commit(null), 'project-closed')

    expect(eventsTo(1)).toEqual([{ watchId: id(1), kind: 'ended', reason: 'project-closed' }])
  })
})
