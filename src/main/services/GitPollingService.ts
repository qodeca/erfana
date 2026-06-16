// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * GitPollingService - Hybrid polling fallback for git status refresh
 *
 * Provides a fallback polling mechanism that complements the file watcher.
 * Uses hybrid mode to avoid redundant refreshes when the watcher is active.
 *
 * Features:
 * - Configurable polling interval (default 5 seconds)
 * - Hybrid mode: Skip refresh if watcher triggered in last 2 seconds
 * - Differential check: Compare .git/index mtime+size before full refresh
 * - Integration with GlobalSettingsService for interval/enabled settings
 * - IPC broadcast 'git:poll-triggered' when refresh needed
 * - Metrics tracking: pollingRefreshCount, pollingSkippedCount
 *
 * Design:
 * - Singleton pattern for centralized state
 * - Coordinates with GitWatcherService for hybrid behavior
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 */

import { stat } from 'fs/promises'
import { join } from 'path'
import { logger } from './LoggingService'
import { broadcastToAllWindows } from '../utils/ipcBroadcast'
import { watcherMetrics } from './watcher/WatcherMetrics'
import type { GitPollTriggeredEvent, GitPollingMetrics } from '../../shared/ipc/git-watcher-schema'

/**
 * Provider for the last watcher event timestamp.
 * Returns null if no events have occurred.
 */
type TimestampProvider = () => number | null

/**
 * Provider for watcher active status.
 * Returns true if the watcher is currently active.
 */
type WatchingStatusProvider = () => boolean

/** Default polling interval in milliseconds */
const DEFAULT_POLLING_INTERVAL_MS = 5000

/** Minimum polling interval allowed (1 second) */
const MIN_POLLING_INTERVAL_MS = 1000

/** Maximum polling interval allowed (60 seconds) */
const MAX_POLLING_INTERVAL_MS = 60000

/** Threshold for considering watcher as active (ms) */
const WATCHER_ACTIVE_THRESHOLD_MS = 2000

// Re-export GitPollingMetrics for backward compatibility
export type { GitPollingMetrics } from '../../shared/ipc/git-watcher-schema'

/**
 * GitPollingService
 *
 * Singleton service for polling git status as a fallback.
 * Use `gitPollingService.start(projectPath)` to begin polling.
 */
export class GitPollingService {
  /** Current project path being polled */
  private projectPath: string | null = null

  /** Polling timer handle */
  private pollingTimer: NodeJS.Timeout | null = null

  /** Current polling interval in milliseconds */
  private pollingIntervalMs: number = DEFAULT_POLLING_INTERVAL_MS

  /** Whether polling is enabled */
  private enabled: boolean = true

  /** Last known .git/index mtime */
  private lastIndexMtime: number = 0

  /** Last known .git/index size */
  private lastIndexSize: number = 0

  /** Metrics tracking */
  private metrics: GitPollingMetrics = {
    pollingRefreshCount: 0,
    pollingSkippedCount: 0,
    lastPollTimestamp: 0,
    lastRefreshTimestamp: 0
  }

  /** Disposal flag to prevent operations during cleanup */
  private isDisposing: boolean = false

  /** Mutex to prevent concurrent interval changes (Issue #74 review fix) */
  private intervalChangeInProgress: boolean = false

  /**
   * Latched when `.git/index` is missing, so we log the condition once per
   * project instead of every poll interval. Cleared when the index reappears
   * (e.g. user runs `git init` in-session) or when `start()` is called for a
   * new project.
   */
  private missingIndexLogged: boolean = false

  /** Provider for last watcher event timestamp (injected) */
  private getLastWatcherEventTimestamp: TimestampProvider = () => null

  /** Provider for watcher active status (injected) */
  private isWatcherActive: WatchingStatusProvider = () => false

  /**
   * Set watcher coordination providers (Dependency Injection).
   *
   * This decouples GitPollingService from GitWatcherService,
   * following the Dependency Inversion Principle.
   *
   * @param timestampProvider - Function that returns last watcher event timestamp
   * @param watchingProvider - Function that returns whether watcher is active
   */
  setWatcherCoordination(
    timestampProvider: TimestampProvider,
    watchingProvider: WatchingStatusProvider
  ): void {
    this.getLastWatcherEventTimestamp = timestampProvider
    this.isWatcherActive = watchingProvider

    logger.debug('GitPollingService: Watcher coordination configured')
  }

