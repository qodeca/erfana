// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The parse half of a comment write: re-locate the target in the bytes just
 * read, plan ONE splice and verify it (docs/designs/comments/html-preview-comments.md
 * §7.6 steps 4–8, §19 R3-12; threats S10, S13).
 *
 * Runs in the comment parse worker as the `write` job (`commentFileJobs.ts`),
 * so neither the parse of the file nor the verifying re-parse of the result
 * runs on the main thread. Pure apart from its random source: no Electron, no
 * file system, no worker API. `CommentWriter.ts` keeps everything that touches
 * the disk – confinement, the lock, the read and the strict write.
 *
 * The answer is the splice as BYTES – where it starts and ends in the bytes
 * read and what goes between – rather than the new file: main rebuilds the
 * file from its own copy with {@link assembleSplice}, so every byte outside
 * the block is the byte it read, whatever the worker sent. The worker builds
 * the same file with the same function and verifies it before answering:
 * every byte outside the block identical, the new bytes decode losslessly to
 * the spliced text, exactly one block more, the same or one fewer, the same
 * elements, and the written block reads back with the intended data.
 *
 * The HTML writer parses the file afresh, never from the document cache:
 * re-locating a draft runs backup-tier lookups whose budget is shared per
 * parse (`commentJobDocs.ts`). A kind whose planning runs no such lookup may
 * pass a cached reader ({@link WriteKind.read}; `kindCommentJobs.ts`). The
 * verified result is a fresh parse of the new bytes, so it goes INTO the
 * cache – the list after the write finds it.
 *
 * The file kind comes with the job's environment (spec 024 architecture note
 * 001 § 5): its parse, its own pre-write check, and its agent note and hints,
 * which every new or rewritten block carries. An HTML `add` names a page
 * draft (offset and anchors); a `pick` – the renderer-hosted previews' add –
 * names a {@link PickedTarget} the kind locates, and is tried at each slot
 * the kind offers, in order, at most {@link MAX_SLOTS_PER_SAVE}: a slot whose
 * splice fails only the kind's own check gives way to the next, and when none
 * passes the save is `render-changed` (C25).
 *
 * Only the plans and the file's {@link KindOrigin} outlive the planning
 * step, so the first parse tree can be collected before the verifying
 * re-parse: at 25 MB one tree is most of a gigabyte, and holding both would
 * double the worker's peak (§19 Rev 4).
 */
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  addReply,
  applySplice,
  buildDraftAnchor,
  createThread,
  decodeLossless,
  deleteMessage,
  editMessage,
  encodeText,
  findAnchorTarget,
  isSafeCommentText,
  planDelete,
  planInsert,
  setStatus,
  utf8Length,
  verifySpliceBytes,
  type CommentAnchor,
  type CommentAuthor,
  type CommentData,
  type CommentDocument,
  type CommentView,
  type IndexedElement,
  type PlanFailure,
  type PlanResult,
  type RandomBytes,
  type SplicePlan,
  type ThreadContext
} from '../../../shared/htmlComments'
import {
  isKindRefusal,
  type CommentFileKind,
  type KindDocument,
  type KindOrigin,
  type KindRefusalReason,
  type PickedTarget
} from '../../../shared/comments/fileKind'
import type { TextQuote } from '../../../shared/comments/format'
import { isAnchorSelection } from '../../../shared/comments/anchorSel'
import { collapseRange, occurrencesInContext } from '../../../shared/comments/selectionWords'
import { insertRefusal, planRebuild, planReplace, planSlotInsert, verifyKindSplice, type VerifyFailure } from '../../../shared/comments/splice'
import { rebuildDataOf } from './commentRebuild'
import { freshKindDocumentOf, sha256HexOf, writableRefusal, type JobDocument, type KindDocCache } from './commentJobDocs'
import type { CommentRefusal } from './commentRefusals'

/** Slots one save tries at most, whatever its kind offers (C19). */
export const MAX_SLOTS_PER_SAVE = 8

