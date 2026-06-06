/**
 * GitWatcherService - Centralized git state watching with multi-path support
 *
 * Watches key git state files to detect external git operations:
 * - .git/index      → Staging area (git add, reset)
 * - .git/HEAD       → Current branch/commit (git checkout, switch)
 * - .git/refs/heads → Branch pointers (git branch, merge)
 * - .git/FETCH_HEAD → Last fetch info (git fetch)
 * - .git/stash      → Stash reference (git stash)
 *
 * Features:
 * - 150ms event coalescing (via GitEventCoalescer)
 * - Session tokens to ignore stale events during project switches
 * - Auto-recovery with exponential backoff on transient errors
 * - IPC broadcast 'git:state-changed' on detected changes
 *
 * Design:
 * - Singleton pattern for centralized state
 * - Replaces the git index watcher in DirectoryWatcherService
 * - Coordinates with GitPollingService for hybrid fallback
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 */

import chokidar, { FSWatcher } from 'chokidar'
import { access, stat } from 'fs/promises'
import { basename, join } from 'path'
import { GitEventCoalescer, classifyGitPath, type GitEventType } from './watcher/GitEventCoalescer'
import { logger } from './LoggingService'
import { broadcastToAllWindows } from '../utils/ipcBroadcast'
import { watcherMetrics } from './watcher/WatcherMetrics'
import type { IGitWatcherService } from '../interfaces/IGitWatcherService'
import type { GitStateChangeEvent } from '../../shared/ipc/git-watcher-schema'

/** Coalescing window for git events (ms) */
const GIT_COALESCE_WINDOW_MS = 150

/** Timeout for chokidar ready event before fallback (ms)
 *
 * Chokidar v4 uses a counter-based ready mechanism – if any watched path
 * fails to complete its initial scan, the ready event never fires.
 * Known causes: CPU contention during Electron startup, non-existent paths
 * between stat check and watch call, large .git directories with many refs.
 *
 * @see Issue #136 - Investigate chokidar ready timeout fallback
 * @see https://github.com/paulmillr/chokidar/issues/873
 * @see https://github.com/paulmillr/chokidar/issues/949
 */
export const WATCHER_READY_TIMEOUT_MS = 5000

/** Maximum restart attempts before giving up */
const MAX_RESTART_ATTEMPTS = 3

/** Base delay for exponential backoff (ms) */
const RESTART_BASE_DELAY_MS = 800

/** Health logger interval (5 minutes) - ADR-Spec003-002 */
const HEALTH_LOG_INTERVAL_MS = 5 * 60 * 1000

/** Polling efficiency threshold for degraded state warning (%) - ADR-Spec003-002 */
const HIGH_POLLING_DEPENDENCY_THRESHOLD = 80

/**
 * Debounce for `.git` presence transitions (ms).
 *
 * `git init` creates the `.git` directory and then writes HEAD/config/refs into
 * it in rapid succession; debouncing lets the directory settle before we react.
 */
const REPO_PRESENCE_DEBOUNCE_MS = 400

/** Git paths to watch (relative to project root) */
const GIT_WATCH_PATHS = [
  '.git/index',
  '.git/HEAD',
  '.git/refs/heads',
  '.git/FETCH_HEAD',
  '.git/stash'
] as const

/**
 * Internal state for active git watcher
 */
interface ActiveWatcher {
  /** Chokidar watcher instance */
  watcher: FSWatcher
  /** Path to project root */
  projectPath: string
  /** Session version for stale event detection */
  version: number
  /** Event coalescer instance */
  coalescer: GitEventCoalescer
}

/**
 * GitWatcherService
 *
 * Singleton service for watching git state changes.
 * Use `gitWatcherService.start(projectPath)` to begin watching.
 */
export class GitWatcherService implements IGitWatcherService {
  /** Active watcher state (null when not watching) */
  private activeWatcher: ActiveWatcher | null = null

  /** Session version counter for stale event detection */
  private sessionVersion = 0

  /** Disposal flag to prevent operations during cleanup */
  private isDisposing = false

  /** Restart attempts counter */
  private restartAttempts = 0

  /** Pending restart timer */
  private pendingRestart: NodeJS.Timeout | null = null

