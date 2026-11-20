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
 * that is back on disk, the watch is re-armed and the change is reported". It
 * CANNOT verify that chokidar actually emits `unlink` for `mv tmp target` -
 * that premise is pinned by the real-chokidar test in
 * `watcher/singleFileWatch.rename.integration.test.ts` (finding M-7).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { FileWatcherService } from './FileWatcherService'
import { UNREADABLE_RECHECK_MS } from './watcher/pathPresence'
import { testSession, type TestSession } from './watcher/__test__/testSession'
import { WindowWatches } from './watcher/__test__/windowWatches'
import { pathKey } from '../utils/pathCompare'

const DETECTOR_WINDOW_MS = 100
/** Time for a change already decided to reach the renderer (main no longer debounces, #478). */
const DELIVER_MS = 300
/** The single-file watch's stability threshold plus one poll. */
const WRITE_SETTLE_MS = 400
const STAMP = { size: 42, mtimeMs: 1, ctimeMs: 1, ino: '1' }

interface FakeWatcher {
  path: string
  handlers: Record<string, (arg?: unknown) => void>
  close: Mock
  on: (event: string, handler: (arg?: unknown) => void) => FakeWatcher
  once: (event: string, handler: () => void) => FakeWatcher
}

/**
 * Fixture paths are built for the host platform rather than hard-coded POSIX.
 *
 * The re-arm re-checks project confinement, and `classifyConfinement` compares
 * `path.resolve`d paths. `path.resolve('/proj')` is `/proj` on macOS but
 * `<drive>:\proj` on Windows, so a POSIX literal makes the `realpath` calls miss
 * the mock below and reach the real filesystem: the `canonicalPaths` symlink
 * fixture is bypassed, and real fs I/O is not guaranteed to settle inside
 * `vi.advanceTimersByTimeAsync`, so the re-arm is still pending when the
 * assertions run. Every fixture path therefore lives under one fake root in the
 * host's own absolute form, which `path.resolve` returns unchanged on both
 * platforms - and which the mock can recognise, so no fixture path ever reaches
 * the real filesystem.
 */
const {
  PROJECT,
  OTHER_PROJECT,
  FILE,
  OUTSIDE_TARGET,
  isFixturePath,
  isFixtureDir,
  sends,
  filesOnDisk,
  failingPaths,
  canonicalPaths,
  createdWatchers,
  watchHooks
} = vi.hoisted(() => {
  const isWindows = process.platform === 'win32'
  const sep = isWindows ? '\\' : '/'
  /** `/a/b` -> `/a/b` on POSIX, `C:\a\b` on Windows. Both are resolve-stable. */
  const native = (posixPath: string): string =>
    isWindows ? `C:${posixPath.split('/').join(sep)}` : posixPath

  const FIXTURE_ROOT = native('/erfana-watch-fixture')
  const PROJECT = native('/erfana-watch-fixture/proj')
  const OTHER_PROJECT = native('/erfana-watch-fixture/other')

  return {
    PROJECT,
    OTHER_PROJECT,
    FILE: native('/erfana-watch-fixture/proj/icon.svg'),
    /** Where the confinement fixture's symlink points, outside the project. */
    OUTSIDE_TARGET: native('/erfana-watch-fixture/elsewhere/secret.txt'),
    /** Is this a path the fixture owns, i.e. one the fs mock must answer? */
    isFixturePath: (key: string): boolean =>
      key === FIXTURE_ROOT || key.startsWith(FIXTURE_ROOT + sep),
    /** Directories the fixture pretends exist; files follow `filesOnDisk`. */
    isFixtureDir: (key: string): boolean =>
      key === FIXTURE_ROOT || key === PROJECT || key === OTHER_PROJECT,
    sends: [] as Array<{ id: number; channel: string; payload: Record<string, unknown> }>,
    filesOnDisk: new Set<string>(),
    /** Path -> the errno code `stat` fails with for it, whatever `filesOnDisk` says. */
    failingPaths: new Map<string, string>(),
    /** Path -> what `realpath` resolves it to, i.e. the fixture's symlinks. */
    canonicalPaths: new Map<string, string>(),
    createdWatchers: [] as FakeWatcher[],
    watchHooks: { onCreate: null as ((watcher: FakeWatcher) => void) | null }
  }
})

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
      // chokidar says `ready` on a later tick
      watcher.once = (event, handler) => {
        if (event === 'ready') queueMicrotask(handler)
        return watcher
      }
      createdWatchers.push(watcher)
      watchHooks.onCreate?.(watcher)
      return watcher
    }
  }
}))

