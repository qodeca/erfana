// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain, dialog } from 'electron'
import { externalFileService } from '../services/ExternalFileService'
import {
  ExternalFileValidateRequestSchema,
  ExternalFileCopyRequestSchema,
  ExternalFileMoveRequestSchema,
  type ExternalFileValidateResponse,
  type ExternalFileCopyResponse,
  type ExternalFileMoveResponse
} from '../../shared/ipc/external-file-schema'
import { logger } from '../services/LoggingService'

/**
 * Selected files result from native file picker
 */
export interface ExternalFileSelection {
  /** Array of absolute paths to selected files */
  paths: string[]
}

/**
 * Register external file drop IPC handlers
 *
 * Handles Spec #012: External file drop to project tree
 *
 * Channels:
 * - file:validateExternal - Validate external file for drop
 * - file:copyFromExternal - Copy external file into project
 * - file:moveFromExternal - Move external file into project
 * - file:selectExternalFiles - Open native file picker
 */
export function registerExternalFileHandlers(): void {
  /**
   * Validate external file for drop
   *
   * Performs security checks before copy/move operation:
   * - Source exists and is accessible
   * - Source is not a directory
   * - Source is a regular file (not device, pipe, socket)
   * - If symlink, target is not a system directory
   */
  ipcMain.handle(
    'file:validateExternal',
    async (
      _event,
      sourcePath: string,
      projectRoot: string
    ): Promise<ExternalFileValidateResponse> => {
      // Validate inputs using Zod schema
      const parseResult = ExternalFileValidateRequestSchema.safeParse({
        sourcePath,
        projectRoot
      })

      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ')
        logger.warn('External file validation failed: invalid input', { error: errorMessage })
        return {
          valid: false,
          isSymlink: false,
          isDirectory: false,
          exists: false,
          isRegularFile: false,
          error: errorMessage,
          errorCode: 'VALIDATION_ERROR'
        }
      }

      try {
        return await externalFileService.validateExternalFile(sourcePath, projectRoot)
      } catch (error) {
        logger.error(
          'Error validating external file',
          error instanceof Error ? error : undefined
        )
        return {
          valid: false,
          isSymlink: false,
          isDirectory: false,
          exists: false,
          isRegularFile: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: 'UNKNOWN_ERROR'
        }
      }
    }
  )

  /**
   * Copy external file into project
   *
   * Validates the file, then copies to target folder within project.
   * Supports conflict resolution strategies: 'replace' or 'keepBoth'.
   */
  ipcMain.handle(
    'file:copyFromExternal',
    async (
      _event,
      sourcePath: string,
      targetFolder: string,
      projectRoot: string,
      conflictResolution?: 'replace' | 'keepBoth'
    ): Promise<ExternalFileCopyResponse> => {
      // Validate inputs using Zod schema
      const parseResult = ExternalFileCopyRequestSchema.safeParse({
        sourcePath,
        targetFolder,
        projectRoot,
        conflictResolution
      })

      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ')
        logger.warn('External file copy failed: invalid input', { error: errorMessage })
        return {
          success: false,
          error: errorMessage,
          errorCode: 'VALIDATION_ERROR'
        }
      }

      try {
        return await externalFileService.copyFromExternal(
          sourcePath,
          targetFolder,
          projectRoot,
          conflictResolution
        )
      } catch (error) {
        logger.error('Error copying external file', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: 'UNKNOWN_ERROR'
        }
      }
    }
  )

  /**
   * Move external file into project
   *
   * Validates the file, copies to target folder, then deletes source.
   * Supports conflict resolution strategies: 'replace' or 'keepBoth'.
   */
  ipcMain.handle(
    'file:moveFromExternal',
    async (
      _event,
      sourcePath: string,
      targetFolder: string,
      projectRoot: string,
      conflictResolution?: 'replace' | 'keepBoth'
    ): Promise<ExternalFileMoveResponse> => {
      // Validate inputs using Zod schema
      const parseResult = ExternalFileMoveRequestSchema.safeParse({
        sourcePath,
        targetFolder,
        projectRoot,
        conflictResolution
      })

      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ')
        logger.warn('External file move failed: invalid input', { error: errorMessage })
        return {
          success: false,
          error: errorMessage,
          errorCode: 'VALIDATION_ERROR'
        }
      }

      try {
        return await externalFileService.moveFromExternal(
          sourcePath,
          targetFolder,
          projectRoot,
          conflictResolution
        )
      } catch (error) {
        logger.error('Error moving external file', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: 'UNKNOWN_ERROR'
        }
      }
    }
  )

  /**
   * Open native file picker for external files
   *
   * Used when folder is selected and user presses Cmd+Shift+I.
   * Returns array of selected file paths.
   */
  ipcMain.handle('file:selectExternalFiles', async (): Promise<ExternalFileSelection | null> => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        title: 'Select files to add',
        buttonLabel: 'Add to project'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      logger.debug('External files selected', { count: result.filePaths.length })

      return {
        paths: result.filePaths
      }
    } catch (error) {
      logger.error(
        'Error opening file picker',
        error instanceof Error ? error : undefined
      )
      throw new Error('Failed to open file picker')
    }
  })
}
