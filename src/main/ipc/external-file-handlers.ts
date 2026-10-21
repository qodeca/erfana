// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { BrowserWindow, dialog, webContents, type OpenDialogOptions } from 'electron'
import { externalFileService } from '../services/ExternalFileService'
import { externalSourceGrants } from '../services/ExternalSourceGrants'
import {
  ExternalMoveConfirmerImpl,
  type MoveConfirmer
} from '../services/ExternalMoveConfirmer'
import type { ProjectSession } from '../services/session/ProjectSession'
import {
  ExternalFileValidateArgsSchema,
  ExternalFileTransferArgsSchema,
  type ExternalFileValidateResponse,
  type ExternalFileCopyResponse,
  type ExternalFileMoveResponse
} from '../../shared/ipc/external-file-schema'
import { ErrorCode } from '../../shared/errors'
import { logger } from '../services/LoggingService'
import { redactedLogError } from '../utils/redactUserInput'
import { registerHandle } from './registry'
import { registerConfinedHandle } from './confinement/registerConfinedHandle'
import type { ConfinementError } from './confinement/ConfinementError'
import { rememberDialogResult, withLastDirectory } from '../utils/lastDialogDirectory'

/**
 * Selected files result from native file picker
 */
export interface ExternalFileSelection {
  /** Array of absolute paths to selected files */
  paths: string[]
}

/** The confirmation box the app shows: a native message box modal to the project's window. */
function createNativeMoveConfirmer(): MoveConfirmer {
  return new ExternalMoveConfirmerImpl({
    showBox: (owner, options) => dialog.showMessageBox(owner as BrowserWindow, options),
    resolveOwner: (senderId) => {
      const contents = webContents.fromId(senderId)
      return contents ? BrowserWindow.fromWebContents(contents) : null
    }
  })
}

/** The error code a refused path carries in a result-shaped answer. */
function refusalCode(error: ConfinementError): string {
  switch (error.code) {
    case 'INVALID_PATH':
      return 'VALIDATION_ERROR'
    case 'OUTSIDE_PROJECT':
      return ErrorCode.PATH_OUTSIDE_PROJECT
    case 'NOT_FOUND':
      return ErrorCode.EXTERNAL_FILE_NOT_FOUND
    default:
      return error.code
  }
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
 *
 * The target folder of a copy or move is checked in the main process against
 * the open project. The trailing project-root argument the renderer still
 * sends is accepted and not used.
 */
export function registerExternalFileHandlers(
  session: ProjectSession,
  moveConfirmer: MoveConfirmer = createNativeMoveConfirmer()
): void {
  externalFileService.setMoveConfirmer(moveConfirmer)

  /**
   * Validate external file for drop
   *
   * Performs security checks before copy/move operation:
   * - Source exists and is accessible
   * - Source is not a directory
   * - Source is a regular file (not device, pipe, socket)
   * - If symlink, target is not a system directory
   */
  registerConfinedHandle(
    'file:validateExternal',
    {
      schema: ExternalFileValidateArgsSchema,
      paths: { source: { arg: 0, mode: 'external', check: 'escape' } },
      onRefusal: (error): ExternalFileValidateResponse => ({
        valid: false,
        isSymlink: false,
        isDirectory: false,
        exists: false,
        isRegularFile: false,
        error: error.message,
        errorCode: refusalCode(error)
      }),
      handler: async (_ctx, _args, { source }): Promise<ExternalFileValidateResponse> => {
        try {
          return await externalFileService.validateExternalFile(source.requested)
        } catch (error) {
          logger.error('Error validating external file', redactedLogError(error))
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
    },
    session
  )

  /**
   * Copy external file into project
   *
   * Validates the file, then copies to target folder within project.
   * Supports conflict resolution strategies: 'replace' or 'keepBoth'.
   */
  registerConfinedHandle(
    'file:copyFromExternal',
    {
      schema: ExternalFileTransferArgsSchema,
      paths: {
        source: { arg: 0, mode: 'external', check: 'escape' },
        target: { arg: 1, mode: 'project', mustExist: true, kind: 'directory', access: 'change' }
      },
      onRefusal: (error): ExternalFileCopyResponse => ({
        success: false,
        error: error.message,
        errorCode: refusalCode(error)
      }),
      handler: async (_ctx, [, , , conflictResolution], { source, target }): Promise<ExternalFileCopyResponse> => {
        try {
          return await externalFileService.copyFromExternal(
            source.requested,
            { real: target.real, requested: target.requested },
            conflictResolution
          )
        } catch (error) {
          logger.error('Error copying external file', redactedLogError(error))
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: 'UNKNOWN_ERROR'
          }
        }
      }
    },
    session
  )

  /**
   * Move external file into project
   *
   * Validates the file, copies to target folder, then deletes source. The
   * source must be a file the user chose in the native picker (see
   * ExternalSourceGrants), or the user confirms the move in a native box.
   * Supports conflict resolution strategies: 'replace' or 'keepBoth'.
   */
  registerConfinedHandle(
    'file:moveFromExternal',
    {
      schema: ExternalFileTransferArgsSchema,
      paths: {
        source: { arg: 0, mode: 'external', check: 'escape' },
        target: { arg: 1, mode: 'project', mustExist: true, kind: 'directory', access: 'change' }
      },
      onRefusal: (error): ExternalFileMoveResponse => ({
        success: false,
        error: error.message,
        errorCode: refusalCode(error)
      }),
      handler: async ({ event }, [, , , conflictResolution], { source, target }): Promise<ExternalFileMoveResponse> => {
        try {
          return await externalFileService.moveFromExternal(
            source.requested,
            { real: target.real, requested: target.requested },
            event.sender?.id ?? null,
            conflictResolution
          )
        } catch (error) {
          logger.error('Error moving external file', redactedLogError(error))
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: 'UNKNOWN_ERROR'
          }
        }
      }
    },
    session
  )

  /**
   * Open native file picker for external files
   *
   * Used when folder is selected and user presses Cmd+Shift+I.
   * Returns array of selected file paths, and records them as files the user
   * chose, so a later move of one of them may delete the original.
   */
  registerHandle('file:selectExternalFiles', async (event): Promise<ExternalFileSelection | null> => {
    try {
      const result = await dialog.showOpenDialog(withLastDirectory<OpenDialogOptions>({
        properties: ['openFile', 'multiSelections'],
        title: 'Select files to add',
        buttonLabel: 'Add to project'
      }))

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      rememberDialogResult(result.filePaths)
      externalSourceGrants.issue(event.sender?.id ?? null, result.filePaths)

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
