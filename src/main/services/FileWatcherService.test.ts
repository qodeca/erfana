// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileWatcherService with window subscriptions: window cleanup (issue #59),
 * several consumers of one file (issue #70, D3), the watch cap (issue #70,
 * arch H1; #478 G9) and the project-switch guard. Each subscription has its
 * own `watchId` (#478, plan S9) and hears its own events.
 *
 * chokidar, `fs/promises` and Electron are fake at module scope (every path
 * below the fake project answers "a file"), hence a file of its own.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ id: number; channel: string; payload: Record<string, unknown> }>,
  watchers: [] as Array<{
    path: string
    handlers: Map<string, (...args: unknown[]) => void>
    close: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('chokidar', () => {
  const watch = vi.fn((watchedPath: string) => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const close = vi.fn(async () => {})
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
    harness.watchers.push({ path: watchedPath, handlers, close })
    return watcher
  })
  return { default: { watch }, watch }
})

vi.mock('fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('fs/promises')>()
  return {
    ...real,
    stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false, size: 1 })),
    realpath: vi.fn(async (p: string) => p)
  }
})

vi.mock('electron', () => {
  const mkWin = (id: number) => ({
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel: string, payload: Record<string, unknown>) => harness.sends.push({ id, channel, payload })
    }
  })
  return { BrowserWindow: { getAllWindows: vi.fn(() => [mkWin(1), mkWin(2)]) } }
})

import { FileWatcherService } from './FileWatcherService'
import { testSession, type TestSession } from './watcher/__test__/testSession'
import { WindowWatches } from './watcher/__test__/windowWatches'
import { WATCH_BUCKETS } from '../../shared/freshness/timingProfiles'

const ROOT = path.resolve(path.sep, 'proj')
const at = (name: string): string => path.join(ROOT, name)
/** Past the write-finish gate. */
const DELIVERY_MS = 1_000

let svc: FileWatcherService
let session: TestSession
let w: WindowWatches
const STAMP = { size: 1, mtimeMs: 1, ctimeMs: 1, ino: '1' }

/** Fire chokidar `change` on the newest watcher of `filePath` and let the gate run. */
async function change(filePath: string): Promise<void> {
  const watcher = harness.watchers.filter(w => w.path === filePath).at(-1)
  if (!watcher) throw new Error(`setup: no watcher for ${filePath}`)
  watcher.handlers.get('change')?.()
  await vi.advanceTimersByTimeAsync(DELIVERY_MS)
}

const changedTo = (filePath: string): number[] => w.to(filePath, 'changed')

const watcherOf = (filePath: string) => harness.watchers.filter(w => w.path === filePath).at(-1)

beforeEach(() => {
  vi.useFakeTimers()
  harness.sends.length = 0
  harness.watchers.length = 0
  session = testSession(ROOT)
  svc = new FileWatcherService({ session, stampFile: async () => STAMP })
  w = new WindowWatches(svc, harness.sends)
})

afterEach(async () => {
  await svc.dispose()
  vi.useRealTimers()
})

describe('FileWatcherService project-switch guard', () => {
  it('drops the events of a watch the project switch ended', async () => {
    const file = at('readme.md')
    await w.watch(file, 1)
    const oldWatcher = watcherOf(file)

    await svc.suspendAll()
    await svc.endSuspended(session.switchTo(ROOT))
    oldWatcher?.handlers.get('change')?.()
    await vi.advanceTimersByTimeAsync(DELIVERY_MS)

    // The window is told its watch ended with the project, and nothing else
    expect(w.kinds()).toEqual(['ended'])
    expect(w.events()[0]).toMatchObject({ window: 1, reason: 'project-switch' })
    expect(svc.getStats().totalWatched).toBe(0)
  })
})

describe('FileWatcherService Issue #59 - WebContents Cleanup', () => {
  it('cleanupForWebContentsId removes that window from a watch another window holds', async () => {
    const file = at('file.md')
    await w.watch(file, 1)
    await w.watch(file, 2)

    await svc.cleanupForWebContentsId(1)

    expect(svc.getStats().fileDetails).toEqual([{ path: file, watchers: 1 }])
    await change(file)
    expect(changedTo(file)).toEqual([2])
  })

  it('cleanupForWebContentsId closes watchers with no remaining window', async () => {
    const file = at('file.md')
    await w.watch(file, 1)

    await svc.cleanupForWebContentsId(1)

    expect(watcherOf(file)?.close).toHaveBeenCalledTimes(1)
    expect(svc.getStats().totalWatched).toBe(0)
  })

  it('cleanupForWebContentsId handles multiple files', async () => {
    await w.watch(at('file1.md'), 1)
    await w.watch(at('file2.md'), 1)

    await svc.cleanupForWebContentsId(1)

    expect(svc.getStats().totalWatched).toBe(0)
    expect(harness.watchers.every(w => w.close.mock.calls.length === 1)).toBe(true)
  })

  it('cleanupForWebContentsId does not affect other windows', async () => {
    const file = at('file.md')
    await w.watch(file, 1)

    await svc.cleanupForWebContentsId(2)

    expect(svc.getStats().fileDetails).toEqual([{ path: file, watchers: 1 }])
    expect(watcherOf(file)?.close).not.toHaveBeenCalled()
  })

  it('cleanupForWebContentsId handles double cleanup gracefully', async () => {
    await w.watch(at('file.md'), 1)
    await svc.cleanupForWebContentsId(1)
    expect(svc.getStats().totalWatched).toBe(0)

    await expect(svc.cleanupForWebContentsId(1)).resolves.not.toThrow()
  })
})

