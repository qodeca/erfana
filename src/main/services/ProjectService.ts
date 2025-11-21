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
import { validatePath, PathSecurityError } from '../utils/pathSecurity'
import { AppError, ErrorCode } from '../../shared/errors'
import type { ProjectChanged } from '../../shared/ipc/schema'

// Use interface types for dependency injection
interface IFileService {
  getProjectPath(): string | null
  setProjectPath(path: string): void
}

interface IFileWatcherService {
  stopAll(): Promise<void>
  setProjectPath(path: string): void
}

interface IDirectoryWatcherService {
  stopAll(): Promise<void>
  setProjectPath(path: string): void
}

interface ISettingsService {
  setLastProjectPath(path: string): Promise<void>
  addRecentProject(path: string, name: string): Promise<void>
}

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
    private settingsService: ISettingsService
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
      console.warn('Stopping watchers failed (continuing):', e)
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
    } catch (e) {
      // Best-effort rollback
      console.warn('Rollback failed after openProject error:', e)
    }
  }

  /**
   * Switch to a new project
   *
   * Orchestrates the entire project switching flow:
   * 1. Security validation
   * 2. Check if same project (no-op)
   * 3. Validate directory exists
   * 4. Stop watchers
   * 5. Update services
   * 6. Persist settings
   * 7. Broadcast change
   * 8. Rollback on error
   *
   * @throws Error if validation fails or operation fails
   */
  async switchProject(newProjectPath: string): Promise<ProjectSwitchResult> {
    const oldProjectPath = this.fileService.getProjectPath()

    // 1. SECURITY: Validate path before any operations
    try {
      await validatePath(newProjectPath)
    } catch (error) {
      if (error instanceof PathSecurityError) {
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

    try {
      // 3. Validate directory exists and is accessible
      let stats
      try {
        stats = await stat(newProjectPath)
      } catch (error) {
        const originalError = error instanceof Error ? error : undefined
        throw new AppError(
          'Project directory not found or not accessible',
          ErrorCode.PROJECT_NOT_FOUND,
          originalError
        )
      }

      if (!stats.isDirectory()) {
        throw new AppError(
          'Selected path is not a directory',
          ErrorCode.PROJECT_NOT_DIRECTORY
        )
      }

      // 4. Stop all existing watchers before switching
      await this.stopAllWatchers()

      // 5. Update project path across services
      this.updateServices(newProjectPath)

      // 6. Persist project change
      await this.persistProjectChange(newProjectPath)

      // 7. Broadcast change to renderers
      const payload: ProjectChanged = {
        oldPath: oldProjectPath,
        newPath: newProjectPath
      }
      broadcastProjectChanged(payload)

      return {
        success: true,
        path: newProjectPath,
        action: 'switched'
      }
    } catch (error) {
      // 8. Rollback on error
      this.rollbackServices(oldProjectPath)

      const message = error instanceof Error ? error.message : String(error)
      console.error('Open project failed:', message)

      return {
        success: false,
        path: oldProjectPath || '',
        action: 'noop',
        error: message
      }
    }
  }
}