  /** Timestamp of last emitted event (for polling coordination) */
  private lastEventTimestamp: number | null = null

  /** Health logger interval timer - ADR-Spec003-002 */
  private healthLogInterval: NodeJS.Timeout | null = null

  /**
   * Watcher for the `.git` path itself – detects a repo appearing (`git init` /
   * clone into an open folder) or disappearing (`rm .git`). Lives for the whole
   * time a project is open, independent of the inner git-state watcher.
   */
  private presenceWatcher: FSWatcher | null = null

  /** Project root the presence watcher is bound to (identity guard for debounced callbacks) */
  private presenceWatcherPath: string | null = null

  /** Debounce timer for `.git` presence transitions */
  private presenceDebounce: NodeJS.Timeout | null = null

  /**
   * Start watching git state for a project
   *
   * Automatically stops any existing watcher before starting. Always starts a
   * presence watcher on the project's `.git` path (even for a non-repo folder,
   * to catch a later `git init`); the inner git-state watcher starts only if
   * `.git` already exists.
   *
   * @param projectPath - Absolute path to project root
   * @returns Promise resolving when watcher is ready
   */
  async start(projectPath: string): Promise<{ success: boolean; error?: string }> {
    // Stop existing watcher
    await this.stop()

    // Reset restart state
    this.restartAttempts = 0
    logger.info('GitWatcherService: Starting watcher', { projectPath })
    if (this.pendingRestart) {
      clearTimeout(this.pendingRestart)
      this.pendingRestart = null
    }

    // Increment session to invalidate any stale events
    this.sessionVersion++

    // Always watch the `.git` path itself so we react when this folder becomes
    // (git init / clone) or stops being (rm .git) a repo while it stays open.
    this.createPresenceWatcher(projectPath)

    // Check if .git directory exists right now
    const gitDir = join(projectPath, '.git')
    try {
      await access(gitDir)
    } catch {
      logger.debug('GitWatcherService: No .git directory yet (presence watcher active)', { projectPath })
      return { success: true } // Not a repo yet; presence watcher will catch `git init`
    }

    try {
      return await this.createWatcher(projectPath)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // Always pass an Error object to logger (Issue #74 review fix)
      const logError = error instanceof Error ? error : new Error(String(error))
      logger.error('GitWatcherService: Failed to start watcher', logError, {
        projectPath
      })
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Stop watching git state
   *
   * Safe to call even if not currently watching.
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
    // Stop health logger (ADR-Spec003-002)
    this.stopHealthLogger()

    // Clear pending restart
    if (this.pendingRestart) {
      clearTimeout(this.pendingRestart)
      this.pendingRestart = null
    }

    // Tear down the presence watcher (it can exist even when there is no inner
    // watcher – e.g. a non-repo folder waiting for `git init`).
    if (this.presenceDebounce) {
      clearTimeout(this.presenceDebounce)
      this.presenceDebounce = null
    }
    this.presenceWatcherPath = null
    if (this.presenceWatcher) {
      try {
        await this.presenceWatcher.close()
      } catch (error) {
        logger.warn('GitWatcherService: Error closing presence watcher', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
      this.presenceWatcher = null
    }

    if (!this.activeWatcher) {
      return { success: true }
    }

    try {
      // Dispose coalescer first
      this.activeWatcher.coalescer.dispose()

      // Close watcher
      await this.activeWatcher.watcher.close()

      logger.info('GitWatcherService: Stopped watching', {
        projectPath: this.activeWatcher.projectPath
      })

      this.activeWatcher = null
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('GitWatcherService: Error stopping watcher', error instanceof Error ? error : undefined)
      this.activeWatcher = null
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Check if currently watching a project
   */
  isWatching(): boolean {
    return this.activeWatcher !== null
  }

  /**
   * Get the path of the currently watched project
   */
  getWatchedPath(): string | null {
    return this.activeWatcher?.projectPath ?? null
  }

  /**
   * Get timestamp of last emitted event (for polling coordination)
   */
  getLastEventTimestamp(): number | null {
    return this.lastEventTimestamp
  }

  /**
   * Dispose the service (call on app shutdown)
   */
  async dispose(): Promise<void> {
    this.isDisposing = true
    await this.stop()
  }

  /**
   * Cleanup resources when a webContents is destroyed.
   * Bumps session version to invalidate pending events, then stops the watcher.
   *
   * @param webContentsId - The ID of the destroyed webContents
   * @see Issue #106
   */
  async cleanupForWebContentsId(webContentsId: number): Promise<void> {
    this.sessionVersion++
    await this.stop()
    logger.info('GitWatcherService: Cleaned up for webContentsId', { webContentsId })
  }

  /**
   * Create and configure the chokidar watcher
   */
  private async createWatcher(projectPath: string): Promise<{ success: boolean; error?: string }> {
    const currentVersion = this.sessionVersion

    // Build absolute paths to watch
    const watchPaths = GIT_WATCH_PATHS.map((relativePath) => join(projectPath, relativePath))

    // Filter to only existing paths (some like FETCH_HEAD or stash may not exist)
    const existingPaths: string[] = []
    for (const watchPath of watchPaths) {
      try {
        await stat(watchPath)
        existingPaths.push(watchPath)
      } catch {
        // Path doesn't exist - skip it
      }
    }

    logger.debug('GitWatcherService: Path filtering', {
      total: watchPaths.length,
      existing: existingPaths.length,
      filtered: watchPaths.length - existingPaths.length
    })

    // Must have at least .git/index
    const indexPath = join(projectPath, '.git/index')
    if (!existingPaths.includes(indexPath)) {
      logger.debug('GitWatcherService: .git/index not found (bare repo?)', { projectPath })
      return { success: true } // Not an error
    }

    // Create coalescer
    const coalescer = new GitEventCoalescer((eventTypes) => {
      this.handleCoalescedEvent(projectPath, currentVersion, eventTypes)
    }, GIT_COALESCE_WINDOW_MS)

    // Create watcher
    logger.debug('GitWatcherService: Creating chokidar watcher', { pathCount: existingPaths.length })
    const watcher = chokidar.watch(existingPaths, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
      disableGlobbing: true, // chokidar v3: treat paths literally (matches v4); avoids glob chars in repo paths
      awaitWriteFinish: false,
      followSymlinks: false,
      // Watch directories recursively for refs/heads/
      depth: 3
    })

    // Store active watcher state
    this.activeWatcher = {
      watcher,
      projectPath,
      version: currentVersion,
      coalescer
    }

    // Set up event handlers
    watcher.on('change', (filePath: string) => {
      this.handleFileChange(filePath, 'change')
    })

    watcher.on('add', (filePath: string) => {
      this.handleFileChange(filePath, 'add')
    })

    watcher.on('unlink', (filePath: string) => {
      this.handleFileChange(filePath, 'unlink')
    })

    watcher.on('error', (error: unknown) => {
      this.handleWatcherError(error)
    })

    // Ready/timeout lifecycle – three possible outcomes:
    // 1. Ready-first: chokidar ready fires before timeout → normal path
    // 2. Timeout-first: timeout fires before ready → degraded mode, polling handles git status
    // 3. Late-ready: ready fires after timeout → logged for diagnostics (Issue #136)
    const startTime = Date.now()
    let raceResolved = false

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (raceResolved) return
        if (this.activeWatcher?.version !== currentVersion) {
          resolve({ success: true })
          return
        }

        raceResolved = true
        const elapsedMs = Date.now() - startTime
        logger.warn('GitWatcherService: Watcher ready timeout fallback triggered', {
          projectPath,
          elapsedMs,
          timeoutMs: WATCHER_READY_TIMEOUT_MS,
          pathCount: existingPaths.length
        })

        // Start health logger even in degraded mode (ADR-Spec003-002)
        this.startHealthLogger()
        resolve({ success: true })
      }, WATCHER_READY_TIMEOUT_MS)

      watcher.on('ready', () => {
        if (this.activeWatcher?.version !== currentVersion) return

        const elapsedMs = Date.now() - startTime

        if (!raceResolved) {
          raceResolved = true
          clearTimeout(timeoutHandle)

          logger.info('GitWatcherService: Watcher ready', {
            projectPath,
            pathCount: existingPaths.length,
            elapsedMs
          })

          // Start health logger when watcher is ready (ADR-Spec003-002)
          this.startHealthLogger()
          resolve({ success: true })
        } else {
          // Late ready – timeout already fired and resolved the promise.
          // This diagnostic log helps determine whether chokidar eventually
          // becomes ready (timeout too short) or never does (permanent failure).
          logger.info('GitWatcherService: Late ready event received after timeout', {
            projectPath,
            elapsedMs,
            pathCount: existingPaths.length
          })
        }
      })
    })
  }

