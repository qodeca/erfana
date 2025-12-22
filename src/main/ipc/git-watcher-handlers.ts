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
 * @see BRS-003 - Real-time git status refresh specification
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
    try {
      // Validate input
      if (!projectPath || typeof projectPath !== 'string') {
        return { success: false, error: 'Invalid project path' }
      }

      const trimmedPath = projectPath.trim()
      if (!trimmedPath) {
        return { success: false, error: 'Project path is empty' }
      }

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
        logger.debug('git-watcher:start handler completed', { projectPath: trimmedPath })
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
    try {
      const result = await gitWatcherService.stop()

      if (result.success) {
        logger.debug('git-watcher:stop handler completed')
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
    try {
      // Validate input
      if (!projectPath || typeof projectPath !== 'string') {
        return { success: false, error: 'Invalid project path' }
      }

      const trimmedPath = projectPath.trim()
      if (!trimmedPath) {
        return { success: false, error: 'Project path is empty' }
      }

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

      logger.debug('git-polling:start handler completed', { projectPath: trimmedPath })

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
    try {
      gitPollingService.stop()

      logger.debug('git-polling:stop handler completed')

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
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('git-polling:set-interval', async (_event, intervalMs: number) => {
    try {
      // Validate input
      if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs)) {
        return { success: false, error: 'Invalid interval: must be a number' }
      }

      if (intervalMs < 0) {
        return { success: false, error: 'Invalid interval: must be positive' }
      }

      gitPollingService.setInterval(intervalMs)

      logger.debug('git-polling:set-interval handler completed', {
        intervalMs: gitPollingService.getInterval()
      })

      return { success: true, interval: gitPollingService.getInterval() }
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
    try {
      // Validate input
      if (typeof enabled !== 'boolean') {
        return { success: false, error: 'Invalid enabled value: must be a boolean' }
      }

      gitPollingService.setEnabled(enabled)

      logger.debug('git-polling:set-enabled handler completed', { enabled })

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