// Only fixture paths are controlled by `filesOnDisk`; everything else (log
// rotation, for instance) keeps the real implementation.
//
// `realpath` is mocked alongside `stat` because the re-arm re-checks project
// confinement before binding a new watcher: leaving it real would send the
// branch to the actual filesystem for a path that only exists in this map.
vi.mock('fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  const missing = (key: string): Error =>
    Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' })
  return {
    ...actual,
    stat: async (target: unknown, ...rest: unknown[]) => {
      const key = String(target)
      if (!isFixturePath(key)) {
        return (actual.stat as (...args: unknown[]) => Promise<unknown>)(target, ...rest)
      }
      const failure = failingPaths.get(key)
      if (failure) {
        throw Object.assign(new Error(`${failure}: ${key}`), { code: failure })
      }
      if (!filesOnDisk.has(key)) {
        throw missing(key)
      }
      return { size: 42, isFile: () => true }
    },
    realpath: async (target: unknown, ...rest: unknown[]) => {
      const key = String(target)
      if (!isFixturePath(key)) {
        return (actual.realpath as (...args: unknown[]) => Promise<unknown>)(target, ...rest)
      }
      // Fixture directories always resolve; files follow `filesOnDisk` and
      // canonicalise to themselves unless a fixture made one a symlink.
      if (!isFixtureDir(key) && !filesOnDisk.has(key)) {
        throw missing(key)
      }
      return canonicalPaths.get(key) ?? key
    }
  }
})

let service: FileWatcherService
let session: TestSession
let w: WindowWatches

/** The entry the service holds for `FILE`, if any. */
const held = () => service.entries.get(pathKey(FILE, true))
/** Windows subscribed to `FILE`. */
const windowsOn = (): number => service.getStats().fileDetails[0]?.watchers ?? 0

/** Start a watch for `filePath` on behalf of one webContents. */
async function startWatch(filePath = FILE, webContentsId = 1): Promise<FakeWatcher> {
  filesOnDisk.add(filePath)
  await w.watch(filePath, webContentsId)
  return createdWatchers[createdWatchers.length - 1]
}

/** Let the atomic-save window close and the re-arm settle. */
async function closeDetectorWindow(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DETECTOR_WINDOW_MS + 20)
}

/** Let a change already decided reach the renderer. */
async function flushDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DELIVER_MS + 20)
}

/** Let a raw chokidar change reach the renderer: the write-finish gate's settle (#464). */
async function flushChange(): Promise<void> {
  await vi.advanceTimersByTimeAsync(WRITE_SETTLE_MS + 20)
}

/** The event kinds sent so far, in order. */
const kinds = (): string[] => w.kinds()

const HOST_PLATFORM = process.platform

/** Play Windows, where an EPERM just after an unlink earns a second look (#252). */
function playWindows(): void {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  sends.length = 0
  createdWatchers.length = 0
  filesOnDisk.clear()
  failingPaths.clear()
  canonicalPaths.clear()
  watchHooks.onCreate = null
  session = testSession(PROJECT)
  service = new FileWatcherService({ session, stampFile: async () => STAMP })
  w = new WindowWatches(service, sends)
})

afterEach(async () => {
  watchHooks.onCreate = null
  await service.dispose()
  Object.defineProperty(process, 'platform', { value: HOST_PLATFORM, configurable: true })
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
    expect(held()).toBeDefined()
  })

  it('reports the re-armed file once, as a change', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    expect(w.events()).toEqual([expect.objectContaining({ window: 1, filePath: FILE, kind: 'changed' })])
  })

  it('never reports a delete for an atomic save', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    expect(kinds()).not.toContain('deleted')
  })

  it('keeps subscribers and map size across the re-arm', async () => {
    filesOnDisk.add(FILE)
    await w.watch(FILE, 1)
    await w.watch(FILE, 2)
    const first = createdWatchers[0]

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()
    sends.length = 0

    // A change on the NEW watcher still reaches both original subscribers
    createdWatchers[1].handlers.change()
    await flushChange()

    expect(sends.map(s => s.id).sort()).toEqual([1, 2])
    // The re-arm mutates in place, so it can never grow the bucket towards its cap
    expect(service.entries.size).toBe(1)
    expect(windowsOn()).toBe(2)
  })

  it('stays silent after a re-arm while the watch is paused', async () => {
    const first = await startWatch()
    w.pause(FILE, 1)

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    // Erfana's own save pauses the watch; a re-arm must not punch through it
    expect(sends).toHaveLength(0)
    expect(held()).toBeDefined()
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

    expect(kinds()).toEqual(['changed'])
    expect(createdWatchers).toHaveLength(2)
  })
})

