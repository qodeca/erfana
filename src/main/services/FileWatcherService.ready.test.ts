// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A subscribe answers after the watcher is ready, and only if its page and
 * project are still the ones it began in (#478, plan decisions 14, 15, N1,
 * F12, F45, G3). The fake watcher's `ready` is held by the test. Fake
 * chokidar, Electron and disk; module-scope mocks, hence a file of its own.
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
import { FAKE_STAMP, fakeLayer, resetFakeWatchLayer, watcherOn } from './watcher/__test__/fakeWatchLayer'
import type { WatchEvent } from '../../shared/freshness/freshnessTypes'
import type { SubscribeReply } from '../../shared/freshness/freshnessTypes'
import type { WatchOwner } from './watcher/watchTypes'
import { FRESHNESS_LIMITS } from '../../shared/freshness/timingProfiles'

const ROOT = path.resolve(path.sep, 'proj')
const FILE = path.join(ROOT, 'a.md')
const ID = '33333333-3333-4333-8333-333333333333'
const windowOne: WatchOwner = { kind: 'window', webContentsId: 1 }

let fws: FileWatcherService
let session: TestSession

/** Start a subscribe and wait until its watcher exists (its `ready` held). */
async function subscribeHeld(owner: WatchOwner): Promise<{ reply: Promise<SubscribeReply> }> {
  const reply = fws.subscribe({ owner, watchId: ID, filePath: FILE, profile: 'editor' })
  await vi.waitFor(() => expect(watcherOn(FILE)).toBeDefined())
  return { reply }
}

beforeEach(() => {
  resetFakeWatchLayer()
  fakeLayer.autoReady = false
  fakeLayer.disk.set(FILE, { ino: 1 })
  session = testSession(ROOT)
  fws = new FileWatcherService({ session, stampFile: async () => FAKE_STAMP })
})

afterEach(async () => {
  vi.useRealTimers()
  await fws.dispose()
})

describe('FileWatcherService ready-gated subscribe (#478 S10)', () => {
  it('answers only once the watcher is ready', async () => {
    let answered = false
    const reply = (await subscribeHeld(windowOne)).reply.then(r => {
      answered = true
      return r
    })
    await Promise.resolve()
    expect(answered).toBe(false)

    watcherOn(FILE)?.ready()

    await expect(reply).resolves.toEqual({ status: 'started', stamp: FAKE_STAMP, liveRefresh: 'full' })
  })

  it('answers limited when ready does not come within the timeout (F45)', async () => {
    vi.useFakeTimers()
    const reply = fws.subscribe({ owner: windowOne, watchId: ID, filePath: FILE, profile: 'editor' })
    await vi.advanceTimersByTimeAsync(FRESHNESS_LIMITS.readyTimeoutMs + 1)

    await expect(reply).resolves.toEqual({ status: 'started', stamp: FAKE_STAMP, liveRefresh: 'limited' })
  })

  it('refuses a subscribe whose page navigated while it waited, and leaves no watch (G2)', async () => {
    const { reply } = await subscribeHeld(windowOne)

    await fws.pageNavigated(1)
    watcherOn(FILE)?.ready()

    await expect(reply).resolves.toEqual({ status: 'refused', code: 'PAGE_CHANGED' })
    expect(fws.getStats()).toMatchObject({ totalWatched: 0, subscriptions: 0 })
    expect(watcherOn(FILE)?.close).toHaveBeenCalledTimes(1)
  })

  it('refuses a window’s subscribe that a project commit overtook, and closes its watcher (N1)', async () => {
    const { reply } = await subscribeHeld(windowOne)

    session.switchTo(ROOT)
    watcherOn(FILE)?.ready()

    await expect(reply).resolves.toEqual({ status: 'refused', code: 'PROJECT_CHANGED' })
    expect(fws.getStats().totalWatched).toBe(0)
    expect(watcherOn(FILE)?.close).toHaveBeenCalledTimes(1)
  })

  it('refuses an in-process owner’s subscribe that a project commit overtook (N1, F12)', async () => {
    const events: WatchEvent[] = []
    const preview: WatchOwner = { kind: 'process', ownerId: 'preview-1', onEvent: e => events.push(e) }
    const { reply } = await subscribeHeld(preview)

    session.switchTo(ROOT)
    watcherOn(FILE)?.ready()

    await expect(reply).resolves.toEqual({ status: 'refused', code: 'PROJECT_CHANGED' })
    expect(fws.getStats().totalWatched).toBe(0)
    expect(watcherOn(FILE)?.close).toHaveBeenCalledTimes(1)
    expect(events).toEqual([])
  })

  it('hands a change that lands before the answer to the subscriber, for its catch-up (decision 6)', async () => {
    const events: WatchEvent[] = []
    const preview: WatchOwner = { kind: 'process', ownerId: 'preview-1', onEvent: e => events.push(e) }
    vi.useFakeTimers()
    const reply = fws.subscribe({ owner: preview, watchId: ID, filePath: FILE, profile: 'preview' })
    await vi.advanceTimersByTimeAsync(0)

    watcherOn(FILE)?.fire('change')
    await vi.advanceTimersByTimeAsync(500)
    watcherOn(FILE)?.ready()

    await expect(reply).resolves.toMatchObject({ status: 'started', liveRefresh: 'full' })
    expect(events).toEqual([{ watchId: ID, kind: 'changed' }])
  })
})
