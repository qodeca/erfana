// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * After a wake every watch is re-armed (#478, plan decision 22, G8, F26): a
 * watcher that died silently in sleep – no error, no event – follows the file
 * again, for a window and for an in-process owner. Fake chokidar, Electron and
 * disk; module-scope mocks, hence a file of its own.
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
import { FAKE_STAMP, eventsTo, fakeLayer, resetFakeWatchLayer, watcherOn } from './watcher/__test__/fakeWatchLayer'
import { afterWake } from './freshness/watchOwnerLifecycle'
import type { WatchEvent } from '../../shared/freshness/freshnessTypes'

const ROOT = path.resolve(path.sep, 'proj')
const FILE = path.join(ROOT, 'a.md')
const PAGE = path.join(ROOT, 'page.html')
const ID = '66666666-6666-4666-8666-666666666666'

let fws: FileWatcherService

beforeEach(() => {
  vi.useFakeTimers()
  resetFakeWatchLayer()
  fakeLayer.disk.set(FILE, { ino: 1 })
  fakeLayer.disk.set(PAGE, { ino: 2 })
  fws = new FileWatcherService({ session: testSession(ROOT), stampFile: async () => FAKE_STAMP })
})

afterEach(async () => {
  vi.useRealTimers()
  await fws.dispose()
})

describe('FileWatcherService after a wake (#478 S10/S11)', () => {
  it('re-arms a watch that died silently, so a later write is heard live (G8)', async () => {
    const previewEvents: WatchEvent[] = []
    const onCheck = vi.fn()
    await fws.subscribe({ owner: { kind: 'window', webContentsId: 1 }, watchId: ID, filePath: FILE, profile: 'editor' })
    await fws.subscribe({
      owner: { kind: 'process', ownerId: 'preview-1', onEvent: e => previewEvents.push(e), onCheck },
      watchId: ID,
      filePath: PAGE,
      profile: 'preview'
    })
    // Sleep killed both native watchers without a word: they never fire again
    const dead = [watcherOn(FILE), watcherOn(PAGE)]
    const broadcast = vi.fn()

    await afterWake(fws, broadcast)

    expect(dead.map(w => w?.close.mock.calls.length)).toEqual([1, 1])
    expect(fakeLayer.watchers).toHaveLength(4)
    expect(broadcast).toHaveBeenCalledWith({ reason: 'resume' })
    expect(onCheck).toHaveBeenCalledTimes(1)

    watcherOn(FILE)?.fire('change')
    watcherOn(PAGE)?.fire('change')
    await vi.advanceTimersByTimeAsync(500)

    expect(eventsTo(1)).toEqual([
      { watchId: ID, kind: 'restarted' },
      { watchId: ID, kind: 'changed' }
    ])
    expect(previewEvents).toEqual([
      { watchId: ID, kind: 'restarted' },
      { watchId: ID, kind: 'changed' }
    ])
  })

  it('reports a file gone during sleep as deleted', async () => {
    await fws.subscribe({ owner: { kind: 'window', webContentsId: 1 }, watchId: ID, filePath: FILE, profile: 'editor' })
    fakeLayer.disk.delete(FILE)

    await fws.rearmAll()

    expect(eventsTo(1)).toEqual([{ watchId: ID, kind: 'deleted' }])
    expect(fws.getStats().totalWatched).toBe(0)
  })
})
