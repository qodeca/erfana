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
import { anchorSelectionOf, type AnchorSelection } from '../../../shared/comments/anchorSel'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  COMMENT_RAW_PREVIEW_MAX_CHARS,
  type CommentFileView,
  type CommentThreadView
} from '../../../shared/ipc/preview-comment-schema'
import { cutText } from '../../../shared/comments/cutText'
import type { TargetVia } from '../../../shared/comments/reattach'
import type { IndexedTarget } from '../../../shared/comments/targetIndex'
import { innerTargetOf } from '../../../shared/markdownComments/mdAnchor'
import type { MdIndex, MdTarget } from '../../../shared/markdownComments/mdIndex'
import { positionTargetOf } from '../../../shared/markdownComments/mdLocate'
import { changeOf, type ListedChange } from './commentListChange'
import { rebuildViewOf } from './commentRebuild'
import { addRefusal, type JobDocument } from './commentJobDocs'
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

/** Where an attached thread's target is now: its 1-based first line, its tag, and the words it is about. */
export interface ListedPlacement {
  readonly threadId: string
  readonly line: number
  readonly tag: string
  /** The block's valid `anchor.sel` (024-FR-004): the preview underlines these words while it finds them. */
  readonly sel?: AnchorSelection
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
  /** Writable, but full: no new comment (`addRefusal` in `commentJobDocs.ts`). */
  readonly addRefusal?: CommentFileView['addRefusal']
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

type OkBlock = Extract<ParsedBlock, { kind: 'ok' }>

/** True when the index is a Markdown file's: it has a body line. */
function isMarkdownIndex(index: KindDocument['index']): index is MdIndex {
  return 'bodyLine' in index
}

/** Where a block's target is now, and how it was found. */
interface FoundTarget {
  readonly el: IndexedTarget
  /** Absent when only the block's position names it. */
  readonly via?: TargetVia
}

/**
 * The target a block is on now: the parse's, or – in a Markdown file whose
 * target only changed its text – the one at the block's position
 * (`positionTargetOf`, no `via`), so the comment reads as Changed rather than
 * Not found (C-06). The parse itself is never changed.
 */
function currentTarget(doc: KindDocument, block: OkBlock): FoundTarget | undefined {
  if (block.target.state === 'attached') {
    const el = doc.index.elementAt(block.target.startOffset)
    return el === undefined ? undefined : { el, via: block.target.via }
  }
  if (!isMarkdownIndex(doc.index)) return undefined
  const el = positionTargetOf(doc.index, block.nodeRange[1], block.data.anchor.tag)
  return el === undefined ? undefined : { el }
}

/** The derived change of an open thread (C-06); a resolved thread is history and gets none. */
function threadChange(doc: KindDocument, block: OkBlock, found: FoundTarget | undefined): ListedChange | undefined {
  if (found === undefined || block.data.status !== 'open') return undefined
  return changeOf({
    index: doc.index,
    target: found.el,
    anchor: block.data.anchor,
    via: found.via,
    html: !isMarkdownIndex(doc.index)
  })
}

/** The target an open thread is shown on: the parse's, or a Markdown position whose text changed (C-06). */
function shownTarget(doc: KindDocument, block: OkBlock): { readonly found?: FoundTarget; readonly change?: ListedChange } {
  const found = currentTarget(doc, block)
  const change = threadChange(doc, block, found)
  if (found === undefined || (block.target.state !== 'attached' && change === undefined)) return {}
  return change === undefined ? { found } : { found, change }
}

function threadOf(doc: KindDocument, block: OkBlock, line: number): ListedThread {
  const { data } = block
  const runtime = data.anchor.runtime
  const quote = storedQuoteOf(data.anchor)
  const { found, change } = shownTarget(doc, block)
  return {
    threadId: data.id,
    rawHash: block.rawHash,
    status: data.status,
    ...(data.resolved === undefined ? {} : { resolved: { by: authorView(data.resolved.by), at: data.resolved.at } }),
    line,
    tag: data.anchor.tag,
    ...(data.anchor.id === undefined ? {} : { elementId: data.anchor.id }),
    classes: [...(data.anchor.cls ?? [])],
    // A Markdown target found only by its position is attached, and Changed (C-06).
    attached: block.target.state === 'attached' || found !== undefined,
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
    })),
    ...(change === undefined ? {} : { change })
  }
}

/**
 * The element a thread's icon is drawn on: in Markdown, the inner target its
 * anchor names below the carrier (list item 1, a row or cell, a block in a
 * quote, an image – markdown-format.md § 5 "Inner target"), so the icon and
 * its name say what the comment is about, as the window did. A placement
 * names its element by line and tag only, so the inner target is used only
 * where that pair finds it – the first of its tag on its line (a table's
 * third cell is not). Else, or when the inner target is gone, the carrier.
 */
function placedOn(doc: KindDocument, block: OkBlock, carrier: IndexedTarget): IndexedTarget {
  const runtime = block.data.anchor.runtime
  const index = doc.index
  if (runtime === undefined || !isMarkdownIndex(index)) return carrier
  const inner = innerTargetOf(index, carrier as MdTarget, runtime)
  if (inner === undefined) return carrier
  const firstOnLine = index.elements.find(el => el.line === inner.line && el.tag === inner.tag)
  return firstOnLine === inner ? inner : carrier
}

/** Each attached thread's target line, in block order. */
function placementsOf(doc: KindDocument, line: (offset: number) => number): ListedPlacement[] {
  const placements: ListedPlacement[] = []
  for (const block of doc.state.blocks) {
    if (block.kind !== 'ok') continue
    // An open Markdown comment whose target only changed its text keeps its icon there (C-06).
    const carrier = shownTarget(doc, block).found?.el
    if (carrier === undefined) continue
    const target = placedOn(doc, block, carrier)
    const sel = anchorSelectionOf(block.data.anchor)
    placements.push({ threadId: block.data.id, line: line(target.start), tag: target.tag, ...(sel === undefined ? {} : { sel }) })
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
      threads.push(threadOf(doc, block, at))
    } else if (block.kind === 'damaged') {
      const raw = doc.text.slice(start, block.nodeRange[1])
      const cut = cutText(raw, COMMENT_RAW_PREVIEW_MAX_CHARS)
      // OD-05: a hand-damaged block with valid @data can be rebuilt from it – offered, never done here.
      const rebuild = doc.state.writable ? rebuildViewOf(raw, block.reason) : undefined
      damaged.push({
        rawHash: block.rawHash,
        start,
        reason: block.reason,
        line: at,
        raw: cut,
        ...(cut.length < raw.length ? { rawTruncated: true as const } : {}),
        ...(rebuild === undefined ? {} : { rebuild })
      })
    } else {
      newer.push({ rawHash: block.rawHash, start, version: block.version, line: at })
    }
  }
  return {
    writable: doc.state.writable,
    ...(doc.state.readOnlyReason === undefined ? {} : { readOnlyReason: doc.state.readOnlyReason }),
    ...(doc.state.writable && addRefusal(doc.state) === 'too-many-blocks' ? { addRefusal: 'too-many-blocks' as const } : {}),
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