/** What a draft recorded about its element when the pick was made (P5). */
export interface CommentDraftTarget {
  /** UTF-16 offset of the element's start tag in the decoded text the draft was made from. */
  readonly offset: number
  /** SHA-256 (hex) of the file bytes the draft was made from. */
  readonly fileHash: string
  /** The draft's anchor (`buildDraftAnchor`): its backups re-locate the element, its `runtime` part is kept. */
  readonly anchor: CommentAnchor
  /** The pick's computed `white-space-collapse` of the element's parent (R3-8); missing → mid-line. */
  readonly ws?: string
}

/** One change to an existing thread (§7.7). Deleting the first message deletes the thread. */
export type ThreadChange =
  /** `resolve`: the reply and the resolve in one write ("Reply and resolve", C-13). */
  | { readonly op: 'reply'; readonly text: string; readonly resolve?: true }
  | { readonly op: 'editMessage'; readonly messageId: string; readonly text: string }
  | { readonly op: 'deleteMessage'; readonly messageId: string }
  | { readonly op: 'setStatus'; readonly status: CommentData['status'] }
  | { readonly op: 'deleteThread' }

/** The edit a write makes, as plain data that crosses to the worker. */
export type WritePlanRequest =
  | { readonly op: 'add'; readonly draft: CommentDraftTarget; readonly view: CommentView; readonly text: string }
  | {
      readonly op: 'pick'
      readonly pick: PickedTarget
      /** The selected words, kept as `anchor.sel` when the kind finds them valid. */
      readonly sel?: TextQuote
      readonly view: CommentView
      readonly text: string
    }
  | { readonly op: 'thread'; readonly threadId: string; readonly rawHash: string; readonly change: ThreadChange }
  | { readonly op: 'deleteBlock'; readonly rawHash: string; readonly start?: number }
  /** OD-05: rebuild a damaged block from its own valid `@data`; `status: 'resolved'` is "Mark resolved". */
  | { readonly op: 'rebuild'; readonly rawHash: string; readonly start?: number; readonly status?: CommentData['status'] }

/** Who acts and when. `author` is set whenever the edit writes one; `nowMs` is epoch milliseconds. */
export interface WriteAct {
  readonly author?: CommentAuthor
  readonly nowMs: number
}

/** Plan and verify one write against the bytes main read. */
export interface WriteJob {
  readonly kind: 'write'
  readonly request: WritePlanRequest
  readonly act: WriteAct
}

/** Where a verified splice goes in the bytes read, and what goes there. */
export interface ByteSplice {
  /** Byte offset in the bytes read where the replaced range starts. */
  readonly byteStart: number
  /** Byte offset in the bytes read where the replaced range ends. */
  readonly byteEnd: number
  /** The new block's UTF-8 bytes (empty for a delete). */
  readonly insert: Uint8Array
}

/** A verified splice, or why nothing may be written. */
export type WriteJobResult =
  | (ByteSplice & {
      readonly kind: 'write'
      readonly ok: true
      /** SHA-256 (hex) of the bytes read: the strict write's compare-and-swap. */
      readonly inputHash: string
      /** SHA-256 (hex) of the file after the splice: the own-write echo filter (§7.5). */
      readonly outputHash: string
      /** The thread written; `null` when the edit removed its block. */
      readonly threadId: string | null
      /** An add asked for words the kind did not keep: the comment is on the whole target (024-FR-004). */
      readonly wordsDropped?: true
    })
  | { readonly kind: 'write'; readonly ok: false; readonly refusal: CommentRefusal }

/** Planner refusals as save refusals. */
const PLAN_REFUSALS: Readonly<Record<PlanFailure, CommentRefusal>> = {
  'read-only': 'read-only',
  'not-eligible': 'target-moved',
  'not-found': 'block-changed',
  'not-editable': 'block-changed',
  stale: 'block-changed',
  'meta-charset': 'meta-charset',
  limit: 'limit',
  invalid: 'invalid'
}

/** A kind's "no target" reasons as save refusals. */
const KIND_REFUSALS: Readonly<Record<KindRefusalReason, CommentRefusal>> = {
  'not-found': 'target-moved',
  'not-eligible': 'target-moved',
  'generated-region': 'generated-region',
  frontmatter: 'frontmatter'
}

