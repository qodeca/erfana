// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test harness for the Markdown comment kind: the save pipeline of
 * architecture note 001 § 5 on decoded text, built from the shared planners
 * and checks only (`splice.ts`, `thread.ts`) – parse, locate, try each slot
 * with its own anchor until the shared checks and the render check pass –
 * so the kind's suites need neither the worker nor the writer. The worker
 * path (`markdownCommentJobs.ts`) runs the same steps on bytes.
 */
import { ADA, FIXED_NOW, GRACE, LATER, seededRandom } from '../../comments/__fixtures__/commentTestData'
import type { ParsedBlock } from '../../comments/blocks'
import type { CommentFileKind, KindDocument, PickedTarget } from '../../comments/fileKind'
import { isKindRefusal } from '../../comments/fileKind'
import type { CommentData, CommentView, TextQuote } from '../../comments/format'
import {
  applySplice,
  insertRefusal,
  planDelete,
  planReplace,
  planSlotInsert,
  verifyKindSplice,
  type SplicePlan
} from '../../comments/splice'
import { addReply, createThread, editMessage, setStatus, type ThreadContext } from '../../comments/thread'
import { markdownKind } from '../markdownKind'
import { MdIndex, type MdTarget } from '../mdIndex'
import { markdownTextHash } from '../mdLocate'

export const MD_VIEW: CommentView = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }

/** A fixed actor and clock with a seeded random source, so ids repeat run after run. */
export function contextOf(seed = 7, author = ADA, now = FIXED_NOW): ThreadContext {
  return { author, now, random: seededRandom(seed) }
}

let nextSeed = 100
/** A fresh seed for each add without one, so two comments in one file never share an id. */
const freshSeed = (): number => (nextSeed += 1)

/** `text`'s BOM length. */
export const bomOf = (text: string): number => (text.startsWith('\uFEFF') ? 1 : 0)

/** Parse `text` with `kind`. */
export function parseMd(text: string, kind: CommentFileKind = markdownKind): KindDocument {
  return kind.parse(text, bomOf(text))
}

/** The Markdown index of a document. */
export function mdOf(doc: KindDocument): MdIndex {
  if (!(doc.index instanceof MdIndex)) throw new Error('not a Markdown document')
  return doc.index
}

/** A pick of `target` as the preview would send it while the file is unchanged. */
export function pickOf(doc: KindDocument, target: MdTarget, over: Partial<PickedTarget> = {}): PickedTarget {
  const index = mdOf(doc)
  const sameLine = index.elements.filter(t => t.line === target.line && t.tag === target.tag)
  const quote = index.visibleText.slice(target.textStart, target.textEnd).replace(/\s+/g, ' ').trim().normalize('NFC')
  return {
    lineStart: target.line,
    lineEnd: target.lineEnd,
    tag: target.tag,
    ordinal: sameLine.indexOf(target) + 1,
    quote: { exact: quote.slice(0, 200) || '-', prefix: '', suffix: '' },
    baseHash: markdownTextHash(doc.text),
    ...over
  }
}

/** The first target of `kind` (and tag, when given) whose text holds `text`, or throws. */
export function targetBy(doc: KindDocument, kind: MdTarget['kind'], text = '', nth = 0): MdTarget {
  const index = mdOf(doc)
  const found = index.elements.filter(
    t => t.kind === kind && index.visibleText.slice(t.textStart, t.textEnd).includes(text)
  )[nth]
  if (found === undefined) throw new Error(`no ${kind} target with "${text}"`)
  return found
}

/** One verified write: the new text, its plan and parse. */
export interface Written {
  readonly text: string
  readonly plan: SplicePlan
  readonly doc: KindDocument
  readonly data?: CommentData
  /** Which slot passed (adds). */
  readonly slot?: number
}

/** Why a write did nothing. */
export interface Refused {
  readonly refused: string
}

function verified(kind: CommentFileKind, doc: KindDocument, plan: SplicePlan): KindDocument | string {
  const text = applySplice(doc.text, plan)
  const result = verifyKindSplice(kind.originOf(doc), text, plan, {
    parse: next => kind.parse(next, bomOf(next)),
    verify: (origin, newDoc, p) => kind.verify(origin, newDoc, p)
  })
  return result.ok ? result.doc : result.reason
}

/** Add a comment on the target `pick` names, trying the kind's slots in order (§ 4.5). */
export function addComment(
  text: string,
  pick: PickedTarget,
  message = 'Please look at this.',
  options: { kind?: CommentFileKind; sel?: TextQuote; seed?: number } = {}
): Written | Refused {
  const kind = options.kind ?? markdownKind
  const doc = parseMd(text, kind)
  const found = kind.locate(doc, pick)
  if (isKindRefusal(found)) return { refused: found.refused }
  const shared = insertRefusal(doc)
  if (shared) return { refused: shared }
  const slots = kind.slots(doc, found, pick)
  if (slots.length === 0) return { refused: 'no-slot' }
  let last = 'render-changed'
  const seed = options.seed ?? freshSeed()
  for (const [i, slot] of slots.entries()) {
    const anchor = kind.anchorOf(doc, found, options.sel, slot)
    const data = createThread({ anchor, view: MD_VIEW, text: message, context: contextOf(seed) })
    const planned = planSlotInsert(doc, slot, data, kind.refuseGrowth, kind)
    if (!planned.ok) return { refused: planned.reason }
    const next = verified(kind, doc, planned.plan)
    if (typeof next !== 'string') return { text: applySplice(text, planned.plan), plan: planned.plan, doc: next, data, slot: i }
    last = next
    if (next !== 'render-changed') return { refused: next }
  }
  return { refused: last }
}

/** The `ok` block with thread `id`. */
export function okBlock(doc: KindDocument, id: string): Extract<ParsedBlock, { kind: 'ok' }> {
  const block = doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === id)
  if (block?.kind !== 'ok') throw new Error(`no ok block ${id}`)
  return block
}

/** A thread operation, as the writer runs it. */
export type ThreadOp = 'reply' | 'edit' | 'resolve' | 'reopen' | 'delete'

/** Run one thread operation on block `id` of `text`. */
export function changeThread(text: string, id: string, op: ThreadOp, kind: CommentFileKind = markdownKind): Written | Refused {
  const doc = parseMd(text, kind)
  const block = okBlock(doc, id)
  const context = contextOf(11, GRACE, LATER)
  const planned =
    op === 'delete'
      ? planDelete(doc, { block: { id }, rawHash: block.rawHash })
      : planReplace(doc, { id, rawHash: block.rawHash, data: changed(block.data, op, context) }, kind.refuseGrowth, kind)
  if (!planned.ok) return { refused: planned.reason }
  const next = verified(kind, doc, planned.plan)
  return typeof next === 'string' ? { refused: next } : { text: applySplice(text, planned.plan), plan: planned.plan, doc: next }
}

function changed(data: CommentData, op: Exclude<ThreadOp, 'delete'>, context: ThreadContext): CommentData {
  switch (op) {
    case 'reply':
      return addReply(data, 'Done in the next commit.', context)
    case 'edit':
      return editMessage(data, data.msgs[0].id, 'Please look at this again.', context.now)!
    case 'resolve':
      return setStatus(data, 'resolved', context)
    case 'reopen':
      return setStatus(data, 'open', context)
  }
}

/** Narrow a write result, or throw with its refusal. */
export function written(result: Written | Refused): Written {
  if ('refused' in result) throw new Error(`refused: ${result.refused}`)
  return result
}
