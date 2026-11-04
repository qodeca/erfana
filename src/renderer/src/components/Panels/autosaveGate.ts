// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * When the Markdown editor panel's autosave may write.
 *
 * @module autosaveGate
 */

/**
 * Whether an autosave may write the tab's buffer now.
 *
 * - A file that changed on disk while the tab holds unsaved edits waits for the
 *   user's choice in the conflict bar: an autosave would overwrite the newer
 *   file and dismiss the bar.
 * - A file that was deleted on disk (a branch switch, a merge) stays deleted
 *   until the user saves on purpose (#460): an autosave would bring it back
 *   without the user choosing to. Cmd/Ctrl+S ("Save to restore it") still works.
 *
 * @param externalChangeDetected - The tab shows the "file changed on disk" bar
 * @param isFileDeleted - The tab shows the "deleted on disk" banner
 */
export function shouldAutosave(externalChangeDetected: boolean, isFileDeleted: boolean): boolean {
  return !externalChangeDetected && !isFileDeleted
}