  /**
   * Handle file change event from chokidar
   */
  private handleFileChange(filePath: string, eventType: 'change' | 'add' | 'unlink'): void {
    if (this.isDisposing) return

    const watcher = this.activeWatcher
    if (!watcher) return

    // Check for stale event
    if (watcher.version !== this.sessionVersion) {
      logger.debug('GitWatcherService: Ignoring stale event', { filePath, eventType })
      return
    }

    // Classify the path
    const gitEventType = classifyGitPath(filePath)
    if (!gitEventType) {
      logger.debug('GitWatcherService: Unrecognized git path', { filePath })
      return
    }

    logger.debug('GitWatcherService: Git file changed', {
      path: filePath,
      eventType,
      gitEventType
    })

    // Queue event for coalescing
    watcher.coalescer.queueEvent(gitEventType)
  }

  /**
   * Handle coalesced events - emit IPC broadcast
   */
  private handleCoalescedEvent(
    projectPath: string,
    eventVersion: number,
    eventTypes: GitEventType[]
  ): void {
    if (this.isDisposing) return

    // Verify version still matches
    if (eventVersion !== this.sessionVersion) {
      logger.debug('GitWatcherService: Ignoring stale coalesced event')
      return
    }

    const timestamp = Date.now()
    this.lastEventTimestamp = timestamp

    // Generate correlation ID for tracing (ADR-Spec003-002)
    const correlationId = this.generateCorrelationId()

    logger.info('GitWatcherService: Git state changed', {
      projectPath,
      eventTypes,
      count: eventTypes.length,
      correlationId
    })

    // Record metrics (ADR-Spec003-002)
    watcherMetrics.recordGitWatcherEvent()

    // Broadcast to all windows
    const payload: GitStateChangeEvent = {
      projectPath,
      eventTypes,
      timestamp,
      correlationId
    }

    broadcastToAllWindows('git:state-changed', payload)
  }

