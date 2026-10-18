// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DirectoryWatcherService on the native Windows backend (issue #211, W13;
 * design D1–D6, D13, D15, D16; AC1, AC3, AC5, AC6).
 *
 * `NativeRecursiveWatcher` is replaced by an EventEmitter fake that records
 * how it was constructed and can be told to throw, and the service is built
 * with `{ backend: 'native-recursive' }` – the global test setup pins the
 * selector to chokidar. The fake's events are driven by hand, so these tests
 * cover the wiring: what the watcher is built with, where its events go, and
 * how the restart path treats a root that is gone. The watcher itself is
 * covered by `NativeRecursiveWatcher.test.ts` (fakes) and
 * `NativeRecursiveWatcher.win32.test.ts` (real file system).
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { NativeRecursiveWatcherOptions } from './watcher'

interface FakeNative {
  readonly root: string
  readonly options: NativeRecursiveWatcherOptions
  readonly close: ReturnType<typeof vi.fn>
  emit(event: string, ...args: unknown[]): boolean
}

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  /** Runs at each send, before it is recorded – to look at the service then. */
  onSend: null as ((channel: string) => void) | null,
  natives: [] as FakeNative[],
  /** Called by every fake construction; throw from it to fail the watch. */
  construct: vi.fn(),
  chokidarWatch: vi.fn(),
  depth: vi.fn(async (): Promise<number | undefined> => undefined),
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('./watcher/NativeRecursiveWatcher', async () => {
  const { EventEmitter } = await import('events')
  class FakeNativeRecursiveWatcher extends EventEmitter {
    readonly close = vi.fn(async () => {})
    readonly getPlanStats = vi.fn(() => ({
      handles: 4,
      recursiveWatches: 3,
      splitFolders: 1,
      planCapped: false,
      elapsedMs: 12
    }))

    constructor(
      readonly root: string,
      readonly options: NativeRecursiveWatcherOptions
    ) {
      super()
      harness.construct(root, options)
      harness.natives.push(this)
    }
  }
  return { NativeRecursiveWatcher: FakeNativeRecursiveWatcher }
})

vi.mock('chokidar', () => ({
  default: { watch: harness.chokidarWatch },
  watch: harness.chokidarWatch
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) => {
            harness.onSend?.(channel)
            harness.sends.push({ channel, payload })
          }
        }
      }
    ])
  },
  webContents: { getAllWebContents: vi.fn(() => [{ id: 1, isDestroyed: () => false }]) }
}))

vi.mock('./SettingsService', () => ({
  settingsService: { getDirectoryWatchDepth: harness.depth }
}))

vi.mock('../utils/pathSecurity', () => ({ isSystemDirectory: vi.fn(() => false) }))

vi.mock('./LoggingService', () => ({ logger: harness.logger }))

import { DirectoryWatcherService } from './DirectoryWatcherService'
import { AtomicSaveDetector, PauseEpisode, getPlatformConfig } from './watcher'
import { ProjectPathFilter } from '../utils/projectPathFilter'

/** The private members these tests reach into (names kept on purpose, see the design § 5). */
interface ServiceInternals {
  watchedDirectories: Map<string, unknown>
  pendingRestarts: Map<string, NodeJS.Timeout>
  restartAttempts: Map<string, number>
  MAX_RESTART_ATTEMPTS: number
  queueEvent: (dirPath: string, event: { type: string; path: string }) => void
}

const ROOT = path.join(path.sep, 'work', 'proj')
const OWNER = 1
const FLUSH_MS = 1000
/** scheduleRestart's back-off: 800 ms, doubled per attempt. */
const RESTART_DELAYS_MS = [800, 1600, 3200]
/** A process uptime past RateLimitedLogger's first-line quiet period. */
const LOG_CLOCK_MS = 100_000
const webContents = { id: OWNER } as unknown as WebContents