/** The verify failures the shared checks own; any other is the kind's own (HTML: `elements`). */
const SHARED_VERIFY_FAILURES: ReadonlySet<VerifyFailure> = new Set<VerifyFailure>(['bytes', 'block-count', 'comment-count', 'block-data'])

/**
 * Plans in try order: one for every operation but a `pick`; one per slot for
 * a `pick` (`slotted`), where a plan failing only the kind's check gives way
 * to the next.
 */
type Planned =
  | {
      readonly ok: true
      readonly plans: readonly SplicePlan[]
      readonly threadId: string | null
      readonly slotted?: true
      /** A `pick` asked for words its first anchor does not keep. */
      readonly wordsDropped?: true
    }
  | { readonly ok: false; readonly refusal: CommentRefusal }

const refuse = (refusal: CommentRefusal): { readonly ok: false; readonly refusal: CommentRefusal } => ({ ok: false, refusal })

/** `bytes[0:byteStart] + insert + bytes[byteEnd:]` – the one way both threads build the new file. */
export function assembleSplice(bytes: Uint8Array, splice: ByteSplice): Uint8Array {
  const { byteStart, byteEnd, insert } = splice
  const out = new Uint8Array(byteStart + insert.length + bytes.length - byteEnd)
  out.set(bytes.subarray(0, byteStart), 0)
  out.set(insert, byteStart)
  out.set(bytes.subarray(byteEnd), byteStart + insert.length)
  return out
}

/** True when `splice` names a range inside `length` bytes. */
export function isSpliceWithin(splice: ByteSplice, length: number): boolean {
  const { byteStart, byteEnd, insert } = splice
  return (
    Number.isSafeInteger(byteStart) &&
    Number.isSafeInteger(byteEnd) &&
    byteStart >= 0 &&
    byteStart <= byteEnd &&
    byteEnd <= length &&
    insert instanceof Uint8Array
  )
}

/** The own-lines tail after a new block (§5.2): one line break, then the target's indent. */
export const OWN_LINES_TAIL = /(?:\r\n|\r|\n)[ \t]*$/
/** A line-start slot's indent before the block (a Markdown list item 2 or later, a block in a quote): blanks only. */
export const LINE_START_INDENT = /^[ \t]+/

/**
 * Main's own check of the bytes a worker answer would put in the file
 * (security review S-L-C): nothing (a delete), or ONE comment that cannot end
 * early or open another (`isSafeCommentText`), optionally after a line-start
 * slot's indent (spaces and tabs) and followed by the own-lines tail. The worker serialized and verified the block, but it parses
 * hostile pages; checked here, a worker that answered wrong still cannot make
 * main write text that leaves the comment. Strict UTF-8, BOM kept: anything
 * else is not what the serializer writes.
 */
export function isSafeInsert(insert: Uint8Array): boolean {
  if (insert.length === 0) return true
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(insert)
  } catch {
    return false
  }
  return isSafeCommentText(text.replace(OWN_LINES_TAIL, '').replace(LINE_START_INDENT, ''))
}

function contextOf(act: WriteAct, random: RandomBytes | undefined): ThreadContext {
  // `CommentWriter` refuses an edit that writes an author before it gets here without one.
  return { author: act.author!, now: new Date(act.nowMs), random }
}

function fromPlan(result: PlanResult, threadId: string | null): Planned {
  return result.ok ? { ok: true, plans: [result.plan], threadId } : refuse(PLAN_REFUSALS[result.reason])
}

/** The element the draft's backup anchors name in a changed file, when exactly one matches. */
function relocate(doc: CommentDocument, anchor: CommentAnchor): IndexedElement | undefined {
  const found = findAnchorTarget(doc.index, anchor)
  return found.state === 'attached' ? doc.index.elementAt(found.startOffset) : undefined
}

