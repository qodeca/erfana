// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * GlobalSettingsService
 *
 * Manages global application settings persisted to ~/.erfana/settings.json
 *
 * Features:
 * - Singleton pattern for consistent state
 * - Zod schema validation with defaults
 * - Corruption handling (backup + reset + notification)
 * - Reactive updates via IPC broadcast
 * - Thread-safe writes with async-mutex
 *
 * @see Issue #50 - global settings service
 */
import { readFile, writeFile, mkdir, copyFile, access, constants } from 'fs/promises'
import { homedir } from 'os'
import { Mutex } from 'async-mutex'
import {
  GlobalSettingsSchema,
  type GlobalSettings,
  type GlobalSettingsChanged,
  getDefaultGlobalSettings
} from '../../shared/ipc/global-settings-schema'
import { AppError, ErrorCode } from '../../shared/errors'
import { logger } from './LoggingService'

/** Global settings directory */
const SETTINGS_DIR = '.erfana'
/** Settings file name */
const SETTINGS_FILE = 'settings.json'
/** Backup file name (used when corruption detected) */
const BACKUP_FILE = 'settings.json.bak'

/**
 * Global settings service implementation
 */
export class GlobalSettingsService {
  private settings: GlobalSettings
  private readonly settingsPath: string
  private readonly backupPath: string
  private readonly writeMutex = new Mutex()
  private readonly changeListeners: Set<(event: GlobalSettingsChanged) => void> = new Set()

  constructor() {
    const settingsDir = this.getSettingsDir()
    this.settingsPath = `${settingsDir}/${SETTINGS_FILE}`
    this.backupPath = `${settingsDir}/${BACKUP_FILE}`
    this.settings = getDefaultGlobalSettings()
  }

  /**
   * Initialize service - create directory and load settings
   */
  async initialize(): Promise<void> {
    await this.ensureSettingsDir()
    await this.loadSettings()
  }

  /**
   * Get current settings (cached)
   */
  getSettings(): GlobalSettings {
    return this.settings
  }

  /**
   * Get specific setting value
   */
  getSetting<K extends keyof GlobalSettings>(key: K): GlobalSettings[K] {
    return this.settings[key]
  }

  /**
   * Update specific setting
   * @throws AppError on validation or write failure
   */
  async setSetting<K extends keyof GlobalSettings>(
    key: K,
    value: GlobalSettings[K]
  ): Promise<void> {
    // Skip $schema updates (metadata only)
    if (key === '$schema') {
      return
    }

    const previousValue = this.settings[key]

    // Build new settings object
    const newSettings = {
      ...this.settings,
      [key]: value
    }

    // Validate entire settings object
    const result = GlobalSettingsSchema.safeParse(newSettings)
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      throw new AppError(
        `Invalid settings value:\n${issues}`,
        ErrorCode.GLOBAL_SETTINGS_VALIDATION_FAILED
      )
    }

    // Update in-memory settings
    this.settings = result.data

    // Persist to disk
    await this.saveSettings()

    // Notify listeners
    this.notifyChange({
      settings: this.settings,
      changedKey: key as string,
      previousValue
    })
  }

  /**
   * Reset settings to defaults
   */
  async resetSettings(): Promise<void> {
    // Backup current settings
    await this.backupSettings()

    // Reset to defaults
    const previousSettings = this.settings
    this.settings = getDefaultGlobalSettings()

    // Persist
    await this.saveSettings()

    // Notify listeners
    this.notifyChange({
      settings: this.settings,
      changedKey: 'reset',
      previousValue: previousSettings
    })
  }

  /**
   * Subscribe to settings changes
   * @returns Unsubscribe function
   */
  onSettingsChanged(callback: (event: GlobalSettingsChanged) => void): () => void {
    this.changeListeners.add(callback)
    return () => {
      this.changeListeners.delete(callback)
    }
  }

  /**
   * Get settings file path (for debugging)
   */
  getSettingsPath(): string {
    return this.settingsPath
  }

  /**
   * Get settings directory path
   */
  private getSettingsDir(): string {
    return `${homedir()}/${SETTINGS_DIR}`
  }

  /**
   * Ensure settings directory exists
   * @throws AppError on directory creation failure
   */
  private async ensureSettingsDir(): Promise<void> {
    const settingsDir = this.getSettingsDir()

    try {
      await mkdir(settingsDir, { recursive: true })
    } catch (error) {
      throw new AppError(
        `Failed to create settings directory at ${settingsDir}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.GLOBAL_SETTINGS_DIR_CREATE_FAILED,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Load settings from disk with corruption handling
   */
  private async loadSettings(): Promise<void> {
    // Check if settings file exists
    const exists = await this.fileExists(this.settingsPath)
    if (!exists) {
      // No settings file - use defaults
      this.settings = getDefaultGlobalSettings()
      // Create initial settings file
      await this.saveSettings()
      return
    }

    try {
      // Read and parse JSON
      const content = await readFile(this.settingsPath, 'utf-8')
      const rawSettings = JSON.parse(content)

      // Validate with Zod
      const result = GlobalSettingsSchema.safeParse(rawSettings)
      if (!result.success) {
        // Validation failed - handle corruption
        await this.handleCorruption('Validation failed')
        return
      }

      this.settings = result.data
    } catch (error) {
      if (error instanceof SyntaxError) {
        // JSON parse failed - handle corruption
        await this.handleCorruption('Invalid JSON')
      } else {
        // Read error
        throw new AppError(
          `Failed to read settings from ${this.settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
          ErrorCode.GLOBAL_SETTINGS_READ_FAILED,
          error instanceof Error ? error : undefined
        )
      }
    }
  }

  /**
   * Save settings to disk with write serialization
   * @throws AppError on write failure
   */
  private async saveSettings(): Promise<void> {
    return this.writeMutex.runExclusive(async () => {
      try {
        const content = JSON.stringify(this.settings, null, 2)
        await writeFile(this.settingsPath, content, 'utf-8')
      } catch (error) {
        throw new AppError(
          `Failed to write settings to ${this.settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
          ErrorCode.GLOBAL_SETTINGS_WRITE_FAILED,
          error instanceof Error ? error : undefined
        )
      }
    })
  }

  /**
   * Handle corrupted settings file
   * 1. Copy current file to backup
   * 2. Reset to defaults
   * 3. Save defaults
   * 4. Log warning
   */
  private async handleCorruption(reason: string): Promise<void> {
    logger.warn('Global settings file corrupted', {
      reason,
      backupPath: this.backupPath,
      action: 'reset to defaults'
    })

    // Backup corrupted file
    await this.backupSettings()

    // Reset to defaults
    this.settings = getDefaultGlobalSettings()

    // Save defaults
    await this.saveSettings()
  }

  /**
   * Backup current settings file
   */
  private async backupSettings(): Promise<void> {
    try {
      const exists = await this.fileExists(this.settingsPath)
      if (exists) {
        await copyFile(this.settingsPath, this.backupPath)
      }
    } catch (error) {
      // Log but don't fail - backup is best-effort
      logger.warn('Failed to backup settings', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * Notify all listeners of settings change
   */
  private notifyChange(event: GlobalSettingsChanged): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event)
      } catch (error) {
        logger.error('Error in settings change listener', error instanceof Error ? error : undefined)
      }
    }
  }
}

/** Singleton instance */
export const globalSettingsService = new GlobalSettingsService()