describe('FileWatcherService genuine delete', () => {
  it('reports the delete and tears the watch down', async () => {
    const first = await startWatch()
    filesOnDisk.delete(FILE)

    first.handlers.unlink()
    await closeDetectorWindow()

    expect(w.events()).toEqual([expect.objectContaining({ window: 1, filePath: FILE, kind: 'deleted' })])
    expect(first.close).toHaveBeenCalled()
    expect(held()).toBeUndefined()
    // No replacement watcher for a file that is really gone
    expect(createdWatchers).toHaveLength(1)
  })

  it('leaves no pending detector work behind', async () => {
    const first = await startWatch()
    filesOnDisk.delete(FILE)

    first.handlers.unlink()
    await closeDetectorWindow()

    expect(service.atomicSaveDetector.getPendingCount()).toBe(0)
  })
})

describe('FileWatcherService re-arm bail-outs', () => {
  it('tells a subscriber its watch ended when the project switches inside the window', async () => {
    filesOnDisk.add(FILE)
    const watchId = '0b6f3c1e-2b47-4f0e-a3f8-6d8f1a2b3c4d'
    await service.subscribe({ owner: { kind: 'window', webContentsId: 1 }, watchId, filePath: FILE, profile: 'editor' })
    filesOnDisk.delete(FILE)
    createdWatchers[0].handlers.unlink()

    // Project switch inside the 100 ms window
    await service.suspendAll()
    await service.endSuspended(session.switchTo(OTHER_PROJECT))
    await closeDetectorWindow()
    await flushDebounce()

    // H-4b: silently dropping the entry would leave the panel showing stale
    // content with no indicator - the symptom #70 fixes. The pending check was
    // cancelled with the suspend, so no stale "deleted" follows.
    expect(sends).toEqual([
      { id: 1, channel: 'file-watch:event', payload: { watchId, kind: 'ended', reason: 'project-switch' } }
    ])
    expect(held()).toBeUndefined()
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

    expect(kinds()).toEqual(['deleted'])
    expect(held()).toBeUndefined()
    expect(createdWatchers[1].close).toHaveBeenCalled()
  })
})

describe('FileWatcherService re-arm confinement', () => {
  it('kills the watch when the replacement resolves outside the project', async () => {
    // The unlink/re-arm window is the moment an outside writer can swap the
    // file for a symlink pointing out of the project; the re-arm re-checks with
    // realpath rather than trusting the subscribe's lexical entry check.
    const first = await startWatch()
    canonicalPaths.set(FILE, OUTSIDE_TARGET)

    first.handlers.unlink()
    await closeDetectorWindow()
    await flushDebounce()

    expect(w.events()).toEqual([
      expect.objectContaining({ window: 1, filePath: FILE, kind: 'ended', reason: 'outside-project' })
    ])
    expect(held()).toBeUndefined()
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
    expect(service.atomicSaveDetector.getPendingCount()).toBe(1)

    await w.watch(FILE, 2)

    expect(service.atomicSaveDetector.getPendingCount()).toBe(0)
    expect(createdWatchers).toHaveLength(2)
    expect(first.close).toHaveBeenCalled()
    expect(windowsOn()).toBe(2)

    await flushDebounce()
    expect(kinds()).toEqual(['changed', 'changed'])
  })

  it('never leaves a join believing it watches when the re-arm dropped the watch', async () => {
    // LOW-3: a join that succeeds silently after the entry was dropped would
    // leave the renderer believing it watches a path that has no watcher at all.
    // The detector looks at once (#478), so the re-arm may finish before or
    // after the join answers: the join is then refused, or it hears the delete.
    const first = await startWatch()

    first.handlers.unlink()
    // The file disappears again while the replacement watcher is being created
    watchHooks.onCreate = () => {
      filesOnDisk.delete(FILE)
    }

    const join = await w.watch(FILE, 2)
    await closeDetectorWindow()
    await flushDebounce()

    const toldDeleted = w.to(FILE, 'deleted').includes(2)
    expect(
      join.status === 'refused' || toldDeleted,
      `join answered ${JSON.stringify(join)} and was ${toldDeleted ? '' : 'not '}told the file is gone`
    ).toBe(true)
    expect(held()).toBeUndefined()
    expect(kinds()).toContain('deleted')
  })
})

