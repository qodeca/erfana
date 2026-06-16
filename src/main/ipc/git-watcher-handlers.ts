// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git watcher IPC handlers
 *
 * Handles IPC requests for git file watcher and polling control.
 * The watcher monitors .git directory for external git operations,
 * while the polling service provides a hybrid fallback mechanism.
 *
 * Handlers:
 * - 'git-watcher:start' - Start watching a project path
 * - 'git-watcher:stop' - Stop watching
 * - 'git-watcher:status' - Get current watcher status
 * - 'git-polling:start' - Start polling
 * - 'git-polling:stop' - Stop polling
 * - 'git-polling:set-interval' - Update polling interval
 * - 'git-polling:set-enabled' - Enable/disable polling
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 */
import { ipcMain } from 'electron'
import { gitWatcherService } from '../services/GitWatcherService'
import { gitPollingService } from '../services/GitPollingService'
import { logger } from '../services/LoggingService'
import { GitWatcherStatusSchema, type GitWatcherStatus } from '../../shared/ipc/git-watcher-schema'
import { validateProjectPath } from '../utils/pathSecurity'
import { getUserFriendlyMessage } from '../../shared/errors'

/**
 * Register all git watcher IPC handlers
 */
export function registerGitWatcherHandlers(): void {
  // ====================================================
  // Git Watcher Handlers
  // ====================================================

  /**
   * Start watching git state for a project
   *
   * @param projectPath - Absolute path to project root
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('git-watcher:start', async (_event, projectPath: string) => {
    const startTime = Date.now() // Timing (ADR-Spec003-002)
    try {
      // Validate input
      if (!projectPath || typeof projectPath !== 'string') {
        return { success: false, error: 'Invalid project path' }
      }

      const trimmedPath = projectPath.trim()
      if (!trimmedPath) {
        return { success: false, error: 'Project path is empty' }
      }

      // Trace log for handler entry (ADR-Spec003-002)
      logger.trace('git-watcher:start invoked', { projectPath: trimmedPath })

      // Validate path security (prevent path traversal and system directory access)
      try {
        await validateProjectPath(trimmedPath)
      } catch (error) {
        // Use user-friendly message to avoid path disclosure (Issue #74 review fix)
        const userMessage = getUserFriendlyMessage(error)
        const logMessage = error instanceof Error ? error.message : String(error)
        logger.warn('Git watcher start rejected - invalid path', { projectPath: trimmedPath, error: logMessage })
        return { success: false, error: userMessage }
      }

      const result = await gitWatcherService.start(trimmedPath)

      if (result.success) {
        logger.debug('git-watcher:start completed', {
          projectPath: trimmedPath,
          latencyMs: Date.now() - startTime
        })
      }

      return result
    } catch (error) {
      // Use sanitized message to avoid internal error exposure (Issue #74 review fix)
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in git-watcher:start handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  /**
   * Stop watching git state
   *
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('git-watcher:stop', async () => {
    const startTime = Date.now() // Timing (ADR-Spec003-002)
    logger.trace('git-watcher:stop invoked')
    try {
      const result = await gitWatcherService.stop()

      if (result.success) {
        logger.debug('git-watcher:stop completed', {
          latencyMs: Date.now() - startTime
        })
      }

      return result
    } catch (error) {
      // Use sanitized message to avoid internal error exposure (Issue #74 review fix)
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in git-watcher:stop handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  /**
   * Get current watcher status
   *
   * @returns GitWatcherStatus - Current state, watched path, last event, error
   */
  ipcMain.handle('git-watcher:status', async () => {
    const startTime = Date.now() // Timing (ADR-Spec003-002)
    logger.trace('git-watcher:status invoked')
    try {
      const isWatching = gitWatcherService.isWatching()
      const watchedPath = gitWatcherService.getWatchedPath()
      const lastEventTimestamp = gitWatcherService.getLastEventTimestamp()

      const status: GitWatcherStatus = {
        state: isWatching ? 'watching' : 'stopped',
        watchedPath,
        lastEventTimestamp: lastEventTimestamp || null,
        error: null
      }

      // Validate against schema
      const validated = GitWatcherStatusSchema.parse(status)

      logger.debug('git-watcher:status completed', {
        state: validated.state,
        latencyMs: Date.now() - startTime
      })

      return { success: true, status: validated }
    } catch (error) {
      // Use sanitized message to avoid internal error exposure (Issue #74 review fix)
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in git-watcher:status handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  // ====================================================
  // Git Polling Handlers
  // ====================================================

  /**
   * Start polling for a project
   *
   * @param projectPath - Absolute path to project root
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('git-polling:start', async (_event, projectPath: string) => {
    const startTime = Date.now() // Timing (ADR-Spec003-002)
    try {
      // Validate input
      if (!projectPath || typeof projectPath !== 'string') {
        return { success: false, error: 'Invalid project path' }
      }

      const trimmedPath = projectPath.trim()
      if (!trimmedPath) {
        return { success: false, error: 'Project path is empty' }
      }

      // Trace log for handler entry (ADR-Spec003-002)
      logger.trace('git-polling:start invoked', { projectPath: trimmedPath })

      // Validate path security (prevent path traversal and system directory access)
      try {
        await validateProjectPath(trimmedPath)
      } catch (error) {
        // Use user-friendly message to avoid path disclosure (Issue #74 review fix)
        const userMessage = getUserFriendlyMessage(error)
        const logMessage = error instanceof Error ? error.message : String(error)
        logger.warn('Git polling start rejected - invalid path', { projectPath: trimmedPath, error: logMessage })
        return { success: false, error: userMessage }
      }

      gitPollingService.start(trimmedPath)

      logger.debug('git-polling:start completed', {
        projectPath: trimmedPath,
        latencyMs: Date.now() - startTime
      })

      return { success: true }
    } catch (error) {
      // Use sanitized message to avoid internal error exposure (Issue #74 review fix)
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in git-polling:start handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  /**
   * Stop polling
   *
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('git-polling:stop', async () => {
    const startTime = Date.now() // Timing (ADR-Spec003-002)
    logger.trace('git-polling:stop invoked')
    try {
      gitPollingService.stop()

      logger.debug('git-polling:stop completed', {
        latencyMs: Date.now() - startTime
      })

      return { success: true }
    } catch (error) {
      // Use sanitized message to avoid internal error exposure (Issue #74 review fix)
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in git-polling:stop handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  /**
   * Update polling interval
   *
   * @param intervalMs - Interval in milliseconds (clamped to 1-60 seconds)
   * @returns { success: boolean, interval?: number, clamped?: boolean, error?: string }
   */
  ipcMain.handle('git-polling:set-interval', async (_event, intervalMs: number) => {
    const startTime = Date.now() // Timing (ADR-Spec003-002)
    logger.trace('git-polling:set-interval invoked', { requestedIntervalMs: intervalMs })
    try {
      // Validate input
      if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs)) {
        return { success: false, error: 'Invalid interval: must be a number' }
      }

      if (intervalMs < 0) {
        return { success: false, error: 'Invalid interval: must be positive' }
      }

      gitPollingService.setInterval(intervalMs)

      const actualInterval = gitPollingService.getInterval()
      const wasClamped = actualInterval !== intervalMs

      logger.debug('git-polling:set-interval completed', {
        requestedMs: intervalMs,
        actualMs: actualInterval,
        clamped: wasClamped,
        latencyMs: Date.now() - startTime
      })

      return { success: true, interval: actualInterval, clamped: wasClamped }
    } catch (error) {
      // Use sanitized message to avoid internal error exposure (Issue #74 review fix)
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in git-polling:set-interval handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  /**
   * Enable or disable polling
   *
   * @param enabled - Whether polling should be enabled
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('git-polling:set-enabled', async (_event, enabled: boolean) => {
    const startTime = Date.now() // Timing (ADR-Spec003-002)
    logger.trace('git-polling:set-enabled invoked', { enabled })
    try {
      // Validate input
      if (typeof enabled !== 'boolean') {
        return { success: false, error: 'Invalid enabled value: must be a boolean' }
      }

      gitPollingService.setEnabled(enabled)

      logger.debug('git-polling:set-enabled completed', {
        enabled: gitPollingService.isEnabled(),
        latencyMs: Date.now() - startTime
      })

      return { success: true, enabled: gitPollingService.isEnabled() }
    } catch (error) {
      // Use sanitized message to avoid internal error exposure (Issue #74 review fix)
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in git-polling:set-enabled handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  logger.info('Git watcher IPC handlers registered')
}
