// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `RepoPresenceWatcher`.
 *
 * This is the collaborator extracted out of `GitWatcherService` in the
 * lens-review follow-up (#10/A4). It owns:
 *   - the chokidar watch on the `.git` path itself (file *or* directory);
 *   - the debounce that coalesces `git init`'s flurry of writes into one
 *     transition;
 *   - re-deriving the actual transition kind from disk before firing, so a
 *     debounced stale `'added'` after a real removal correctly reports
 *     `'removed'` (lens review #13).
 *
 * Tests live in their own file because the chokidar mock here returns a fresh
 * per-call watcher (shape different from the shared-mock setup in
 * GitWatcherService.test.ts) – per CLAUDE.md test split policy.
 *
 * Covers lens-review test gaps:
 *   #23 – existing repoTransition tests resolved via the 5s ready timeout
 *         (degraded path); these tests advance only the 400ms debounce and
 *         disambiguate watchers by path, not by argument shape (#24);
 *   #26 – `.git` as a *file* (worktree pointer) `unlink` transition.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'

// --- hoisted mocks ----------------------------------------------------------

const createdWatchers: Array<{ watchPath: string; w: any }> = []

function makeWatcher(): any {
  const handlers: Record<string, ((arg?: any) => void) | undefined> = {}
  const w = {
    on: vi.fn((event: string, cb: (arg?: any) => void) => {
      handlers[event] = cb
      return w
    }),
    close: vi.fn().mockResolvedValue(undefined),
    _handlers: handlers,
  }
  return w
}

const mockChokidar = {
  watch: vi.fn((arg: unknown) => {
    const w = makeWatcher()
    createdWatchers.push({ watchPath: String(arg), w })
    return w
  }),
}

const mockLogger = {
  trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}

vi.mock('chokidar', () => ({ default: mockChokidar }))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))
vi.mock('fs/promises', () => ({ access: vi.fn() }))

// --- helpers ----------------------------------------------------------------

const PROJECT = path.join(path.sep === '\\' ? 'C:\\' : '/', 'presence-test-proj')
const GIT_DIR = path.join(PROJECT, '.git')

describe('RepoPresenceWatcher', () => {
  let RepoPresenceWatcher: typeof import('./RepoPresenceWatcher').RepoPresenceWatcher
  let fsPromises: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    createdWatchers.length = 0
    vi.resetModules()
    fsPromises = await import('fs/promises')
    RepoPresenceWatcher = (await import('./RepoPresenceWatcher')).RepoPresenceWatcher
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('watches the `.git` path itself, not the project root', async () => {
    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()

    expect(createdWatchers).toHaveLength(1)
    // Disambiguate by intent (the watched path), not by argument shape (#24).
    expect(createdWatchers[0].watchPath).toBe(GIT_DIR)
    await w.dispose()
  })

  it('uses chokidar opts that skip child .git churn (depth:0 + ignored predicate)', async () => {
    const w = new RepoPresenceWatcher(PROJECT, vi.fn())
    w.start()
    const opts = mockChokidar.watch.mock.calls[0][1] as Record<string, unknown>
    expect(opts.depth).toBe(0)
    expect(opts.ignoreInitial).toBe(true)
    expect(opts.followSymlinks).toBe(false)
    expect(typeof opts.ignored).toBe('function')
    const ignored = opts.ignored as (p: string) => boolean
    // The .git dir itself is NOT ignored (so chokidar can watch its appearance).
    expect(ignored(GIT_DIR)).toBe(false)
    // .git/index.lock and other transient child files ARE ignored.
    expect(ignored(path.join(GIT_DIR, 'index.lock'))).toBe(true)
    expect(ignored(path.join(GIT_DIR, 'HEAD'))).toBe(true)
    await w.dispose()
  })

  it('fires `added` when .git appears and access() succeeds', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)

    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()

    createdWatchers[0].w._handlers['addDir']!(GIT_DIR)
    await vi.advanceTimersByTimeAsync(400)

    expect(onTransition).toHaveBeenCalledTimes(1)
    expect(onTransition).toHaveBeenCalledWith('added')
    await w.dispose()
  })

  it('fires `removed` when .git disappears', async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))

    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()

    createdWatchers[0].w._handlers['unlinkDir']!(GIT_DIR)
    await vi.advanceTimersByTimeAsync(400)

    expect(onTransition).toHaveBeenCalledWith('removed')
    await w.dispose()
  })

  it('coalesces rapid events into a single transition (debounce)', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)

    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()
    const h = createdWatchers[0].w._handlers

    h['addDir']!(GIT_DIR)
    h['addDir']!(GIT_DIR)
    h['add']!(GIT_DIR)
    await vi.advanceTimersByTimeAsync(400)

    expect(onTransition).toHaveBeenCalledTimes(1)
    await w.dispose()
  })

  it('re-derives the kind from disk – a stale `added` after a real removal fires `removed`', async () => {
    // Lens review #13: previously the debounce kept only the last kind. A
    // create-then-remove burst whose final event was addDir would broadcast
    // `'added'` despite .git being gone. Now the kind is re-checked from disk.
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))

    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()
    const h = createdWatchers[0].w._handlers

    h['addDir']!(GIT_DIR)
    h['unlinkDir']!(GIT_DIR)
    h['addDir']!(GIT_DIR) // last event would have set kind='added' under the old logic
    await vi.advanceTimersByTimeAsync(400)

    expect(onTransition).toHaveBeenCalledWith('removed')
    await w.dispose()
  })

  it('ignores events for non-.git entries (basename guard)', async () => {
    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()
    const h = createdWatchers[0].w._handlers

    h['addDir']!(path.join(PROJECT, 'src'))
    h['add']!(path.join(PROJECT, 'README.md'))
    await vi.advanceTimersByTimeAsync(400)

    expect(onTransition).not.toHaveBeenCalled()
    await w.dispose()
  })

  it('fires `removed` on `unlink` of a `.git` *file* (worktree gitdir pointer)', async () => {
    // Lens review #26: the file-removal transition was untested previously.
    // Worktrees / submodules use `.git` as a file containing `gitdir: <path>`,
    // so the watcher must react to `unlink` (file), not just `unlinkDir`.
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))

    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()

    createdWatchers[0].w._handlers['unlink']!(GIT_DIR)
    await vi.advanceTimersByTimeAsync(400)

    expect(onTransition).toHaveBeenCalledWith('removed')
    await w.dispose()
  })

  it('dispose() cancels a pending debounce and closes the watcher', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)

    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()
    createdWatchers[0].w._handlers['addDir']!(GIT_DIR)

    await w.dispose()
    await vi.advanceTimersByTimeAsync(1000) // flush any leftover timers

    expect(onTransition).not.toHaveBeenCalled()
    expect(createdWatchers[0].w.close).toHaveBeenCalled()
  })

  it('reschedules the chokidar watch with exponential backoff on `error`', async () => {
    const onTransition = vi.fn()
    const w = new RepoPresenceWatcher(PROJECT, onTransition)
    w.start()
    expect(createdWatchers).toHaveLength(1)

    // Simulate a transient chokidar error.
    createdWatchers[0].w._handlers['error']!(new Error('EMFILE'))
    await vi.advanceTimersByTimeAsync(800)

    // A new chokidar.watch() should have been created (restart).
    expect(createdWatchers.length).toBeGreaterThanOrEqual(2)
    expect(createdWatchers[createdWatchers.length - 1].watchPath).toBe(GIT_DIR)

    await w.dispose()
  })
})
