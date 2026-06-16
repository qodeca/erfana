// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the `.git` presence watcher in GitWatcherService – the repo
 * transition feature (a folder becoming, or ceasing to be, a git repo while it
 * stays open: `git init` / clone into an open folder, or `rm .git`).
 *
 * The presence watcher is a SEPARATE chokidar watch on the project's `.git`
 * path (string arg), distinct from the inner git-state watcher (array arg).
 * On `addDir`/`add` of `.git` it (re)starts the inner watcher; on
 * `unlinkDir`/`unlink` it tears the inner watcher down. Either way it broadcasts
 * `git:state-changed` with `eventTypes: ['repo']` so the renderer re-fetches.
 *
 * Split into its own file (per CLAUDE.md test-split policy) because the chokidar
 * mock returns a fresh per-call watcher – different shape from the shared-mock
 * setup in GitWatcherService.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'

// --- hoisted mocks ----------------------------------------------------------

const createdWatchers: Array<{ arg: unknown; w: any }> = []

function makeWatcher(): any {
  const handlers: Record<string, ((arg?: any) => void) | undefined> = {}
  const w = {
    on: vi.fn((event: string, cb: (arg?: any) => void) => {
      handlers[event] = cb
      return w
    }),
    close: vi.fn().mockResolvedValue(undefined),
    _handlers: handlers,
    _emitReady: () => handlers['ready']?.(),
  }
  return w
}

const mockChokidar = {
  watch: vi.fn((arg: unknown) => {
    const w = makeWatcher()
    createdWatchers.push({ arg, w })
    return w
  }),
}

const mockBrowserWindows: any[] = []
const sendSpy = vi.fn()

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

vi.mock('chokidar', () => ({ default: mockChokidar }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => mockBrowserWindows) },
}))
vi.mock('./LoggingService', () => ({ logger: mockLogger }))
vi.mock('./watcher/WatcherMetrics', () => ({
  watcherMetrics: {
    recordGitWatcherEvent: vi.fn(),
    getSnapshot: vi.fn(() => ({
      uptimeMs: 0,
      gitWatcherEventCount: 0,
      pollingRefreshCount: 0,
      pollingSkippedCount: 0,
      pollingEfficiency: 0,
      restartScheduled: 0,
      errorCounts: {},
    })),
  },
}))
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  stat: vi.fn(),
}))

// --- helpers ----------------------------------------------------------------

const PROJECT = path.join(path.sep === '\\' ? 'C:\\' : '/', 'repo-transition-proj')
const GIT_DIR = path.join(PROJECT, '.git')

function presenceWatcher(): any | undefined {
  return createdWatchers.find((x) => typeof x.arg === 'string')?.w
}
function innerWatcher(): any | undefined {
  return createdWatchers.find((x) => Array.isArray(x.arg))?.w
}
function repoBroadcasts(): any[] {
  return sendSpy.mock.calls.filter(
    (c) => c[0] === 'git:state-changed' && Array.isArray(c[1]?.eventTypes) && c[1].eventTypes.includes('repo')
  )
}

describe('GitWatcherService – .git presence watcher (repo transitions)', () => {
  let service: any
  let fsPromises: any
  let WATCHER_READY_TIMEOUT_MS: number

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    createdWatchers.length = 0
    mockBrowserWindows.length = 0
    mockBrowserWindows.push({ isDestroyed: () => false, webContents: { send: sendSpy } })

    vi.resetModules()
    fsPromises = await import('fs/promises')
    const module = await import('./GitWatcherService')
    service = module.gitWatcherService
    WATCHER_READY_TIMEOUT_MS = module.WATCHER_READY_TIMEOUT_MS

    // Default: git paths exist (used once .git is present)
    vi.mocked(fsPromises.stat).mockResolvedValue({ mtimeMs: Date.now(), size: 1024 } as any)
  })

  afterEach(async () => {
    await service.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** Start on a folder where `.git` already exists, resolving the inner watcher's ready. */
  async function startOnRepo(): Promise<void> {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    const p = service.start(PROJECT)
    await vi.advanceTimersByTimeAsync(0)
    innerWatcher()?._emitReady()
    await p
  }

  it('starts on a non-repo folder with only a presence watcher (no inner watcher)', async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))

    const result = await service.start(PROJECT)

    expect(result.success).toBe(true)
    expect(presenceWatcher()).toBeDefined()
    expect(createdWatchers.find((x) => typeof x.arg === 'string')!.arg).toBe(GIT_DIR)
    expect(innerWatcher()).toBeUndefined()
  })

  it('starts the inner watcher and broadcasts a repo event when .git appears (git init)', async () => {
    // Open a plain folder (no .git yet)
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))
    await service.start(PROJECT)
    expect(innerWatcher()).toBeUndefined()

    // Simulate `git init`: .git now exists
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)

    // Fire the presence watcher's addDir for `.git`
    presenceWatcher()!._handlers['addDir']!(GIT_DIR)

    // Debounce (400ms) → applyRepoTransition → createWatcher (inner)
    await vi.advanceTimersByTimeAsync(400)
    // Resolve the inner watcher's ready timeout so createWatcher completes
    await vi.advanceTimersByTimeAsync(WATCHER_READY_TIMEOUT_MS + 10)

    expect(innerWatcher()).toBeDefined()
    expect(repoBroadcasts().length).toBe(1)
    expect(repoBroadcasts()[0][1]).toMatchObject({ projectPath: PROJECT, eventTypes: ['repo'] })
  })

  it('tears the inner watcher down and broadcasts a repo event when .git is removed', async () => {
    await startOnRepo()
    const inner = innerWatcher()
    expect(inner).toBeDefined()
    sendSpy.mockClear()

    // Simulate `rm .git`
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))
    presenceWatcher()!._handlers['unlinkDir']!(GIT_DIR)

    await vi.advanceTimersByTimeAsync(400)

    expect(inner.close).toHaveBeenCalled()
    expect(service.isWatching()).toBe(false)
    expect(repoBroadcasts().length).toBe(1)
    expect(repoBroadcasts()[0][1]).toMatchObject({ projectPath: PROJECT, eventTypes: ['repo'] })
  })

  it('coalesces rapid presence events into a single transition (debounce)', async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))
    await service.start(PROJECT)
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)

    const presence = presenceWatcher()!
    presence._handlers['addDir']!(GIT_DIR)
    presence._handlers['addDir']!(GIT_DIR)
    presence._handlers['add']!(GIT_DIR)

    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(WATCHER_READY_TIMEOUT_MS + 10)

    // Three rapid events, one transition.
    expect(repoBroadcasts().length).toBe(1)
  })

  it('ignores presence events for non-.git entries', async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))
    await service.start(PROJECT)

    presenceWatcher()!._handlers['addDir']!(path.join(PROJECT, 'src'))
    await vi.advanceTimersByTimeAsync(400)

    expect(repoBroadcasts().length).toBe(0)
  })

  it('drops a late presence event after the watcher was stopped (stale guard)', async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))
    await service.start(PROJECT)
    const presence = presenceWatcher()!

    await service.stop() // clears presenceWatcherPath
    sendSpy.mockClear()

    presence._handlers['addDir']!(GIT_DIR)
    await vi.advanceTimersByTimeAsync(400)

    expect(repoBroadcasts().length).toBe(0)
  })
})