  /**
   * Start polling for a project
   *
   * Automatically stops any existing polling before starting.
   *
   * @param projectPath - Absolute path to project root
   */
  start(projectPath: string): void {
    // Stop existing polling
    this.stop()

    this.projectPath = projectPath
    this.isDisposing = false

    // Reset index tracking
    this.lastIndexMtime = 0
    this.lastIndexSize = 0
    this.missingIndexLogged = false

    // Reset metrics
    this.metrics = {
      pollingRefreshCount: 0,
      pollingSkippedCount: 0,
      lastPollTimestamp: 0,
      lastRefreshTimestamp: 0
    }

    if (!this.enabled) {
      logger.debug('GitPollingService: Polling disabled, not starting', { projectPath })
      return
    }

    this.scheduleNextPoll()

    logger.info('GitPollingService: Started polling', {
      projectPath,
      intervalMs: this.pollingIntervalMs
    })
  }

  /**
   * Stop polling
   *
   * Safe to call even if not currently polling.
   */
  stop(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }

    if (this.projectPath) {
      logger.info('GitPollingService: Stopped polling', {
        projectPath: this.projectPath,
        refreshCount: this.metrics.pollingRefreshCount,
        skippedCount: this.metrics.pollingSkippedCount
      })
    }

    this.projectPath = null
    this.lastIndexMtime = 0
    this.lastIndexSize = 0
  }

  /**
   * Check if currently polling
   */
  isPolling(): boolean {
    return this.pollingTimer !== null && this.projectPath !== null
  }

  /**
   * Set the polling interval
   *
   * @param ms - Interval in milliseconds (clamped to 1-60 seconds)
   */
  setInterval(ms: number): void {
    // Mutex: Prevent concurrent interval changes (Issue #74 review fix)
    if (this.intervalChangeInProgress) {
      logger.debug('GitPollingService: Interval change already in progress, skipping')
      return
    }

    // Clamp to valid range
    const clamped = Math.max(MIN_POLLING_INTERVAL_MS, Math.min(MAX_POLLING_INTERVAL_MS, ms))

    if (clamped !== ms) {
      logger.warn('GitPollingService: Interval clamped to valid range', {
        requested: ms,
        actual: clamped
      })
    }

    this.pollingIntervalMs = clamped

    logger.debug('GitPollingService: Interval updated', { intervalMs: clamped })

    // If currently polling, restart with new interval
    // Capture projectPath BEFORE condition check to prevent race condition
    // where this.projectPath becomes null between check and use
    const projectPath = this.projectPath
    if (this.isPolling() && projectPath) {
      this.intervalChangeInProgress = true
      try {
        this.stop()
        this.start(projectPath)
      } finally {
        this.intervalChangeInProgress = false
      }
    }
  }

  /**
   * Enable or disable polling
   *
   * @param enabled - Whether polling should be enabled
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled

    logger.debug('GitPollingService: Enabled state updated', { enabled })

    if (!enabled && this.isPolling()) {
      this.stop()
    } else if (enabled && this.projectPath && !this.isPolling()) {
      this.scheduleNextPoll()
    }
  }

  /**
   * Get the current polling interval
   */
  getInterval(): number {
    return this.pollingIntervalMs
  }

  /**
   * Check if polling is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get current polling metrics (snapshot).
   * Returns a copy to prevent external mutation.
   *
   * @returns Metrics object with refresh/skip counts and timestamps
   */
  getMetrics(): GitPollingMetrics {
    return { ...this.metrics }
  }

  /**
   * Dispose the service (call on app shutdown)
   */
  dispose(): void {
    this.isDisposing = true
    this.stop()
  }

  /**
   * Cleanup resources when a webContents is destroyed.
   * Stops polling.
   *
   * @param webContentsId - The ID of the destroyed webContents
   * @see Issue #106
   */
  cleanupForWebContentsId(webContentsId: number): void {
    this.stop()
    logger.info('GitPollingService: Cleaned up for webContentsId', { webContentsId })
  }

  /**
   * Schedule the next poll
   */
  private scheduleNextPoll(): void {
    if (this.isDisposing || !this.enabled || !this.projectPath) {
      return
    }

    this.pollingTimer = setTimeout(async () => {
      await this.poll()
      this.scheduleNextPoll()
    }, this.pollingIntervalMs)
  }

  /**
   * Perform a single poll
   */
  private async poll(): Promise<void> {
    if (this.isDisposing || !this.projectPath) {
      return
    }

    this.metrics.lastPollTimestamp = Date.now()

    // Check if watcher is active (triggered recently)
    if (this.shouldSkip()) {
      this.metrics.pollingSkippedCount++
      watcherMetrics.recordPollingSkipped() // Record to shared metrics (ADR-Spec003-002)
      const lastWatcherEvent = this.getLastWatcherEventTimestamp()
      // Trace log with context for debugging (ADR-Spec003-002)
      logger.trace('GitPolling: Skipped (watcher active)', {
        lastWatcherEventMs: lastWatcherEvent ? Date.now() - lastWatcherEvent : null
      })
      return
    }

    // Check if .git/index has changed
    const indexChanged = await this.hasIndexChanged()
    if (!indexChanged) {
      this.metrics.pollingSkippedCount++
      watcherMetrics.recordPollingSkipped() // Record to shared metrics (ADR-Spec003-002)
      // Trace log with context for debugging (ADR-Spec003-002)
      logger.trace('GitPolling: Skipped (index unchanged)', {
        indexMtime: this.lastIndexMtime
      })
      return
    }

    // Trigger refresh
    this.metrics.pollingRefreshCount++
    this.metrics.lastRefreshTimestamp = Date.now()
    watcherMetrics.recordPollingRefresh() // Record to shared metrics (ADR-Spec003-002)

    const reason = this.isWatcherActive() ? 'index_changed' : 'no_watcher'

    logger.info('GitPollingService: Poll triggered refresh', {
      projectPath: this.projectPath,
      reason,
      refreshCount: this.metrics.pollingRefreshCount
    })

    this.broadcastEvent({
      projectPath: this.projectPath,
      timestamp: Date.now(),
      reason
    })
  }

  /**
   * Check if poll should be skipped because watcher is active
   */
  private shouldSkip(): boolean {
    const lastWatcherEvent = this.getLastWatcherEventTimestamp()

    if (lastWatcherEvent !== null && Date.now() - lastWatcherEvent < WATCHER_ACTIVE_THRESHOLD_MS) {
      return true // Skip, watcher is active
    }

    return false
  }

  /**
   * Check if .git/index has changed since last poll
   */
  private async hasIndexChanged(): Promise<boolean> {
    if (!this.projectPath) {
      return false
    }

    const indexPath = join(this.projectPath, '.git', 'index')

    try {
      const indexStat = await stat(indexPath)

      // Index reappeared (or existed all along) – allow future disappearances
      // to log again instead of staying silent for the session.
      this.missingIndexLogged = false

      if (indexStat.mtimeMs !== this.lastIndexMtime || indexStat.size !== this.lastIndexSize) {
        this.lastIndexMtime = indexStat.mtimeMs
        this.lastIndexSize = indexStat.size
        return true
      }

      return false
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      // ENOENT is the expected case for non-git folders. Log once at debug
      // and stay silent for subsequent polls – polling is cheap and must keep
      // running so we notice if the user later runs `git init`.
      if (code === 'ENOENT') {
        if (!this.missingIndexLogged) {
          logger.debug('GitPollingService: .git/index not found (non-repo); polling silently', {
            indexPath
          })
          this.missingIndexLogged = true
        }
        return false
      }

      logger.warn('GitPollingService: Failed to stat .git/index', {
        indexPath,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  /**
   * Broadcast poll triggered event to all renderer windows
   */
  private broadcastEvent(payload: GitPollTriggeredEvent): void {
    broadcastToAllWindows('git:poll-triggered', payload)
  }
}

/** Singleton instance */
export const gitPollingService = new GitPollingService()