describe('FileWatcherService detector disposal', () => {
  it('cancels the pending check when the last subscriber unwatches', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await w.unwatch(FILE, 1)

    expect(service.atomicSaveDetector.getPendingCount()).toBe(0)
    await closeDetectorWindow()
    expect(sends).toHaveLength(0)
  })

  it('cancels the pending check when a webContents is destroyed', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.cleanupForWebContentsId(1)

    expect(service.atomicSaveDetector.getPendingCount()).toBe(0)
    await closeDetectorWindow()
    expect(sends).toHaveLength(0)
  })

  it('cancels the pending check on stopAll', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.stopAll()

    expect(service.atomicSaveDetector.getPendingCount()).toBe(0)
    await closeDetectorWindow()
    // The window hears its watch ended with the project – and no stale verdict after it
    expect(kinds()).toEqual(['ended'])
    expect(w.events()[0]).toMatchObject({ reason: 'project-closed' })
  })

  it('disposes the detector with the service', async () => {
    const first = await startWatch()

    first.handlers.unlink()
    await service.dispose()

    expect(service.atomicSaveDetector.getPendingCount()).toBe(0)
    // The detector is disposed for good, so late unlinks register nothing
    service.atomicSaveDetector.registerDelete(FILE, () => {})
    expect(service.atomicSaveDetector.getPendingCount()).toBe(0)
  })
})

// On Windows an EPERM just after an unlink earns a second look 250 ms later.
// Whatever happens to the watch in that time must win over the late answer:
// a stale verdict would reach, re-arm or tear down a newer watch on the same
// path (#252 review)
describe('FileWatcherService – a newer watch on the path while a second look waits', () => {
  beforeEach(() => playWindows())

  it('leaves the newer watch alone when the re-arm’s second look ends after a reopen', async () => {
    const first = await startWatch()
    // The replacement is bound, then the file answers as one Windows is deleting
    watchHooks.onCreate = () => {
      watchHooks.onCreate = null
      failingPaths.set(FILE, 'EPERM')
    }
    first.handlers.unlink()
    await closeDetectorWindow()
    expect(createdWatchers).toHaveLength(2)

    // The tab is closed and reopened while the stat waits, then the file is gone
    failingPaths.delete(FILE)
    await w.unwatch(FILE, 1)
    const newer = await startWatch()
    filesOnDisk.delete(FILE)
    sends.length = 0

    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)
    await flushDebounce()

    // The reopened tab hears no stale "deleted", and its watch is neither dropped nor closed
    expect(sends).toHaveLength(0)
    expect(held()?.watcher).toBe(newer)
    expect(newer.close).not.toHaveBeenCalled()
  })

  it('drops the old session’s check when the project is reopened while it waits', async () => {
    const first = await startWatch()
    // The unlink's check finds a possible delete pending and waits
    failingPaths.set(FILE, 'EPERM')
    first.handlers.unlink()
    await closeDetectorWindow()
    expect(service.atomicSaveDetector.hasPending(FILE)).toBe(true)

    // The same project is reopened, and the file is back
    failingPaths.delete(FILE)
    await service.suspendAll()
    await service.endSuspended(session.switchTo(PROJECT))
    const newer = await startWatch()
    sends.length = 0

    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)
    await flushDebounce()

    // The old "atomic save" verdict neither re-arms the new watch nor reports a change
    expect(sends).toHaveLength(0)
    expect(createdWatchers).toHaveLength(2)
    expect(newer.close).not.toHaveBeenCalled()
    expect(held()?.watcher).toBe(newer)
  })

  it('lets a consumer joining during the second look re-arm at once, and only once', async () => {
    const first = await startWatch()
    failingPaths.set(FILE, 'EPERM')
    first.handlers.unlink()
    await closeDetectorWindow()

    // The replacement has landed by the time a second tab opens the file
    failingPaths.delete(FILE)
    await w.watch(FILE, 2)
    expect(createdWatchers).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(UNREADABLE_RECHECK_MS)
    await flushDebounce()

    // The cancelled check adds no second re-arm
    expect(createdWatchers).toHaveLength(2)
    expect(windowsOn()).toBe(2)
    expect(kinds()).toEqual(['changed', 'changed'])
  })
})
