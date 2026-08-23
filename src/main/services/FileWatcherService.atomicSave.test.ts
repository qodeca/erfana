// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Atomic-save re-arm (issue #70, defect D2).
 *
 * chokidar and `fs/promises.stat` are mocked at module scope, so this file is
 * kept separate from `FileWatcherService.test.ts` per the project's test-file
 * split policy.
 *
 * What this file can and cannot prove: it verifies "given an unlink and a file
 * that is back on disk, the watch is re-armed and the change is debounced". It
 * CANNOT verify that chokidar v3 actually emits `unlink` for `mv tmp target` -
 * that premise is pinned by the real-chokidar test in
 * `watcher/singleFileWatch.rename.integration.test.ts` (finding M-7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileWatcherService } from './FileWatcherService'
import { WATCH_DEAD_OUTSIDE_PROJECT, WATCH_DEAD_SESSION_ENDED } from './watcher/atomicRearm'

const PROJECT = '/proj'
const FILE = '/proj/icon.svg'
const DETECTOR_WINDOW_MS = 100
const DEBOUNCE_MS = 300

interface FakeWatcher {
  path: string
  handlers: Record<string, (arg?: unknown) => void>
  close: ReturnType<typeof vi.fn>
  on: (event: string, handler: (arg?: unknown) => void) => FakeWatcher
}

const { sends, filesOnDisk, canonicalPaths, createdWatchers, watchHooks } = vi.hoisted(() => ({
  sends: [] as Array<{ id: number; channel: string; payload: Record<string, unknown> }>,
  filesOnDisk: new Set<string>(),
  /** Path -> what `realpath` resolves it to, i.e. the fixture's symlinks. */
  canonicalPaths: new Map<string, string>(),
  createdWatchers: [] as FakeWatcher[],
  watchHooks: { onCreate: null as ((watcher: FakeWatcher) => void) | null }
}))

vi.mock('electron', () => {
  const mkWin = (id: number) => ({
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel: string, payload: Record<string, unknown>) =>
        sends.push({ id, channel, payload })
    }
  })
  return { BrowserWindow: { getAllWindows: vi.fn(() => [mkWin(1), mkWin(2)]) } }
})

vi.mock('chokidar', () => ({
  default: {
    watch: (path: string): FakeWatcher => {
      const watcher = {
        path,
        handlers: {} as Record<string, (arg?: unknown) => void>,
        close: vi.fn(async () => {})
      } as FakeWatcher
      watcher.on = (event, handler) => {
        watcher.handlers[event] = handler
        return watcher
      }
      createdWatchers.push(watcher)
      watchHooks.onCreate?.(watcher)
      return watcher
    }
  }
}))

// Only paths under the fake project are controlled by `filesOnDisk`; everything
// else (log rotation, for instance) keeps the real implementation.
//
// `realpath` is mocked alongside `stat` because the re-arm re-checks project
// confinement before binding a new watcher: leaving it real would send the
// branch to the actual filesystem for a path that only exists in this map.
vi.mock('fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  const missing = (key: string): Error =>
    Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' })
  const isFake = (key: string): boolean => key === PROJECT || key.startsWith(`${PROJECT}/`)
  return {
    ...actual,
    stat: async (target: unknown, ...rest: unknown[]) => {
      const key = String(target)
      if (!key.startsWith(`${PROJECT}/`)) {
        return (actual.stat as (...args: unknown[]) => Promise<unknown>)(target, ...rest)
      }
      if (!filesOnDisk.has(key)) {
        throw missing(key)
      }
      return { size: 42, isFile: () => true }
    },
    realpath: async (target: unknown, ...rest: unknown[]) => {
      const key = String(target)
      if (!isFake(key)) {
        return (actual.realpath as (...args: unknown[]) => Promise<unknown>)(target, ...rest)
      }
      // The fake project root always resolves; its files follow `filesOnDisk`
      // and canonicalise to themselves unless a fixture made one a symlink.
      if (key !== PROJECT && !filesOnDisk.has(key)) {
        throw missing(key)
      }
      return canonicalPaths.get(key) ?? key
    }
  }
})

let service: FileWatcherService

let internals: any

/** Start a watch for `filePath` on behalf of one webContents. */
async function startWatch(filePath = FILE, webContentsId = 1): Promise<FakeWatcher> {
  filesOnDisk.add(filePath)
  await service.watchFile(filePath, { id: webContentsId } as never)
  return createdWatchers[createdWatchers.length - 1]
}

