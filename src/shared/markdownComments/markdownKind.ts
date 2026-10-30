// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown file kind (spec 024 024-FR-003; architecture note 001 § 3,
 * § 5, § 8 C2–C5, C7, C9–C11, C19; design `markdown-format.md`): `.md` and
 * `.markdown` files behind the {@link CommentFileKind} seam.
 *
 * - `parse` refuses a file past the limits before any parse
 *   (`markdownLimits.ts`), then indexes it (`mdIndex.ts`) and classifies its
 *   blocks with the shared classifier in the `line-start` shape; a block
 *   that relies on `--!>` is unterminated in Markdown and makes the file
 *   read-only.
 * - `locate`, `reattach` and the block positions: `mdLocate.ts`.
 * - `slots`: `mdSlots.ts`; `anchorOf`: `mdAnchor.ts`; `hints`: `mdHints.ts`.
 * - `verify` is the RENDER CHECK: the file's preview tree before and after
 *   the splice, after parse and sanitize, compared with positions and
 *   comments dropped, with the user's "preserve line breaks" setting; every
 *   comment but the one written must keep its text and place. The "before"
 *   render is made once per save, in `originOf`. Parse and compare only.
 *
 * {@link markdownKind} renders with line breaks off; a write job passes the
 * setting through {@link markdownKindWith}.
 */
import { classifyIndexedBlocks, type FileCommentState, type ParsedBlock } from '../comments/blocks'
import type { CommentFileKind, KindDocument, KindOrigin, KindVerifyResult } from '../comments/fileKind'
import { MARKDOWN_AGENT_NOTE_LINES } from '../comments/agentNotes'
import type { SplicePlan, SpliceOrigin } from '../comments/splice'
import { markdownLimitBreach } from './markdownLimits'
import { markdownAnchor, markdownSelection } from './mdAnchor'
import { markdownHints } from './mdHints'
import { emptyMdIndex, indexMarkdown, MdIndex, type MdComment, type MdTarget } from './mdIndex'
import { findMarkdownTarget, locateMarkdownTarget, markdownBlockResolver } from './mdLocate'
import { renderMarkdownBody, renderSignature } from './mdRender'
import { markdownSlots, primaryCarrierOf, type MdSlot } from './mdSlots'

/** A comment of the planned-on file, as the render check compares it. */
interface OriginComment {
  readonly start: number
  readonly end: number
  readonly data: string
}

/** What the render check needs of the planned-on file: its render, never its tree. */
export interface MarkdownOrigin extends SpliceOrigin {
  readonly breaks: boolean
  readonly signature: string
  readonly comments: readonly OriginComment[]
}

/** How the preview renders: the user's "preserve line breaks" setting. */
export interface MarkdownRenderOptions {
  readonly breaks: boolean
}

/** `doc`'s Markdown index. Another kind's document reaching here is a wiring bug. */
function mdIndexOf(doc: KindDocument): MdIndex {
  if (!(doc.index instanceof MdIndex)) throw new Error('The Markdown comment kind was given another kind\'s document')
  return doc.index
}

function isMdTarget(target: unknown): target is MdTarget {
  return typeof target === 'object' && target !== null && 'block' in target && 'kind' in target
}

function isMarkdownOrigin(origin: KindOrigin): origin is MarkdownOrigin {
  return 'signature' in origin && typeof origin.signature === 'string' && 'breaks' in origin
}

function isMdSlot(slot: unknown): slot is MdSlot {
  return typeof slot === 'object' && slot !== null && 'carrier' in slot
}

/** The state with every block whose comment never closed marked unterminated, and the file read-only. */
function withUnterminated(index: MdIndex, state: FileCommentState): FileCommentState {
  const open = new Set(index.comments.filter((c: MdComment) => !c.terminated).map(c => c.start))
  if (!state.blocks.some(block => open.has(block.nodeRange[0]))) return state
  const blocks = state.blocks.map((block): ParsedBlock => {
    if (!open.has(block.nodeRange[0]) || (block.kind === 'damaged' && block.reason === 'unterminated')) return block
    const headerId = block.kind === 'ok' ? block.data.id : block.kind === 'damaged' ? block.headerId : undefined
    const { range, nodeRange, rawHash } = block
    return { kind: 'damaged', reason: 'unterminated', range, nodeRange, rawHash, ...(headerId === undefined ? {} : { headerId }) }
  })
  const readOnlyReason = state.readOnlyReason === 'conflict-markers' ? 'conflict-markers' : 'unterminated-block'
  return { blocks, writable: false, readOnlyReason }
}

