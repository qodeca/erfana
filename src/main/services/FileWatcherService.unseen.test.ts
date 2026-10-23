// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Open files the project watcher cannot speak for (#252).
 *
 * Renaming `.github` while `.github/workflows/ci.yml` was open gave no
 * "deleted" banner: the project watcher filters that folder out, and a
 * single-file watch hears nothing when a folder above the file goes away.
 * `watchUnseenFiles` re-checks such files on a timer; `checkWatchedFilesUnder`
 * re-checks the files under a folder whose removals a pause lost. Both only
 * ever look at this session's files inside the project.
 *
 * Real files in `os.tmpdir()`. The rename case uses the real chokidar watch;
 * the others seed watch entries with fake watchers, so no file handle is held
 * and nothing but the code under test can call the unlink branch. Only
 * Electron is mocked, at module scope - hence a file of its own. Waits are
 * condition-based polls, never fixed sleeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { WebContents } from 'electron'
import { SubscriberCounter } from './watcher/SubscriberCounter'

const sends = vi.hoisted(() => [] as Array<{ channel: string; payload: Record<string, unknown> }>)

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) => sends.push({ channel, payload })
        }
      }
    ])
  }
}))

import { FileWatcherService } from './FileWatcherService'
import { MISSING_ROUNDS_TO_REPORT, UNSEEN_PROBE_INTERVAL_MS, type RemovalCoverage } from './watcher/unseenWatchProbe'

/** Two probe rounds, the 100 ms atomic-save window and the existence re-check, with CI headroom. */
const EVENT_BUDGET_MS = UNSEEN_PROBE_INTERVAL_MS * MISSING_ROUNDS_TO_REPORT + 6_000
/** A test that waits on real probe rounds needs more than vitest's 5 s default. */
const REAL_ROUNDS_TEST_MS = EVENT_BUDGET_MS + 3_000
const webContents = { id: 1 } as unknown as WebContents

interface ServiceInternals {
  watchedFiles: Map<string, unknown>
  switchVersion: number
  handleFileDeleted: (filePath: string) => void
}

interface FakeCoverage extends RemovalCoverage {
  fire(): void
  listenerCount(): number
}

