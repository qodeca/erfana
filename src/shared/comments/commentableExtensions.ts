// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every file extension some preview can comment on, as one list both sides
 * read (spec 024 024-FR-026, architecture note 001 § 8 C6).
 *
 * The renderer reports a window's dirty editor tabs for exactly these files
 * (`useUnsavedSourcesFeed`), so a comment save never writes under unsaved
 * edits of any commentable file. Main's registries are the authority on what
 * is commentable (`src/main/services/comments/commentFileKinds.ts`); the
 * renderer cannot import them (they load the parsers), so this list mirrors
 * them, and a main test fails when a registered extension is missing here.
 * Listing an extension early – Markdown, before its kind is registered – only
 * makes the dirty-tab report wider, never a write possible.
 *
 * Pure: no imports.
 */

/** Lower-case extensions with the dot. */
export const COMMENTABLE_EXTENSIONS: readonly string[] = ['.html', '.htm', '.md', '.markdown']

/**
 * True when `fileName` (a name or a path, either separator) ends in a
 * commentable extension, in any ASCII letter case.
 */
export function isCommentableFileName(fileName: string): boolean {
  const name = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  const extension = name.slice(dot).replace(/[A-Z]/g, letter => letter.toLowerCase())
  return COMMENTABLE_EXTENSIONS.includes(extension)
}