  /**
   * Watch the project's `.git` path itself to detect a repository appearing
   * (`git init` / clone into an already-open folder) or disappearing (`rm .git`).
   *
   * Watching the exact `.git` path with `depth: 0` reliably fires
   * `addDir`/`unlinkDir` for the directory (verified empirically on chokidar
   * 3.6.0 incl. Windows) and does NOT recurse into `.git/objects`. Watching the
   * project root with an `ignored` predicate does NOT detect the child `.git`
   * being created/removed, so the direct-path watch is required.
   */
  private createPresenceWatcher(projectPath: string): void {
    const gitDir = join(projectPath, '.git')
    this.presenceWatcherPath = projectPath

    // A presence-watcher failure must never break start() (which calls this
    // before the inner watcher) – the inner watcher and polling remain the
    // primary status path, so degrade silently if chokidar throws here.
    try {
      const watcher = chokidar.watch(gitDir, {
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        disableGlobbing: true,
        followSymlinks: false,
        depth: 0
      })

      // basename guard: ignore any direct children of .git the watcher may
      // surface; only the `.git` entry itself signals a repo transition.
      // `add`/`unlink` cover a `.git` *file* (worktree/submodule gitdir pointer).
      const onAppear = (p: string): void => {
        if (basename(p) === '.git') this.scheduleRepoTransition(projectPath, 'added')
      }
      const onDisappear = (p: string): void => {
        if (basename(p) === '.git') this.scheduleRepoTransition(projectPath, 'removed')
      }

      watcher.on('addDir', onAppear)
      watcher.on('add', onAppear)
      watcher.on('unlinkDir', onDisappear)
      watcher.on('unlink', onDisappear)
      watcher.on('error', (error: unknown) => {
        logger.warn('GitWatcherService: Presence watcher error', {
          error: error instanceof Error ? error.message : String(error)
        })
      })

      this.presenceWatcher = watcher
    } catch (error) {
      logger.warn('GitWatcherService: Failed to create presence watcher', {
        projectPath,
        error: error instanceof Error ? error.message : String(error)
      })
      this.presenceWatcher = null
    }
  }

