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
 * Single Responsibility: Project lifecycle management (open, switch, close, validate)
 *
 * Owns the `ProjectSession` – the one record of which project is open. open,
 * switch and close run one at a time; the session changes only at the commit
 * step of a transition, so a failed open leaves it as it was.
 * Open/Closed: Extensible for new services without modifying existing code
 */

import { stat, realpath } from 'fs/promises'
import { normalize, sep, parse, resolve } from 'path'
import { BrowserWindow } from 'electron'
import { validatePath } from '../utils/pathSecurity'
import { AppError, ErrorCode } from '../../shared/errors'
import type { ProjectChanged } from '../../shared/ipc/schema'
import type { ResolvedProjectSettings } from '../../shared/ipc/project-settings-schema'
import type { ExcludeRejection, ExcludeSource } from '../../shared/ipc/files-exclude-schema'
import { ProjectPathFilter } from '../utils/projectPathFilter'
import { getPlatformConfig } from './watcher/PlatformConfig'
import type { IFileService } from '../interfaces/IFileService'
import type { IFileWatcherService } from '../interfaces/IFileWatcherService'
import type { IDirectoryWatcherService } from '../interfaces/IDirectoryWatcherService'
import type { ISettingsService } from '../interfaces/ISettingsService'
import type { IProjectSettingsService } from '../interfaces/IProjectSettingsService'
import type { IProjectLockService } from '../interfaces/IProjectLockService'
import { logger } from './LoggingService'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import { redactQuotedPaths } from '../../shared/redactQuotedPaths'
import {
  ProjectSessionStore,
  normaliseRealRoot,
  type ProjectSession,
  type ProjectSessionSnapshot
} from './session/ProjectSession'
import { sweepStaleAtomicTemps } from '../utils/atomicTempSweep'

export interface ProjectSwitchResult {
  success: boolean
  path: string
  action: 'noop' | 'switched'
  error?: string
}

/** Who asked for a transition; recorded on the session for later owner checks */
export interface OpenContext {
  /** `webContents.id` of the requesting window, or null when there is none */
  senderId: number | null
  source: 'dialog' | 'recent'
}

export interface CloseContext {
  senderId: number | null
  reason: 'user' | 'project-deleted' | 'window-destroyed'
  /** Close only if the session is still at this generation; a mismatch is a no-op */
  expectedGeneration?: number
}

const DEFAULT_OPEN_CONTEXT: OpenContext = { senderId: null, source: 'recent' }

/** Same case rule as `canonicalizePath`, for a path that is already resolved */
function foldCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
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
 * Rejections listed per source in the log line. A cloned repository's list is
 * untrusted and uncapped in length – every entry past the 256th is rejected –
 * so the line carries the full count and only the first ones.
 */
const MAX_LOGGED_EXCLUDE_REJECTIONS = 64

/**
 * Log the rejected `files.exclude` entries: one `warn` per source that has any,
 * by index and reason only – an entry's text can name a user's folder (#211).
 */
function logExcludeRejections(rejections: readonly ExcludeRejection[]): void {
  const bySource = new Map<ExcludeSource, Array<{ index: number; reason: string }>>()
  for (const { source, index, reason } of rejections) {
    const list = bySource.get(source) ?? []
    list.push({ index, reason })
    bySource.set(source, list)
  }
  for (const [source, rejected] of bySource) {
    logger.warn('Project switch: files.exclude entries rejected', {
      source,
      rejectedCount: rejected.length,
      rejected: rejected.slice(0, MAX_LOGGED_EXCLUDE_REJECTIONS)
    })
  }
}

