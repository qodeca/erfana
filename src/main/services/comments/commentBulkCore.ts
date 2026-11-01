// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The parse half of a bulk write (spec 024 024-FR-028, plan step 13): resolve
 * or delete several threads of one file in ONE splice-set and one write.
 *
 * Runs in the comment parse worker as the `bulkWrite` job, beside the `write`
 * job, with the same rules (`commentWriteCore.ts`): a fresh parse of the bytes
 * main read, every thread named by its id and the hash of the block the person
 * reviewed, and the verified answer as byte ranges main rebuilds the file from.
 *
 * All or nothing: one thread that moved on since the review – its bytes
 * changed, it is gone, or it is no longer in the status the action starts from
 * – refuses the whole file as `block-changed`, so a reviewed list is never
 * partly applied and an open comment is never deleted in bulk.
 */
import { decodeLossless, encodeText, setStatus, utf8Length, type RandomBytes, type SplicePlan, type ThreadContext } from '../../../shared/htmlComments'
import type { KindDocument, KindOrigin } from '../../../shared/comments/fileKind'
import { planDelete, planReplace, type PlanResult } from '../../../shared/comments/splice'
import { composePlans, verifyPlans, type ComposedPlans } from '../../../shared/comments/spliceMany'
import { freshKindDocumentOf, sha256HexOf, writableRefusal } from './commentJobDocs'
import type { CommentRefusal } from './commentRefusals'
import { isSpliceWithin, PLAN_REFUSALS, type ByteSplice, type WriteAct, type WriteJobEnv } from './commentWriteCore'

/** What a bulk action does: its one change, and the status its threads must hold. */
export type BulkChange = 'resolve' | 'deleteResolved'

/** One thread of a bulk write, as the person reviewed it. */
export interface BulkThread {
  readonly threadId: string
  readonly rawHash: string
}

/** The edit, as plain data that crosses to the worker. */
export interface BulkPlanRequest {
  readonly change: BulkChange
  readonly threads: readonly BulkThread[]
}

/** Plan and verify one bulk write against the bytes main read. */
export interface BulkWriteJob {
  readonly kind: 'bulkWrite'
  readonly request: BulkPlanRequest
  readonly act: WriteAct
}

/** The verified splices, in file order, or why nothing may be written. */
export type BulkWriteJobResult =
  | {
      readonly kind: 'bulkWrite'
      readonly ok: true
      readonly splices: readonly ByteSplice[]
      /** SHA-256 (hex) of the bytes read: the strict write's compare-and-swap. */
      readonly inputHash: string
      /** SHA-256 (hex) of the file after the splices: the own-write echo filter. */
      readonly outputHash: string
    }
  | { readonly kind: 'bulkWrite'; readonly ok: false; readonly refusal: CommentRefusal }

/**
 * `splices`, in file order and apart, applied to `bytes`: the many-splice form
 * of {@link assembleSplice}, every byte outside them copied from `bytes`.
 */
export function assembleSplices(bytes: Uint8Array, splices: readonly ByteSplice[]): Uint8Array {
  const size = splices.reduce((total, splice) => total + splice.insert.length - (splice.byteEnd - splice.byteStart), bytes.length)
  const out = new Uint8Array(size)
  let readAt = 0
  let writeAt = 0
  for (const { byteStart, byteEnd, insert } of splices) {
    out.set(bytes.subarray(readAt, byteStart), writeAt)
    writeAt += byteStart - readAt
    out.set(insert, writeAt)
    writeAt += insert.length
    readAt = byteEnd
  }
  out.set(bytes.subarray(readAt), writeAt)
  return out
}

/** True when `splices` are each inside `length` bytes, in file order, and apart. */
export function areSplicesInOrder(splices: readonly ByteSplice[], length: number): boolean {
  let at = 0
  for (const splice of splices) {
    if (!isSpliceWithin(splice, length) || splice.byteStart < at) return false
    at = splice.byteEnd
  }
  return splices.length > 0
}

const STARTS_FROM: Readonly<Record<BulkChange, 'open' | 'resolved'>> = { resolve: 'open', deleteResolved: 'resolved' }

const refuse = (refusal: CommentRefusal): BulkWriteJobResult => ({ kind: 'bulkWrite', ok: false, refusal })

