// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectSettingsService
 *
 * Loads and validates project-level settings from .erfana/settings.json
 *
 * @see Issue #63 - project-level settings for watcher ignore and tree visibility
 */
import { readFile, access, constants } from 'fs/promises'
import { join } from 'path'
import {
  ProjectSettingsSchema,
  type ProjectSettings,
  type ResolvedProjectSettings
} from '../../shared/ipc/project-settings-schema'
import { AppError, ErrorCode } from '../../shared/errors'
import {
  DEFAULT_WATCHER_IGNORE_PATTERNS,
  DEFAULT_TREE_HIDDEN_PATTERNS
} from '../../shared/constants'
import type { IProjectSettingsService } from '../interfaces/IProjectSettingsService'

/** Directory name for project-specific settings */
const SETTINGS_DIR = '.erfana'
/** Settings file name */
const SETTINGS_FILE = 'settings.json'

export class ProjectSettingsService implements IProjectSettingsService {
  private currentSettings: ResolvedProjectSettings | null = null

  /**
   * Load and validate project settings from .erfana/settings.json
   * @throws AppError if settings file exists but is invalid JSON or fails schema validation
   */
  async loadSettings(projectPath: string): Promise<ResolvedProjectSettings> {
    const settingsPath = join(projectPath, SETTINGS_DIR, SETTINGS_FILE)

    // Check if settings file exists
    const exists = await this.fileExists(settingsPath)
    if (!exists) {
      // No settings file - use defaults
      this.currentSettings = this.getDefaultSettings()
      return this.currentSettings
    }

    // Read and parse settings
    const rawSettings = await this.readSettingsFile(settingsPath)
    const validatedSettings = this.validateSettings(rawSettings, settingsPath)

    // Resolve patterns (apply mode-based merging)
    this.currentSettings = this.resolveSettings(validatedSettings)
    return this.currentSettings
  }

  getCurrentSettings(): ResolvedProjectSettings | null {
    return this.currentSettings
  }

  clearSettings(): void {
    this.currentSettings = null
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  private async readSettingsFile(settingsPath: string): Promise<unknown> {
    try {
      const content = await readFile(settingsPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new AppError(
          `Invalid JSON in ${settingsPath}: ${error.message}`,
          ErrorCode.PROJECT_SETTINGS_INVALID_JSON,
          error
        )
      }
      throw new AppError(
        `Failed to read ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.PROJECT_SETTINGS_READ_FAILED,
        error instanceof Error ? error : undefined
      )
    }
  }

  private validateSettings(rawSettings: unknown, settingsPath: string): ProjectSettings {
    const result = ProjectSettingsSchema.safeParse(rawSettings)
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      throw new AppError(
        `Invalid settings in ${settingsPath}:\n${issues}`,
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }
    return result.data
  }

  private resolveSettings(settings: ProjectSettings): ResolvedProjectSettings {
    return {
      watcherIgnorePatterns: this.resolvePatterns(
        settings.watcher?.ignoreList,
        DEFAULT_WATCHER_IGNORE_PATTERNS
      ),
      treeHiddenPatterns: this.resolvePatterns(
        settings.tree?.hiddenPatterns,
        DEFAULT_TREE_HIDDEN_PATTERNS
      )
    }
  }

  private resolvePatterns(
    config: { mode?: 'extend' | 'replace'; patterns?: string[] } | undefined,
    defaults: readonly string[]
  ): string[] {
    if (!config) {
      return [...defaults]
    }

    const mode = config.mode ?? 'extend'
    const patterns = config.patterns ?? []

    if (mode === 'replace') {
      return [...patterns]
    }

    // extend: merge with defaults, deduplicate
    const combined = new Set([...defaults, ...patterns])
    return [...combined]
  }

  private getDefaultSettings(): ResolvedProjectSettings {
    return {
      watcherIgnorePatterns: [...DEFAULT_WATCHER_IGNORE_PATTERNS],
      treeHiddenPatterns: [...DEFAULT_TREE_HIDDEN_PATTERNS]
    }
  }
}

/** Singleton instance */
export const projectSettingsService = new ProjectSettingsService()