/** Parse a decoded Markdown file for comments; past a limit, read-only "too large", never parsed. */
export function parseMarkdownDocument(text: string, bomLength: number): KindDocument {
  if (markdownLimitBreach(text) !== undefined) {
    return { text, index: emptyMdIndex(text, bomLength), state: { blocks: [], writable: false, readOnlyReason: 'too-large' } }
  }
  const index = indexMarkdown(text, bomLength)
  const state = classifyIndexedBlocks(index, 'line-start', markdownBlockResolver(index))
  return { text, index, state: withUnterminated(index, state) }
}

/** The render check's view of a planned-on document, rendering it once with `breaks`. */
export function markdownOriginOf(doc: KindDocument, options: MarkdownRenderOptions): MarkdownOrigin {
  const index = mdIndexOf(doc)
  return {
    text: doc.text,
    blockCount: doc.state.blocks.length,
    commentCount: index.comments.length,
    breaks: options.breaks,
    signature: signatureOf(index, options.breaks),
    comments: index.comments.map(({ start, end, data }) => ({ start, end, data }))
  }
}

function signatureOf(index: MdIndex, breaks: boolean): string {
  return breaks ? renderSignature(renderMarkdownBody(index.text.slice(index.bodyStart), true)) : index.signature
}

/**
 * True when every comment the plan did not write is still there with the
 * same text, at its place moved by the splice (C4). A comment the splice
 * cuts into fails.
 */
function otherCommentsKept(before: readonly OriginComment[], after: readonly MdComment[], plan: SplicePlan): boolean {
  const delta = plan.insert.length - (plan.end - plan.start)
  const insertEnd = plan.start + plan.insert.length
  if (before.some(c => c.start < plan.start && plan.start < c.end)) return false
  const kept = before.filter(c => c.end <= plan.start || c.start >= plan.end)
  const now = after.filter(c => c.end <= plan.start || c.start >= insertEnd)
  return (
    kept.length === now.length &&
    kept.every((c, i) => {
      const shift = c.start >= plan.end ? delta : 0
      return now[i].start === c.start + shift && now[i].end === c.end + shift && now[i].data === c.data
    })
  )
}

/** The render check (module comment). */
function verifyRender(origin: MarkdownOrigin, newDoc: KindDocument, plan: SplicePlan): KindVerifyResult {
  const index = mdIndexOf(newDoc)
  const unchanged =
    newDoc.state.readOnlyReason !== 'too-large' &&
    signatureOf(index, origin.breaks) === origin.signature &&
    otherCommentsKept(origin.comments, index.comments, plan)
  return unchanged ? { ok: true } : { ok: false, reason: 'render-changed' }
}

/** The Markdown kind, rendering with the "preserve line breaks" setting `options.breaks`. */
export function markdownKindWith(options: MarkdownRenderOptions): CommentFileKind {
  return {
    id: 'markdown',
    extensions: ['.md', '.markdown'],
    agentNote: MARKDOWN_AGENT_NOTE_LINES,

    parse: parseMarkdownDocument,

    locate(doc, pick) {
      return locateMarkdownTarget(mdIndexOf(doc), pick)
    },

    slots(doc, target) {
      return isMdTarget(target) ? markdownSlots(mdIndexOf(doc), target) : []
    },

    anchorOf(doc, target, sel, slot) {
      const index = mdIndexOf(doc)
      if (!isMdTarget(target)) throw new Error('The Markdown comment kind was given a target outside its document')
      const carrier = isMdSlot(slot) ? slot.carrier : primaryCarrierOf(target)
      if (carrier === undefined) throw new Error('The Markdown comment kind found no carrier for its target')
      const anchor = markdownAnchor(index, carrier, target)
      const words = markdownSelection(index, target, sel)
      return words === undefined ? anchor : { ...anchor, sel: words }
    },

    hints: markdownHints,

    reattach(doc, anchor) {
      return findMarkdownTarget(mdIndexOf(doc), anchor)
    },

    originOf(doc) {
      return markdownOriginOf(doc, options)
    },

    verify(origin, newDoc, plan) {
      if (!isMarkdownOrigin(origin)) throw new Error('The Markdown comment kind was given another kind\'s origin')
      return verifyRender(origin, newDoc, plan)
    }
  }
}

/** Markdown files, rendered with line breaks off (the setting's default). */
export const markdownKind: CommentFileKind = markdownKindWith({ breaks: false })
