// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { rm } from 'fs/promises'
import { logger } from '../services/LoggingService'

/**
 * RollbackHandler manages transaction rollback for file operations
 * Ensures atomic-like behavior by cleaning up partial operations on failure
 *
 * Example:
 *   const handler = new RollbackHandler()
 *   await handler.rollbackCopyOnDeleteFailure(sourcePath, targetPath)
 */
export class RollbackHandler {
  /**
   * Rollback a copy operation if the source deletion fails
   * Used in cross-filesystem moves (copy + delete pattern)
   *
   * @param _sourcePath - Path to the source file/directory (unused, kept for API clarity)
   * @param targetPath - Path to the copied file/directory (to be deleted on rollback)
   * @throws Error with descriptive message about the rollback
   */
  async rollbackCopyOnDeleteFailure(
    _sourcePath: string,
    targetPath: string,
    deleteError: unknown
  ): Promise<void> {
    logger.error('Failed to delete source during move, rolling back',
      deleteError instanceof Error ? deleteError : undefined,
      { targetPath }
    )

    try {
      await rm(targetPath, { recursive: true, force: true })
      logger.info('Rollback successful: Deleted copied item', { path: targetPath })
    } catch (rollbackError) {
      logger.error('Rollback failed', rollbackError instanceof Error ? rollbackError : undefined)
      // Log but don't throw - we want to throw the original error message
    }

    throw new Error('Move failed: Could not delete source file. Operation rolled back.')
  }

  /**
   * Generic rollback that deletes a file/directory
   * Used for cleaning up failed operations
   *
   * @param path - Path to delete
   * @param operationDescription - Description of the failed operation (for logging)
   */
  async rollbackDelete(path: string, operationDescription: string): Promise<void> {
    logger.error(`${operationDescription} failed, rolling back`, undefined, { path })

    try {
      await rm(path, { recursive: true, force: true })
      logger.info('Rollback successful: Deleted', { path })
    } catch (rollbackError) {
      logger.error('Rollback failed', rollbackError instanceof Error ? rollbackError : undefined)
      throw new Error(
        `${operationDescription} failed and rollback also failed. System may be in inconsistent state.`
      )
    }
  }
}
