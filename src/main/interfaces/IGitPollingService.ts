// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for git polling service
 *
 * Provides a polling fallback mechanism for git status refresh.
 * Complements IGitWatcherService for reliable status detection.
 *
 * Follows Interface Segregation Principle by exposing only
 * the minimal API needed by consumers.
 *
 * @see GitPollingService for implementation
 * @see Spec #003 - Real-time git status refresh specification
 * @see Issue #74 review fix - added for consistency with IGitWatcherService
 */
import type { GitPollingMetrics } from '../../shared/ipc/git-watcher-schema'

export interface IGitPollingService {
  /**
   * Start polling for a project.
   *
   * @param projectPath - Absolute path to project root
   */
  start(projectPath: string): void

  /**
   * Stop polling.
   *
   * Safe to call even if not currently polling.
   */
  stop(): void

  /**
   * Check if currently polling.
   */
  isPolling(): boolean

  /**
   * Set the polling interval.
   *
   * @param ms - Interval in milliseconds (clamped to 1-60 seconds)
   */
  setInterval(ms: number): void

  /**
   * Get the current polling interval.
   */
  getInterval(): number

  /**
   * Enable or disable polling.
   *
   * @param enabled - Whether polling should be enabled
   */
  setEnabled(enabled: boolean): void

  /**
   * Check if polling is enabled.
   */
  isEnabled(): boolean

  /**
   * Get current polling metrics (snapshot).
   *
   * @returns Metrics object with refresh/skip counts and timestamps
   */
  getMetrics(): GitPollingMetrics

  /**
   * Dispose the service (call on app shutdown).
   */
  dispose(): void

  /**
   * Cleanup resources when a webContents is destroyed.
   * Stops polling.
   *
   * @param webContentsId - The ID of the destroyed webContents
   * @see Issue #106
   */
  cleanupForWebContentsId(webContentsId: number): void
}