function planAdd(request: Extract<WritePlanRequest, { op: 'add' }>, kind: CommentFileKind, doc: KindDocument, hash: string, context: () => ThreadContext): Planned {
  // A page draft names HTML offsets and anchors: only the HTML kind's document can take it.
  if (!isHtmlDocument(doc)) return refuse('invalid')
  const { draft } = request
  const el = hash === draft.fileHash ? doc.index.elementAt(draft.offset) : relocate(doc, draft.anchor)
  if (!el || el.tag !== draft.anchor.tag) return refuse('target-moved')
  // The stored anchor is rebuilt from the bytes being written; only `runtime` comes from the draft,
  // and its selected words (024-FR-004) only when these bytes still hold them once, in context.
  const sel = draft.anchor.runtime === undefined ? keptSelection(doc, el, draft.anchor.sel) : undefined
  const anchor = { ...buildDraftAnchor(doc.index, el, draft.anchor.runtime), ...(sel === undefined ? {} : { sel }) }
  const data = createThread({ anchor, view: request.view, text: request.text, context: context() })
  const planned = fromPlan(planInsert(doc, { targetStart: el.start, data, ws: draft.ws }, kind), data.id)
  const dropped = planned.ok && draft.anchor.sel !== undefined && sel === undefined
  return dropped ? { ...planned, wordsDropped: true } : planned
}

/**
 * `sel` when it is a valid `anchor.sel` found exactly once, in its context, in
 * `el`'s readable text in `doc` – collapsed as a selection reads it, the text
 * the window chose the words from (spec 024 024-FR-004). Else `undefined`: the
 * words are gone or now ambiguous, and the comment goes on the whole element.
 */
function keptSelection(doc: CommentDocument, el: IndexedElement, sel: unknown): TextQuote | undefined {
  if (!isAnchorSelection(sel)) return undefined
  const text = collapseRange(doc.index.visibleText.slice(el.textStart, el.textEnd), 0, 0).text
  return occurrencesInContext(text, sel).length === 1 ? { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } : undefined
}

/** True when `doc` is the HTML kind's document – the only one a page draft fits. */
function isHtmlDocument(doc: KindDocument): doc is CommentDocument {
  return 'tagSequence' in doc.index
}

/**
 * A `pick` (the renderer-hosted previews' add): the kind finds the target,
 * builds its anchor (with the selected words when valid) and offers its
 * slots; one plan per slot, in the kind's order, capped.
 */
function planPick(request: Extract<WritePlanRequest, { op: 'pick' }>, kind: CommentFileKind, doc: KindDocument, context: () => ThreadContext): Planned {
  const found = kind.locate(doc, request.pick)
  if (isKindRefusal(found)) return refuse(KIND_REFUSALS[found.refused])
  const shared = insertRefusal(doc)
  if (shared) return refuse(PLAN_REFUSALS[shared])
  const slots = kind.slots(doc, found, request.pick).slice(0, MAX_SLOTS_PER_SAVE)
  if (slots.length === 0) return refuse('target-moved')
  // One thread for every slot; only its anchor may differ by slot (a block before a whole list names the list).
  const first = createThread({ anchor: kind.anchorOf(doc, found, request.sel, slots[0]), view: request.view, text: request.text, context: context() })
  const plans: SplicePlan[] = []
  for (const slot of slots) {
    const data: CommentData = slot === slots[0] ? first : { ...first, anchor: kind.anchorOf(doc, found, request.sel, slot) }
    const planned = planSlotInsert(doc, slot, data, kind.refuseGrowth, kind)
    if (!planned.ok) return refuse(PLAN_REFUSALS[planned.reason])
    plans.push(planned.plan)
  }
  const dropped = request.sel !== undefined && first.anchor.sel === undefined
  return { ok: true, plans, threadId: first.id, slotted: true, ...(dropped ? { wordsDropped: true as const } : {}) }
}

/**
 * OD-05: rebuild a hand-damaged block from its own `@data`, offered only for
 * `readable-mismatch` and `id-mismatch` with valid data (`commentRebuild.ts`).
 * "Mark resolved" writes the status the readable line claims; the data is
 * otherwise exactly the block's.
 */
