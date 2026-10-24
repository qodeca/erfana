// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DirectoryWatcherService removal listeners (save after a folder rename).
 *
 * A single-file chokidar watch hears nothing when its parent folder is renamed
 * away, so `FileWatcherService` learns about it from the project watcher's
 * removals. These tests pin the hand-off on both backends: a native
 * `unlinkDir` and a chokidar `unlinkDir` each reach `onPathsRemoved` with the
 * absolute path, after coalescing and in the same flush as the broadcast.
 *
 * #252 adds the cases the project watcher used to miss: a removal dropped
 * while the watch was paused for the app's own operation is reported when the
 * pause ends (or lost, when the pause could not keep its path), and
 * `reportsRemovalsAbove` says which open files it cannot speak for at all.
 *
 * Both watcher libraries are replaced by fakes driven by hand (module-scope
 * mocks, hence a file of its own per the test-file split policy).
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  natives: [] as Array<{ emit(event: string, ...args: unknown[]): boolean }>,
  chokidarHandlers: new Map<string, (p: string) => void>(),
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('./watcher/NativeRecursiveWatcher', async () => {
  const { EventEmitter } = await import('events')
  class FakeNativeRecursiveWatcher extends EventEmitter {
    readonly close = vi.fn(async () => {})
    readonly getPlanStats = vi.fn(() => ({
      handles: 1,
      recursiveWatches: 1,
      splitFolders: 0,
      planCapped: false,
      elapsedMs: 1
    }))

    constructor() {
      super()
      harness.natives.push(this)
    }
  }
  return { NativeRecursiveWatcher: FakeNativeRecursiveWatcher }
})

vi.mock('chokidar', () => {
  const watch = vi.fn(() => {
    const watcher = {
      on: vi.fn((event: string, listener: (p: string) => void) => {
        harness.chokidarHandlers.set(event, listener)
        return watcher
      }),
      close: vi.fn(async () => {})
    }
    return watcher
  })
  return { default: { watch }, watch }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) => {
            harness.sends.push({ channel, payload })
          }
        }
      }
    ])
  },
  webContents: { getAllWebContents: vi.fn(() => [{ id: 1, isDestroyed: () => false }]) }
}))

vi.mock('./SettingsService', () => ({
  settingsService: { getDirectoryWatchDepth: vi.fn(async (): Promise<number | undefined> => undefined) }
}))

vi.mock('../utils/pathSecurity', () => ({ isSystemDirectory: vi.fn(() => false) }))

vi.mock('./LoggingService', () => ({ logger: harness.logger }))

import { DirectoryWatcherService } from './DirectoryWatcherService'
import { settingsService } from './SettingsService'
import { ProjectPathFilter } from '../utils/projectPathFilter'
import { PAUSE_CONTROLLER } from '../../shared/constants'
import { MAX_REMEMBERED_REMOVALS } from './watcher/PauseEpisode'

// path.resolve, not path.join: the code resolves paths, which adds the drive on Windows
const ROOT = path.resolve(path.sep, 'work', 'proj')
const FLUSH_MS = 1000
const OWNER = 1
const webContents = { id: OWNER } as unknown as WebContents
const inRoot = (...segments: string[]): string => path.join(ROOT, ...segments)

function latestNative(): { emit(event: string, ...args: unknown[]): boolean } {
  const native = harness.natives.at(-1)
  if (!native) throw new Error('no native watcher was constructed')
  return native
}

const services: DirectoryWatcherService[] = []

async function start(backend: 'native-recursive' | 'chokidar'): Promise<DirectoryWatcherService> {
  const svc = new DirectoryWatcherService({ backend })
  services.push(svc)
  svc.setProjectPath(ROOT)
  await svc.watchDirectory(ROOT, webContents)
  return svc
}

beforeEach(() => {
  vi.useFakeTimers()
  harness.sends.length = 0
  harness.natives.length = 0
  harness.chokidarHandlers.clear()
  harness.logger.error.mockClear()
})

afterEach(async () => {
  await Promise.all(services.splice(0).map(svc => svc.dispose()))
  vi.useRealTimers()
})

