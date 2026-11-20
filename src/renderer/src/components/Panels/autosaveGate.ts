// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * When the Markdown editor panel's autosave may write.
 *
 * @module autosaveGate
 */

/** What the gate reads: the tab's notices, from its freshness state. */
export interface AutosaveGateInput {
  /** The tab shows the "file changed on disk" bar */
  readonly conflict: boolean
  /** The tab shows the "deleted on disk" notice */
  readonly deleted: boolean
  /** The file cannot be shown (too large, binary, another encoding, unreadable): the tab is read-only */
  readonly contentBlocked: boolean
}

/**
 * Whether an autosave may write the tab's buffer now.
 *
 * - A file that changed on disk while the tab holds unsaved edits waits for the
 *   user's choice in the conflict bar: an autosave would overwrite the newer
 *   file and dismiss the bar.
 * - A file that was deleted on disk (a branch switch, a merge) stays deleted
 *   until the user saves on purpose (#460): an autosave would bring it back
 *   without the user choosing to. Restore file (and Cmd/Ctrl+S) still works.
 * - A file whose content the tab cannot show (#478, F1): the buffer is the
 *   last good read, and writing it would replace whatever the file holds now.
 */
export function shouldAutosave({ conflict, deleted, contentBlocked }: AutosaveGateInput): boolean {
  return !conflict && !deleted && !contentBlocked
}
