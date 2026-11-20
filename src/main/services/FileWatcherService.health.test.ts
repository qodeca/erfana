// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The watch health round (#478, plan decision 21, G4): a watched path that
 * names another file now – its folder deleted and created again, which no
 * single-file watcher hears – is re-armed within one round and reported as a
 * change; a path gone takes the unlink branch. Fake chokidar, Electron and
 * disk (whose `lstat` the round asks); module-scope mocks, hence a file of
 * its own.
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
import { FRESHNESS_LIMITS } from '../../shared/freshness/timingProfiles'

const ROOT = path.resolve(path.sep, 'proj')
const FILE = path.join(ROOT, 'dist', 'notes.md')
const ID = '55555555-5555-4555-8555-555555555555'

let fws: FileWatcherService

beforeEach(async () => {
  vi.useFakeTimers()
  resetFakeWatchLayer()
  fakeLayer.disk.set(FILE, { ino: 1 })
  fws = new FileWatcherService({ session: testSession(ROOT), stampFile: async () => FAKE_STAMP })
  await fws.subscribe({ owner: { kind: 'window', webContentsId: 1 }, watchId: ID, filePath: FILE, profile: 'editor' })
})

afterEach(async () => {
  vi.useRealTimers()
  await fws.dispose()
})

describe('FileWatcherService health round (#478 S10)', () => {
  it('re-arms a watch whose path names another file now, within one round (G4)', async () => {
    const first = watcherOn(FILE)
    // The ignored folder was removed and rebuilt: same path, another file, no event heard
    fakeLayer.disk.set(FILE, { ino: 2 })

    await vi.advanceTimersByTimeAsync(FRESHNESS_LIMITS.healthRoundMs + 1)

    expect(first?.close).toHaveBeenCalledTimes(1)
    expect(fakeLayer.watchers).toHaveLength(2)
    // Replaced unheard, the new file may still be being written: the reader settles first (F8)
    expect(eventsTo(1)).toEqual([{ watchId: ID, kind: 'changed', forced: true }])

    // The new watcher is the live one: a later write is heard, through the write gate
    watcherOn(FILE)?.fire('change')
    await vi.advanceTimersByTimeAsync(500)
    expect(eventsTo(1)).toEqual([
      { watchId: ID, kind: 'changed', forced: true },
      { watchId: ID, kind: 'changed' }
    ])
  })

  it('leaves a watch alone while its file is the one it was armed on', async () => {
    await fws.runHealthRound()
    await vi.advanceTimersByTimeAsync(FRESHNESS_LIMITS.healthRoundMs * 3)

    expect(fakeLayer.watchers).toHaveLength(1)
    expect(eventsTo(1)).toEqual([])
  })

  it('takes a watched file found gone down the unlink branch', async () => {
    fakeLayer.disk.delete(FILE)

    await fws.runHealthRound()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(eventsTo(1)).toEqual([{ watchId: ID, kind: 'deleted' }])
    expect(fws.getStats().totalWatched).toBe(0)
  })
})