/**
 * Broadcast project change to all renderer processes. The only sender of
 * `project:changed`; `generation` is the session's, so a listener can tell a
 * stale event from a current one.
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
  private readonly sessionStore = new ProjectSessionStore()
  // Tail of the transition queue; always resolves, so one failure never blocks the next
  private transitionTail: Promise<unknown> = Promise.resolve()

  /** Read-only view of the open project; this service is its only writer */
  readonly session: ProjectSession = this.sessionStore

  constructor(
    private fileService: IFileService,
    private fileWatcherService: IFileWatcherService,
    private directoryWatcherService: IDirectoryWatcherService,
    private settingsService: ISettingsService,
    private projectSettingsService: IProjectSettingsService,
    private projectLockService: IProjectLockService
  ) {
    // The services follow the session, so they cannot drift from it
    this.sessionStore.onChange((_prev, next) => this.updateServices(next?.root ?? ''))
  }

  /**
   * Run `task` after every earlier transition has settled. A second open waits
   * for the first, so a double-click on two recents ends with the second
   * project open, never with both half-applied.
   */
  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const result = this.transitionTail.then(task)
    this.transitionTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /**
   * Check if the new path is the open project
   * Uses canonical comparison (resolves symlinks, case-insensitivity)
   */
  private async isSameProject(open: ProjectSessionSnapshot, newPath: string): Promise<boolean> {
    return foldCase(open.realRoot) === (await canonicalizePath(newPath))
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
        error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
      })
    }
  }

  /**
   * Point the services at the session's root. Runs from the session's
   * `onChange`, never directly: '' means no project.
   */
  private updateServices(root: string): void {
    this.fileService.setProjectPath(root)
    this.fileWatcherService.setProjectPath(root)
    this.directoryWatcherService.setProjectPath(root)
  }

  /**
   * Build the path filter (#211, design D7). One path filter – exclude list,
   * hidden names, ignore patterns – is built per project open and the same
   * instance goes to the tree walk and the directory watcher, so both drop the
   * same paths and the walk hints the file service records on it reach the
   * watcher's plan. A fresh filter also restarts the matcher's tripwire.
   * Built before the commit, so a failure here leaves the session untouched.
   */
  private buildPathFilter(
    projectPath: string,
    settings: ResolvedProjectSettings,
    caseSensitive: boolean
  ): ProjectPathFilter {
    logExcludeRejections(settings.excludeRejections)
    return new ProjectPathFilter(projectPath, {
      exclude: settings.excludePatterns,
      hiddenPatterns: settings.treeHiddenPatterns,
      ignorePatterns: settings.watcherIgnorePatterns,
      caseSensitive
    })
  }

  /**
   * Hand the loaded settings and the filter to the services (after the commit)
   */
  private applyProjectSettings(settings: ResolvedProjectSettings, pathFilter: ProjectPathFilter): void {
    this.fileService.setHiddenPatterns(settings.treeHiddenPatterns)
    this.fileService.setPathFilter(pathFilter)
    this.directoryWatcherService.setPathFilter(pathFilter)
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
   * Drop the settings a failed open may have loaded, and give back the lock it
   * took. The session needs no rollback: it was never changed.
   * Best-effort: continues on error
   */
  private abandonOpen(newProjectPath: string, lockLogMessage: string): void {
    try {
      this.projectSettingsService.clearSettings()
    } catch (e) {
      logger.warn('Clearing project settings failed after openProject error', {
        error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
      })
    }

    // Release the lock we just acquired (fire-and-forget)
    this.projectLockService.releaseLock(newProjectPath).catch((e) => {
      logger.warn(lockLogMessage, {
        projectPath: redactPath(newProjectPath),
        error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
      })
    })
  }

  /**
   * Switch to a new project
   *
   * Runs after every earlier open/switch/close has finished. Orchestrates the
   * entire project switching flow; the session changes only at step 7:
   * 1. Security validation
   * 2. Check if same project (no-op)
   * 3. Acquire project lock (multi-instance support)
   * 4. Validate directory exists
   * 5. Stop watchers
   * 6. Load and validate project settings; build the path filter
   * 7. Commit the session (services follow through `onChange`)
   * 8. Apply project settings
   * 9. Persist settings
   * 10. Broadcast change
   * 11. Release old project lock (after successful switch)
   * 12. On a failure in 1-6 the session is untouched (keeps old lock, releases new lock)
   *
   * @throws Error if validation fails or operation fails
   */
  switchProject(
    newProjectPath: string,
    ctx: OpenContext = DEFAULT_OPEN_CONTEXT
  ): Promise<ProjectSwitchResult> {
    return this.serialise(() => this.performSwitch(newProjectPath, ctx))
  }

  private async performSwitch(
    requestedPath: string,
    ctx: OpenContext
  ): Promise<ProjectSwitchResult> {
    const openSnapshot = this.sessionStore.current()
    const oldProjectPath = openSnapshot?.root ?? null
    const switchStart = performance.now()
    logger.info('Project switch: starting', {
      oldPath: oldProjectPath ? redactPath(oldProjectPath) : null,
      newPath: redactPath(requestedPath),
      source: ctx.source
    })

    // 1. SECURITY: Validate path before any operations
    try {
      await validatePath(requestedPath)
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
    const newProjectPath = resolve(requestedPath)

    // 2. Check if same project (canonical comparison)
    if (openSnapshot) {
      const isSame = await this.isSameProject(openSnapshot, newProjectPath)
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
        projectPath: redactPath(newProjectPath),
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
        projectPath: redactPath(newProjectPath),
        error: redactQuotedPaths(lockResult.message ?? '')
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
        this.abandonOpen(newProjectPath, 'Failed to release lock after settings validation failure')

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
        ignorePatternCount: projectSettings.watcherIgnorePatterns.length,
        excludePatternCount: projectSettings.excludePatterns.length
      })

      const caseSensitive = getPlatformConfig().caseSensitive
      const pathFilter = this.buildPathFilter(newProjectPath, projectSettings, caseSensitive)
      const realRoot = normaliseRealRoot(await realpath(newProjectPath).catch(() => newProjectPath))

      // 7. Commit: swap the session. The services take the new path in `onChange`.
      const generation = this.sessionStore.commit({
        root: newProjectPath,
        realRoot,
        caseSensitive,
        ownerWebContentsId: ctx.senderId
      })
      logger.debug('Project switch: session committed', { generation })

      // 8. Apply project settings to services
      this.applyProjectSettings(projectSettings, pathFilter)

      // 9. Persist project change. The project is open from here on, so a
      // failure to remember it is logged and does not undo the open.
      try {
        await this.persistProjectChange(newProjectPath)
      } catch (e) {
        logger.warn('Project switch: could not persist the opened project', {
          error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
        })
      }

      // 10. Broadcast change to renderers
      broadcastProjectChanged({
        oldPath: oldProjectPath,
        newPath: newProjectPath,
        generation
      })

      // Temp files an interrupted save left behind: background, best effort
      void sweepStaleAtomicTemps(newProjectPath)

      // 11. Release old project lock AFTER successful switch
      // This ensures we don't lose lock on old project if switch fails
      if (oldProjectPath) {
        this.projectLockService.releaseLock(oldProjectPath).catch((e) => {
          logger.warn('Failed to release old project lock', {
            projectPath: redactPath(oldProjectPath),
            error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
          })
        })
      }

      const durationMs = Math.round(performance.now() - switchStart)
      logger.info('Project switch: completed', { durationMs, generation, note: 'git watcher/polling will be started by renderer' })

      return {
        success: true,
        path: newProjectPath,
        action: 'switched'
      }
    } catch (error) {
      // 12. The session was not changed. Release the new lock and drop loaded settings.
      // Note: Old project lock is NOT released here - we keep it if switch fails
      this.abandonOpen(newProjectPath, 'Failed to release lock during rollback')

      const stage = this.sessionStore.current() === openSnapshot ? 'pre-switch' : 'post-switch'
      const durationMs = Math.round(performance.now() - switchStart)
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Project switch: failed', redactedLogError(error), {
        stage,
        durationMs,
        path: redactPath(newProjectPath)
      })

      return {
        success: false,
        path: oldProjectPath || '',
        action: 'noop',
        error: message
      }
    }
  }

  /**
   * Close the open project: release its lock, stop the watchers, commit `null`,
   * forget the last path, tell the renderers. Runs after any open or switch
   * already queued. With `expectedGeneration`, a project opened in the meantime
   * is left alone.
   */
  close(ctx: CloseContext): Promise<void> {
    return this.serialise(() => this.performClose(ctx))
  }

  private async performClose(ctx: CloseContext): Promise<void> {
    const open = this.sessionStore.current()
    if (!open) return
    if (ctx.expectedGeneration !== undefined && ctx.expectedGeneration !== open.generation) {
      logger.debug('Project close: skipped, the project changed meanwhile', {
        reason: ctx.reason,
        expectedGeneration: ctx.expectedGeneration,
        generation: open.generation
      })
      return
    }
    logger.info('Project close: starting', { reason: ctx.reason, generation: open.generation })

    try {
      await this.projectLockService.releaseLock(open.root)
    } catch (e) {
      logger.warn('Failed to release project lock on close', {
        projectPath: redactPath(open.root),
        error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
      })
    }
    await this.stopAllWatchers()

    const generation = this.sessionStore.commit(null)

    // A closing window is not the user forgetting the project: keep the last path
    if (ctx.reason !== 'window-destroyed') {
      try {
        await this.settingsService.clearLastProjectPath()
      } catch (e) {
        logger.warn('Project close: could not clear the last project path', {
          error: e instanceof Error ? redactQuotedPaths(e.message) : String(e)
        })
      }
    }

    broadcastProjectChanged({ oldPath: open.root, newPath: null, generation })
  }
}
