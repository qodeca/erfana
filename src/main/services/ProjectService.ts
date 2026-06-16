// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectService
 *
 * REFACTORING (todo017): Extract orchestration logic from IPC handlers
 *
 * Orchestrates project switching across multiple services.
 * Follows Dependency Inversion: depends on abstractions (services), not concrete implementations.
 *
 * Single Responsibility: Project lifecycle management (open, switch, validate)
 * Open/Closed: Extensible for new services without modifying existing code
 */

import { stat, realpath } from 'fs/promises'
import { normalize, sep, parse } from 'path'
import { BrowserWindow } from 'electron'
import { validatePath } from '../utils/pathSecurity'
import { AppError, ErrorCode } from '../../shared/errors'
import type { ProjectChanged } from '../../shared/ipc/schema'
import type { IFileService } from '../interfaces/IFileService'
import type { IFileWatcherService } from '../interfaces/IFileWatcherService'
import type { IDirectoryWatcherService } from '../interfaces/IDirectoryWatcherService'
import type { ISettingsService } from '../interfaces/ISettingsService'
import type { IProjectSettingsService } from '../interfaces/IProjectSettingsService'
import type { IProjectLockService } from '../interfaces/IProjectLockService'
import { logger } from './LoggingService'

export interface ProjectSwitchResult {
  success: boolean
  path: string
  action: 'noop' | 'switched'
  error?: string
}

/**
 * Canonicalize path for comparison
 * - Normalize separators
 * - Remove trailing separators
 * - Resolve symlinks
 * - Case fold on Windows
 */
async function canonicalizePath(p: string): Promise<string> {
  // Normalize separators
  let n = normalize(p)

  // Preserve root; trim trailing separators only past root length
  const root = parse(n).root
  while (n.length > root.length && n.endsWith(sep)) {
    n = n.slice(0, -1)
  }

  // Resolve symlinks if possible
  let r = n
  try {
    r = await realpath(n)
  } catch {
    // ignore, fallback to normalized path
  }

  // Case fold only on Windows (case-insensitive by default)
  if (process.platform === 'win32') {
    r = r.toLowerCase()
  }
  return r
}

/**
 * Broadcast project change to all renderer processes
 */
function broadcastProjectChanged(payload: ProjectChanged): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('project:changed', payload)
      } catch {
        // ignore send errors for destroyed windows
      }
    }
  }
}

export class ProjectService {
  constructor(
    private fileService: IFileService,
    private fileWatcherService: IFileWatcherService,
    private directoryWatcherService: IDirectoryWatcherService,
    private settingsService: ISettingsService,
    private projectSettingsService: IProjectSettingsService,
    private projectLockService: IProjectLockService
  ) {}

  /**
   * Check if two paths represent the same project
   * Uses canonical comparison (resolves symlinks, case-insensitivity)
   */
  private async isSameProject(oldPath: string, newPath: string): Promise<boolean> {
    const [canonOld, canonNew] = await Promise.all([
      canonicalizePath(oldPath),
      canonicalizePath(newPath)
    ])
    return canonOld === canonNew
  }

