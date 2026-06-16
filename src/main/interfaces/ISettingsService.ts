// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for application settings service
 * Persists global app settings via electron-store
 */
export interface ISettingsService {
  /**
   * Set the last opened project path
   */
  setLastProjectPath(path: string): Promise<void>

  /**
   * Add a project to recent projects list
   */
  addRecentProject(path: string, name: string): Promise<void>
}
