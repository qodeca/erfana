// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DirectoryWatcherService path filter (issue #211, design D4, D13, D14; AC4).
 *
 * The project path filter decides twice: as chokidar's `ignored` option, so an
 * excluded, hidden or ignored folder is not watched at all, and again in
 * `queueEvent` as a backstop, before pause accounting and before metrics. A
 * dropped path is therefore never a missed change while paused, never counted
 * as received, and a burst made only of dropped paths sends nothing – so it
 * starts neither a tree re-read nor a git refresh in the renderer.
 *
 * The project deliberately lives under a folder named `build`: the old ignore
 * check was a substring test on the absolute path, so such a project was never
 * watched.
 */
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

type Listener = (path: string) => void

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  handlers: new Map<string, (path: string) => void>(),
  watch: vi.fn()
}))

vi.mock('chokidar', () => ({ default: { watch: harness.watch }, watch: harness.watch }))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) =>
            harness.sends.push({ channel, payload })
        }
      }
    ])
  }
}))

vi.mock('./SettingsService', () => ({
  settingsService: { getDirectoryWatchDepth: vi.fn(async () => undefined) }
}))

vi.mock('../utils/pathSecurity', () => ({ isSystemDirectory: vi.fn(() => false) }))

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { DirectoryWatcherService } from './DirectoryWatcherService'
import { PauseEpisode } from './watcher'
import { ProjectPathFilter } from '../utils/projectPathFilter'

const ROOT = '/work/build/proj'
const OWNER = 1
const FLUSH_MS = 1000
const webContents = { id: OWNER } as unknown as WebContents

/** Paths the default filter drops: hidden (`.git`, `node_modules`) or ignored (`dist`). */
const DEFAULT_DROPPED = [`${ROOT}/.git/index.lock`, `${ROOT}/node_modules/pkg/a.js`, `${ROOT}/pkg/dist/b.js`]

function projectFilter(root: string, exclude: string[] = ['scratch', '**/test-tmp']): ProjectPathFilter {
  return new ProjectPathFilter(root, {
    exclude,
    hiddenPatterns: ['.git', 'secret'],
    ignorePatterns: ['node_modules', 'dist'],
    caseSensitive: true
  })
}

/** Start a watch through the real `watchDirectory` and hand back chokidar's side of it. */
async function startWatch(
  svc: DirectoryWatcherService,
  dirPath: string
): Promise<{ ignored: (path: string) => boolean; emit: (event: string, path: string) => void }> {
  await svc.watchDirectory(dirPath, webContents)
  const options = harness.watch.mock.calls.at(-1)?.[1] as { ignored: (path: string) => boolean }
  return {
    ignored: options.ignored,
    emit: (event, eventPath) => {
      const handler = harness.handlers.get(event)
      if (!handler) throw new Error(`no '${event}' listener registered`)
      handler(eventPath)
    }
  }
}

function changedSends(): Array<Record<string, unknown>> {
  return harness.sends.filter(s => s.channel === 'directory-watch:changed').map(s => s.payload)
}