  /**
   * Stop all watchers before project switch
   * Non-fatal: continues on error (guards prevent stale events)
   */
  private async stopAllWatchers(): Promise<void> {
    try {
      await this.fileWatcherService.stopAll()
      await this.directoryWatcherService.stopAll()
    } catch (e) {
      // Non-fatal: proceed with switch, guards prevent stale events
      logger.warn('Stopping watchers failed (continuing)', {
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  /**
   * Update project path across all services
   */
  private updateServices(newPath: string): void {
    this.fileService.setProjectPath(newPath)
    this.fileWatcherService.setProjectPath(newPath)
    this.directoryWatcherService.setProjectPath(newPath)
  }

  /**
   * Persist project change to settings
   */
  private async persistProjectChange(newPath: string): Promise<void> {
    // Persist last project path
    await this.settingsService.setLastProjectPath(newPath)

    // Add to recent projects (max 5) - CRITICAL: Updates timestamp!
    const projectName = parse(newPath).base || newPath
    await this.settingsService.addRecentProject(newPath, projectName)
  }

  /**
   * Rollback services to previous state on error
   * Best-effort: continues on error
   */
  private rollbackServices(oldPath: string | null): void {
    try {
      this.fileService.setProjectPath(oldPath || '')
      this.fileWatcherService.setProjectPath(oldPath || '')
      this.directoryWatcherService.setProjectPath(oldPath || '')
      this.projectSettingsService.clearSettings()
    } catch (e) {
      // Best-effort rollback
      logger.warn('Rollback failed after openProject error', {
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  /**
   * Switch to a new project
   *
   * Orchestrates the entire project switching flow:
   * 1. Security validation
   * 2. Check if same project (no-op)
   * 3. Acquire project lock (multi-instance support)
   * 4. Validate directory exists
   * 5. Stop watchers
   * 6. Load and validate project settings
   * 7. Update services
   * 8. Apply project settings
   * 9. Persist settings
   * 10. Broadcast change
   * 11. Release old project lock (after successful switch)
   * 12. Rollback on error (keeps old lock, releases new lock)
   *
   * @throws Error if validation fails or operation fails
   */
  async switchProject(newProjectPath: string): Promise<ProjectSwitchResult> {
    const oldProjectPath = this.fileService.getProjectPath()
    const switchStart = performance.now()
    logger.info('Project switch: starting', { oldPath: oldProjectPath, newPath: newProjectPath })

    // 1. SECURITY: Validate path before any operations
    try {
      await validatePath(newProjectPath)
    } catch (error) {
      if (error instanceof AppError) {
        const errorMsg = `Security validation failed: ${error.message}`
        return {
          success: false,
          path: oldProjectPath || '',
          action: 'noop',
          error: errorMsg
        }
      }
      throw error
    }
    logger.debug('Project switch: security validation passed')

    // 2. Check if same project (canonical comparison)
    if (oldProjectPath) {
      const isSame = await this.isSameProject(oldProjectPath, newProjectPath)
      if (isSame) {
        return {
          success: true,
          path: newProjectPath,
          action: 'noop'
        }
      }
    }

    // 3. Try to acquire project lock (multi-instance support)
    const lockResult = await this.projectLockService.acquireLock(newProjectPath)
    if (lockResult.status === 'already_locked') {
      // Focus existing window and exit silently
      await this.projectLockService.requestFocus(newProjectPath)
      logger.info('Project already locked, focused existing instance', {
        projectPath: newProjectPath,
        holderPid: lockResult.holderPid,
        holderHostname: lockResult.holderHostname
      })
      return {
        success: false,
        path: oldProjectPath || '',
        action: 'noop',
        error: 'focused_existing'
      }
    }
    if (lockResult.status === 'error') {
      // Log warning but allow project to open (graceful degradation)
      logger.warn('Lock acquisition failed, continuing with project open', {
        projectPath: newProjectPath,
        error: lockResult.message
      })
    }

    try {
      // 4. Validate directory exists and is accessible
      const stats = await stat(newProjectPath).catch((error) => {
        const originalError = error instanceof Error ? error : undefined
        throw new AppError(
          'Project directory not found or not accessible',
          ErrorCode.PROJECT_NOT_FOUND,
          originalError
        )
      })

      if (!stats.isDirectory()) {
        throw new AppError(
          'Selected path is not a directory',
          ErrorCode.PROJECT_NOT_DIRECTORY
        )
      }

      // 5. Stop all existing watchers before switching
      const watcherStopStart = performance.now()
      await this.stopAllWatchers()
      logger.debug('Project switch: watchers stopped', { durationMs: Math.round(performance.now() - watcherStopStart) })

      // 6. Load and validate project settings
      let projectSettings
      try {
        projectSettings = await this.projectSettingsService.loadSettings(newProjectPath)
      } catch (error) {
        // Settings validation failed - block project open
        // Rollback services (including clearing settings)
        this.rollbackServices(oldProjectPath)

        // Release the lock we just acquired (fire-and-forget)
        this.projectLockService.releaseLock(newProjectPath).catch((e) => {
          logger.warn('Failed to release lock after settings validation failure', {
            projectPath: newProjectPath,
            error: e instanceof Error ? e.message : String(e)
          })
        })

        if (error instanceof AppError) {
          return {
            success: false,
            path: oldProjectPath || '',
            action: 'noop',
            error: error.message
          }
        }
        throw error
      }
      logger.debug('Project switch: settings loaded', {
        hiddenPatternCount: projectSettings.treeHiddenPatterns.length,
        ignorePatternCount: projectSettings.watcherIgnorePatterns.length
      })

      // 7. Update project path across services
      this.updateServices(newProjectPath)
      logger.debug('Project switch: services updated')

      // 8. Apply project settings to services
      this.fileService.setHiddenPatterns(projectSettings.treeHiddenPatterns)
      this.directoryWatcherService.setIgnorePatterns(projectSettings.watcherIgnorePatterns)

      // 9. Persist project change
      await this.persistProjectChange(newProjectPath)

      // 10. Broadcast change to renderers
      const payload: ProjectChanged = {
        oldPath: oldProjectPath,
        newPath: newProjectPath
      }
      broadcastProjectChanged(payload)

      // 11. Release old project lock AFTER successful switch
      // This ensures we don't lose lock on old project if switch fails
      if (oldProjectPath) {
        this.projectLockService.releaseLock(oldProjectPath).catch((e) => {
          logger.warn('Failed to release old project lock', {
            projectPath: oldProjectPath,
            error: e instanceof Error ? e.message : String(e)
          })
        })
      }

      const durationMs = Math.round(performance.now() - switchStart)
      logger.info('Project switch: completed', { durationMs, note: 'git watcher/polling will be started by renderer' })

      return {
        success: true,
        path: newProjectPath,
        action: 'switched'
      }
    } catch (error) {
      // 12. Rollback on error (including releasing new lock if acquired)
      // Note: Old project lock is NOT released here - we keep it if switch fails
      this.rollbackServices(oldProjectPath)

      // Release the lock we just acquired (fire-and-forget)
      this.projectLockService.releaseLock(newProjectPath).catch((e) => {
        logger.warn('Failed to release lock during rollback', {
          projectPath: newProjectPath,
          error: e instanceof Error ? e.message : String(e)
        })
      })

      const stage = !this.fileService.getProjectPath() || this.fileService.getProjectPath() === oldProjectPath
        ? 'pre-switch' : 'post-switch'
      const durationMs = Math.round(performance.now() - switchStart)
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Project switch: failed', error instanceof Error ? error : undefined, {
        stage,
        durationMs,
        path: newProjectPath
      })

      return {
        success: false,
        path: oldProjectPath || '',
        action: 'noop',
        error: message
      }
    }
  }
}
