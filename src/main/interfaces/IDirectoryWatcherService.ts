// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for directory watcher service
 * Watches for file system changes and notifies renderers
 */
export interface IDirectoryWatcherService {
  /**
   * Stop all active directory watchers
   */
  stopAll(): Promise<void>

  /**
   * Set the project root path for security validation
   */
  setProjectPath(path: string): void

  /**
   * Set custom ignore patterns (called by ProjectService after loading settings)
   * @see Issue #63 - project-level settings
   */
  setIgnorePatterns(patterns: string[]): void

  /**
   * Get current ignore patterns
   */
  getIgnorePatterns(): string[]
}
