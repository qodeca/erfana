// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for file watcher service
 * Watches individual files for content changes
 */
export interface IFileWatcherService {
  /**
   * Stop all active file watchers
   */
  stopAll(): Promise<void>

  /**
   * Set the project root path for security validation
   */
  setProjectPath(path: string): void
}
