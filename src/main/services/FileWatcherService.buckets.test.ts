// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Watch caps as buckets, and their waitlists (#478, plan decisions 9, 20,
 * G9): a subscribe past the cap is `queued`, and armed with `started` when a
 * slot frees; an owner that goes away leaves the queue; a per-owner cap holds
 * one owner back without blocking the next in line. Fake chokidar, Electron
 * and disk; module-scope mocks, hence a file of its own.
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
import { testSession } from './watcher/__test__/testSession'
import { FAKE_STAMP, eventsTo, fakeLayer, resetFakeWatchLayer } from './watcher/__test__/fakeWatchLayer'
import type { WatchEvent } from '../../shared/freshness/freshnessTypes'
import type { WatchOwner } from './watcher/watchTypes'

const ROOT = path.resolve(path.sep, 'proj')
const file = (n: number): string => path.join(ROOT, `f${n}.md`)
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const windowOne: WatchOwner = { kind: 'window', webContentsId: 1 }
const windowTwo: WatchOwner = { kind: 'window', webContentsId: 2 }

let fws: FileWatcherService

beforeEach(() => {
  resetFakeWatchLayer()
  for (let n = 0; n < 12; n++) fakeLayer.disk.set(file(n), { ino: n + 1 })
  fws = new FileWatcherService({ session: testSession(ROOT), stampFile: async () => FAKE_STAMP })
})

afterEach(async () => {
  await fws.dispose()
})

const subscribe = (owner: WatchOwner, n: number, profile: 'editor' | 'dependent' = 'editor') =>
  fws.subscribe({ owner, watchId: id(n), filePath: file(n), profile })

describe('FileWatcherService buckets and waitlist (#478 S10)', () => {
  it('queues a tab past the cap and starts it when a slot frees (G9)', async () => {
    fws.setBucketCap('tabs', 2)
    await subscribe(windowOne, 0)
    await subscribe(windowOne, 1)

    await expect(subscribe(windowOne, 2)).resolves.toEqual({ status: 'queued' })
    expect(fws.getStats()).toMatchObject({ totalWatched: 2, waiting: 1, buckets: { tabs: { active: 2, waiting: 1 } } })

    await fws.unsubscribe(windowOne, id(0))

    await vi.waitFor(() =>
      expect(eventsTo(1)).toEqual([{ watchId: id(2), kind: 'started', stamp: FAKE_STAMP, liveRefresh: 'full' }])
    )
    expect(fws.getStats()).toMatchObject({ totalWatched: 2, waiting: 0 })
  })

  it('lets a subscription join a file the bucket already counts, at the cap', async () => {
    fws.setBucketCap('tabs', 1)
    await subscribe(windowOne, 0)

    await expect(fws.subscribe({ owner: windowTwo, watchId: id(9), filePath: file(0), profile: 'image' })).resolves.toMatchObject({
      status: 'started'
    })
  })

  it('drops a gone owner’s queued subscriptions: a freed slot goes to the next owner', async () => {
    fws.setBucketCap('tabs', 1)
    await subscribe(windowOne, 0)
    await expect(subscribe(windowTwo, 1)).resolves.toEqual({ status: 'queued' })
    await expect(subscribe(windowOne, 2)).resolves.toEqual({ status: 'queued' })

    // Window two reloads: its queued subscription leaves the line
    await fws.pageNavigated(2)
    expect(fws.getStats().waiting).toBe(1)
    await fws.unsubscribe(windowOne, id(0))

    await vi.waitFor(() => expect(eventsTo(1)).toEqual([expect.objectContaining({ watchId: id(2), kind: 'started' })]))
    expect(eventsTo(2)).toEqual([])
  })

  it('takes a queued subscription out of the line on unsubscribe', async () => {
    fws.setBucketCap('tabs', 1)
    await subscribe(windowOne, 0)
    await subscribe(windowOne, 1)

    await fws.unsubscribe(windowOne, id(1))

    expect(fws.getStats().waiting).toBe(0)
  })

  it('holds one owner to its per-owner cap without blocking the next owner in line', async () => {
    // dependent: 8 per owner group, 32 in all
    const replies: string[] = []
    for (let n = 0; n < 9; n++) replies.push((await subscribe(windowOne, n, 'dependent')).status)
    expect(replies).toEqual([...Array(8).fill('started'), 'queued'])

    await expect(subscribe(windowTwo, 9, 'dependent')).resolves.toMatchObject({ status: 'started' })
  })

  it('refuses with the limit once the waitlist is full', async () => {
    fws.setBucketCap('tabs', 0)
    for (let n = 0; n < 200; n++) {
      fakeLayer.disk.set(path.join(ROOT, `q${n}.md`), { ino: 100 + n })
      await fws.subscribe({ owner: windowOne, watchId: id(100 + n), filePath: path.join(ROOT, `q${n}.md`), profile: 'editor' })
    }

    await expect(subscribe(windowOne, 0)).resolves.toEqual({ status: 'refused', code: 'WATCH_FAILED' })
  })

  it('starts queued subscriptions when the cap is raised', async () => {
    fws.setBucketCap('tabs', 0)
    await subscribe(windowOne, 0)

    fws.setBucketCap('tabs', 100)

    await vi.waitFor(() =>
      expect(eventsTo(1).map(e => (e as WatchEvent).kind)).toEqual(['started'])
    )
  })
})