/** Let the atomic-save window close and the re-arm settle. */
async function closeDetectorWindow(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DETECTOR_WINDOW_MS + 20)
}

/** Let a debounced change reach the renderer. */
async function flushDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 20)
}

const channels = (): string[] => sends.map(s => s.channel)

beforeEach(() => {
  vi.useFakeTimers()
  sends.length = 0
  createdWatchers.length = 0
  filesOnDisk.clear()
  canonicalPaths.clear()
  watchHooks.onCreate = null
  service = new FileWatcherService()
  internals = service
  service.setProjectPath(PROJECT)
})

afterEach(async () => {
  watchHooks.onCreate = null
  await service.dispose()
  vi.useRealTimers()
})

describe('FileWatcherService atomic save re-arm', () => {
  it('re-arms the watch when the file is back on disk', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await closeDetectorWindow()

    // A chokidar single-file watch is bound to the inode it opened, so the
    // stale watcher must be replaced, not reused.
    expect(createdWatchers).toHaveLength(2)
    expect(first.close).toHaveBeenCalled()
    expect(internals.watchedFiles.has(FILE)).toBe(true)
  })

  it('emits the change through the debounced path, not immediately', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await closeDetectorWindow()

    // H-1: a direct notify here would tell the editor to reload a file that may
    // still be half written.
    expect(sends).toHaveLength(0)

    await flushDebounce()

    expect(sends).toEqual([{ id: 1, channel: 'file-watch:changed', payload: { filePath: FILE } }])
  })

  it('never reports a delete for an atomic save', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    expect(channels()).not.toContain('file-watch:deleted')
  })

  it('keeps subscribers and map size across the re-arm', async () => {
    filesOnDisk.add(FILE)
    await service.watchFile(FILE, { id: 1 } as never)
    await service.watchFile(FILE, { id: 2 } as never)
    const first = createdWatchers[0]

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()
    sends.length = 0

    // A change on the NEW watcher still reaches both original subscribers
    createdWatchers[1].handlers.change()
    await flushDebounce()

    expect(sends.map(s => s.id).sort()).toEqual([1, 2])
    // The re-arm mutates in place, so it can never grow the map towards
    // MAX_WATCHED_FILES
    expect(internals.watchedFiles.size).toBe(1)
    expect(internals.watchedFiles.get(FILE).subscribers.size).toBe(2)
  })

  it('stays silent after a re-arm while the watch is paused', async () => {
    const first = await startWatch()
    service.pauseWatch(FILE)

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    // Erfana's own save pauses the watch; a re-arm must not punch through it
    expect(sends).toHaveLength(0)
    expect(internals.watchedFiles.has(FILE)).toBe(true)
  })

  it('re-arms when a slow rename lands after the detector gave up', async () => {
    // H-4a: the detector reports "gone", but the replacement arrives before the
    // callback runs. A false deleted banner over a file that exists is worse
    // than a late refresh.
    const first = await startWatch()
    filesOnDisk.delete(FILE)

    first.handlers.unlink()
    const restore = vi.advanceTimersByTimeAsync(DETECTOR_WINDOW_MS + 20)
    filesOnDisk.add(FILE)
    await restore
    await flushDebounce()

    expect(channels()).toEqual(['file-watch:changed'])
    expect(createdWatchers).toHaveLength(2)
  })
})

describe('FileWatcherService genuine delete', () => {
  it('reports the delete and tears the watch down', async () => {
    const first = await startWatch()
    filesOnDisk.delete(FILE)

    first.handlers.unlink()
    await closeDetectorWindow()

    expect(sends).toEqual([{ id: 1, channel: 'file-watch:deleted', payload: { filePath: FILE } }])
    expect(first.close).toHaveBeenCalled()
    expect(internals.watchedFiles.has(FILE)).toBe(false)
    // No replacement watcher for a file that is really gone
    expect(createdWatchers).toHaveLength(1)
  })

  it('leaves no pending detector work behind', async () => {
    const first = await startWatch()
    filesOnDisk.delete(FILE)

    first.handlers.unlink()
    await closeDetectorWindow()

    expect(internals.atomicSaveDetector.getPendingCount()).toBe(0)
  })
})

