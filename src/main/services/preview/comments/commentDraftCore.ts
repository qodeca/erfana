// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The parse half of a pick: a draft, and a pin's damaged blocks, worked out
 * from a fresh parse of the file (docs/designs/comments/html-preview-comments.md §6,
 * §7.3 step 3, decisions 16–17, 34, §19 R3-8, R3-11, R3-12; tests M-033,
 * M-054, M-055).
 *
 * Runs in the comment parse worker as the `draft` and `pin` jobs
 * (`commentFileJobs.ts`), so no page – up to 25 MB – parses on the main thread.
 * A pin click is ONE job on one read: the blocks standing on the pin's element
 * and the draft for its "New comment" come from the same parse (§19 "One pin
 * job") – a 25 MB page does not fit the worker's document cache, so two jobs
 * would parse it twice.
 * Pure: no Electron, no file system, no worker API. Main reads the bytes and
 * keeps everything that names a path (`commentDraftBuilder.ts`,
 * `commentDraftOpener.ts`).
 *
 * The token's element is looked up at the recorded offset, with the recorded
 * tag, in bytes that still hash to what was served; anything else opens no
 * draft. Where the block goes (R3-11): before the element itself, or – inside
 * a framework's hydrated region – before the region's container, with the
 * element as a runtime path below it and no whitespace layout. A JS-built
 * element the page described goes below either as a runtime path, with its
 * snapshot cut and stripped (`prepareSnapshot`); a path that names an element
 * that IS in the file keeps no snapshot (M-054, `buildDraftAnchor`).
 */
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import {
  BOM_CHAR,
  buildDraftAnchor,
  frameworkPlacementFor,
  prepareSnapshot,
  quoteOf,
  type CommentAnchor,
  type HtmlIndex,
  type IndexedElement,
  type RuntimeAnchor
} from '../../../../shared/htmlComments'
import type { CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import { writableRefusal, type JobDocument } from './commentJobDocs'
import { positionTarget } from './commentParseCore'
import type { CommentRefusal } from './commentRefusals'

/** Characters of the start-tag excerpt the menu shows (§10.4). */
export const EXCERPT_MAX_CHARS = 200
const TAG_VIEW_MAX_CHARS = 128
const ID_VIEW_MAX_CHARS = 200
const CLASS_VIEW_MAX_CHARS = 100
const RUNTIME_TAG_VIEW_MAX_CHARS = 32

/** What the menu and the comment window say about the picked element (§10.4). */
export interface DraftTargetView {
  readonly tag: string
  readonly elementId?: string
  readonly classes: string[]
  readonly line: number
  readonly excerpt: string
  readonly runtime?: { readonly tag: string; readonly snapshotBytes?: number; readonly truncated?: true }
}

/** What main recorded for the token when it served the page. */
export interface DraftEntry {
  readonly startOffset: number
  readonly tagName: string
  readonly fileHash: string
}

/** The parts of a pick the parse needs; the rest stays on main. */
export type DraftPickPart = Pick<CommentPick, 'runtime' | 'ws'>

/** Build a draft for a token's element. */
export interface DraftJob {
  readonly kind: 'draft'
  readonly entry: DraftEntry
  readonly pick: DraftPickPart
}

/**
 * The draft's parse half, or why there is none: `refusal` absent means the
 * element cannot take comments ("can't comment here").
 */
export type DraftJobResult =
  | {
      readonly kind: 'draft'
      readonly ok: true
      /** UTF-16 offset of the start tag the block goes before. */
      readonly offset: number
      readonly fileHash: string
      readonly anchor: CommentAnchor
      readonly ws?: 'collapse' | 'preserve'
      readonly target: DraftTargetView
    }
  | { readonly kind: 'draft'; readonly ok: false; readonly refusal?: CommentRefusal }

/** A damaged or newer block by its hash and start offset – main turns it into a key. */
export interface PinBlock {
  readonly rawHash: string
  readonly start: number
}

/** A pin click: the blocks standing on the pin's element, and a draft on it, from one parse. */
export interface PinJob {
  readonly kind: 'pin'
  readonly entry: DraftEntry
  /** Look for the element's damaged and newer blocks (the pin counts some). */
  readonly blocks: boolean
  /** The pick "New comment" is built from; absent: no draft (the element is not one a pick could name). */
  readonly pick?: DraftPickPart
}

/** The pin's blocks – empty when the file changed – and the draft's parse half when one was asked for. */
export interface PinJobResult {
  readonly kind: 'pin'
  readonly blocks: readonly PinBlock[]
  readonly draft?: DraftJobResult
}

const MOVED: DraftJobResult = { kind: 'draft', ok: false, refusal: 'target-moved' }
const NOT_HERE: DraftJobResult = { kind: 'draft', ok: false }

/** 1-based line of `offset` in `text`. */
export function lineAt(text: string, offset: number): number {
  let line = 1
  for (let at = text.indexOf('\n'); at !== -1 && at < offset; at = text.indexOf('\n', at + 1)) line += 1
  return line
}

/** `text` cut to `max` UTF-16 units, never through a surrogate pair. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** The element's start tag as it is on disk, cut for the menu. */
function excerptOf(text: string, el: IndexedElement): string {
  const location = el.node.sourceCodeLocation?.startTag
  const bom = text.startsWith(BOM_CHAR) ? 1 : 0
  const end = location === undefined ? el.nameEnd : location.endOffset + bom
  return cutText(text.slice(el.start, Math.max(el.start, end)), EXCERPT_MAX_CHARS)
}

/** The runtime part of the anchor, from the framework placement and the page's description. */
function runtimeOf(
  index: HtmlIndex,
  el: IndexedElement,
  basePath: string,
  pick: DraftPickPart
): RuntimeAnchor | undefined | null {
  const described = pick.runtime
  if (basePath === '' && described === undefined) return undefined
  const path = [basePath, described?.path ?? ''].filter(part => part !== '').join(' > ')
  if (path.length > PREVIEW_LIMITS.COMMENT_RUNTIME_PATH_MAX_CHARS) return null
  const quote = described === undefined ? quoteOf(index, el) : described.quote
  const prepared = described?.snapshot === undefined ? undefined : prepareSnapshot(described.snapshot)
  const truncated = prepared?.truncated === true || described?.truncated === true
  return {
    path,
    tag: described?.tag ?? el.tag,
    ...(quote === undefined ? {} : { quote }),
    ...(prepared === undefined ? {} : { snapshot: prepared.snapshot }),
    ...(prepared !== undefined && truncated ? { truncated: true as const } : {}),
    snapshotSource: 'page'
  }
}

function targetViewOf(text: string, anchorEl: IndexedElement, anchor: CommentAnchor): DraftTargetView {
  const runtime = anchor.runtime
  return {
    tag: anchorEl.tag.slice(0, TAG_VIEW_MAX_CHARS),
    ...(anchorEl.id === undefined ? {} : { elementId: anchorEl.id.slice(0, ID_VIEW_MAX_CHARS) }),
    classes: anchorEl.classes.slice(0, PREVIEW_LIMITS.COMMENT_MAX_CLASSES).map(name => name.slice(0, CLASS_VIEW_MAX_CHARS)),
    line: lineAt(text, anchorEl.start),
    excerpt: excerptOf(text, anchorEl),
    ...(runtime === undefined
      ? {}
      : {
          runtime: {
            tag: runtime.tag.slice(0, RUNTIME_TAG_VIEW_MAX_CHARS),
            ...(runtime.snapshot === undefined ? {} : { snapshotBytes: Buffer.byteLength(runtime.snapshot) }),
            ...(runtime.truncated === true ? { truncated: true as const } : {})
          }
        })
  }
}

/** The `draft` job. Never throws for a file that cannot take the draft. */
export function runDraftJob(document: JobDocument, job: DraftJob): DraftJobResult {
  if (!document.ok) return { kind: 'draft', ok: false, refusal: document.refusal }
  const { doc, hash } = document
  const blocked = writableRefusal(doc.state)
  if (blocked !== null) return { kind: 'draft', ok: false, refusal: blocked }
  // The page shows what was served; a file changed since then is re-picked after its reload.
  if (hash !== job.entry.fileHash) return MOVED
  const el = doc.index.elementAt(job.entry.startOffset)
  if (el === undefined || el.tag !== job.entry.tagName) return MOVED
  const placement = frameworkPlacementFor(doc.index, el)
  if (placement.kind === 'no-container') return NOT_HERE
  const anchorEl = placement.kind === 'framework' ? placement.container : el
  const runtime = runtimeOf(doc.index, el, placement.kind === 'framework' ? placement.runtimePath : '', job.pick)
  if (runtime === null) return NOT_HERE
  const anchor = buildDraftAnchor(doc.index, anchorEl, runtime)
  const ws = placement.kind === 'framework' ? undefined : job.pick.ws
  return {
    kind: 'draft',
    ok: true,
    offset: anchorEl.start,
    fileHash: hash,
    anchor,
    ...(ws === undefined ? {} : { ws }),
    target: targetViewOf(doc.text, anchorEl, anchor)
  }
}

/** Damaged and newer blocks whose position names the element at `entry`; none when the file changed. */
function pinBlocksOf(document: JobDocument, entry: DraftEntry): PinBlock[] {
  if (!document.ok || document.hash !== entry.fileHash) return []
  const { index, state } = document.doc
  const ends = new Map(state.blocks.map(block => [block.nodeRange[0], block.nodeRange[1]]))
  return state.blocks
    .filter(block => block.kind !== 'ok' && positionTarget(index, block.nodeRange[1], ends) === entry.startOffset)
    .map(block => ({ rawHash: block.rawHash, start: block.nodeRange[0] }))
}

/** The `pin` job: the pin's blocks and the draft on its element, from one parse. */
export function runPinJob(document: JobDocument, job: PinJob): PinJobResult {
  const blocks = job.blocks ? pinBlocksOf(document, job.entry) : []
  if (job.pick === undefined) return { kind: 'pin', blocks }
  return { kind: 'pin', blocks, draft: runDraftJob(document, { kind: 'draft', entry: job.entry, pick: job.pick }) }
}
