// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dockview tab-title formatting, shared by every panel type.
 *
 * The "unsaved" bullet and the "(deleted)" suffix are copy, and copy must not
 * be owned by one feature: the image viewer marks a deleted tab exactly the way
 * the Markdown editor does, so the two cannot drift apart. This module used to
 * live in `components/Panels/markdownEditorPanel.logic.ts`, which made the
 * image viewer import from the editor - a cross-feature dependency in the wrong
 * direction (QG-6 finding M7).
 *
 * @module tabTitle
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

/** Prefix `formatTabTitle` puts in front of a modified file. */
const MODIFIED_PREFIX = '● '

/** Suffix `formatTabTitle` appends to a file that is gone from disk. */
const DELETED_SUFFIX = ' (deleted)'

/**
 * Formats a dockview tab title from the file's state.
 *
 * `deleted` wins over `modified`: the indicators do not stack, because a file
 * that is gone from disk cannot usefully be described as "has unsaved edits" in
 * the two or three characters a tab affords. Read-only surfaces (the image
 * viewer) always pass `modified: false`.
 *
 * @param fileName - Base file name, already stripped of its directory
 * @param modified - Whether the file has unsaved changes
 * @param deleted - Whether the file was deleted externally
 * @returns The formatted title string
 *
 * @example
 * ```ts
 * formatTabTitle('doc.md', false, false) // 'doc.md'
 * formatTabTitle('doc.md', true, false)  // '● doc.md'
 * formatTabTitle('doc.md', false, true)  // 'doc.md (deleted)'
 * formatTabTitle('doc.md', true, true)   // 'doc.md (deleted)'
 * ```
 */
export function formatTabTitle(fileName: string, modified: boolean, deleted: boolean): string {
  if (deleted) {
    return `${fileName}${DELETED_SUFFIX}`
  }
  if (modified) {
    return `${MODIFIED_PREFIX}${fileName}`
  }
  return fileName
}

/** The state a tab title encodes, recovered by {@link parseTabTitle}. */
export interface ParsedTabTitle {
  /** File name with both markers removed. */
  name: string
  /** The title carried the unsaved-changes bullet. */
  modified: boolean
  /** The title carried the `(deleted)` suffix. */
  deleted: boolean
}

/**
 * Recovers the state {@link formatTabTitle} encoded into a title.
 *
 * The tab components render the panel's live `api.title` – that is how a title
 * a panel sets reaches the screen at all – but they draw the unsaved-changes
 * bullet themselves, from the store, as their own element. Parsing lets them
 * render the file name and the deleted marker separately instead of printing a
 * raw string with a duplicate bullet in it.
 *
 * NOTE: a file genuinely named `report (deleted).png` parses as deleted. The
 * rendered result is character-for-character the same either way, so the false
 * positive is invisible; it is called out here so nobody "fixes" it with an
 * escaping scheme the user would then see.
 *
 * @param title - A title produced by {@link formatTabTitle}, or any string
 * @returns The file name plus the two marker flags
 *
 * @example
 * ```ts
 * parseTabTitle('doc.md')             // { name: 'doc.md', modified: false, deleted: false }
 * parseTabTitle('● doc.md')           // { name: 'doc.md', modified: true,  deleted: false }
 * parseTabTitle('doc.md (deleted)')   // { name: 'doc.md', modified: false, deleted: true }
 * ```
 */
export function parseTabTitle(title: string): ParsedTabTitle {
  let name = title

  const deleted = name.endsWith(DELETED_SUFFIX)
  if (deleted) name = name.slice(0, -DELETED_SUFFIX.length)

  const modified = name.startsWith(MODIFIED_PREFIX)
  if (modified) name = name.slice(MODIFIED_PREFIX.length)

  return { name, modified, deleted }
}

/** Visible text a tab appends for a file that is gone from disk. */
export const DELETED_TAB_MARKER = '(deleted)'
