// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the drawer's rows, from main's list, in both previews
 * (docs/designs/comments/html-preview-comments.md decision 8, §8, §10.6;
 * R-009, R-020; comments-v2 C-06, C-15, OD-04; spec 024 state table § 1, § 4).
 *
 * Three filters (OD-04):
 *
 * - **Open** – every open thread, found or not: "Not visible now" (S-02),
 *   "Changed" and "Words changed" (S-03, S-04) and "Not found" (S-05) are
 *   neutral tags, never a filter. Enter on a not-found row is "Open in
 *   source": there is nothing in the preview to show.
 * - **Resolved** – resolved threads; "Not found" as well when the target is
 *   gone (S-06).
 * - **Can't edit** – damaged blocks (S-07, S-08, the ▲ attention counter) and
 *   newer-format blocks (S-09, neutral).
 *
 * One tag per state, by the state table's precedence (§ 4). File order within
 * each file; the page's own file first, frames after, as main lists them.
 * {@link sortRows} re-orders a filter's rows for the drawer's sort menu (C-15).
 *
 * @module components/Comments/commentRows
 */
import type { CommentFileView, CommentThreadView } from '../../../../shared/ipc/preview-comment-schema'
import { COPY, DRAWER_COPY, inFrameTag } from './commentCopy'
import { COMMENT_LIST_COPY, HTML_WORDS, type CommentSortOrder, type CommentWords } from './commentCopyWords'

/** A drawer filter (OD-04). */
export type DrawerFilter = 'open' | 'resolved' | 'cantEdit'

/** The filters, in the order the drawer shows them. */
export const DRAWER_FILTERS: readonly DrawerFilter[] = ['open', 'resolved', 'cantEdit']

/** One tag on a row. */
export interface RowTag {
  readonly text: string
  /** A damaged block: the attention counter's shape (▲, C-15) – never a colour alone. */
  readonly attention: boolean
}

/** One drawer row. */
export interface DrawerRow {
  /** Unique across files. */
  readonly id: string
  readonly filter: DrawerFilter
  readonly fileKey: string
  readonly displayPath: string
  /** Absolute, project space – "Open in source". */
  readonly filePath: string
  /** The file is a frame's, not the page's own. */
  readonly frame: boolean
  readonly line: number
  readonly label: string
  readonly replies: number
  /** The first message; `''` for a block. */
  readonly excerpt: string
  /** A selection comment whose words changed: "“was” → “now”" (C-06, R-11); `''` otherwise. */
  readonly words: string
  readonly author: string
  readonly at: string
  /** The newest message or status change, for "Latest activity" (C-15); `''` for a block. */
  readonly latest: string
  /** Changed or Words changed (S-03, S-04): first under "Changed first". */
  readonly changed: boolean
  readonly tags: readonly RowTag[]
  /** What Enter or a click does. */
  readonly main: 'reveal' | 'source'
  readonly threadKey?: string
  readonly blockKey?: string
}

/** Rows per filter, and their counts. */
export interface DrawerRows {
  readonly open: readonly DrawerRow[]
  readonly resolved: readonly DrawerRow[]
  readonly cantEdit: readonly DrawerRow[]
  /** No thread or block at all in any file. */
  readonly none: boolean
}

/** A thread's newest moment: its last message, or its resolve when later. */
function latestOf(thread: CommentThreadView): string {
  let latest = ''
  for (const message of thread.messages) {
    const at = message.edited ?? message.at
    if (at > latest) latest = at
  }
  const resolvedAt = thread.resolved?.at ?? ''
  return resolvedAt > latest ? resolvedAt : latest
}

/** The derived change of an open, found thread (state table S-03, S-04); `undefined` when there is none. */
function changeOf(thread: CommentThreadView): CommentThreadView['change'] {
  return thread.status === 'open' && thread.attached ? thread.change : undefined
}

/** A thread's one state tag, by the state table's precedence (§ 4), or `null` for a plain open thread. */
function stateTag(thread: CommentThreadView, hidden: boolean, words: CommentWords): RowTag | null {
  if (thread.status === 'resolved') return null
  if (!thread.attached) return { text: words.notFoundTag, attention: false }
  const change = changeOf(thread)
  if (change?.state === 'words') return { text: COMMENT_LIST_COPY.wordsChangedTag, attention: false }
  if (change?.state === 'changed') return { text: COMMENT_LIST_COPY.changedTag, attention: false }
  return hidden ? { text: DRAWER_COPY.notVisible, attention: false } : null
}

