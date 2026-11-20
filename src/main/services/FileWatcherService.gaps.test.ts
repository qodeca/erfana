// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Gap tests for #478 against `FileWatcherService` (plan step S0, T1).
 *
 * Written at S0 against the code of then, each stated the correct behaviour
 * inside an `expect(…).rejects` pinned to the symptom the gap showed. Plan
 * steps S9–S11 closed all four; each test is now the plain assertion of the
 * correct behaviour – that conversion is the T1 proof:
 *
 * | Gap | Closed by |
 * |-----|-----------|
 * | closing-watch race | an entry leaves the map before its watcher closes (S9, decision 19) |
 * | start between stop and commit | suspend + `endSuspended` by generation (S11, decision 18, N1) |
 * | L5 | a pause belongs to one subscription (S9, decision 16) |
 * | G2 (unit) | a pause ends by itself after `pauseMaxMs` (S9, decision 16) |
 *
 * Single-file watches are fake chokidar (one handler map per `watch` call, a
 * `close` the test can hold); `stat` and `realpath` answer "present". Fake
 * timers carry the write-finish gate. Module-scope mocks, hence a file of its
 * own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ id: number; channel: string; payload: Record<string, unknown> }>,
  fileWatchers: [] as Array<{
    path: string
    handlers: Map<string, (...args: unknown[]) => void>
    close: () => Promise<void>
  }>,
  /** When set, the next `close` waits for the test to call it. */
  holdClose: null as null | { release: () => void },
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('chokidar', () => {
  const watch = vi.fn((watchedPath: string) => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const close = vi.fn(async () => {
      const hold = harness.holdClose
      if (!hold) return
      harness.holdClose = null
      await new Promise<void>(resolve => {
        hold.release = resolve
      })
    })
    const watcher = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        handlers.set(event, listener)
        return watcher
      }),
      // Says `ready` at once: a subscribe answers after it (#478 G3)
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'ready') queueMicrotask(listener)
        return watcher
      }),
      close
    }
    harness.fileWatchers.push({ path: watchedPath, handlers, close })
    return watcher
  })
  return { default: { watch }, watch }
})

vi.mock('fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('fs/promises')>()
  return {
    ...real,
    stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false, size: 1, mtimeMs: 1 })),
    realpath: vi.fn(async (p: string) => p)
  }
})

vi.mock('electron', () => {
  const window = (id: number) => ({
    isDestroyed: () => false,
    webContents: {
      id,
      isDestroyed: () => false,
      send: (channel: string, payload: Record<string, unknown>) => {
        harness.sends.push({ id, channel, payload })
      }
    }
  })
  return {
    BrowserWindow: { getAllWindows: vi.fn(() => [window(1), window(2)]) },
    webContents: { getAllWebContents: vi.fn(() => []) }
  }
})

vi.mock('./LoggingService', () => ({ logger: harness.logger }))

import { FileWatcherService } from './FileWatcherService'
import { testSession, type TestSession } from './watcher/__test__/testSession'
import { WindowWatches } from './watcher/__test__/windowWatches'

const ROOT = path.resolve(path.sep, 'work', 'proj')
const FILE = path.join(ROOT, 'docs', 'open.md')
/** Past the write-finish gate (75 ms stable, polled every 25 ms). */
const DELIVERY_MS = 2_000
/** What the fake disk stamps every file with. */
const STAMP = { size: 1, mtimeMs: 1, ctimeMs: 1, ino: '1' }
/** Far past any pause a save could need (the pause limit is 10 s). */
const LONG_AFTER_MS = 60_000

let fws: FileWatcherService
let session: TestSession
let w: WindowWatches

/** Fires chokidar `change` on the newest watcher of `FILE` and lets the gate run. */
async function outsideChange(): Promise<void> {
  const latest = harness.fileWatchers.filter(w => w.path === FILE).at(-1)
  if (!latest) throw new Error('setup: no watcher was created for the file')
  latest.handlers.get('change')?.()
  await vi.advanceTimersByTimeAsync(DELIVERY_MS)
}

/** The `changed` events for the file, by window id, one per subscription. */
function changedTo(): number[] {
  return w.to(FILE, 'changed')
}

beforeEach(() => {
  vi.useFakeTimers()
  harness.sends.length = 0
  harness.fileWatchers.length = 0
  harness.holdClose = null
  session = testSession(ROOT)
  fws = new FileWatcherService({ session, stampFile: async () => STAMP })
  w = new WindowWatches(fws, harness.sends)
})

afterEach(async () => {
  harness.holdClose = null
  await fws.dispose()
  vi.useRealTimers()
})

describe('#478 gaps in FileWatcherService, closed', () => {
  it('control: the harness delivers an outside change to a plain watch', async () => {
    await w.started(FILE, 1)
    await outsideChange()
    expect(changedTo()).toEqual([1])
  })

  it('closing-watch race: a file reopened while its watch closes gets a watch of its own', async () => {
    await w.started(FILE, 1)
    const hold = { release: () => {} }
    harness.holdClose = hold

    // The last consumer leaves; its watch is closing (close held)…
    const closing = w.unwatch(FILE, 1)
    // …and the file is opened again in that moment
    await expect(w.watch(FILE, 2)).resolves.toMatchObject({ status: 'started' })
    hold.release()
    await closing

    expect(fws.getStats().totalWatched, 'the reopened file has a watch').toBe(1)
    await outsideChange()
    expect(changedTo()).toEqual([2])
  })

  it('start between suspend and commit: the subscription is ended, never left silently stale', async () => {
    const watchId = '5f0c2f0e-8f43-4c55-9d0a-3c7c1f8f2a11'
    // A project switch suspends every watch just before its commit, …
    await fws.suspendAll()
    // …a tab subscribes in that moment and is inserted suspended, …
    const reply = await fws.subscribe({
      owner: { kind: 'window', webContentsId: 1 },
      watchId,
      filePath: FILE,
      profile: 'editor'
    })
    expect(reply.status).toBe('started')
    // …then the commit (the same project again) ends everything of the old session
    await fws.endSuspended(session.switchTo(ROOT))

    expect(fws.getStats()).toMatchObject({ totalWatched: 0, subscriptions: 0 })
    expect(harness.sends.filter(s => s.channel === 'file-watch:event').map(s => s.payload)).toEqual([
      { watchId, kind: 'ended', reason: 'project-switch' }
    ])
  })

  it('L5: a pause by one consumer does not drop another consumer’s change', async () => {
    await w.started(FILE, 1)
    await w.started(FILE, 2)

    // Window one saves the file: it pauses its own watch around its own write
    w.pause(FILE, 1)
    await outsideChange()

    expect(changedTo(), 'the other window hears the change').toEqual([2])
  })

  it('G2: a pause never released by a dropped page ends by itself', async () => {
    const paused = await w.started(FILE, 1)
    // A save paused the watch; the page reloaded before its resume was sent
    w.pause(FILE, 1)
    // The reloaded page (same webContents) subscribes again and joins the watch
    await w.started(FILE, 1)
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS)

    await outsideChange()

    // Both subscriptions hear it – the paused one too, once its pause ran out
    expect(changedTo(), 'the file is heard again after the reload').toEqual([1, 1])
    expect(w.events().some(e => e.watchId === paused && e.kind === 'changed')).toBe(true)
  })
})
