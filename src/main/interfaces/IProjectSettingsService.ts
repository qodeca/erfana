// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { ResolvedProjectSettings } from '../../shared/ipc/project-settings-schema'

/**
 * Supplies the global `files.exclude` list from `~/.erfana/settings.json`
 * (Issue #211, design D7). Read once per `loadSettings` call.
 */
export type GlobalExcludeProvider = () => readonly string[]

/**
 * Interface for project-level settings service
 * Loads and validates .erfana/settings.json
 *
 * @see Issue #63 - project-level settings
 */
export interface IProjectSettingsService {
  /**
   * Load and validate project settings from .erfana/settings.json.
   * Does not change the cache: see `setCurrentSettings`.
   * @throws AppError if settings file exists but is invalid
   */
  loadSettings(projectPath: string): Promise<ResolvedProjectSettings>

  /**
   * Cache the settings of the project that is now open (`null` for none)
   */
  setCurrentSettings(settings: ResolvedProjectSettings | null): void

  /**
   * Get the cached settings of the open project
   */
  getCurrentSettings(): ResolvedProjectSettings | null

  /**
   * Clear cached settings (called when the project session closes)
   */
  clearSettings(): void

  /**
   * Set the source of the global `files.exclude` list, merged ahead of the
   * project's list on every `loadSettings` (Issue #211, design D7). Set once
   * at wiring time; until then the global list is empty.
   */
  setGlobalExcludeProvider(provider: GlobalExcludeProvider): void
}
