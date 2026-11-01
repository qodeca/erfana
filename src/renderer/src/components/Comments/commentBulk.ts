// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – what the drawer's bulk actions cover, in both previews
 * (spec 024 024-FR-028, state table § 2; plan step 13), and their words.
 *
 * - **Resolve all changed comments**: the open comments in Changed or Words
 *   changed (S-03, S-04) – never a plain open or a Not found one.
 * - **Delete all resolved comments** (owner decision, 2026-11-01): the resolved
 *   comments (S-06). There is deliberately no "remove all comments".
 *
 * A file that cannot be written gives no item: the action is not offered for it.
 *
 * @module components/Comments/commentBulk
 */
import { ErrorCode } from '../../../../shared/errors'
import type { CommentBulkChange, CommentBulkRequest, CommentBulkResult, CommentBulkSettled, CommentFileView, CommentThreadView } from '../../../../shared/ipc/comment-common-schema'
import type { CommentWords } from './commentCopyWords'

/** One comment a bulk action will change, as the review shows it. */
export interface BulkItem {
  readonly fileKey: string
  readonly threadKey: string
  readonly rawHash: string
  readonly displayPath: string
  readonly label: string
  /** The first message. */
  readonly excerpt: string
  /** What changed under it (a resolve only); `now` absent when no words are found. */
  readonly change?: NonNullable<CommentThreadView['change']>
}

const COVERS: Readonly<Record<CommentBulkChange, (thread: CommentThreadView) => boolean>> = {
  resolve: thread => thread.status === 'open' && thread.attached && thread.change !== undefined,
  deleteResolved: thread => thread.status === 'resolved'
}

/**
 * The comments `change` covers, in file order.
 *
 * @param files - Main's list.
 * @param change - The action.
 * @param words - The preview's words, for the labels.
 * @returns The items; none in a file that cannot be written.
 */
export function bulkItems(files: readonly CommentFileView[], change: CommentBulkChange, words: CommentWords): readonly BulkItem[] {
  const items: BulkItem[] = []
  for (const file of files) {
    if (!file.writable) continue
    for (const thread of file.threads) {
      if (!COVERS[change](thread)) continue
      items.push({
        fileKey: file.fileKey,
        threadKey: thread.threadKey,
        rawHash: thread.rawHash,
        displayPath: file.displayPath,
        label: words.label(thread),
        excerpt: thread.messages[0]?.text ?? '',
        ...(change === 'resolve' && thread.change !== undefined ? { change: thread.change } : {})
      })
    }
  }
  return items
}

/**
 * The files part of a bulk request: one entry per file, so one write per file.
 *
 * @param items - What the review showed.
 * @returns The request's `files`.
 */
export function bulkFiles(items: readonly BulkItem[]): CommentBulkRequest['files'] {
  const files = new Map<string, { threadKey: string; rawHash: string }[]>()
  for (const { fileKey, threadKey, rawHash } of items) {
    const threads = files.get(fileKey) ?? []
    threads.push({ threadKey, rawHash })
    files.set(fileKey, threads)
  }
  return [...files].map(([fileKey, threads]) => ({ fileKey, threads }))
}

const comments = (count: number): string => `${count} ${count === 1 ? 'comment' : 'comments'}`

/** The drawer's and the review's words, per action. */
export const BULK_COPY: Readonly<
  Record<CommentBulkChange, { action: string; title: (n: number) => string; note: string; confirm: (n: number) => string; done: (n: number) => string; some: (done: number, all: number) => string }>
> = {
  resolve: {
    action: 'Resolve all changed comments',
    title: n => `Resolve ${comments(n)}?`,
    note: 'Check what changed first. Each comment is marked resolved with your name.',
    confirm: n => `Resolve ${comments(n)}`,
    done: n => `Resolved ${comments(n)}.`,
    some: (done, all) => `Resolved ${done} of ${comments(all)}.`
  },
  deleteResolved: {
    action: 'Delete all resolved comments',
    title: n => `Delete ${comments(n)}?`,
    note: "These comments leave the file. This can't be undone.",
    confirm: n => `Delete ${comments(n)}`,
    done: n => `Deleted ${comments(n)}.`,
    some: (done, all) => `Deleted ${done} of ${comments(all)}.`
  }
}

/** A file's write landed, and the file then changed by someone else (L-1): the comments did change, so this is a note, not a failure. */
const changedAfterwards = (file: string): string => `${file} changed during the save, so check the comment list.`

/**
 * The answer, once main said how a file answered "still saving" ended (L-2).
 *
 * @param result - The answer so far.
 * @param event - Main's event; one for no pending file changes nothing.
 * @param items - What the review showed, for how many comments a landed file holds.
 * @returns The answer with that file's ending in it.
 */
export function settleBulkFile(result: CommentBulkResult, event: CommentBulkSettled, items: readonly BulkItem[]): CommentBulkResult {
  if (!result.ok) return result
  const { fileKey, ok, changedDuringSave, code, reason } = event
  const files = result.files.map(file => {
    if (file.fileKey !== fileKey || file.ok || file.code !== ErrorCode.COMMENT_SAVE_PENDING) return file
    if (!ok) return { fileKey, ok: false as const, code: code ?? ErrorCode.COMMENT_WRITE_FAILED, ...(reason === undefined ? {} : { reason }) }
    const done = items.filter(item => item.fileKey === fileKey).length
    return { fileKey, ok: true as const, done, ...(changedDuringSave === true ? { changedDuringSave } : {}) }
  })
  return { ok: true, files }
}

/** The sentences after a bulk action. */
export interface BulkOutcome {
  /** Every comment changed. */
  readonly ok: boolean
  readonly text: string
}

/**
 * What a bulk action's answer means to the reader. Files that were refused
 * wrote nothing, so their comments are all still there; one that changed right
 * after its write landed counts as done, with a note.
 *
 * @param change - The action.
 * @param all - How many comments were asked for.
 * @param result - Main's answer.
 * @param items - What the review showed.
 * @param words - The preview's words, for the reason.
 * @returns The sentence: how many, then why not, for the first file refused.
 */
export function bulkOutcome(change: CommentBulkChange, all: number, result: CommentBulkResult, items: readonly BulkItem[], words: CommentWords): BulkOutcome {
  const pathOf = (fileKey: string): string => items.find(item => item.fileKey === fileKey)?.displayPath ?? ''
  if (!result.ok) return { ok: false, text: words.saveFailure(result.code, pathOf(items[0]?.fileKey ?? ''), undefined, result.reason).text }
  const done = result.files.reduce((total, file) => total + (file.ok ? file.done : 0), 0)
  const refused = result.files.find(file => !file.ok)
  const changed = result.files.find(file => file.ok && file.changedDuringSave === true)
  const note = changed === undefined ? '' : ` ${changedAfterwards(pathOf(changed.fileKey))}`
  if (refused === undefined || refused.ok) return { ok: note === '', text: `${BULK_COPY[change].done(done)}${note}` }
  const why = words.saveFailure(refused.code, pathOf(refused.fileKey), undefined, refused.reason).text
  return { ok: false, text: done === 0 ? why : `${BULK_COPY[change].some(done, all)} ${why}${note}` }
}
