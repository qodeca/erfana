// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the drawer's rows, from main's list
 * (docs/designs/comments/html-preview-comments.md decision 8, §8 "Drawer mapping of
 * block kinds", §10.6; R-009, R-020).
 *
 * Three filters:
 *
 * - **Open** – open threads whose element is in the file; "Not visible now"
 *   is a tag, not a filter (decision 30).
 * - **Resolved** – resolved threads, a missing element tagged "Element not
 *   found" (it stays here, §8).
 * - **Needs attention** – open threads whose element is gone, damaged blocks
 *   and newer-format blocks. Each kind keeps its own tag (R-020), and Enter
 *   on such a row is "Open in source": there is nothing on the page to show.
 *
 * File order within each file; the page's own file first, frames after, as
 * main lists them.
 *
 * @module HtmlPreviewPanel/comments/commentRows
 */
import type { CommentFileView } from '../../../../shared/ipc/preview-comment-schema'
import { COPY, DRAWER_COPY, inFrameTag } from './commentCopy'
import { elementLabel } from './commentFormat'

/** A drawer filter. */
export type DrawerFilter = 'open' | 'resolved' | 'attention'

/** One tag on a row; `attention` tags carry the warning look and glyph. */
export interface RowTag {
  readonly text: string
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
  readonly author: string
  readonly at: string
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
  readonly attention: readonly DrawerRow[]
  /** No thread or block at all in any file. */
  readonly none: boolean
}

/**
 * Builds the drawer's rows.
 *
 * @param files - Main's list.
 * @param notVisible - Thread keys main reported as not rendered right now.
 * @returns Rows per filter.
 */
export function drawerRows(
  files: readonly CommentFileView[],
  notVisible: ReadonlySet<string>
): DrawerRows {
  const open: DrawerRow[] = []
  const resolved: DrawerRow[] = []
  const attention: DrawerRow[] = []
  for (const file of files) {
    const base = {
      fileKey: file.fileKey,
      displayPath: file.displayPath,
      filePath: file.filePath,
      frame: file.frame
    }
    const frameTag: RowTag[] = file.frame
      ? [{ text: inFrameTag(file.displayPath), attention: false }]
      : []
    for (const thread of file.threads) {
      const [first] = thread.messages
      const label = thread.runtime ? thread.runtime.tag : elementLabel(thread)
      const tags: RowTag[] = [...frameTag]
      const hidden = thread.attached && (thread.notVisible || notVisible.has(thread.threadKey))
      if (hidden) tags.push({ text: DRAWER_COPY.notVisible, attention: false })
      const isResolved = thread.status === 'resolved'
      if (isResolved) tags.push({ text: DRAWER_COPY.resolved, attention: false })
      if (!thread.attached) tags.push({ text: DRAWER_COPY.notFound, attention: true })
      const row: DrawerRow = {
        ...base,
        id: `${file.fileKey}/${thread.threadKey}`,
        filter: isResolved ? 'resolved' : thread.attached ? 'open' : 'attention',
        line: thread.line,
        label,
        replies: thread.messages.length - 1,
        excerpt: first?.text ?? '',
        author: first?.by.name ?? '',
        at: first?.at ?? '',
        tags,
        main: thread.attached ? 'reveal' : 'source',
        threadKey: thread.threadKey
      }
      ;(row.filter === 'open' ? open : row.filter === 'resolved' ? resolved : attention).push(row)
    }
    for (const block of file.damaged) {
      attention.push({
        ...base,
        id: `${file.fileKey}/${block.blockKey}`,
        filter: 'attention',
        line: block.line,
        label: `${file.displayPath}, line ${block.line}`,
        replies: 0,
        excerpt: '',
        author: '',
        at: '',
        tags: [...frameTag, { text: DRAWER_COPY.damaged, attention: true }],
        main: 'source',
        blockKey: block.blockKey
      })
    }
    for (const block of file.newer) {
      attention.push({
        ...base,
        id: `${file.fileKey}/${block.blockKey}`,
        filter: 'attention',
        line: block.line,
        label: `${file.displayPath}, line ${block.line}`,
        replies: 0,
        excerpt: '',
        author: '',
        at: '',
        tags: [...frameTag, { text: COPY.newerTag, attention: true }],
        main: 'source',
        blockKey: block.blockKey
      })
    }
  }
  return { open, resolved, attention, none: open.length + resolved.length + attention.length === 0 }
}
