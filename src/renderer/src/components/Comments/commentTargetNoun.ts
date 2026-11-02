// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The ONE function that names a Markdown target (comments-v2 C-03 kind map;
 * spec 024 024-FR-007): "paragraph", "H2 heading", "list item", "row 2",
 * "header row", "row 2, column 3", "diagram".
 *
 * Every place the Markdown Preview names a target – the window title, a
 * drawer row, an icon's name, an announcement, a menu item, a picker step,
 * the window's edge tab, the comment-mode tab – reads it through
 * `MARKDOWN_WORDS` (`commentCopyWords.ts`), which calls
 * {@link markdownTargetNoun}. What they pass is a {@link NounSource}: a tag,
 * or a target with its tag, its inner target (`runtime`, the target a
 * comment is about below its carrier) and its place. The place comes from
 * main's index for a listed comment (`CommentTargetPlace`) and from the
 * rendered table and diagram wrapper for a block in the preview
 * (`markdownAdapter.ts`), so one block gets one noun either way.
 *
 * Without a place – a comment main could not find, say – a row is a "table
 * row", a cell a "table cell" and a code block a "code block": the tag alone
 * says no more.
 *
 * @module components/Comments/commentTargetNoun
 */
import type { CommentTargetPlace } from '../../../../shared/ipc/comment-common-schema'

/** A target as a sentence names it: its tag, the tag of the inner target a comment is about, and its place. */
export interface NounTarget {
  readonly tag: string
  /** A Markdown comment's inner target below its carrier (list item 1, a row, a cell): what it is about. */
  readonly runtime?: { readonly tag: string }
  /** Where the target sits, when its tag does not name it (C-03). */
  readonly place?: CommentTargetPlace
}

/** What a noun is read from: a bare tag, or a {@link NounTarget}. */
export type NounSource = string | NounTarget

const MARKDOWN_NOUNS: Readonly<Record<string, string>> = {
  p: 'paragraph',
  li: 'list item',
  ul: 'list',
  ol: 'list',
  pre: 'code block',
  img: 'image',
  blockquote: 'block quote',
  table: 'table',
  tr: 'table row',
  td: 'table cell',
  th: 'table cell',
  hr: 'divider'
}

/**
 * The Markdown kind noun of a rendered tag (C-03 kind map), lower case. A
 * tag alone cannot tell a diagram from a code block or one row from another:
 * {@link markdownTargetNoun} adds the place. Raw HTML the sanitizer kept is
 * an "HTML section" – never its tag.
 *
 * @param tag - The target's tag as main indexes it (`p`, `li`, `h2`, …).
 * @returns e.g. "list item", "H2 heading".
 */
export function markdownKindNoun(tag: string): string {
  const lower = tag.toLowerCase()
  const heading = /^h([1-6])$/.exec(lower)
  if (heading !== null) return `H${heading[1]} heading`
  return MARKDOWN_NOUNS[lower] ?? 'HTML section'
}

/**
 * The noun of a place (C-03): "row 2", "header row", "row 2, column 3",
 * "header row, column 1", "diagram".
 *
 * @param place - Where the target sits.
 * @returns The noun, lower case.
 */
export function placeNoun(place: CommentTargetPlace): string {
  switch (place.kind) {
    case 'row':
      return `row ${place.row}`
    case 'header-row':
      return 'header row'
    case 'cell':
      return `row ${place.row}, column ${place.column}`
    case 'header-cell':
      return `header row, column ${place.column}`
    case 'diagram':
      return 'diagram'
  }
}

/**
 * The Markdown noun of a target, lower case: its place when it has one, else
 * the kind noun of the target a comment is about (`runtime`), else of its tag.
 *
 * @param source - A tag, or a target with its inner target and place.
 * @returns e.g. "paragraph", "row 2, column 3", "diagram".
 *
 * @example
 * ```ts
 * markdownTargetNoun('li') // 'list item'
 * markdownTargetNoun({ tag: 'table', runtime: { tag: 'td' }, place: { kind: 'cell', row: 2, column: 3 } }) // 'row 2, column 3'
 * ```
 */
export function markdownTargetNoun(source: NounSource): string {
  if (typeof source === 'string') return markdownKindNoun(source)
  if (source.place !== undefined) return placeNoun(source.place)
  return markdownKindNoun(source.runtime?.tag ?? source.tag)
}

/** The tag of a {@link NounSource}: what the sentences that need a tag (a heading's text) read. */
export function nounTagOf(source: NounSource): string {
  return typeof source === 'string' ? source : (source.runtime?.tag ?? source.tag)
}