  /**
   * Debounce a `.git` presence transition. `git init` writes many files into
   * `.git` right after creating it, so coalesce rapid events into one.
   */
  private scheduleRepoTransition(projectPath: string, kind: 'added' | 'removed'): void {
    if (this.isDisposing || this.presenceWatcherPath !== projectPath) return

    if (this.presenceDebounce) clearTimeout(this.presenceDebounce)
    this.presenceDebounce = setTimeout(() => {
      this.presenceDebounce = null
      void this.applyRepoTransition(projectPath, kind)
    }, REPO_PRESENCE_DEBOUNCE_MS)
  }

  /**
   * Apply a debounced `.git` presence transition: (re)start or tear down the
   * inner git-state watcher, then tell the renderer to re-fetch status.
   */
  private async applyRepoTransition(projectPath: string, kind: 'added' | 'removed'): Promise<void> {
    // Identity guard: drop if the project was switched/closed while debouncing.
    if (this.isDisposing || this.presenceWatcherPath !== projectPath) return

    logger.info('GitWatcherService: Repo presence transition', { projectPath, kind })

    if (kind === 'added') {
      // Start real-time inner watching if not already active. createWatcher
      // self-guards on `.git/index`; if git has not written it yet (init writes
      // it on first add/commit), polling drives the refresh and the next index
      // write engages the watcher.
      if (!this.activeWatcher) {
        try {
          await this.createWatcher(projectPath)
        } catch (error) {
          logger.warn('GitWatcherService: Failed to start inner watcher after repo appeared', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } else {
      // `.git` removed: tear down the inner watcher but KEEP the presence watcher
      // alive so a later `git init` in the same folder is detected again.
      if (this.activeWatcher) {
        try {
          this.activeWatcher.coalescer.dispose()
          await this.activeWatcher.watcher.close()
        } catch (error) {
          logger.warn('GitWatcherService: Error tearing down inner watcher after .git removal', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
        this.activeWatcher = null
      }
    }

    // Re-check the identity guard: createWatcher above is async and a project
    // switch may have intervened.
    if (this.isDisposing || this.presenceWatcherPath !== projectPath) return

    // Re-fetch on the renderer: getStatus() re-checks `.git` presence and returns
    // isGitRepo true/false, so the store flips decorations on (added) or off
    // (removed) without any dedicated IPC.
    const timestamp = Date.now()
    this.lastEventTimestamp = timestamp
    const payload: GitStateChangeEvent = {
      projectPath,
      eventTypes: ['repo'],
      timestamp,
      correlationId: this.generateCorrelationId()
    }
    watcherMetrics.recordGitWatcherEvent()
    broadcastToAllWindows('git:state-changed', payload)
  }

  /**
   * Handle watcher errors with auto-recovery
   */
  private handleWatcherError(error: unknown): void {
    if (this.isDisposing) return

    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorType = this.classifyError(errorMessage)

    logger.error('GitWatcherService: Watcher error', error instanceof Error ? error : undefined, {
      errorType
    })

    // Check if transient error that can be recovered
    if (this.isTransientError(errorType) && this.restartAttempts < MAX_RESTART_ATTEMPTS) {
      this.scheduleRestart()
    }
  }

  /**
   * Classify error message into error type
   *
   * Matches Node.js error codes (uppercase) directly, with fallback to
   * lowercase matching for descriptive phrases in case error format varies.
   */
  private classifyError(errorMessage: string): string {
    // First try direct uppercase error code match (Node.js standard format)
    if (errorMessage.includes('ENOENT')) return 'ENOENT'
    if (errorMessage.includes('EMFILE')) return 'EMFILE'
    if (errorMessage.includes('EACCES')) return 'EACCES'
    if (errorMessage.includes('ESTALE')) return 'ESTALE'

    // Fallback: case-insensitive match for descriptive phrases
    const msgLower = errorMessage.toLowerCase()
    if (msgLower.includes('no such file')) return 'ENOENT'
    if (msgLower.includes('too many')) return 'EMFILE'
    if (msgLower.includes('access denied')) return 'EACCES'
    if (msgLower.includes('stale')) return 'ESTALE'

    return 'UNKNOWN'
  }

  /**
   * Check if error type is transient (can recover with restart)
   */
  private isTransientError(errorType: string): boolean {
    return ['ENOENT', 'EMFILE', 'EACCES', 'ESTALE'].includes(errorType)
  }

  /**
   * Schedule a watcher restart with exponential backoff
   */
  private scheduleRestart(): void {
    if (this.pendingRestart) {
      return // Already scheduled
    }

    const projectPath = this.activeWatcher?.projectPath
    if (!projectPath) return

    const delay = RESTART_BASE_DELAY_MS * Math.pow(2, this.restartAttempts)

    logger.info('GitWatcherService: Scheduling restart', {
      attempt: this.restartAttempts + 1,
      maxAttempts: MAX_RESTART_ATTEMPTS,
      delayMs: delay
    })

    this.pendingRestart = setTimeout(async () => {
      this.pendingRestart = null
      this.restartAttempts++
      this.sessionVersion++ // Invalidate old watcher's timeout handles

      try {
        // Stop current watcher
        if (this.activeWatcher) {
          this.activeWatcher.coalescer.dispose()
          await this.activeWatcher.watcher.close()
          this.activeWatcher = null
        }

        // Try to recreate
        const result = await this.createWatcher(projectPath)

        if (result.success) {
          logger.info('GitWatcherService: Restart successful')
          this.restartAttempts = 0
        } else {
          logger.warn('GitWatcherService: Restart failed', { error: result.error })
          if (this.restartAttempts < MAX_RESTART_ATTEMPTS) {
            this.scheduleRestart()
          }
        }
      } catch (error) {
        logger.error('GitWatcherService: Restart error', error instanceof Error ? error : undefined)
        if (this.restartAttempts < MAX_RESTART_ATTEMPTS) {
          this.scheduleRestart()
        }
      }
    }, delay)
  }

  /**
   * Generate a unique correlation ID for tracing refreshes across components
   * Format: git-{timestamp}-{random}
   * @see ADR-Spec003-002 - Git status logging strategy
   */
  private generateCorrelationId(): string {
    return `git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Start the health logger (5-minute interval)
   * Logs periodic health summaries and degraded state warnings
   * @see ADR-Spec003-002 - Git status logging strategy
   */
  private startHealthLogger(): void {
    // Guard: Prevent duplicate intervals from rapid start() calls
    // This can happen if start() is called again before 'ready' fires
    if (this.healthLogInterval !== null) {
      return
    }

    this.healthLogInterval = setInterval(() => {
      const snapshot = watcherMetrics.getSnapshot()

      logger.debug('GitStatus: Health summary', {
        uptimeMinutes: Math.round(snapshot.uptimeMs / 60000),
        watcherEvents: snapshot.gitWatcherEventCount,
        pollingRefreshes: snapshot.pollingRefreshCount,
        pollingSkipped: snapshot.pollingSkippedCount,
        pollingEfficiency: `${snapshot.pollingEfficiency}%`,
        restarts: snapshot.restartScheduled,
        errors: snapshot.errorCounts
      })

      // Degraded state warnings
      if (snapshot.pollingEfficiency > HIGH_POLLING_DEPENDENCY_THRESHOLD) {
        logger.warn('GitStatus: High polling dependency - watcher may be missing events', {
          pollingEfficiency: snapshot.pollingEfficiency,
          threshold: HIGH_POLLING_DEPENDENCY_THRESHOLD
        })
      }
    }, HEALTH_LOG_INTERVAL_MS)
    this.healthLogInterval.unref()
  }

  /**
   * Stop the health logger
   */
  private stopHealthLogger(): void {
    if (this.healthLogInterval) {
      clearInterval(this.healthLogInterval)
      this.healthLogInterval = null
    }
  }
}

/** Singleton instance */
export const gitWatcherService = new GitWatcherService()