function planRebuildDamaged(request: Extract<WritePlanRequest, { op: 'rebuild' }>, kind: CommentFileKind, doc: KindDocument, context: () => ThreadContext): Planned {
  const damaged = doc.state.blocks.filter(b => b.kind === 'damaged' && b.rawHash === request.rawHash)
  const block = damaged.length === 1 ? damaged[0] : damaged.find(b => b.nodeRange[0] === request.start)
  if (block?.kind !== 'damaged') return refuse('block-changed')
  const own = rebuildDataOf(doc.text.slice(block.nodeRange[0], block.nodeRange[1]), block.reason)
  if (own === undefined) return refuse('block-changed')
  const data = request.status === 'resolved' && own.status !== 'resolved' ? setStatus(own, 'resolved', context()) : own
  return fromPlan(planRebuild(doc, { start: block.nodeRange[0], rawHash: request.rawHash, data }, kind.refuseGrowth, kind), data.id)
}

/** The thread after `change`: `null` removes the block, `undefined` means the message is gone. */
function changedData(data: CommentData, change: ThreadChange, act: WriteAct, context: () => ThreadContext): CommentData | null | undefined {
  switch (change.op) {
    case 'reply': {
      const replied = addReply(data, change.text, context())
      return change.resolve === true ? setStatus(replied, 'resolved', context()) : replied
    }
    case 'editMessage':
      return editMessage(data, change.messageId, change.text, new Date(act.nowMs))
    case 'deleteMessage':
      return deleteMessage(data, change.messageId)
    case 'setStatus':
      return setStatus(data, change.status, context())
    case 'deleteThread':
      return null
  }
}

function planThreadChange(request: Extract<WritePlanRequest, { op: 'thread' }>, kind: CommentFileKind, doc: KindDocument, act: WriteAct, context: () => ThreadContext): Planned {
  const { threadId, rawHash } = request
  const block = doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === threadId)
  if (block?.kind !== 'ok' || block.rawHash !== rawHash) return refuse('block-changed')
  // A full thread is worded on its own: "Start a new comment instead" (C-19).
  if (request.change.op === 'reply' && block.data.msgs.length > PREVIEW_LIMITS.COMMENT_MAX_REPLIES) return refuse('replies')
  const next = changedData(block.data, request.change, act, context)
  if (next === undefined) return refuse('block-changed')
  if (next === null) return fromPlan(planDelete(doc, { block: { id: threadId }, rawHash }), null)
  return fromPlan(planReplace(doc, { id: threadId, rawHash, data: next }, kind.refuseGrowth, kind), threadId)
}

function planDeleteDamaged(request: Extract<WritePlanRequest, { op: 'deleteBlock' }>, doc: KindDocument): Planned {
  const damaged = doc.state.blocks.filter(b => b.kind === 'damaged' && b.rawHash === request.rawHash)
  const block = damaged.length === 1 ? damaged[0] : damaged.find(b => b.nodeRange[0] === request.start)
  if (!block) return refuse('block-changed')
  return fromPlan(planDelete(doc, { block: { start: block.nodeRange[0] }, rawHash: request.rawHash }), null)
}

function planOf(job: WriteJob, kind: CommentFileKind, doc: KindDocument, hash: string, random: RandomBytes | undefined): Planned {
  const { request, act } = job
  const context = (): ThreadContext => contextOf(act, random)
  switch (request.op) {
    case 'add':
      return planAdd(request, kind, doc, hash, context)
    case 'pick':
      return planPick(request, kind, doc, context)
    case 'thread':
      return planThreadChange(request, kind, doc, act, context)
    case 'deleteBlock':
      return planDeleteDamaged(request, doc)
    case 'rebuild':
      return planRebuildDamaged(request, kind, doc, context)
  }
}

/** Plans made on the bytes read, with what verifying them needs – and no parse tree. */
type ReadyPlan =
  | (Extract<Planned, { ok: true }> & { readonly origin: KindOrigin; readonly hash: string })
  | { readonly ok: false; readonly refusal: CommentRefusal }

/** The file kind a write runs for, and how it reads the bytes afresh. */
export interface WriteKind {
  readonly kind: CommentFileKind
  /**
   * How `bytes` are read for planning; {@link freshKindDocumentOf} when absent. From the cache only for a kind
   * whose planning runs no budgeted lookup (module comment).
   */
  readonly read?: (bytes: Uint8Array) => JobDocument<KindDocument>
}