function planOne(doc: KindDocument, env: WriteJobEnv, job: BulkWriteJob, thread: BulkThread, random: RandomBytes | undefined): PlanResult | CommentRefusal {
  const { threadId, rawHash } = thread
  const block = doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === threadId)
  if (block?.kind !== 'ok' || block.rawHash !== rawHash || block.data.status !== STARTS_FROM[job.request.change]) return 'block-changed'
  if (job.request.change === 'deleteResolved') return planDelete(doc, { block: { id: threadId }, rawHash })
  // `CommentWriter` refuses a resolve without an author before it gets here.
  const context: ThreadContext = { author: job.act.author!, now: new Date(job.act.nowMs), random }
  return planReplace(doc, { id: threadId, rawHash, data: setStatus(block.data, 'resolved', context) }, env.kind.refuseGrowth, env.kind)
}

type ReadyBulk =
  | { readonly ok: true; readonly composed: ComposedPlans; readonly origin: KindOrigin; readonly hash: string }
  | { readonly ok: false; readonly refusal: CommentRefusal }

/** Every plan on one fresh parse. Only plans and the origin leave, so the parse tree can go before the new text is parsed. */
function planOnFreshParse(bytes: Uint8Array, job: BulkWriteJob, env: WriteJobEnv): ReadyBulk {
  const document = env.read?.(bytes) ?? freshKindDocumentOf(bytes, env.kind)
  if (!document.ok) return document
  const { doc } = document
  const blocked = writableRefusal(doc.state)
  if (blocked) return { ok: false, refusal: blocked }
  const plans: SplicePlan[] = []
  for (const thread of job.request.threads) {
    const planned = planOne(doc, env, job, thread, env.random)
    if (typeof planned === 'string') return { ok: false, refusal: planned }
    if (!planned.ok) return { ok: false, refusal: PLAN_REFUSALS[planned.reason] }
    plans.push(planned.plan)
  }
  const composed = composePlans(doc.text, plans)
  if (!composed.ok) return { ok: false, refusal: 'invalid' }
  // Each plan passed the growth check alone; together they may not (a `<meta charset>` pushed out of the prescan).
  const { plan } = composed
  const grown = env.kind.refuseGrowth?.(doc.text, [plan.start, plan.end], plan.insert)
  if (grown) return { ok: false, refusal: PLAN_REFUSALS[grown] }
  return { ok: true, composed, origin: env.kind.originOf(doc), hash: document.hash }
}

/** The plans as byte ranges of `text`'s UTF-8, each measured from the last so 500 blocks in 25 MB stay linear. */
function byteSplicesOf(text: string, plans: readonly SplicePlan[]): ByteSplice[] {
  const splices: ByteSplice[] = []
  let textAt = 0
  let byteAt = 0
  for (const plan of plans) {
    const byteStart = byteAt + utf8Length(text, textAt, plan.start)
    const byteEnd = byteStart + utf8Length(text, plan.start, plan.end)
    splices.push({ byteStart, byteEnd, insert: encodeText(plan.insert) })
    textAt = plan.end
    byteAt = byteEnd
  }
  return splices
}

/** The `bulkWrite` job on the bytes main read; the verified result goes into `env.cache`. */
export function runBulkWriteJob(bytes: Uint8Array, job: BulkWriteJob, env: WriteJobEnv): BulkWriteJobResult {
  const ready = planOnFreshParse(bytes, job, env)
  if (!ready.ok) return refuse(ready.refusal)
  const { composed, origin, hash } = ready
  const splices = byteSplicesOf(origin.text, composed.plans)
  const out = assembleSplices(bytes, splices)
  const decoded = decodeLossless(out)
  if (!decoded.ok) return refuse('verify-failed')
  const verified = verifyPlans(origin, decoded.text, composed, {
    parse: next => env.kind.parse(next, decoded.hasBom ? 1 : 0),
    verify: (from, doc, plan) => env.kind.verify(from, doc, plan)
  })
  if (!verified.ok) return refuse(verified.reason === 'render-changed' ? 'render-changed' : 'verify-failed')
  const outputHash = sha256HexOf(out)
  env.cache?.set(outputHash, verified.doc, out.length)
  return { kind: 'bulkWrite', ok: true, splices, inputHash: hash, outputHash }
}
