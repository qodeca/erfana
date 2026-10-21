// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { realpath } from 'fs/promises'
import { BrowserWindow, dialog, webContents, type OpenDialogOptions } from 'electron'
import { externalFileService } from '../services/ExternalFileService'
import { externalSourceGrants } from '../services/ExternalSourceGrants'
import {
  ExternalMoveConfirmerImpl,
  type MoveConfirmer
} from '../services/ExternalMoveConfirmer'
import type { ProjectSession, ProjectSessionSnapshot } from '../services/session/ProjectSession'
import {
  ExternalFileValidateArgsSchema,
  ExternalFileTransferArgsSchema,
  type ExternalFileValidateResponse,
  type ExternalFileCopyResponse,
  type ExternalFileMoveResponse
} from '../../shared/ipc/external-file-schema'
import { ErrorCode, ERROR_MESSAGES } from '../../shared/errors'
import { logger } from '../services/LoggingService'
import { redactedLogError } from '../utils/redactUserInput'
import { registerHandle } from './registry'
import { registerConfinedHandle, type PathBinding } from './confinement/registerConfinedHandle'
import { resolveConfinedPath, type PathPolicy } from './confinement/resolveConfinedPath'
import { isInsideRoot } from '../utils/pathCompare'
import type { ConfinementError } from './confinement/ConfinementError'
import { rememberDialogResult, withLastDirectory } from '../utils/lastDialogDirectory'
import { FILE_CHANNELS } from '../../shared/ipc/file-channels'

/**
 * Selected files result from native file picker
 */
export interface ExternalFileSelection {
  /** Array of absolute paths to selected files */
  paths: string[]
}

/** The confirmation box the app shows: a native message box modal to the project's window. */
function createNativeMoveConfirmer(): MoveConfirmer {
  const watched = new WeakSet<object>()
  const confirmer: ExternalMoveConfirmerImpl = new ExternalMoveConfirmerImpl({
    showBox: (owner, options) => dialog.showMessageBox(owner as BrowserWindow, options),
    resolveOwner: (senderId) => {
      const contents = webContents.fromId(senderId)
      const window = contents ? BrowserWindow.fromWebContents(contents) : null
      // Approvals end with the window
      if (window && !watched.has(window)) {
        watched.add(window)
        window.once('closed', () => confirmer.clear(senderId))
      }
      return window
    },
    // A minimised or hidden window cannot be asked
    canShow: (owner) => {
      const window = owner as BrowserWindow
      return window.isVisible() && !window.isMinimized()
    }
  })
  return confirmer
}

/** Whether a file lies in the open project, by the spelling given or where it really is. */
async function isInProject(
  sourcePath: string,
  snapshot: ProjectSessionSnapshot | null
): Promise<boolean> {
  if (!snapshot) return false
  const inside = (candidate: string): boolean =>
    isInsideRoot(candidate, snapshot.root, snapshot.caseSensitive) ||
    isInsideRoot(candidate, snapshot.realRoot, snapshot.caseSensitive)
  if (inside(sourcePath)) return true
  try {
    return inside(await realpath(sourcePath))
  } catch {
    return false
  }
}

/** The target folder of a copy or move: the first check and the one after the box are the same. */
const TARGET_BINDING: PathBinding = {
  arg: 1,
  mode: 'project',
  mustExist: true,
  kind: 'directory',
  access: 'change'
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
  // An answer given for one project says nothing about the next
  session.onChange(() => moveConfirmer.clear?.())

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
    FILE_CHANNELS.validateExternal,
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
    FILE_CHANNELS.copyFromExternal,
    {
      schema: ExternalFileTransferArgsSchema,
      paths: {
        source: { arg: 0, mode: 'external', check: 'escape' },
        target: TARGET_BINDING
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
   * ExternalSourceGrants) or came from a drop; either way the original is deleted
   * only after the user answers "Move" in a native box.
   * Supports conflict resolution strategies: 'replace' or 'keepBoth'.
   */
  registerConfinedHandle(
    FILE_CHANNELS.moveFromExternal,
    {
      schema: ExternalFileTransferArgsSchema,
      paths: {
        source: { arg: 0, mode: 'external', check: 'escape' },
        target: TARGET_BINDING
      },
      onRefusal: (error): ExternalFileMoveResponse => ({
        success: false,
        error: error.message,
        errorCode: refusalCode(error)
      }),
      handler: async (
        { event, session: started },
        [, , , conflictResolution],
        { source, target }
      ): Promise<ExternalFileMoveResponse> => {
        try {
          // A file already in the project is moved from the project tree
          if (await isInProject(source.requested, started)) {
            return {
              success: false,
              error: ERROR_MESSAGES[ErrorCode.EXTERNAL_FILE_IN_PROJECT],
              errorCode: ErrorCode.EXTERNAL_FILE_IN_PROJECT
            }
          }
          const senderId = event.sender?.id ?? null
          // After the user answers: the same project must be open and the target
          // must still resolve to the same folder
          const recheckTarget = async (): Promise<boolean> => {
            const now = session.current()
            if (!now || now.generation !== started?.generation) return false
            try {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { arg, access, ...policy } = TARGET_BINDING
              const again = await resolveConfinedPath(
                target.requested,
                { session: now, senderId },
                policy as PathPolicy
              )
              return again.real === target.real
            } catch {
              return false
            }
          }
          return await externalFileService.moveFromExternal(
            source.requested,
            { real: target.real, requested: target.requested },
            senderId,
            conflictResolution,
            recheckTarget
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
   * Returns array of selected file paths, and records them as one pick, so a later
   * move of one of them is confirmed once for the whole pick.
   */
  registerHandle(FILE_CHANNELS.selectExternalFiles, async (event): Promise<ExternalFileSelection | null> => {
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
      await externalSourceGrants.issue(event.sender?.id ?? null, result.filePaths)

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
