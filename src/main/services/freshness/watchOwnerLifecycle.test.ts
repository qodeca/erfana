// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * What ends or wakes a window's file watches (#478, plan decisions 17, 22,
 * G2, G8): each navigation drops the old page's subscriptions, so 20 reloads
 * that each subscribe 3 files leave 3; a destroyed window leaves none; a wake
 * re-arms, runs one health round, then sends the check once. Fake chokidar,
 * Electron and disk; module-scope mocks, hence a file of its own.
 */
import { EventEmitter } from 'events'
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
import { FAKE_STAMP, fakeLayer, resetFakeWatchLayer } from '../watcher/__test__/fakeWatchLayer'
import { wirePowerResume, wireWatchOwner, type WatchOwnerContents } from './watchOwnerLifecycle'

const ROOT = path.resolve(path.sep, 'proj')
const FILES = ['a.md', 'b.md', 'c.md'].map(name => path.join(ROOT, name))
const RELOADS = 20

let fws: FileWatcherService

/** A webContents that can be navigated and destroyed. */
function fakeContents(id: number): WatchOwnerContents & EventEmitter {
  return Object.assign(new EventEmitter(), { id }) as WatchOwnerContents & EventEmitter
}

/** What a page's tabs do: subscribe each file with a fresh id. */
async function subscribeAll(webContentsId: number): Promise<void> {
  for (const filePath of FILES) {
    await fws.subscribe({ owner: { kind: 'window', webContentsId }, watchId: crypto.randomUUID(), filePath, profile: 'editor' })
  }
}

beforeEach(() => {
  resetFakeWatchLayer()
  for (const [n, filePath] of FILES.entries()) fakeLayer.disk.set(filePath, { ino: n + 1 })
  fws = new FileWatcherService({ session: testSession(ROOT), stampFile: async () => FAKE_STAMP })
})

afterEach(async () => {
  await fws.dispose()
})

describe('wireWatchOwner', () => {
  it('leaves exactly the last page’s subscriptions after 20 reloads (G2)', async () => {
    const contents = fakeContents(1)
    wireWatchOwner(contents, fws)
    await subscribeAll(1)

    for (let i = 0; i < RELOADS; i++) {
      contents.emit('did-navigate')
      await vi.waitFor(() => expect(fws.getStats().subscriptions).toBe(0))
      await subscribeAll(1)
    }

    expect(fws.getStats()).toMatchObject({ totalWatched: 3, subscriptions: 3 })
  })

  it('drops everything when the window is destroyed, and leaves other windows alone', async () => {
    const one = fakeContents(1)
    wireWatchOwner(one, fws)
    await subscribeAll(1)
    await subscribeAll(2)

    one.emit('destroyed')

    await vi.waitFor(() => expect(fws.getStats()).toMatchObject({ totalWatched: 3, subscriptions: 3 }))
    expect(fws.getStats().fileDetails.every(detail => detail.watchers === 1)).toBe(true)
  })
})

describe('wirePowerResume', () => {
  it('re-arms, runs one health round, then sends the check once (G8)', async () => {
    const order: string[] = []
    const monitor = new EventEmitter()
    const broadcast = vi.fn(() => {
      order.push('broadcast')
    })
    wirePowerResume(
      monitor,
      {
        rearmAll: async () => {
          order.push('rearm')
        },
        runHealthRound: async () => {
          order.push('health')
        },
        checkInProcessOwners: () => {
          order.push('owners')
        }
      },
      broadcast
    )

    monitor.emit('resume')

    await vi.waitFor(() => expect(order).toEqual(['rearm', 'health', 'broadcast', 'owners']))
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith({ reason: 'resume' })
  })

  it('still sends the check when the re-arm failed', async () => {
    const monitor = new EventEmitter()
    const broadcast = vi.fn()
    wirePowerResume(
      monitor,
      {
        rearmAll: async () => {
          throw new Error('EMFILE')
        },
        runHealthRound: vi.fn(async () => {}),
        checkInProcessOwners: vi.fn()
      },
      broadcast
    )

    monitor.emit('resume')

    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1))
  })
})
