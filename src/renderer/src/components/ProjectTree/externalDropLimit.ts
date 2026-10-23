// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file-count limit of an external drop, checked before the user is asked
 * how to add it.
 */
import { IMPORT } from '../../../../shared/constants'
import { EXTERNAL_MOVE_BATCH_MAX } from '../../../../shared/ipc/external-file-limits'
import { showGlobalToast } from '../Toast/toastService'

/** Most files one drop may add: a move carries at most this many in its one request, an import no more */
export const EXTERNAL_DROP_MAX = Math.min(EXTERNAL_MOVE_BATCH_MAX, IMPORT.MAX_BATCH_SIZE)

/**
 * Whether a drop is too large to add. If so, says so with the same "Too many
 * files" toast the picker shows. Called before the Move / Copy / Import choice,
 * so the user is never asked how to add a drop that would then be refused (the
 * picker refuses the same count up front for every mode).
 */
export function refuseOversizedDrop(fileCount: number): boolean {
  if (fileCount <= EXTERNAL_DROP_MAX) return false
  showGlobalToast({
    title: 'Too many files',
    message: `Cannot add more than ${EXTERNAL_DROP_MAX} files at once. Please drop fewer files.`,
    type: 'error'
  })
  return true
}