/** One thread's row. */
function threadRow(
  file: CommentFileView,
  thread: CommentThreadView,
  frameTag: readonly RowTag[],
  notVisible: ReadonlySet<string>,
  words: CommentWords
): DrawerRow {
  const [first] = thread.messages
  const isResolved = thread.status === 'resolved'
  const hidden = thread.attached && (thread.notVisible || notVisible.has(thread.threadKey))
  const tags: RowTag[] = [...frameTag]
  const state = stateTag(thread, hidden, words)
  if (state !== null) tags.push(state)
  if (isResolved) tags.push({ text: DRAWER_COPY.resolved, attention: false })
  // S-06's exception: a resolved row also says its target is gone.
  if (isResolved && !thread.attached) tags.push({ text: words.notFoundTag, attention: false })
  const change = changeOf(thread)
  return {
    fileKey: file.fileKey,
    displayPath: file.displayPath,
    filePath: file.filePath,
    frame: file.frame,
    id: `${file.fileKey}/${thread.threadKey}`,
    filter: isResolved ? 'resolved' : 'open',
    line: thread.line,
    label: thread.runtime ? thread.runtime.tag : words.label(thread),
    replies: thread.messages.length - 1,
    excerpt: first?.text ?? '',
    words: change?.state === 'words' ? `“${change.was}” → “${change.now ?? ''}”` : '',
    author: first?.by.name ?? '',
    at: first?.at ?? '',
    latest: latestOf(thread),
    changed: change !== undefined,
    tags,
    main: thread.attached ? 'reveal' : 'source',
    threadKey: thread.threadKey
  }
}

/** A damaged or newer-format block's row: Can't edit (OD-04). */
function blockRow(file: CommentFileView, blockKey: string, line: number, tags: readonly RowTag[]): DrawerRow {
  return {
    fileKey: file.fileKey,
    displayPath: file.displayPath,
    filePath: file.filePath,
    frame: file.frame,
    id: `${file.fileKey}/${blockKey}`,
    filter: 'cantEdit',
    line,
    label: `${file.displayPath}, line ${line}`,
    replies: 0,
    excerpt: '',
    words: '',
    author: '',
    at: '',
    latest: '',
    changed: false,
    tags,
    main: 'source',
    blockKey
  }
}

/**
 * Builds the drawer's rows.
 *
 * @param files - Main's list.
 * @param notVisible - Thread keys main reported as not rendered right now.
 * @param words - The preview's words (labels and tags, C-03); the HTML Preview's by default.
 * @returns Rows per filter.
 */
export function drawerRows(
  files: readonly CommentFileView[],
  notVisible: ReadonlySet<string>,
  words: CommentWords = HTML_WORDS
): DrawerRows {
  const open: DrawerRow[] = []
  const resolved: DrawerRow[] = []
  const cantEdit: DrawerRow[] = []
  for (const file of files) {
    const frameTag: RowTag[] = file.frame ? [{ text: inFrameTag(file.displayPath), attention: false }] : []
    for (const thread of file.threads) {
      const row = threadRow(file, thread, frameTag, notVisible, words)
      ;(row.filter === 'open' ? open : resolved).push(row)
    }
    for (const block of file.damaged) {
      cantEdit.push(blockRow(file, block.blockKey, block.line, [...frameTag, { text: DRAWER_COPY.damaged, attention: true }]))
    }
    for (const block of file.newer) {
      cantEdit.push(blockRow(file, block.blockKey, block.line, [...frameTag, { text: COPY.newerTag, attention: false }]))
    }
  }
  return { open, resolved, cantEdit, none: open.length + resolved.length + cantEdit.length === 0 }
}

/**
 * A filter's rows in the drawer's sort order (C-15). Stable: rows that tie
 * keep file order.
 *
 * @param rows - One filter's rows, in file order.
 * @param order - "File order" (as given), "Changed first", or "Latest activity" (newest first).
 * @returns The rows in that order; `rows` itself for file order.
 */
export function sortRows(rows: readonly DrawerRow[], order: CommentSortOrder): readonly DrawerRow[] {
  if (order === 'file') return rows
  const rank = order === 'changed' ? (row: DrawerRow) => (row.changed ? 0 : 1) : null
  return [...rows].sort((a, b) => (rank !== null ? rank(a) - rank(b) : b.latest.localeCompare(a.latest)))
}

/** Counts for the toolbar (state table § 1 "Toolbar"): the number, the changed part and the ▲ damaged badge. */
export interface ListCounts {
  /** Open comments, found or not (S-01 – S-05). */
  readonly open: number
  readonly resolved: number
  /** Open comments that are Changed or Words changed. */
  readonly changed: number
  /** Damaged blocks (S-07, S-08); newer-format blocks count in neither. */
  readonly damaged: number
}

/**
 * The toolbar's counts from main's list (OD-04, C-15).
 *
 * @param files - Main's list.
 * @returns {@link ListCounts}
 */
export function listCounts(files: readonly CommentFileView[]): ListCounts {
  let open = 0
  let resolved = 0
  let changed = 0
  let damaged = 0
  for (const file of files) {
    damaged += file.damaged.length
    for (const thread of file.threads) {
      if (thread.status === 'resolved') resolved += 1
      else open += 1
      if (changeOf(thread) !== undefined) changed += 1
    }
  }
  return { open, resolved, changed, damaged }
}
