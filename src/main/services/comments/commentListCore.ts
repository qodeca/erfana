// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The parse half of `preview:commentList`: one file's threads, damaged and
 * newer blocks with their lines (docs/designs/comments/html-preview-comments.md §7.7,
 * §10.4, §10.6, §19 R3-12; tests M-014, M-053).
 *
 * Runs in the comment parse worker as the `list` job (`commentFileJobs.ts`).
 * Pure: no Electron, no file system, no worker API. The summary names blocks
 * by thread id, hash and start offset only; main mints the keys the renderer
 * sees and adds what only main knows – the file's paths and whether a thread
 * is rendered now (`commentListBuilder.ts`).
 */
import { visibleInline, type CommentAnchor, type CommentAuthor, type ParsedBlock } from '../../../shared/htmlComments'
import type { KindDocument } from '../../../shared/comments/fileKind'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  COMMENT_RAW_PREVIEW_MAX_CHARS,
  type CommentFileView,
  type CommentThreadView
} from '../../../shared/ipc/preview-comment-schema'
import { cutText } from '../../../shared/comments/cutText'
import type { JobDocument } from './commentJobDocs'
import type { CommentRefusal } from './commentRefusals'

/** List one file's comments. */
export interface ListJob {
  readonly kind: 'list'
  /**
   * Also say where each attached thread's target starts (the file-comment
   * family's placements, spec 024 § 4); the HTML Preview never asks.
   */
  readonly placements?: true
}

/** Where an attached thread's target is now: its 1-based first line and its tag. */
export interface ListedPlacement {
  readonly threadId: string
  readonly line: number
  readonly tag: string
}

/** A thread as listed, before main gives it a key and its "not visible now" flag. */
export type ListedThread = Omit<CommentThreadView, 'threadKey' | 'notVisible'> & { readonly threadId: string }

/** A damaged block as listed, before its key. */
export type ListedDamaged = Omit<CommentFileView['damaged'][number], 'blockKey'> & { readonly start: number }

/** A newer-version block as listed, before its key. */
export type ListedNewer = Omit<CommentFileView['newer'][number], 'blockKey'> & {
  readonly rawHash: string
  readonly start: number
}

/** One file's comments, without keys or paths. */
export interface ListSummary {
  readonly writable: boolean
  readonly readOnlyReason?: CommentFileView['readOnlyReason']
  readonly threads: ListedThread[]
  readonly damaged: ListedDamaged[]
  readonly newer: ListedNewer[]
  /** Present only when the job asked for it. */
  readonly placements?: ListedPlacement[]
}

/** The summary, or why the file cannot be read for comments. */
export type ListJobResult =
  | { readonly kind: 'list'; readonly ok: true; readonly summary: ListSummary }
  | { readonly kind: 'list'; readonly ok: false; readonly refusal: CommentRefusal }

/** 1-based line numbers by offset, from one scan of the text. */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
  return offset => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function authorView(author: CommentAuthor): { name: string; email?: string } {
  return author.email === undefined ? { name: author.name } : { name: author.name, email: author.email }
}

/**
 * The stored text of the element a thread is on, for "It was attached to:":
 * the JS-built element's own quote when it has one, else the in-file
 * element's. Shown with nothing hidden (`visibleInline`) and cut, whole
 * characters and escapes only, to the quote cap.
 */
export function storedQuoteOf(anchor: CommentAnchor): string | undefined {
  const exact = anchor.runtime?.quote?.exact ?? anchor.quote?.exact
  if (exact === undefined) return undefined
  let shown = ''
  for (const char of exact) {
    const visible = visibleInline(char)
    if (shown.length + visible.length > PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS) break
    shown += visible
  }
  return shown === '' ? undefined : shown
}

function threadOf(block: Extract<ParsedBlock, { kind: 'ok' }>, line: number): ListedThread {
  const { data } = block
  const runtime = data.anchor.runtime
  const quote = storedQuoteOf(data.anchor)
  return {
    threadId: data.id,
    rawHash: block.rawHash,
    status: data.status,
    ...(data.resolved === undefined ? {} : { resolved: { by: authorView(data.resolved.by), at: data.resolved.at } }),
    line,
    tag: data.anchor.tag,
    ...(data.anchor.id === undefined ? {} : { elementId: data.anchor.id }),
    classes: [...(data.anchor.cls ?? [])],
    attached: block.target.state === 'attached',
    ...(quote === undefined ? {} : { quote }),
    ...(runtime === undefined
      ? {}
      : {
          runtime: {
            tag: runtime.tag,
            path: runtime.path,
            ...(runtime.snapshot === undefined ? {} : { snapshotBytes: Buffer.byteLength(runtime.snapshot) }),
            ...(runtime.truncated === true ? { truncated: true as const } : {})
          }
        }),
    messages: data.msgs.map(message => ({
      id: message.id,
      by: authorView(message.by),
      at: message.at,
      text: message.text,
      ...(message.edited === undefined ? {} : { edited: message.edited })
    }))
  }
}

/** Each attached thread's target line, in block order. */
function placementsOf(doc: KindDocument, line: (offset: number) => number): ListedPlacement[] {
  const placements: ListedPlacement[] = []
  for (const block of doc.state.blocks) {
    if (block.kind !== 'ok' || block.target.state !== 'attached') continue
    const target = doc.index.elementAt(block.target.startOffset)
    if (target === undefined) continue
    placements.push({ threadId: block.data.id, line: line(target.start), tag: target.tag })
  }
  return placements
}

function summaryOf(doc: KindDocument, job: ListJob | undefined): ListSummary {
  const line = lineIndex(doc.text)
  const threads: ListedThread[] = []
  const damaged: ListedDamaged[] = []
  const newer: ListedNewer[] = []
  for (const block of doc.state.blocks) {
    const start = block.nodeRange[0]
    const at = line(start)
    if (block.kind === 'ok') {
      threads.push(threadOf(block, at))
    } else if (block.kind === 'damaged') {
      const raw = doc.text.slice(start, block.nodeRange[1])
      const cut = cutText(raw, COMMENT_RAW_PREVIEW_MAX_CHARS)
      damaged.push({ rawHash: block.rawHash, start, reason: block.reason, line: at, raw: cut, ...(cut.length < raw.length ? { rawTruncated: true as const } : {}) })
    } else {
      newer.push({ rawHash: block.rawHash, start, version: block.version, line: at })
    }
  }
  return {
    writable: doc.state.writable,
    ...(doc.state.readOnlyReason === undefined ? {} : { readOnlyReason: doc.state.readOnlyReason }),
    threads,
    damaged,
    newer,
    ...(job?.placements === true ? { placements: placementsOf(doc, line) } : {})
  }
}

/** The `list` job. */
export function runListJob(document: JobDocument<KindDocument>, job?: ListJob): ListJobResult {
  return document.ok
    ? { kind: 'list', ok: true, summary: summaryOf(document.doc, job) }
    : { kind: 'list', ok: false, refusal: document.refusal }
}