describe('FileWatcherService subscriber counting (issue #70, D3)', () => {
  it('keeps the watch alive when one of two consumers in the same window unsubscribes', async () => {
    // Two panels in ONE window watching one path: an image viewer and the
    // Markdown editor. The first teardown must not close the watcher under the second.
    const file = at('icon.svg')
    await w.watch(file, 1)
    await w.watch(file, 1)

    await w.unwatch(file, 1)

    expect(watcherOf(file)?.close).not.toHaveBeenCalled()
    expect(svc.getStats().totalWatched).toBe(1)
    // The surviving consumer still receives events: one subscription, one event
    await change(file)
    expect(changedTo(file)).toEqual([1])
  })

  it('closes the watch when the last consumer in the window unsubscribes', async () => {
    const file = at('icon.svg')
    await w.watch(file, 1)
    await w.watch(file, 1)

    await w.unwatch(file, 1)
    await w.unwatch(file, 1)

    expect(watcherOf(file)?.close).toHaveBeenCalledTimes(1)
    expect(svc.getStats().totalWatched).toBe(0)
  })

  it('destroying a webContents drops all its subscriptions at once', async () => {
    const file = at('icon.svg')
    for (let i = 0; i < 3; i++) await w.watch(file, 1)

    await svc.cleanupForWebContentsId(1)

    expect(watcherOf(file)?.close).toHaveBeenCalled()
    expect(svc.getStats().totalWatched).toBe(0)
  })

  it('reports one watcher per window in getStats, not one per subscription', async () => {
    const file = at('icon.svg')
    await w.watch(file, 1)
    await w.watch(file, 1)
    await w.watch(file, 2)

    expect(svc.getStats()).toMatchObject({
      totalWatched: 1,
      fileDetails: [{ path: file, watchers: 2 }],
      subscriptions: 3
    })
  })
})

describe('FileWatcherService watch cap (issue #70, arch H1; #478 G9)', () => {
  it('lets a second consumer join a watched path with the bucket at capacity', async () => {
    svc.setBucketCap('tabs', 1)
    const file = at('icon.svg')
    await w.watch(file, 1)

    // A second panel in the SAME window joins the existing watch: refusing it
    // would leave it watching nothing while its unmount still released
    await expect(w.watch(file, 1)).resolves.toMatchObject({ status: 'started' })
    await w.unwatch(file, 1)

    expect(watcherOf(file)?.close).not.toHaveBeenCalled()
    expect(svc.getStats().totalWatched).toBe(1)
  })

  it('queues a new file past the cap and arms it when a slot frees', async () => {
    svc.setBucketCap('tabs', 1)
    const first = at('first.md')
    const queued = at('queued.md')
    await w.watch(first, 1)

    await expect(w.watch(queued, 1)).resolves.toMatchObject({ status: 'queued' })
    expect(svc.getStats()).toMatchObject({ totalWatched: 1, waiting: 1 })

    await w.unwatch(first, 1)
    await vi.advanceTimersByTimeAsync(0)

    expect(svc.getStats()).toMatchObject({ totalWatched: 1, waiting: 0 })
    // The armed subscription is told `started`, so it catches up with what it missed while queued
    expect(w.to(queued, 'started')).toEqual([1])
    await change(queued)
    expect(changedTo(queued)).toEqual([1])
  })

  it('refuses a new file once the cap and its waitlist are full', async () => {
    svc.setBucketCap('tabs', 1)
    await w.watch(at('first.md'), 1)
    for (let i = 0; i < 200; i++) await w.watch(at(`queued-${i}.md`), 1)

    await expect(w.watch(at('one-too-many.md'), 1)).resolves.toMatchObject({ status: 'refused', code: 'WATCH_FAILED' })
    expect(WATCH_BUCKETS.tabs.totalCap).toBe(100)
  })
})
