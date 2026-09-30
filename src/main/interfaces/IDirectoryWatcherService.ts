// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { ProjectPathFilter } from '../utils/projectPathFilter'

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
   * Set the project's path filter – exclude list, hidden names and ignore
   * patterns – that decides which paths are not watched and which events are
   * dropped (#211). Called by ProjectService after loading settings, with the
   * same instance it hands to the file service.
   * @see Issue #63 - project-level settings
   */
  setPathFilter(filter: ProjectPathFilter): void
}