describe('DirectoryWatcherService.onPathsRemoved', () => {

  it('reports a renamed folder (native unlinkDir) with its absolute path', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    latestNative().emit('unlinkDir', inRoot('docs'))
    latestNative().emit('addDir', inRoot('docs2'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([inRoot('docs')])
    expect(harness.sends.filter(s => s.channel === 'directory-watch:changed')).toHaveLength(1)
  })

  it('reports a renamed folder (chokidar unlinkDir) with its absolute path', async () => {
    const svc = await start('chokidar')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    harness.chokidarHandlers.get('unlinkDir')?.(inRoot('docs'))
    harness.chokidarHandlers.get('addDir')?.(inRoot('docs2'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).toHaveBeenCalledWith([inRoot('docs')])
  })

  it('reports a file unlink, and coalesces a deleted folder’s children into the folder', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    latestNative().emit('unlink', inRoot('docs', 'open.md'))
    latestNative().emit('unlinkDir', inRoot('docs'))
    latestNative().emit('unlink', inRoot('top.md'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).toHaveBeenCalledTimes(1)
    const removed = listener.mock.calls[0][0] as string[]
    expect(removed).toContain(inRoot('docs'))
    expect(removed).toContain(inRoot('top.md'))
  })

  it('stays quiet for a batch with no removals', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    svc.onPathsRemoved(listener)

    latestNative().emit('add', inRoot('new.md'))
    latestNative().emit('change', inRoot('old.md'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).not.toHaveBeenCalled()
    expect(harness.sends).toHaveLength(1)
  })

  it('stops reporting once unsubscribed', async () => {
    const svc = await start('native-recursive')
    const listener = vi.fn()
    const unsubscribe = svc.onPathsRemoved(listener)
    unsubscribe()

    latestNative().emit('unlinkDir', inRoot('docs'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(listener).not.toHaveBeenCalled()
  })

  it('logs a throwing listener and still runs the others and the broadcast', async () => {
    const svc = await start('native-recursive')
    const second = vi.fn()
    svc.onPathsRemoved(() => {
      throw new Error('boom')
    })
    svc.onPathsRemoved(second)

    latestNative().emit('unlinkDir', inRoot('docs'))
    vi.advanceTimersByTime(FLUSH_MS)

    expect(second).toHaveBeenCalledWith([inRoot('docs')])
    expect(harness.logger.error).toHaveBeenCalledWith('Directory removal listener failed', expect.any(Error))
    expect(harness.sends.filter(s => s.channel === 'directory-watch:changed')).toHaveLength(1)
  })
})

describe('DirectoryWatcherService removals during a pause (#252)', () => {
  async function startListening(): Promise<{
    svc: DirectoryWatcherService
    removed: ReturnType<typeof vi.fn>
    lost: ReturnType<typeof vi.fn>
  }> {
    const svc = await start('native-recursive')
    const removed = vi.fn()
    const lost = vi.fn()
    svc.onPathsRemoved(removed)
    svc.onRemovalsLost(lost)
    return { svc, removed, lost }
  }

  it('reports an outside removal dropped during a pause once the pause ends', async () => {
    const { svc, removed, lost } = await startListening()
    svc.pauseWatch(ROOT, OWNER)

    latestNative().emit('unlinkDir', inRoot('docs'))
    vi.advanceTimersByTime(FLUSH_MS)
    expect(removed).not.toHaveBeenCalled()

    svc.resumeWatch(ROOT)
    expect(removed).toHaveBeenCalledWith([inRoot('docs')])
    expect(lost).not.toHaveBeenCalled()
  })

  it('reports it even when the pausing window re-read the tree after the drop', async () => {
    const { svc, removed } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('unlinkDir', inRoot('docs'))
    svc.beginTreeRead(ROOT, OWNER)()

    svc.resumeWatch(ROOT)

    expect(removed).toHaveBeenCalledWith([inRoot('docs')])
  })

  it('waits for the outermost resume of nested pauses', async () => {
    const { svc, removed } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('unlinkDir', inRoot('docs'))

    svc.resumeWatch(ROOT)
    expect(removed).not.toHaveBeenCalled()
    svc.resumeWatch(ROOT)
    expect(removed).toHaveBeenCalledTimes(1)
  })

  it('leaves out the operation’s own removals, noted after their events', async () => {
    const { svc, removed, lost } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('unlink', inRoot('renamed', 'child.md'))
    latestNative().emit('unlinkDir', inRoot('renamed'))
    svc.noteInternalChange({ path: inRoot('renamed'), kind: 'removed', subtree: true })

    svc.resumeWatch(ROOT)

    expect(removed).not.toHaveBeenCalled()
    expect(lost).not.toHaveBeenCalled()
  })

  it('says, while the pause runs, which paths the operation removed itself', async () => {
    const { svc } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    svc.noteInternalChange({ path: inRoot('.github'), kind: 'removed', subtree: true })

    expect(svc.isOwnRemoval(inRoot('.github', 'workflows', 'ci.yml'))).toBe(true)
    expect(svc.isOwnRemoval(inRoot('docs', 'open.md'))).toBe(false)

    // The episode ends with the pause
    svc.resumeWatch(ROOT)
    expect(svc.isOwnRemoval(inRoot('.github', 'workflows', 'ci.yml'))).toBe(false)
  })

  it('reports the removals when the safety timeout ends a pause nobody resumed', async () => {
    const { svc, removed } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('unlinkDir', inRoot('docs'))

    vi.advanceTimersByTime(PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS)

    expect(removed).toHaveBeenCalledWith([inRoot('docs')])
  })

  it('says the removals under the root were lost when a resync swallowed them', async () => {
    const { svc, removed, lost } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('unlinkDir', inRoot('docs'))
    latestNative().emit('resync', 'overflow')

    svc.resumeWatch(ROOT)

    expect(lost).toHaveBeenCalledWith(ROOT, expect.any(Function))
    expect(removed).not.toHaveBeenCalled()
  })

  it('hands the lost-removals listener the operation’s own removals to skip', async () => {
    const { svc, lost } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('resync', 'overflow')
    svc.noteInternalChange({ path: inRoot('renamed'), kind: 'removed', subtree: true })

    svc.resumeWatch(ROOT)

    const isOwnRemoval = lost.mock.calls[0][1] as (filePath: string) => boolean
    expect(isOwnRemoval(inRoot('renamed', 'open.md'))).toBe(true)
    expect(isOwnRemoval(inRoot('docs', 'open.md'))).toBe(false)
  })

  it('folds removals past what it can remember into their folder, and has only that folder re-checked', async () => {
    const { svc, removed, lost } = await startListening()
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('unlink', inRoot('top.md'))
    for (let i = 0; i <= MAX_REMEMBERED_REMOVALS; i++) latestNative().emit('unlink', inRoot('docs', `f${i}.md`))

    svc.resumeWatch(ROOT)

    expect(lost.mock.calls).toEqual([[inRoot('docs'), expect.any(Function)]])
    expect(removed).toHaveBeenCalledWith([inRoot('top.md')])
  })

  it('logs a throwing lost-removals listener and still runs the others', async () => {
    const { svc, lost } = await startListening()
    svc.onRemovalsLost(() => {
      throw new Error('boom')
    })
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('resync', 'overflow')

    expect(() => svc.resumeWatch(ROOT)).not.toThrow()
    expect(lost).toHaveBeenCalledWith(ROOT, expect.any(Function))
    expect(harness.logger.error).toHaveBeenCalledWith('Directory removal listener failed', expect.any(Error))
  })

  it('stops telling a lost-removals listener once unsubscribed', async () => {
    const svc = await start('native-recursive')
    const lost = vi.fn()
    svc.onRemovalsLost(lost)()
    svc.pauseWatch(ROOT, OWNER)
    latestNative().emit('resync', 'overflow')

    svc.resumeWatch(ROOT)

    expect(lost).not.toHaveBeenCalled()
  })
})

describe('DirectoryWatcherService.reportsRemovalsAbove (#252)', () => {
  it('speaks for a file in a watched folder and for one at the root', async () => {
    const svc = await start('native-recursive')

    expect(svc.reportsRemovalsAbove(inRoot('docs', 'deep', 'open.md'))).toBe(true)
    expect(svc.reportsRemovalsAbove(inRoot('top.md'))).toBe(true)
  })

  it('cannot speak for a file under a hidden or an ignored folder', async () => {
    const svc = await start('chokidar')

    expect(svc.reportsRemovalsAbove(inRoot('.git', 'notes.md'))).toBe(false)
    expect(svc.reportsRemovalsAbove(inRoot('dist', 'notes.md'))).toBe(false)
    expect(svc.reportsRemovalsAbove(inRoot('src', 'node_modules', 'pkg', 'readme.md'))).toBe(false)
  })

  it('cannot speak for a file under an excluded folder', async () => {
    const svc = await start('native-recursive')
    svc.setPathFilter(
      new ProjectPathFilter(ROOT, {
        exclude: ['big'],
        hiddenPatterns: [],
        ignorePatterns: [],
        caseSensitive: true
      })
    )

    expect(svc.reportsRemovalsAbove(inRoot('big', 'open.md'))).toBe(false)
    expect(svc.reportsRemovalsAbove(inRoot('small', 'open.md'))).toBe(true)
  })

  it('cannot speak for a file outside every watch, or with no watch at all', async () => {
    const idle = new DirectoryWatcherService({ backend: 'native-recursive' })
    services.push(idle)
    expect(idle.reportsRemovalsAbove(inRoot('docs', 'open.md'))).toBe(false)

    const svc = await start('native-recursive')
    expect(svc.reportsRemovalsAbove(path.resolve(path.sep, 'elsewhere', 'open.md'))).toBe(false)
    expect(svc.reportsRemovalsAbove(`${ROOT}-sibling${path.sep}open.md`)).toBe(false)
  })

  it('cannot speak for a file deeper than the watch depth cap', async () => {
    vi.mocked(settingsService.getDirectoryWatchDepth).mockResolvedValueOnce(1)
    const svc = await start('native-recursive')

    // Folder `a/b` has 2 segments: watched at depth 1 (chokidar's n - 1 > depth rule)
    expect(svc.reportsRemovalsAbove(inRoot('a', 'b', 'open.md'))).toBe(true)
    expect(svc.reportsRemovalsAbove(inRoot('a', 'b', 'c', 'open.md'))).toBe(false)
  })

  it('stops speaking for the old project once the watches stop', async () => {
    const svc = await start('native-recursive')
    await svc.stopAll()

    expect(svc.reportsRemovalsAbove(inRoot('docs', 'open.md'))).toBe(false)
  })
})

describe('DirectoryWatcherService.onCoverageChanged (#252)', () => {
  it('fires whenever reportsRemovalsAbove may answer differently', async () => {
    const svc = new DirectoryWatcherService({ backend: 'native-recursive' })
    services.push(svc)
    const changed = vi.fn()
    svc.onCoverageChanged(changed)

    svc.setProjectPath(ROOT)
    expect(changed).toHaveBeenCalledTimes(1)

    await svc.watchDirectory(ROOT, webContents)
    expect(changed).toHaveBeenCalledTimes(2)

    svc.setPathFilter(
      new ProjectPathFilter(ROOT, { exclude: ['big'], hiddenPatterns: [], ignorePatterns: [], caseSensitive: true })
    )
    expect(changed).toHaveBeenCalledTimes(3)

    await svc.unwatchDirectory(ROOT, webContents)
    expect(changed).toHaveBeenCalledTimes(4)

    await svc.watchDirectory(ROOT, webContents)
    await svc.stopAll()
    expect(changed).toHaveBeenCalledTimes(6)
  })

  it('logs a throwing listener, still tells the others, and stops once unsubscribed', async () => {
    const svc = await start('native-recursive')
    const second = vi.fn()
    svc.onCoverageChanged(() => {
      throw new Error('boom')
    })
    const unsubscribe = svc.onCoverageChanged(second)

    expect(() => svc.setProjectPath(ROOT)).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
    expect(harness.logger.error).toHaveBeenCalledWith('Directory removal listener failed', expect.any(Error))

    unsubscribe()
    svc.setProjectPath(ROOT)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