/**
 * §7.6 steps 3–6 on a fresh parse of `bytes`. Only the plans and the file's
 * origin are returned, so the parse tree is unreachable once this returns
 * (module comment).
 */
function planOnFreshParse(bytes: Uint8Array, job: WriteJob, writeKind: WriteKind, random: RandomBytes | undefined): ReadyPlan {
  const { kind } = writeKind
  const document = writeKind.read?.(bytes) ?? freshKindDocumentOf(bytes, kind)
  if (!document.ok) return refuse(document.refusal)
  const blocked = writableRefusal(document.doc.state)
  if (blocked) return refuse(blocked)
  const planned = planOf(job, kind, document.doc, document.hash, random)
  return planned.ok ? { ...planned, origin: kind.originOf(document.doc), hash: document.hash } : planned
}

type Spliced =
  | { readonly ok: true; readonly splice: ByteSplice; readonly out: Uint8Array; readonly doc: KindDocument }
  | { readonly ok: false; readonly refusal: CommentRefusal; readonly kindCheck?: true }

/**
 * §7.6 steps 7–8: the splice as bytes and the new file's parse, when every
 * check passes. `kindCheck`: only the kind's own check failed.
 */
function spliceVerified(bytes: Uint8Array, kind: CommentFileKind, origin: KindOrigin, plan: SplicePlan): Spliced {
  const byteStart = utf8Length(origin.text, 0, plan.start)
  const splice: ByteSplice = { byteStart, byteEnd: byteStart + utf8Length(origin.text, plan.start, plan.end), insert: encodeText(plan.insert) }
  const out = assembleSplice(bytes, splice)
  // Its own reason, so the window can say the file would grow past its size (C-19).
  if (out.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES) return refuse('file-size')
  const text = applySplice(origin.text, plan)
  const decoded = decodeLossless(out)
  if (!verifySpliceBytes(bytes, out, origin.text, plan) || !decoded.ok || decoded.text !== text) return refuse('verify-failed')
  const verified = verifyKindSplice(origin, text, plan, {
    parse: next => kind.parse(next, decoded.hasBom ? 1 : 0),
    verify: (from, doc, splicePlan) => kind.verify(from, doc, splicePlan)
  })
  if (verified.ok) return { ok: true, splice, out, doc: verified.doc }
  return SHARED_VERIFY_FAILURES.has(verified.reason) ? refuse('verify-failed') : { ok: false, refusal: 'verify-failed', kindCheck: true }
}

/**
 * The first plan that passes every check. For a `pick`, a plan that fails
 * only the kind's own check gives way to the next slot, and when every slot
 * failed that way the save is `render-changed`; any other failure refuses.
 */
function firstVerified(bytes: Uint8Array, kind: CommentFileKind, ready: Extract<ReadyPlan, { ok: true }>): Spliced {
  let last: Spliced = refuse('verify-failed')
  for (const plan of ready.plans) {
    last = spliceVerified(bytes, kind, ready.origin, plan)
    if (last.ok || ready.slotted !== true || last.kindCheck !== true) return last
  }
  return refuse('render-changed')
}

/** What a `write` job uses: its kind (how to read and check the file), the cache it fills, a random source. */
export interface WriteJobEnv extends WriteKind {
  readonly cache?: KindDocCache<KindDocument>
  readonly random?: RandomBytes
}

/** The `write` job on the bytes main read. `cache` receives the verified new file's parse. */
export function runWriteJob(bytes: Uint8Array, job: WriteJob, env: WriteJobEnv): WriteJobResult {
  const ready = planOnFreshParse(bytes, job, env, env.random)
  if (!ready.ok) return { kind: 'write', ok: false, refusal: ready.refusal }
  const spliced = firstVerified(bytes, env.kind, ready)
  if (!spliced.ok) return { kind: 'write', ok: false, refusal: spliced.refusal }
  const outputHash = sha256HexOf(spliced.out)
  env.cache?.set(outputHash, spliced.doc, spliced.out.length)
  const words = ready.wordsDropped === true ? { wordsDropped: true as const } : {}
  return { kind: 'write', ok: true, ...spliced.splice, inputHash: ready.hash, outputHash, threadId: ready.threadId, ...words }
}