function fakeCoverage(covered: (filePath: string) => boolean): FakeCoverage {
  const listeners = new Set<() => void>()
  return {
    reportsRemovalsAbove: covered,
    isOwnRemoval: () => false,
    onCoverageChanged: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    fire: () => {
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size
  }
}

describe('FileWatcherService – files the project watcher cannot see (#252)', () => {
  let root: string
  let svc: FileWatcherService

  beforeEach(async () => {
    sends.length = 0
    root = await realpath(await mkdtemp(join(tmpdir(), 'erfana-unseen-')))
    await mkdir(join(root, '.github', 'workflows'), { recursive: true })
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci')
    await writeFile(join(root, 'docs', 'open.md'), '# open')
    await writeFile(join(root, 'docs', 'kept.md'), '# kept')
    svc = new FileWatcherService()
    svc.setProjectPath(root)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await svc.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const internals = (): ServiceInternals => svc as unknown as ServiceInternals
  const deleted = (): string[] =>
    sends.filter(s => s.channel === 'file-watch:deleted').map(s => String(s.payload.filePath))

  /** A watch entry with a fake watcher: no handle, no event of its own. */
  function seedWatch(filePath: string, version = internals().switchVersion): void {
    internals().watchedFiles.set(filePath, {
      filePath,
      watcher: { close: vi.fn(async () => {}) },
      subscribers: SubscriberCounter.from([webContents.id]),
      isPaused: false,
      debounceTimer: null,
      version
    })
  }

  // Windows refuses to rename a folder while a watch holds a handle inside it (EPERM),
  // so this real-fs rename needs a POSIX host.
  it.skipIf(process.platform === 'win32')(
    'marks an open file deleted when a filtered-out folder above it is renamed',
    async () => {
      const ci = join(root, '.github', 'workflows', 'ci.yml')
      svc.watchUnseenFiles(fakeCoverage(() => false))
      await svc.watchFile(ci, webContents)

      await rename(join(root, '.github'), join(root, '.github2'))

      await vi.waitFor(() => expect(deleted()).toEqual([ci]), { timeout: EVENT_BUDGET_MS })
      expect(svc.getStats().totalWatched).toBe(0)
    },
    REAL_ROUNDS_TEST_MS
  )

  it(
    'leaves a file the project watcher covers to the project watcher',
    async () => {
      const covered = join(root, 'docs', 'gone-covered.md')
      const unseen = join(root, '.github', 'workflows', 'gone-unseen.yml')
      // Both are missing on disk; the covered one comes first in the round
      seedWatch(covered)
      seedWatch(unseen)
      const handleFileDeleted = vi.spyOn(internals(), 'handleFileDeleted')

      svc.watchUnseenFiles(fakeCoverage(filePath => filePath === covered))

      await vi.waitFor(() => expect(handleFileDeleted).toHaveBeenCalledWith(unseen), {
        timeout: EVENT_BUDGET_MS
      })
      expect(handleFileDeleted).not.toHaveBeenCalledWith(covered)
    },
    REAL_ROUNDS_TEST_MS
  )

  it('re-checks the watched files under a folder that lost removals, except the operation’s own', async () => {
    const open = join(root, 'docs', 'open.md')
    const kept = join(root, 'docs', 'kept.md')
    const own = join(root, 'docs', 'moved', 'own.md')
    const elsewhere = join(root, 'other', 'gone.md')
    seedWatch(open)
    seedWatch(kept)
    seedWatch(own)
    seedWatch(elsewhere)
    await rm(open)
    const handleFileDeleted = vi.spyOn(internals(), 'handleFileDeleted')

    await svc.checkWatchedFilesUnder(join(root, 'docs'), filePath => filePath === own)

    expect(handleFileDeleted.mock.calls).toEqual([[open]])
  })

  it('never checks a file outside the project or from an earlier session', async () => {
    const inside = join(root, 'docs', 'gone.md')
    const outside = join(`${root}-sibling`, 'gone.md')
    const stale = join(root, 'docs', 'stale.md')
    seedWatch(inside)
    seedWatch(outside)
    seedWatch(stale, internals().switchVersion - 1)
    const handleFileDeleted = vi.spyOn(internals(), 'handleFileDeleted')

    // A root wide enough to hold all three
    await svc.checkWatchedFilesUnder(dirname(root))

    expect(handleFileDeleted.mock.calls).toEqual([[inside]])
  })

  it('checks nothing once disposed', async () => {
    seedWatch(join(root, 'docs', 'gone.md'))
    const handleFileDeleted = vi.spyOn(internals(), 'handleFileDeleted')
    await svc.dispose()

    await svc.checkWatchedFilesUnder(root)

    expect(handleFileDeleted).not.toHaveBeenCalled()
  })

  it('arms the probe only while some watched file is unseen', () => {
    vi.useFakeTimers()
    seedWatch(join(root, 'docs', 'open.md'))
    let covered = true
    const coverage = fakeCoverage(() => covered)

    svc.watchUnseenFiles(coverage)
    expect(vi.getTimerCount()).toBe(0)

    covered = false
    coverage.fire()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('arms nothing without a project: the probe never reaches outside one', () => {
    vi.useFakeTimers()
    const noProject = new FileWatcherService()
    ;(noProject as unknown as ServiceInternals).watchedFiles.set('/anywhere/open.md', {
      filePath: '/anywhere/open.md',
      watcher: { close: vi.fn(async () => {}) },
      subscribers: SubscriberCounter.from([webContents.id]),
      isPaused: false,
      debounceTimer: null,
      version: 0
    })

    noProject.watchUnseenFiles(fakeCoverage(() => false))

    expect(vi.getTimerCount()).toBe(0)
    void noProject.dispose()
  })

  it('stops the probe on a project switch, and arms it again for the next project', async () => {
    vi.useFakeTimers()
    seedWatch(join(root, 'docs', 'open.md'))
    svc.watchUnseenFiles(fakeCoverage(() => false))
    expect(vi.getTimerCount()).toBe(1)

    await svc.stopAll()
    expect(vi.getTimerCount()).toBe(0)

    seedWatch(join(root, 'docs', 'kept.md'))
    // watchFile tells the probe about a new watch; a seeded one needs a nudge
    svc.watchUnseenFiles(fakeCoverage(() => false))
    expect(vi.getTimerCount()).toBe(1)
  })

  it('stops for good on dispose and lets go of the coverage', async () => {
    vi.useFakeTimers()
    seedWatch(join(root, 'docs', 'open.md'))
    const coverage = fakeCoverage(() => false)
    svc.watchUnseenFiles(coverage)
    expect(coverage.listenerCount()).toBe(1)

    await svc.dispose()

    expect(vi.getTimerCount()).toBe(0)
    expect(coverage.listenerCount()).toBe(0)
  })

  it('takes a newer coverage in place of the older one', () => {
    const first = fakeCoverage(() => true)
    const second = fakeCoverage(() => true)

    svc.watchUnseenFiles(first)
    svc.watchUnseenFiles(second)

    expect(first.listenerCount()).toBe(0)
    expect(second.listenerCount()).toBe(1)
  })
})
