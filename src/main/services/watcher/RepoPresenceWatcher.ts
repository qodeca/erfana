// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * RepoPresenceWatcher - Detect when a folder becomes (or stops being) a git repo
 *
 * Watches the project's `.git` path itself, so that opening a non-repo folder
 * and running `git init` (or `git clone .`) makes the inner git-state watcher
 * + decorations come alive without a project reopen, and deleting `.git`
 * clears them again.
 *
 * Owns three concerns:
 *  - One chokidar watch on the `.git` path (NOT on the project root – watching
 *    the project root with an `ignored` predicate does not fire `addDir` for
 *    a newly-created `.git` child on Windows; verified empirically in the
 *    original implementation).
 *  - A debounced transition handler – `git init` writes HEAD/config/refs in
 *    rapid succession after creating `.git`; we coalesce that flurry into a
 *    single `'added'` callback.
 *  - Bounded restart-on-error – the inner watcher gets exponential-backoff
 *    recovery; the presence watcher gets the same so a transient chokidar
 *    error doesn't silently disable repo-transition detection for the session.
 *
 * Network drives: chokidar's README notes network shares "generally require
 * usePolling: true". This watcher does not auto-detect; if a project lives on
 * a slow network share, transitions may be missed. Manual refresh / polling
 * fallback in GitPollingService still drives the steady-state status.
 *
 * The kind passed to `onTransition` is *re-derived from disk* before firing
 * (not taken from the last debounced event), so a debounced `'added'` whose
 * `.git` is already gone by the time the timer fires correctly reports
 * `'removed'` instead.
 *
 * Refactored out of GitWatcherService (lens review #10/A4): the previous
 * inline implementation gave one class two responsibilities and two debounce
 * mechanisms.
 */

import chokidar, { FSWatcher } from 'chokidar'
import { access } from 'fs/promises'
import { basename, join } from 'path'
import { logger } from '../LoggingService'

/** Default debounce for `.git` presence transitions (ms). */
const DEFAULT_PRESENCE_DEBOUNCE_MS = 400

/** Base delay for restart-on-error exponential backoff (ms). */
const RESTART_BASE_DELAY_MS = 800

/** Max consecutive restart attempts before giving up. */
const MAX_RESTART_ATTEMPTS = 3

/** Notification kind: what happened to `.git`. */
export type RepoPresenceTransition = 'added' | 'removed'

export type RepoPresenceCallback = (transition: RepoPresenceTransition) => void | Promise<void>

export interface RepoPresenceOptions {
  /** Debounce window for rapid `.git` events (ms). */
  debounceMs?: number
}

export class RepoPresenceWatcher {
  private readonly projectPath: string
  private readonly gitDir: string
  private readonly onTransition: RepoPresenceCallback
  private readonly debounceMs: number

  private watcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempts = 0
  private disposed = false

  constructor(projectPath: string, onTransition: RepoPresenceCallback, opts: RepoPresenceOptions = {}) {
    this.projectPath = projectPath
    this.gitDir = join(projectPath, '.git')
    this.onTransition = onTransition
    this.debounceMs = opts.debounceMs ?? DEFAULT_PRESENCE_DEBOUNCE_MS
  }

  /** Begin watching. Idempotent: a second `start()` on the same instance is a no-op. */
  start(): void {
    if (this.disposed || this.watcher) return
    this.createWatcher()
  }

  /** Stop watching and release all timers + the chokidar instance. */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const w = this.watcher
    this.watcher = null
    if (w) {
      try { await w.close() } catch (error) {
        logger.warn('RepoPresenceWatcher: Error closing watcher', {
          projectPath: this.projectPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  private createWatcher(): void {
    if (this.disposed) return

    try {
      // depth:0 + ignored-predicate keeps the watcher's surface tiny:
      //  - It does NOT recurse into .git/objects (which can be huge during
      //    fetch/gc and would surface thousands of events).
      //  - The `ignored` predicate drops every direct child of .git
      //    (index.lock, ORIG_HEAD, COMMIT_EDITMSG, refs/) before our handler
      //    runs, so transient .git churn during a normal git operation
      //    doesn't reach us. We only react to events whose basename is `.git`.
      const watcher = chokidar.watch(this.gitDir, {
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        disableGlobbing: true,
        followSymlinks: false,
        depth: 0,
        ignored: (p: string) => p !== this.gitDir && basename(p) !== '.git'
      })

      const onAppear = (p: string): void => {
        if (basename(p) === '.git') this.scheduleTransition()
      }
      const onDisappear = (p: string): void => {
        if (basename(p) === '.git') this.scheduleTransition()
      }

      // Both `add`/`unlink` (when `.git` is a worktree gitdir-pointer file) and
      // `addDir`/`unlinkDir` (the common case) trigger a transition. We
      // re-derive the kind from disk inside the debounced handler, so any of
      // these events is enough to trigger a re-check.
      watcher.on('addDir', onAppear)
      watcher.on('add', onAppear)
      watcher.on('unlinkDir', onDisappear)
      watcher.on('unlink', onDisappear)
      watcher.on('error', (error: unknown) => {
        logger.warn('RepoPresenceWatcher: Chokidar error', {
          projectPath: this.projectPath,
          error: error instanceof Error ? error.message : String(error)
        })
        this.scheduleRestart()
      })

      this.watcher = watcher
    } catch (error) {
      // Construction itself failed (e.g. chokidar threw synchronously on this
      // platform). Schedule a bounded retry rather than degrading silently.
      logger.warn('RepoPresenceWatcher: Failed to create watcher', {
        projectPath: this.projectPath,
        error: error instanceof Error ? error.message : String(error)
      })
      this.scheduleRestart()
    }
  }

  /**
   * Debounce rapid filesystem events into one transition. `git init` writes
   * HEAD/index/refs immediately after creating `.git`; with `depth:0` we don't
   * see those individual writes, but the `addDir(.git)` arrives before chokidar
   * has settled. The debounce coalesces those edge events into one decision.
   */
  private scheduleTransition(): void {
    if (this.disposed) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.fireTransition()
    }, this.debounceMs)
  }

  /**
   * Resolve the *actual* current state from disk and notify the consumer.
   * We don't trust the last debounced event's polarity: a `.git`-then-no-`.git`
   * burst whose final event was `addDir` could otherwise broadcast `'added'`
   * for a `.git` that no longer exists.
   */
  private async fireTransition(): Promise<void> {
    if (this.disposed) return
    let kind: RepoPresenceTransition
    try {
      await access(this.gitDir)
      kind = 'added'
    } catch {
      kind = 'removed'
    }
    if (this.disposed) return
    try {
      await this.onTransition(kind)
    } catch (error) {
      logger.warn('RepoPresenceWatcher: onTransition handler threw', {
        projectPath: this.projectPath,
        kind,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Recreate the chokidar watch after an error, mirroring GitWatcherService's
   * inner-watcher exponential-backoff so transient errors don't silently
   * disable presence detection for the session.
   */
  private scheduleRestart(): void {
    if (this.disposed || this.restartTimer) return
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      logger.warn('RepoPresenceWatcher: Max restart attempts reached, giving up', {
        projectPath: this.projectPath,
        attempts: this.restartAttempts
      })
      return
    }
    const delay = RESTART_BASE_DELAY_MS * Math.pow(2, this.restartAttempts)
    this.restartAttempts++
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null
      if (this.disposed) return
      const old = this.watcher
      this.watcher = null
      if (old) {
        try { await old.close() } catch { /* swallow – we're restarting */ }
      }
      this.createWatcher()
      if (this.watcher) this.restartAttempts = 0
    }, delay)
  }
}