const inRoot = (...segments: string[]): string => path.join(ROOT, ...segments)
const codeError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: test`), { code })
const internals = (svc: DirectoryWatcherService): ServiceInternals => svc as unknown as ServiceInternals

function projectFilter(): ProjectPathFilter {
  const filter = new ProjectPathFilter(ROOT, {
    exclude: ['scratch', 'sub/tmp', '**/test-tmp'],
    hiddenPatterns: ['.git'],
    ignorePatterns: ['node_modules'],
    caseSensitive: getPlatformConfig().caseSensitive
  })
  filter.replaceWalkHints(['packages/a/node_modules', 'sub/deep/node_modules'])
  return filter
}

function latestNative(): FakeNative {
  const native = harness.natives.at(-1)
  if (!native) throw new Error('no native watcher was constructed')
  return native
}

function sent(channel: string): Array<Record<string, unknown>> {
  return harness.sends.filter(s => s.channel === channel).map(s => s.payload)
}

/** Run the three back-off timers, letting each restart settle in between. */
async function runRestartAttempts(): Promise<void> {
  for (const delay of RESTART_DELAYS_MS) {
    await vi.advanceTimersByTimeAsync(delay)
  }
}

describe('DirectoryWatcherService native backend (#211, W13)', () => {
  let svc: DirectoryWatcherService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    harness.sends.length = 0
    harness.natives.length = 0
    harness.onSend = null
    harness.construct.mockReset()
    harness.depth.mockReset()
    harness.depth.mockImplementation(async () => undefined)
    svc = new DirectoryWatcherService({ backend: 'native-recursive' })
    svc.setProjectPath(ROOT)
    svc.setPathFilter(projectFilter())
  })

  afterEach(async () => {
    await svc.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('construction (D1, D4, D5, D6)', () => {
    it('builds one native watcher on the root with the split paths, then the walk hints; chokidar untouched', async () => {
      await svc.watchDirectory(ROOT, webContents)

      expect(harness.natives).toHaveLength(1)
      const { root, options } = latestNative()
      expect(root).toBe(ROOT)
      expect(options.splitPaths).toEqual([
        'scratch',
        'sub/tmp',
        'packages/a/node_modules',
        'sub/deep/node_modules'
      ])
      expect(options.splitInputsCapped).toBe(false)
      expect(options.caseSensitive).toBe(getPlatformConfig().caseSensitive)
      expect(harness.chokidarWatch).not.toHaveBeenCalled()
    })

    it('drops excluded, hidden and ignored paths given relative to the watch root', async () => {
      await svc.watchDirectory(ROOT, webContents)
      const { shouldDrop } = latestNative().options

      expect(shouldDrop('src/a.md')).toBe(false)
      expect(shouldDrop('a/b/c/d/e/f/g/h.md')).toBe(false) // no depth set: no depth limit
      expect(shouldDrop('scratch')).toBe(true)
      expect(shouldDrop('scratch/deep/x.log')).toBe(true)
      expect(shouldDrop('pkg/test-tmp/a.txt')).toBe(true)
      expect(shouldDrop('.git/index.lock')).toBe(true)
      expect(shouldDrop('packages/a/node_modules/x/index.js')).toBe(true)
    })

    it('maps split paths into a subfolder watch and its drop test back to project-relative paths', async () => {
      const sub = inRoot('sub')
      await svc.watchDirectory(sub, webContents)
      const { root, options } = latestNative()

      expect(root).toBe(sub)
      // Only what lies inside the watch, relative to it
      expect(options.splitPaths).toEqual(['tmp', 'deep/node_modules'])
      // `sub/tmp` is excluded; the root-level `scratch` entry is not `sub/scratch`
      expect(options.shouldDrop('tmp/a.md')).toBe(true)
      expect(options.shouldDrop('scratch/a.md')).toBe(false)
      expect(options.shouldDrop('notes.md')).toBe(false)
    })

    it('honours directoryWatchDepth by dropping deeper paths – chokidar’s rule, n − 1 > depth', async () => {
      harness.depth.mockImplementation(async () => 1)
      await svc.watchDirectory(ROOT, webContents)
      const { shouldDrop } = latestNative().options

      expect(shouldDrop('a')).toBe(false)
      expect(shouldDrop('a/b.md')).toBe(false)
      expect(shouldDrop('a/b/c.md')).toBe(true)
      // The filter still applies within the depth
      expect(shouldDrop('.git')).toBe(true)
    })

    it('uses the filter set at call time, like chokidar’s ignored option', async () => {
      await svc.watchDirectory(ROOT, webContents)
      const { shouldDrop } = latestNative().options
      expect(shouldDrop('scratch/a.md')).toBe(true)

      svc.setPathFilter(
        new ProjectPathFilter(ROOT, { exclude: [], hiddenPatterns: [], ignorePatterns: [], caseSensitive: true })
      )

      expect(shouldDrop('scratch/a.md')).toBe(false)
    })

    it('defaults to the selector (chokidar under the test setup) and logs the backend once', async () => {
      const defaulted = new DirectoryWatcherService()
      try {
        harness.chokidarWatch.mockImplementation(() => ({ on: vi.fn(), close: vi.fn(async () => {}) }))
        await defaulted.watchDirectory(ROOT, webContents)
        await defaulted.watchDirectory(inRoot('sub'), webContents)

        expect(harness.chokidarWatch).toHaveBeenCalledTimes(2)
        expect(harness.natives).toHaveLength(0)
        const selected = harness.logger.info.mock.calls.filter(([message]) => message === 'Directory watcher backend selected')
        expect(selected).toEqual([['Directory watcher backend selected', { backend: 'chokidar' }]])
      } finally {
        await defaulted.dispose()
      }
    })

    it('leaves no entry behind when the root cannot be watched, schedules a restart, and recovers', async () => {
      harness.construct.mockImplementationOnce(() => {
        throw codeError('ENOENT')
      })

      await expect(svc.watchDirectory(ROOT, webContents)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(internals(svc).watchedDirectories.size).toBe(0)
      expect(internals(svc).pendingRestarts.has(ROOT)).toBe(true)

      await vi.advanceTimersByTimeAsync(RESTART_DELAYS_MS[0])

      expect(harness.construct).toHaveBeenCalledTimes(2)
      expect(internals(svc).watchedDirectories.has(ROOT)).toBe(true)
      expect(sent('directory-watch:recovered')).toEqual([{ dirPath: ROOT }])
      // Nothing watched the gap: one catch-up refresh covers it (R-L7)
      expect(sent('directory-watch:changed')).toEqual([
        expect.objectContaining({ dirPath: ROOT, eventCount: 0, catchUp: true })
      ])
      expect(internals(svc).restartAttempts.size).toBe(0)
    })

    it('builds no watcher and leaves no entry when stopAll overtook the start (R-L6)', async () => {
      let releaseDepth: () => void = () => {}
      harness.depth.mockImplementation(
        () => new Promise<undefined>(resolve => (releaseDepth = () => resolve(undefined)))
      )
      const starting = svc.watchDirectory(ROOT, webContents)

      await svc.stopAll()
      releaseDepth()
      await starting

      expect(harness.construct).not.toHaveBeenCalled()
      expect(internals(svc).watchedDirectories.size).toBe(0)
    })
  })

  describe('events (D2, D4)', () => {
    it('routes every path event into queueEvent and broadcasts one batch', async () => {
      const queueEvent = vi.spyOn(internals(svc), 'queueEvent')
      await svc.watchDirectory(ROOT, webContents)
      const native = latestNative()

      native.emit('add', inRoot('a.md'))
      native.emit('addDir', inRoot('dir'))
      native.emit('change', inRoot('b.md'))
      native.emit('unlink', inRoot('c.md'))
      native.emit('unlinkDir', inRoot('old'))
      vi.advanceTimersByTime(FLUSH_MS)

      expect(queueEvent.mock.calls.map(([, event]) => event.type)).toEqual([
        'add',
        'addDir',
        'change',
        'unlink',
        'unlinkDir'
      ])
      expect(sent('directory-watch:changed')).toEqual([
        expect.objectContaining({
          dirPath: ROOT,
          eventCount: 5,
          summary: { add: 1, addDir: 1, change: 1, unlink: 1, unlinkDir: 1 }
        })
      ])
    })

    it('passes a native unlink straight through, without the atomic-save stat', async () => {
      const registerDelete = vi.spyOn(AtomicSaveDetector.prototype, 'registerDelete')
      await svc.watchDirectory(ROOT, webContents)

      latestNative().emit('unlink', inRoot('gone.md'))
      vi.advanceTimersByTime(FLUSH_MS)

      expect(registerDelete).not.toHaveBeenCalled()
      expect(sent('directory-watch:changed')).toEqual([expect.objectContaining({ summary: { unlink: 1 } })])
    })

    it('still runs a chokidar unlink through the atomic-save detector', async () => {
      const registerDelete = vi.spyOn(AtomicSaveDetector.prototype, 'registerDelete')
      const handlers = new Map<string, (p: string) => void>()
      harness.chokidarWatch.mockImplementation(() => {
        const watcher = {
          on: vi.fn((event: string, listener: (p: string) => void) => {
            handlers.set(event, listener)
            return watcher
          }),
          close: vi.fn(async () => {})
        }
        return watcher
      })
      const chokidarSvc = new DirectoryWatcherService({ backend: 'chokidar' })
      try {
        chokidarSvc.setProjectPath(ROOT)
        await chokidarSvc.watchDirectory(ROOT, webContents)

        handlers.get('unlink')?.(inRoot('gone.md'))

        expect(registerDelete).toHaveBeenCalledTimes(1)
      } finally {
        await chokidarSvc.dispose()
      }
    })

    it('drops a path the filter drops at the queueEvent backstop too', async () => {
      await svc.watchDirectory(ROOT, webContents)

      latestNative().emit('add', inRoot('scratch', 'a.md'))
      vi.advanceTimersByTime(FLUSH_MS)

      expect(harness.sends).toHaveLength(0)
      expect(svc.getStats().metrics.eventsFiltered).toBe(1)
    })
  })

  describe('lost events (D3, D13)', () => {
    it('answers a resync with exactly one catch-up refresh', async () => {
      // RateLimitedLogger stays silent until performance.now() passes its interval
      vi.spyOn(performance, 'now').mockReturnValue(LOG_CLOCK_MS)
      await svc.watchDirectory(ROOT, webContents)

      latestNative().emit('resync', 'overflow')
      vi.advanceTimersByTime(FLUSH_MS)

      expect(harness.sends).toEqual([
        {
          channel: 'directory-watch:changed',
          payload: expect.objectContaining({ dirPath: ROOT, eventCount: 0, catchUp: true })
        }
      ])
      expect(svc.getStats().metrics.nativeResyncs).toBe(1)
      expect(harness.logger.info).toHaveBeenCalledWith(
        'Directory watcher resync',
        expect.objectContaining({ reason: 'overflow', paused: false })
      )
    })

    it('counts a resync while paused as one unknown drop and catches up at resume', async () => {
      const recordUnknownDrop = vi.spyOn(PauseEpisode.prototype, 'recordUnknownDrop')
      await svc.watchDirectory(ROOT, webContents)

      svc.pauseWatch(ROOT, OWNER)
      latestNative().emit('resync', 'backlog')
      vi.advanceTimersByTime(FLUSH_MS)

      expect(recordUnknownDrop).toHaveBeenCalledTimes(1)
      expect(harness.sends).toHaveLength(0)

      svc.resumeWatch(ROOT)

      expect(sent('directory-watch:changed')).toEqual([expect.objectContaining({ catchUp: true })])
    })

    it('sends no catch-up when a read by the pausing window began after the resync and completed', async () => {
      await svc.watchDirectory(ROOT, webContents)

      svc.pauseWatch(ROOT, OWNER)
      latestNative().emit('resync', 'overflow')
      const commit = svc.beginTreeRead(ROOT, OWNER)
      commit()
      svc.resumeWatch(ROOT)

      expect(harness.sends).toHaveLength(0)
    })

    it('still catches up when that read began before the resync', async () => {
      await svc.watchDirectory(ROOT, webContents)

      svc.pauseWatch(ROOT, OWNER)
      const commit = svc.beginTreeRead(ROOT, OWNER)
      latestNative().emit('resync', 'overflow')
      commit()
      svc.resumeWatch(ROOT)

      expect(sent('directory-watch:changed')).toEqual([expect.objectContaining({ catchUp: true })])
    })

    it('counts an overflow for the health line without sending anything', async () => {
      await svc.watchDirectory(ROOT, webContents)

      latestNative().emit('overflow')
      vi.advanceTimersByTime(FLUSH_MS)

      expect(svc.getStats().metrics.nativeOverflows).toBe(1)
      expect(harness.sends).toHaveLength(0)
    })
  })

  describe('ready (AC5)', () => {
    it('resolves watchDirectory without waiting for ready, and logs the plan when it comes', async () => {
      await svc.watchDirectory(ROOT, webContents)

      expect(internals(svc).watchedDirectories.has(ROOT)).toBe(true)
      const planLine = (): unknown[][] =>
        harness.logger.info.mock.calls.filter(([message]) => message === 'Native directory watcher ready')
      expect(planLine()).toHaveLength(0)

      latestNative().emit('ready')

      expect(planLine()).toEqual([
        [
          'Native directory watcher ready',
          { recursiveWatches: 3, splitFolders: 1, walkHints: 2, planCapped: false, elapsedMs: 12 }
        ]
      ])
    })
  })

  describe('restarts (D15, D16)', () => {
    it('sends project-deleted once the ENOENT restarts run out, after the map entry is gone', async () => {
      await svc.watchDirectory(ROOT, webContents)
      const first = latestNative()
      harness.construct.mockImplementation(() => {
        throw codeError('ENOENT')
      })
      let entryAtSend: boolean | null = null
      harness.onSend = channel => {
        if (channel === 'directory-watch:project-deleted') {
          entryAtSend = internals(svc).watchedDirectories.has(ROOT)
        }
      }

      first.emit('error', codeError('ENOENT'))
      await runRestartAttempts()

      expect(first.close).toHaveBeenCalled()
      expect(harness.construct).toHaveBeenCalledTimes(1 + RESTART_DELAYS_MS.length)
      expect(sent('directory-watch:project-deleted')).toEqual([{ dirPath: ROOT }])
      expect(entryAtSend).toBe(false)
      expect(sent('directory-watch:restart-failed')).toEqual([])
      expect(internals(svc).pendingRestarts.size).toBe(0)
      expect(internals(svc).restartAttempts.size).toBe(0)
    })

    it('sends restart-failed – no longer lost – when other restarts run out', async () => {
      await svc.watchDirectory(ROOT, webContents)
      harness.construct.mockImplementation(() => {
        throw codeError('EACCES')
      })

      latestNative().emit('error', codeError('EACCES'))
      await runRestartAttempts()

      expect(sent('directory-watch:restart-failed')).toEqual([
        expect.objectContaining({ dirPath: ROOT, attempts: internals(svc).MAX_RESTART_ATTEMPTS })
      ])
      expect(sent('directory-watch:project-deleted')).toEqual([])
    })

    it('sends nothing when stopAll ran while the last restart was in flight', async () => {
      await svc.watchDirectory(ROOT, webContents)
      internals(svc).restartAttempts.set(ROOT, internals(svc).MAX_RESTART_ATTEMPTS - 1)
      let releaseDepth: () => void = () => {}
      harness.depth.mockImplementation(
        () => new Promise<undefined>(resolve => (releaseDepth = () => resolve(undefined)))
      )
      harness.construct.mockImplementation(() => {
        throw codeError('ENOENT')
      })

      latestNative().emit('error', codeError('ENOENT'))
      await vi.advanceTimersByTimeAsync(RESTART_DELAYS_MS[RESTART_DELAYS_MS.length - 1])
      // The last attempt is waiting inside watchDirectory; the project closes meanwhile
      await svc.stopAll()
      releaseDepth()
      await vi.advanceTimersByTimeAsync(0)

      expect(harness.sends).toHaveLength(0)
      expect(internals(svc).pendingRestarts.size).toBe(0)
    })

    describe('after a first start that throws', () => {
      /** Hold the next depth reads until the returned release is called. */
      function gateDepth(): () => void {
        let release: () => void = () => {}
        harness.depth.mockImplementation(
          () => new Promise<undefined>(resolve => (release = () => resolve(undefined)))
        )
        return () => release()
      }

      beforeEach(() => {
        harness.construct.mockImplementation(() => {
          throw codeError('ENOENT')
        })
      })

      it('sends project-deleted once the ENOENT restarts run out', async () => {
        await expect(svc.watchDirectory(ROOT, webContents)).rejects.toMatchObject({ code: 'ENOENT' })
        await runRestartAttempts()

        expect(harness.construct).toHaveBeenCalledTimes(1 + RESTART_DELAYS_MS.length)
        expect(sent('directory-watch:project-deleted')).toEqual([{ dirPath: ROOT }])
        expect(sent('directory-watch:restart-failed')).toEqual([])
        expect(internals(svc).pendingRestarts.size).toBe(0)
        expect(internals(svc).restartAttempts.size).toBe(0)
      })

      it('drops the pending restart at stopAll', async () => {
        await expect(svc.watchDirectory(ROOT, webContents)).rejects.toMatchObject({ code: 'ENOENT' })

        await svc.stopAll()
        await runRestartAttempts()

        expect(harness.construct).toHaveBeenCalledTimes(1)
        expect(harness.sends).toHaveLength(0)
        expect(internals(svc).pendingRestarts.size).toBe(0)
      })

      it('schedules nothing more when stopAll ran while its restart was in flight', async () => {
        await expect(svc.watchDirectory(ROOT, webContents)).rejects.toMatchObject({ code: 'ENOENT' })
        const releaseDepth = gateDepth()

        await vi.advanceTimersByTimeAsync(RESTART_DELAYS_MS[0])
        // The restart is waiting inside the watch start; the project closes meanwhile
        await svc.stopAll()
        releaseDepth()
        await vi.advanceTimersByTimeAsync(0)

        expect(internals(svc).pendingRestarts.size).toBe(0)
        expect(internals(svc).restartAttempts.size).toBe(0)
        await runRestartAttempts()
        // The overtaken restart builds nothing (R-L6)
        expect(harness.construct).toHaveBeenCalledTimes(1)
        expect(harness.sends).toHaveLength(0)
      })

      it('builds nothing and schedules no restart when stopAll overtook the first start itself', async () => {
        const releaseDepth = gateDepth()
        const starting = svc.watchDirectory(ROOT, webContents)

        await svc.stopAll()
        releaseDepth()

        await expect(starting).resolves.toBeUndefined()
        expect(harness.construct).not.toHaveBeenCalled()
        expect(internals(svc).pendingRestarts.size).toBe(0)
      })

      it('builds nothing and schedules no restart when the first start resumes while stopAll is still closing watchers', async () => {
        harness.construct.mockImplementationOnce(() => {})
        await svc.watchDirectory(inRoot('other'), webContents)
        let releaseClose: () => void = () => {}
        latestNative().close.mockImplementation(() => new Promise<void>(resolve => (releaseClose = resolve)))
        const releaseDepth = gateDepth()
        const starting = svc.watchDirectory(ROOT, webContents)

        const stopping = svc.stopAll()
        releaseDepth()
        await expect(starting).resolves.toBeUndefined()
        releaseClose()
        await stopping

        expect(harness.construct).toHaveBeenCalledTimes(1)
        expect(internals(svc).pendingRestarts.size).toBe(0)
      })
    })

    it('recovers from EMFILE on the native backend: tears down, then re-creates the watcher', async () => {
      await svc.watchDirectory(ROOT, webContents)
      const first = latestNative()

      first.emit('error', codeError('EMFILE'))

      expect(first.close).toHaveBeenCalledTimes(1)
      expect(internals(svc).watchedDirectories.has(ROOT)).toBe(false)
      expect(internals(svc).pendingRestarts.has(ROOT)).toBe(true)

      await vi.advanceTimersByTimeAsync(RESTART_DELAYS_MS[0])

      expect(harness.natives).toHaveLength(2)
      expect(latestNative().root).toBe(ROOT)
      expect(internals(svc).watchedDirectories.has(ROOT)).toBe(true)
      expect(sent('directory-watch:recovered')).toEqual([{ dirPath: ROOT }])
      expect(sent('directory-watch:changed')).toEqual([
        expect.objectContaining({ dirPath: ROOT, eventCount: 0, catchUp: true })
      ])
      expect(harness.chokidarWatch).not.toHaveBeenCalled()
    })
  })
})
