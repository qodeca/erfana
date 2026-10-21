// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Moving several dropped external files with ONE request, so the user is asked
 * once ("Move N files into the project?") instead of once per file.
 *
 * Each result is reported the way a single move was: a Cancel answer is not an
 * error, a moved link gets its warning, anything else is a failure toast.
 */
import type { ConflictResolution } from '../../../../shared/ipc/external-file-schema'
import { EXTERNAL_MOVE_BATCH_MAX } from '../../../../shared/ipc/external-file-limits'
import type { FileBridge } from '../../../../shared/ipc/file-schema'
import { logger } from '../../utils/logger'
import { showGlobalToast } from '../Toast/toastService'

/** One dropped file waiting to be moved, with the way its name conflict was settled. */
export interface PendingExternalMove {
  file: { path: string; name: string }
  conflictResolution?: ConflictResolution
}

/** The error code main answers when the user pressed Cancel in the confirmation box. */
const MOVE_CANCELLED = 'EXTERNAL_FILE_MOVE_CANCELLED'

/**
 * Whether a drop is too large to move in one request. If so, says so with the
 * same "Too many files" toast the picker shows, before any file is checked, so
 * one drop is still one box.
 */
export function refuseOversizedMove(fileCount: number): boolean {
  if (fileCount <= EXTERNAL_MOVE_BATCH_MAX) return false
  showGlobalToast({
    title: 'Too many files',
    message: `Cannot move more than ${EXTERNAL_MOVE_BATCH_MAX} files at once. Please drop fewer files.`,
    type: 'error'
  })
  return true
}

export interface ExternalMoveOutcome {
  successCount: number
  failCount: number
}

export async function moveExternalBatch(
  api: Pick<FileBridge, 'moveBatchFromExternal'>,
  moves: readonly PendingExternalMove[],
  targetFolder: string
): Promise<ExternalMoveOutcome> {
  let successCount = 0
  let failCount = 0
  try {
    const response = await api.moveBatchFromExternal({
      items: moves.map(({ file, conflictResolution }) => ({
        sourcePath: file.path,
        conflictResolution
      })),
      targetFolder
    })

    if (response.results.length !== moves.length) {
      // The whole request was refused: every file failed for the one reason
      logger.warn('Move failed', { count: moves.length, error: response.error })
      showGlobalToast({
        title: 'Move failed',
        message: response.error || 'Failed to move the files',
        type: 'error'
      })
      return { successCount, failCount: moves.length }
    }

    moves.forEach(({ file }, index) => {
      const result = response.results[index]
      if (result.success) {
        successCount++
        if (result.isSymlink) {
          showGlobalToast({
            title: 'Symlink moved',
            message: 'Warning: You moved a symbolic link. The target file remains at its original location.',
            type: 'warning'
          })
        }
      } else if (result.errorCode === MOVE_CANCELLED) {
        // The user answered Cancel in the confirmation box: not an error
        logger.info('User cancelled moving file', { fileName: file.name })
      } else {
        logger.warn('Move failed', { path: file.path, error: result.error })
        showGlobalToast({
          title: 'Move failed',
          message: result.error || `Failed to move "${file.name}"`,
          type: 'error'
        })
        failCount++
      }
    })
  } catch (err) {
    logger.error('Error moving external files', err instanceof Error ? err : undefined)
    showGlobalToast({ title: 'Error', message: 'Failed to move the files', type: 'error' })
    return { successCount: 0, failCount: moves.length }
  }
  return { successCount, failCount }
}
