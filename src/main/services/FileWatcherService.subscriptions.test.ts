// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Subscriptions by owner + `watchId` (#478, plan S9, decisions 4, 5, 16, F23,
 * F41): a pause is one subscription's, it ends by itself and says it missed a
 * change; another owner's id finds nothing; a live id cannot be subscribed
 * twice; two spellings of one file (case, 8.3, junction, symlink) share one
 * watch (G6); a watcher error is logged without the path. Fake chokidar,
 * Electron and disk; module-scope mocks, hence a file of its own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const log = vi.hoisted(() => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('chokidar', async () => (await import('./watcher/__test__/fakeWatchLayer')).fakeChokidarModule())
vi.mock('electron', async () => (await import('./watcher/__test__/fakeWatchLayer')).fakeElectronModule())
vi.mock('fs/promises', async importOriginal =>
  (await import('./watcher/__test__/fakeWatchLayer')).fakeFsPromisesModule(importOriginal)
)
vi.mock('./LoggingService', () => ({ logger: log }))

import { FileWatcherService } from './FileWatcherService'
import { testSession } from './watcher/__test__/testSession'
import {
  FAKE_STAMP,
  eventsTo,
  fakeFs,
  fakeLayer,
  resetFakeWatchLayer,
  watcherOn
} from './watcher/__test__/fakeWatchLayer'
import type { WatchOwner } from './watcher/watchTypes'

const ROOT = path.resolve(path.sep, 'work', 'Proj')
const FILE = path.join(ROOT, 'docs', 'Open.md')
const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const windowOne: WatchOwner = { kind: 'window', webContentsId: 1 }
const windowTwo: WatchOwner = { kind: 'window', webContentsId: 2 }
/** Past the write-finish gate. */
const GATE_MS = 500
const PAUSE_MAX_MS = 10_000

let fws: FileWatcherService

async function outsideChange(): Promise<void> {
  watcherOn(FILE)?.fire('change')
  await vi.advanceTimersByTimeAsync(GATE_MS)
}

const kinds = (id: number): string[] => eventsTo(id).map(e => (e as { kind: string }).kind)

beforeEach(() => {
  vi.useFakeTimers()
  resetFakeWatchLayer()
  log.error.mockClear()
  fakeLayer.disk.set(FILE, { ino: 7 })
  fws = new FileWatcherService({ session: testSession(ROOT), fs: fakeFs, stampFile: async () => FAKE_STAMP })
})

afterEach(async () => {
  await fws.dispose()
  vi.useRealTimers()
})

describe('FileWatcherService subscriptions (#478 S9)', () => {
  it('answers started with the stamp after the watcher is ready', async () => {
    await expect(fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })).resolves.toEqual({
      status: 'started',
      stamp: FAKE_STAMP,
      liveRefresh: 'full'
    })
    await outsideChange()
    expect(eventsTo(1)).toEqual([{ watchId: ID_A, kind: 'changed' }])
  })

  it('pauses only the subscription named: another on the same file still hears (L5)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })
    await fws.subscribe({ owner: windowOne, watchId: ID_B, filePath: FILE, profile: 'image' })

    fws.pauseSubscription(windowOne, ID_A)
    await outsideChange()

    expect(eventsTo(1)).toEqual([{ watchId: ID_B, kind: 'changed' }])
    expect(fws.resumeSubscription(windowOne, ID_A)).toEqual({ success: true, missed: true })
    expect(fws.resumeSubscription(windowOne, ID_A)).toEqual({ success: true, missed: false })
  })

  it('ends a pause by itself after pauseMaxMs and says the change was missed (G2)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })
    fws.pauseSubscription(windowOne, ID_A)

    await vi.advanceTimersByTimeAsync(PAUSE_MAX_MS + 1)
    await outsideChange()

    expect(kinds(1)).toEqual(['changed'])
    expect(fws.resumeSubscription(windowOne, ID_A)).toEqual({ success: true, missed: true })
  })

  it('treats another owner’s id as unknown: pause, unsubscribe and resume touch nothing (F23)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })

    fws.pauseSubscription(windowTwo, ID_A)
    await fws.unsubscribe(windowTwo, ID_A)
    await outsideChange()

    expect(kinds(1)).toEqual(['changed'])
    expect(fws.getStats().totalWatched).toBe(1)
    // An unknown id asks the saver to check, to be safe
    expect(fws.resumeSubscription(windowTwo, ID_A)).toEqual({ success: false, missed: true })
  })

  it('refuses a subscribe whose id is live, and lets the same id be used by another owner', async () => {
    await fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })

    await expect(fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })).resolves.toEqual({
      status: 'refused',
      code: 'DUPLICATE_ID'
    })
    await expect(fws.subscribe({ owner: windowTwo, watchId: ID_A, filePath: FILE, profile: 'editor' })).resolves.toMatchObject({
      status: 'started'
    })
  })

  it('closes the watch with its last subscription; an unsubscribed id hears nothing more', async () => {
    await fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })
    const watcher = watcherOn(FILE)

    await fws.unsubscribe(windowOne, ID_A)
    watcher?.fire('change')
    await vi.advanceTimersByTimeAsync(GATE_MS)

    expect(watcher?.close).toHaveBeenCalledTimes(1)
    expect(fws.getStats().totalWatched).toBe(0)
    expect(eventsTo(1)).toEqual([])
  })

  // Each spelling resolves to FILE through realpath, as the OS answers it: the
  // watch is keyed by the real path, so the two tabs share one watch (G6, M1)
  it.each([
    { spelling: 'letter case', otherSpelling: FILE.toUpperCase() },
    { spelling: 'an 8.3 short name', otherSpelling: path.join(ROOT, 'DOCS~1', 'OPEN~1.MD') },
    { spelling: 'a junction to the folder', otherSpelling: path.join(ROOT, 'docs-junction', 'Open.md') },
    { spelling: 'a symlink to the file', otherSpelling: path.join(ROOT, 'open-link.md') }
  ])('files two spellings of one file under one watch: $spelling (G6)', async ({ otherSpelling }) => {
    fakeLayer.links.set(otherSpelling, FILE)
    const service = new FileWatcherService({ session: testSession(ROOT, false), fs: fakeFs, stampFile: async () => FAKE_STAMP })
    try {
      await service.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })
      await service.subscribe({ owner: windowOne, watchId: ID_B, filePath: otherSpelling, profile: 'image' })

      expect(service.getStats().totalWatched).toBe(1)
      expect(fakeLayer.watchers).toHaveLength(1)
    } finally {
      await service.dispose()
    }
  })

  it('refuses a path outside the project before asking the disk', async () => {
    const outside = path.resolve(path.sep, 'elsewhere', 'secret.md')
    const realpath = vi.spyOn(fakeFs, 'realpath')

    await expect(fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: outside, profile: 'editor' })).resolves.toEqual({
      status: 'refused',
      code: 'OUTSIDE_PROJECT'
    })
    expect(realpath).not.toHaveBeenCalled()
    realpath.mockRestore()
  })

  it('logs a watcher error without the path (F41)', async () => {
    await fws.subscribe({ owner: windowOne, watchId: ID_A, filePath: FILE, profile: 'editor' })
    const error = Object.assign(new Error(`EPERM: operation not permitted, watch '${FILE}'`), {
      code: 'EPERM',
      syscall: 'watch',
      path: FILE
    })

    watcherOn(FILE)?.fire('error', error)
    await vi.advanceTimersByTimeAsync(0)

    const logged = JSON.stringify(log.error.mock.calls, (_key, value: unknown) =>
      value instanceof Error ? value.message : value
    )
    expect(log.error).toHaveBeenCalled()
    expect(logged).not.toContain(path.join('docs', 'Open.md'))
    expect(logged).not.toContain(ROOT)
    // The error re-armed the watch: the subscriber is told to catch up, not that it ended
    expect(kinds(1)).toEqual(['restarted'])
  })
})
