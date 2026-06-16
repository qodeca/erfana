// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for git watcher service
 *
 * Watches git state files to detect external git operations.
 * Implements Interface Segregation Principle by exposing only
 * the minimal API needed by consumers (like GitPollingService).
 *
 * @see GitWatcherService for implementation
 * @see Spec #003 - Real-time git status refresh specification
 */
export interface IGitWatcherService {
  /**
   * Start watching git state for a project.
   *
   * @param projectPath - Absolute path to project root
   * @returns Promise resolving with success status
   */
  start(projectPath: string): Promise<{ success: boolean; error?: string }>

  /**
   * Stop watching git state.
   *
   * Safe to call even if not currently watching.
   */
  stop(): Promise<{ success: boolean; error?: string }>

  /**
   * Check if currently watching a project.
   */
  isWatching(): boolean

  /**
   * Get the path of the currently watched project.
   */
  getWatchedPath(): string | null

  /**
   * Get timestamp of last emitted event (for polling coordination).
   */
  getLastEventTimestamp(): number | null

  /**
   * Dispose the service (call on app shutdown).
   */
  dispose(): Promise<void>

  /**
   * Cleanup resources when a webContents is destroyed.
   * Bumps session version and stops the watcher.
   *
   * @param webContentsId - The ID of the destroyed webContents
   * @see Issue #106
   */
  cleanupForWebContentsId(webContentsId: number): Promise<void>
}