describe('FileWatcherService re-arm bail-outs', () => {
  it('tells the renderer the watch is dead when the session moved on', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    // Project switch inside the 100 ms window
    service.setProjectPath('/other')
    await closeDetectorWindow()
    await flushDebounce()

    // H-4b: silently dropping the entry would leave the panel showing stale
    // content with no indicator - the symptom #70 fixes.
    expect(sends).toEqual([
      {
        id: 1,
        channel: 'file-watch:error',
        payload: { filePath: FILE, error: WATCH_DEAD_SESSION_ENDED }
      }
    ])
    expect(internals.watchedFiles.has(FILE)).toBe(false)
  })

  it('sends nothing once the service is disposing', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.dispose()
    await closeDetectorWindow()
    await flushDebounce()

    expect(sends).toHaveLength(0)
  })

  it('drops the entry when the file vanishes between the check and the watch', async () => {
    // L-3 TOCTOU: without the post-create stat the entry would hold a
    // MAX_WATCHED_FILES slot forever, watching nothing.
    const first = await startWatch()
    watchHooks.onCreate = () => {
      filesOnDisk.delete(FILE)
    }

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    expect(channels()).toEqual(['file-watch:deleted'])
    expect(internals.watchedFiles.has(FILE)).toBe(false)
    expect(createdWatchers[1].close).toHaveBeenCalled()
  })
})

describe('FileWatcherService re-arm confinement', () => {
  it('kills the watch when the replacement resolves outside the project', async () => {
    // The unlink/re-arm window is the moment an outside writer can swap the
    // file for a symlink pointing out of the project; the re-arm re-checks with
    // realpath rather than trusting `watchFile`'s lexical entry check.
    const first = await startWatch()
    canonicalPaths.set(FILE, '/elsewhere/secret.txt')

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    expect(sends).toEqual([
      {
        id: 1,
        channel: 'file-watch:error',
        payload: { filePath: FILE, error: WATCH_DEAD_OUTSIDE_PROJECT }
      }
    ])
    expect(internals.watchedFiles.has(FILE)).toBe(false)
    // No watcher is ever bound to the escaped path
    expect(createdWatchers).toHaveLength(1)
  })
})

describe('FileWatcherService pending-delete fast path', () => {
  it('re-arms when a second consumer joins during the atomic window', async () => {
    // L-2: joining the existing entry would bind the new subscriber to the dead
    // inode, so it would never hear a change.
    const first = await startWatch()

    first.handlers.unlink()
    expect(internals.atomicSaveDetector.getPendingCount()).toBe(1)

    await service.watchFile(FILE, { id: 2 } as never)

    expect(internals.atomicSaveDetector.getPendingCount()).toBe(0)
    expect(createdWatchers).toHaveLength(2)
    expect(first.close).toHaveBeenCalled()
    expect(internals.watchedFiles.get(FILE).subscribers.size).toBe(2)

    await flushDebounce()
    expect(sends.map(s => s.channel)).toEqual(['file-watch:changed', 'file-watch:changed'])
  })

  it('fails the join when the re-arm dropped the watch instead of reviving it', async () => {
    // LOW-3: the subscriber is added before the re-arm is awaited. Returning
    // success after the entry was dropped would leave the renderer believing it
    // watches a path that has no watcher at all.
    const first = await startWatch()

    first.handlers.unlink()
    // The file disappears again while the replacement watcher is being created
    watchHooks.onCreate = () => {
      filesOnDisk.delete(FILE)
    }

    await expect(service.watchFile(FILE, { id: 2 } as never)).rejects.toThrow(
      'File watch ended while joining'
    )

    expect(internals.watchedFiles.has(FILE)).toBe(false)
    expect(channels()).toContain('file-watch:deleted')
  })
})

describe('FileWatcherService detector disposal', () => {
  it('cancels the pending check when the last subscriber unwatches', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.unwatchFile(FILE, { id: 1 } as never)

    expect(internals.atomicSaveDetector.getPendingCount()).toBe(0)
    await closeDetectorWindow()
    expect(sends).toHaveLength(0)
  })

  it('cancels the pending check when a webContents is destroyed', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.cleanupForWebContentsId(1)

    expect(internals.atomicSaveDetector.getPendingCount()).toBe(0)
    await closeDetectorWindow()
    expect(sends).toHaveLength(0)
  })

  it('cancels the pending check on stopAll', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.stopAll()

    expect(internals.atomicSaveDetector.getPendingCount()).toBe(0)
    await closeDetectorWindow()
    expect(sends).toHaveLength(0)
  })

  it('disposes the detector with the service', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.dispose()

    expect(internals.atomicSaveDetector.getPendingCount()).toBe(0)
    // The detector is disposed for good, so late unlinks register nothing
    internals.atomicSaveDetector.registerDelete(FILE, () => {})
    expect(internals.atomicSaveDetector.getPendingCount()).toBe(0)
  })
})
