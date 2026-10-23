// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { showInfoToast, showWarningToast } from '../../../utils/toastHelpers'

/**
 * The toast for a file name clicked in the terminal that the project search
 * did not find (an incomplete tree, #320). A search that did not finish – a
 * bound stopped it, main was busy, or it failed – must not claim the file is
 * missing.
 *
 * @param filename - The name as clicked (shown to the user, never logged)
 * @param cutShort - The search did not finish
 */
export function showNameNotFoundToast(filename: string, cutShort: boolean): void {
  if (cutShort) {
    showWarningToast('Search not finished', `Could not finish searching the project for "${filename}".`)
  } else {
    showInfoToast('File not found', `No file named "${filename}" was found in the project.`)
  }
}
