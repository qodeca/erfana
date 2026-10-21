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
  ExternalFileCopyRequestSchema,
  ExternalFileMoveBatchRequestSchema,
  ExternalFileMoveRequestSchema,
  ExternalFileValidateRequestSchema,
  type ExternalFileValidateResponse,
  type ExternalFileCopyResponse,
  type ExternalFileMoveBatchResponse,
  type ExternalFileMoveResponse,
  type ConflictResolution
} from '../../shared/ipc/external-file-schema'
import { payloadArgs } from '../../shared/ipc/file-schema'
import { ErrorCode, ERROR_MESSAGES } from '../../shared/errors'
import { logger } from '../services/LoggingService'
import { redactedLogError } from '../utils/redactUserInput'
import { registerHandle } from './registry'
import { registerConfinedHandle, type PathBinding } from './confinement/registerConfinedHandle'
import { resolveConfinedPath, type PathPolicy } from './confinement/resolveConfinedPath'
import { isInsideRoot } from '../utils/pathCompare'
import { ConfinementError } from './confinement/ConfinementError'
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
  arg: 0,
  key: 'targetFolder',
  mode: 'project',
  mustExist: true,
  kind: 'directory',
  access: 'change'
}

/** What a source of a move must be: a path anywhere, as long as a link does not lead somewhere it should not. */
const SOURCE_POLICY: PathPolicy = { mode: 'external', check: 'escape' }

/**
 * After the user answers: the same project must be open and the target must
 * still resolve to the same folder.
 */
function makeTargetRecheck(
  session: ProjectSession,
  target: { real: string; requested: string },
  startedGeneration: number | undefined,
  senderId: number | null
): () => Promise<boolean> {
  return async (): Promise<boolean> => {
    const now = session.current()
    if (!now || now.generation !== startedGeneration) return false
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { arg, key, access, ...policy } = TARGET_BINDING
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
 * the open project; the request carries no project root.
 * - file:moveBatchFromExternal - Move several external files after ONE confirmation
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
      schema: payloadArgs(ExternalFileValidateRequestSchema),
      paths: { source: { arg: 0, key: 'sourcePath', mode: 'external', check: 'escape' } },
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
      schema: payloadArgs(ExternalFileCopyRequestSchema),
      paths: {
        source: { arg: 0, key: 'sourcePath', mode: 'external', check: 'escape' },
        target: TARGET_BINDING
      },
      onRefusal: (error): ExternalFileCopyResponse => ({
        success: false,
        error: error.message,
        errorCode: refusalCode(error)
      }),
      handler: async (_ctx, [{ conflictResolution }], { source, target }): Promise<ExternalFileCopyResponse> => {
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
      schema: payloadArgs(ExternalFileMoveRequestSchema),
      paths: {
        source: { arg: 0, key: 'sourcePath', mode: 'external', check: 'escape' },
        target: TARGET_BINDING
      },
      onRefusal: (error): ExternalFileMoveResponse => ({
        success: false,
        error: error.message,
        errorCode: refusalCode(error)
      }),
      handler: async (
        { event, session: started },
        [{ conflictResolution }],
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
          const recheckTarget = makeTargetRecheck(session, target, started?.generation, senderId)
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
   * Move several external files into the project with ONE confirmation
   *
   * The same checks as a single move, per file; the difference is that the files
   * that can be moved ask together, so the user sees one box ("Move N files into
   * the project?") instead of one per file. Cancel moves none of them. The box
   * limits stay the confirmer's: ten files to a box, a queue of 100 per window,
   * a rate cap on boxes. The source paths are inside an array, so they are
   * resolved here rather than in the `paths` list; a source that is refused
   * answers its own failure and the others go on.
   */
  registerConfinedHandle(
    FILE_CHANNELS.moveBatchFromExternal,
    {
      schema: payloadArgs(ExternalFileMoveBatchRequestSchema),
      paths: { target: TARGET_BINDING },
      onRefusal: (error): ExternalFileMoveBatchResponse => ({
        results: [],
        error: error.message,
        errorCode: refusalCode(error)
      }),
      handler: async (
        { event, session: started },
        [{ items }],
        { target }
      ): Promise<ExternalFileMoveBatchResponse> => {
        try {
          const senderId = event.sender?.id ?? null
          const results: (ExternalFileMoveResponse | null)[] = items.map(() => null)
          const toMove: { index: number; sourcePath: string; conflictResolution?: ConflictResolution }[] = []
          // The same file under two spellings (case, links, `..`) is one file: it is
          // asked about and moved once
          const seen = new Set<string>()

          for (const [index, item] of items.entries()) {
            try {
              const source = await resolveConfinedPath(
                item.sourcePath,
                { session: started, senderId },
                SOURCE_POLICY
              )
              // A file already in the project is moved from the project tree
              if (await isInProject(source.requested, started)) {
                results[index] = {
                  success: false,
                  error: ERROR_MESSAGES[ErrorCode.EXTERNAL_FILE_IN_PROJECT],
                  errorCode: ErrorCode.EXTERNAL_FILE_IN_PROJECT
                }
                continue
              }
              const key = started?.caseSensitive === false ? source.real.toLowerCase() : source.real
              if (seen.has(key)) {
                results[index] = {
                  success: false,
                  error: 'This file is listed more than once',
                  errorCode: 'VALIDATION_ERROR'
                }
                continue
              }
              seen.add(key)
              toMove.push({
                index,
                sourcePath: source.requested,
                conflictResolution: item.conflictResolution
              })
            } catch (error) {
              if (!(error instanceof ConfinementError)) throw error
              results[index] = { success: false, error: error.message, errorCode: refusalCode(error) }
            }
          }

          const recheckTarget = makeTargetRecheck(session, target, started?.generation, senderId)
          const moved = await externalFileService.moveBatchFromExternal(
            toMove.map(({ sourcePath, conflictResolution }) => ({ sourcePath, conflictResolution })),
            { real: target.real, requested: target.requested },
            senderId,
            recheckTarget
          )
          toMove.forEach(({ index }, position) => {
            results[index] = moved[position]
          })

          return {
            results: results.map(
              (result): ExternalFileMoveResponse =>
                result ?? { success: false, error: 'Unknown error', errorCode: 'UNKNOWN_ERROR' }
            )
          }
        } catch (error) {
          logger.error('Error moving external files', redactedLogError(error))
          return {
            results: [],
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