describe('DirectoryWatcherService path filter (#211)', () => {
  let svc: DirectoryWatcherService

  beforeEach(() => {
    vi.useFakeTimers()
    harness.sends.length = 0
    harness.handlers.clear()
    harness.watch.mockReset()
    harness.watch.mockImplementation(() => {
      const watcher = {
        on: vi.fn((event: string, listener: Listener) => {
          harness.handlers.set(event, listener)
          return watcher
        }),
        close: vi.fn(async () => {})
      }
      return watcher
    })
    svc = new DirectoryWatcherService()
    svc.setProjectPath(ROOT)
  })

  afterEach(async () => {
    await svc.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe("chokidar's ignored option", () => {
    it('drops excluded, hidden and ignored paths and keeps the root and visible paths', async () => {
      svc.setPathFilter(projectFilter(ROOT))
      const { ignored } = await startWatch(svc, ROOT)

      expect(ignored(ROOT)).toBe(false)
      expect(ignored(`${ROOT}/src/a.md`)).toBe(false)
      expect(ignored(`${ROOT}/.github/workflows/ci.yml`)).toBe(false)

      // Excluded: a path entry and everything under it, and a pattern entry anywhere
      expect(ignored(`${ROOT}/scratch`)).toBe(true)
      expect(ignored(`${ROOT}/scratch/deep/x.log`)).toBe(true)
      expect(ignored(`${ROOT}/pkg/test-tmp/a.txt`)).toBe(true)
      // Hidden: any segment equal to a hidden name
      expect(ignored(`${ROOT}/.git`)).toBe(true)
      expect(ignored(`${ROOT}/.git/index.lock`)).toBe(true)
      expect(ignored(`${ROOT}/docs/secret/a.md`)).toBe(true)
      // Ignored: the substring rule on the project-relative path
      expect(ignored(`${ROOT}/node_modules/pkg/index.js`)).toBe(true)
      expect(ignored(`${ROOT}/pkg/dist/bundle.js`)).toBe(true)
    })

    it('measures the default ignore list from the project root, so a project under "build" is watched', async () => {
      const { ignored } = await startWatch(svc, ROOT)

      expect(ignored(`${ROOT}/notes.md`)).toBe(false)
      expect(ignored(`${ROOT}/build/out.js`)).toBe(true)
      expect(ignored(`${ROOT}/.git/index.lock`)).toBe(true)
    })

    it('drops a path outside the project, including a sibling sharing its prefix (fail closed)', async () => {
      const { ignored } = await startWatch(svc, ROOT)

      expect(ignored('/elsewhere/a.md')).toBe(true)
      expect(ignored('/work/build/proj-x/a.md')).toBe(true)
    })

    it('applies the list against the project root on a subfolder watch', async () => {
      svc.setPathFilter(projectFilter(ROOT, ['sub/scratch']))
      const { ignored } = await startWatch(svc, `${ROOT}/sub`)

      expect(ignored(`${ROOT}/sub/a.md`)).toBe(false)
      expect(ignored(`${ROOT}/sub/scratch/a.md`)).toBe(true)
    })

    it('takes paths against the watch root when no project is set', async () => {
      const unscoped = new DirectoryWatcherService()
      try {
        const { ignored } = await startWatch(unscoped, '/proj')

        expect(ignored('/proj/a.md')).toBe(false)
        expect(ignored('/proj/node_modules/a.js')).toBe(true)
      } finally {
        await unscoped.dispose()
      }
    })

    it("accepts chokidar's forward-slash spelling of the platform path", async () => {
      // anymatch hands `ignored` a `/`-separated path, also on Windows
      const nativeRoot = path.resolve(ROOT)
      const slashRoot = nativeRoot.split(path.sep).join('/')
      svc.setProjectPath(nativeRoot)
      svc.setPathFilter(projectFilter(nativeRoot))
      const { ignored } = await startWatch(svc, nativeRoot)

      expect(ignored(`${slashRoot}/src/a.md`)).toBe(false)
      expect(ignored(`${slashRoot}/scratch/a.md`)).toBe(true)
      expect(ignored(`${slashRoot}/.git/index.lock`)).toBe(true)
    })
  })

  describe('queueEvent backstop', () => {
    it('a dropped event never reaches the pause episode, so resume sends no catch-up', async () => {
      const recordDrop = vi.spyOn(PauseEpisode.prototype, 'recordDrop')
      const { emit } = await startWatch(svc, ROOT)

      svc.pauseWatch(ROOT, OWNER)
      for (const dropped of DEFAULT_DROPPED) emit('add', dropped)
      emit('unlinkDir', `${ROOT}/node_modules/pkg`)
      svc.resumeWatch(ROOT)
      vi.advanceTimersByTime(FLUSH_MS)

      expect(recordDrop).not.toHaveBeenCalled()
      expect(harness.sends).toHaveLength(0)
      expect(svc.getStats().metrics).toEqual(
        expect.objectContaining({ eventsReceived: 0, eventsFiltered: DEFAULT_DROPPED.length + 1 })
      )
    })

    it('a visible change dropped while paused still earns its catch-up', async () => {
      const recordDrop = vi.spyOn(PauseEpisode.prototype, 'recordDrop')
      const { emit } = await startWatch(svc, ROOT)

      svc.pauseWatch(ROOT, OWNER)
      emit('add', `${ROOT}/visible.md`)
      svc.resumeWatch(ROOT)

      expect(recordDrop).toHaveBeenCalledTimes(1)
      expect(changedSends()).toEqual([expect.objectContaining({ catchUp: true })])
    })

    it('a burst of only excluded, hidden and ignored paths broadcasts nothing', async () => {
      svc.setPathFilter(projectFilter(ROOT))
      const { emit } = await startWatch(svc, ROOT)
      const events = ['add', 'addDir', 'unlink', 'unlinkDir', 'change']
      const burst = [`${ROOT}/scratch/f`, `${ROOT}/a/test-tmp/f`, `${ROOT}/docs/secret/f`, `${ROOT}/pkg/dist/f`]

      for (let i = 0; i < 40; i++) {
        for (const event of events) emit(event, `${burst[i % burst.length]}${i}`)
      }
      vi.advanceTimersByTime(FLUSH_MS)

      expect(harness.sends).toHaveLength(0)
      expect(svc.getStats().metrics).toEqual(
        expect.objectContaining({ eventsReceived: 0, eventsFiltered: 40 * events.length })
      )
    })

    it('a mixed burst broadcasts only its visible events', async () => {
      const { emit } = await startWatch(svc, ROOT)

      for (const dropped of DEFAULT_DROPPED) emit('add', dropped)
      emit('add', `${ROOT}/notes/new.md`)
      vi.advanceTimersByTime(FLUSH_MS)

      expect(changedSends()).toEqual([
        expect.objectContaining({ eventCount: 1, originalEventCount: 1, summary: { add: 1 } })
      ])
      expect(svc.getStats().metrics.eventsReceived).toBe(1)
    })
  })

  describe('setPathFilter', () => {
    it('replaces the filter for later events and for the running watch', async () => {
      const { ignored, emit } = await startWatch(svc, ROOT)
      expect(ignored(`${ROOT}/.git/index.lock`)).toBe(true)

      svc.setPathFilter(
        new ProjectPathFilter(ROOT, {
          exclude: ['scratch'],
          hiddenPatterns: [],
          ignorePatterns: [],
          caseSensitive: true
        })
      )

      expect(ignored(`${ROOT}/.git/index.lock`)).toBe(false)
      expect(ignored(`${ROOT}/scratch/a.md`)).toBe(true)

      emit('add', `${ROOT}/.git/index.lock`)
      emit('add', `${ROOT}/scratch/a.md`)
      vi.advanceTimersByTime(FLUSH_MS)

      expect(changedSends()).toEqual([expect.objectContaining({ eventCount: 1, summary: { add: 1 } })])
    })

    it('counts the exclude-matcher budget overruns its drop tests cause', async () => {
      let overruns = 0
      const costlyFilter = {
        excludeMatcher: {
          get budgetExceeded(): number {
            return overruns
          }
        },
        shouldDrop: (): boolean => {
          overruns += 2
          return false
        }
      } as unknown as ProjectPathFilter
      svc.setPathFilter(costlyFilter)
      const { emit } = await startWatch(svc, ROOT)
      // Overruns caused elsewhere (the tree walk shares the matcher) are not counted
      overruns = 10

      emit('add', `${ROOT}/a.md`)

      expect(svc.getStats().metrics.matcherBudgetExceeded).toBe(2)
    })
  })
})
