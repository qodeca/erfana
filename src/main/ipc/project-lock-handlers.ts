// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Project lock IPC handlers
 *
 * Handles IPC requests for project lock operations.
 * Used by multi-instance support to prevent duplicate project opens.
 *
 * Handlers:
 * - 'project-lock:acquire' - Acquire lock for a project path
 * - 'project-lock:release' - Release lock for a project path
 * - 'project-lock:check' - Check lock status for a project path
 * - 'project-lock:requestFocus' - Request focus from lock holder
 * - 'project-lock:cleanup' - Cleanup stale locks at startup
 *
 * @see ProjectLockService.ts - Main process lock management implementation
 * @see Spec #010 - Multi-instance support specification
 * @see Issue #27 - Multiple independent instances
 */
import { ipcMain } from 'electron'
import { projectLockService } from '../services/ProjectLockService'
import {
  AcquireLockPayloadSchema,
  ReleaseLockPayloadSchema,
  CheckLockPayloadSchema
} from '../../shared/ipc/project-lock-schema'
import { validatePath } from '../utils/pathSecurity'
import { getUserFriendlyMessage } from '../../shared/errors'
import { logger } from '../services/LoggingService'

/**
 * Registers IPC handlers for project lock operations.
 */
export function registerProjectLockHandlers(): void {
  /**
   * Acquire lock for a project path
   *
   * @param payload - { projectPath: string }
   * @returns LockResult - 'acquired', 'already_locked', or 'error'
   */
  ipcMain.handle('project-lock:acquire', async (_event, payload: unknown) => {
    const startTime = Date.now()

    // Validate payload schema
    const result = AcquireLockPayloadSchema.safeParse(payload)
    if (!result.success) {
      logger.warn('project-lock:acquire - invalid payload', {
        error: result.error.message
      })
      return { status: 'error' as const, message: 'Invalid payload: ' + result.error.message }
    }

    const { projectPath } = result.data

    logger.trace('project-lock:acquire invoked', { projectPath })

    // Validate path security (prevent path traversal, system directory access, and symlink attacks)
    try {
      await validatePath(projectPath)
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      const logMessage = error instanceof Error ? error.message : String(error)
      logger.warn('project-lock:acquire rejected - invalid path', {
        projectPath,
        error: logMessage
      })
      return { status: 'error' as const, message: userMessage }
    }

    try {
      const lockResult = await projectLockService.acquireLock(projectPath)

      logger.debug('project-lock:acquire completed', {
        projectPath,
        status: lockResult.status,
        latencyMs: Date.now() - startTime
      })

      return lockResult
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in project-lock:acquire handler', error instanceof Error ? error : undefined)
      return { status: 'error' as const, message: userMessage }
    }
  })

  /**
   * Release lock for a project path
   *
   * @param payload - { projectPath: string }
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('project-lock:release', async (_event, payload: unknown) => {
    const startTime = Date.now()

    // Validate payload schema
    const result = ReleaseLockPayloadSchema.safeParse(payload)
    if (!result.success) {
      logger.warn('project-lock:release - invalid payload', {
        error: result.error.message
      })
      return { success: false, error: 'Invalid payload: ' + result.error.message }
    }

    const { projectPath } = result.data

    logger.trace('project-lock:release invoked', { projectPath })

    // Validate path security (defense-in-depth, includes symlink validation)
    try {
      await validatePath(projectPath)
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.warn('project-lock:release rejected - invalid path', { projectPath })
      return { success: false, error: userMessage }
    }

    try {
      await projectLockService.releaseLock(projectPath)

      logger.debug('project-lock:release completed', {
        projectPath,
        latencyMs: Date.now() - startTime
      })

      return { success: true }
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in project-lock:release handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  /**
   * Check lock status for a project path
   *
   * @param payload - { projectPath: string }
   * @returns LockStatus - 'unlocked', 'locked_by_self', 'locked_by_other', or 'error'
   */
  ipcMain.handle('project-lock:check', async (_event, payload: unknown) => {
    const startTime = Date.now()

    // Validate payload schema
    const result = CheckLockPayloadSchema.safeParse(payload)
    if (!result.success) {
      logger.warn('project-lock:check - invalid payload', {
        error: result.error.message
      })
      return { status: 'error' as const, message: 'Invalid payload: ' + result.error.message }
    }

    const { projectPath } = result.data

    logger.trace('project-lock:check invoked', { projectPath })

    // Validate path security (defense-in-depth, includes symlink validation)
    try {
      await validatePath(projectPath)
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.warn('project-lock:check rejected - invalid path', { projectPath })
      return { status: 'error' as const, message: userMessage }
    }

    try {
      const lockStatus = await projectLockService.checkLock(projectPath)

      logger.debug('project-lock:check completed', {
        projectPath,
        status: lockStatus.status,
        latencyMs: Date.now() - startTime
      })

      return lockStatus
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in project-lock:check handler', error instanceof Error ? error : undefined)
      return { status: 'error' as const, message: userMessage }
    }
  })

  /**
   * Request focus for a locked project
   *
   * Asks the lock holder to bring their window to front.
   *
   * @param payload - { projectPath: string }
   * @returns { success: boolean, error?: string }
   */
  ipcMain.handle('project-lock:requestFocus', async (_event, payload: unknown) => {
    const startTime = Date.now()

    // Validate payload schema (reusing CheckLockPayloadSchema - same structure)
    const result = CheckLockPayloadSchema.safeParse(payload)
    if (!result.success) {
      logger.warn('project-lock:requestFocus - invalid payload', {
        error: result.error.message
      })
      return { success: false, error: 'Invalid payload: ' + result.error.message }
    }

    const { projectPath } = result.data

    logger.trace('project-lock:requestFocus invoked', { projectPath })

    // Validate path security (defense-in-depth, includes symlink validation)
    try {
      await validatePath(projectPath)
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.warn('project-lock:requestFocus rejected - invalid path', { projectPath })
      return { success: false, error: userMessage }
    }

    try {
      const focused = await projectLockService.requestFocus(projectPath)

      logger.debug('project-lock:requestFocus completed', {
        projectPath,
        focused,
        latencyMs: Date.now() - startTime
      })

      return { success: focused }
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in project-lock:requestFocus handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  /**
   * Cleanup stale locks (called on startup)
   *
   * Removes locks from dead processes or timed-out network locks.
   *
   * @returns { success: boolean, removedCount?: number, error?: string }
   */
  ipcMain.handle('project-lock:cleanup', async () => {
    const startTime = Date.now()

    logger.trace('project-lock:cleanup invoked')

    try {
      const removedCount = await projectLockService.cleanupStaleLocks()

      logger.debug('project-lock:cleanup completed', {
        removedCount,
        latencyMs: Date.now() - startTime
      })

      return { success: true, removedCount }
    } catch (error) {
      const userMessage = getUserFriendlyMessage(error)
      logger.error('Error in project-lock:cleanup handler', error instanceof Error ? error : undefined)
      return { success: false, error: userMessage }
    }
  })

  logger.info('Project lock IPC handlers registered')
}
