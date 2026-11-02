// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Several block changes in one write (spec 024 024-FR-028, plan step 13).
 *
 * Plans made on ONE parse of a file are composed into a single range, from the
 * first change to the last, so the kind's own checks read them as they read
 * one splice: the growth check sees the whole growth, and the render check
 * compares what lies outside the range. Text between two changes sits inside
 * the composed range but is copied from the file, so {@link verifyPlans}
 * compares it through the text the plans make. Only one parse of the new text
 * runs, however many blocks change: a parse per block would cost minutes at
 * 500 comments in a 25 MB page.
 */
import type { KindDocument, KindVerifyResult } from './fileKind'
import { applySplice, writtenBlockStart, type SpliceOrigin, type SplicePlan, type SpliceVerifyResult } from './splice'

/** The plans in file order, and the one range they make. */
export interface ComposedPlans {
  readonly ok: true
  readonly plans: readonly SplicePlan[]
  /** From the first change to the last; `insert` holds the unchanged text between them. */
  readonly plan: SplicePlan
}

/**
 * One plan from many.
 *
 * @param text - The text every plan was made on.
 * @param plans - The plans, in any order.
 * @returns The composed plan, or `{ ok: false }` for no plans or overlapping ranges.
 */
export function composePlans(text: string, plans: readonly SplicePlan[]): ComposedPlans | { readonly ok: false } {
  const inOrder = [...plans].sort((a, b) => a.start - b.start)
  if (inOrder.length === 0) return { ok: false }
  const parts: string[] = []
  let at = inOrder[0].start
  for (const plan of inOrder) {
    if (plan.start < at) return { ok: false }
    parts.push(text.slice(at, plan.start), plan.insert)
    at = plan.end
  }
  return { ok: true, plans: inOrder, plan: { op: 'replace', start: inOrder[0].start, end: at, insert: parts.join('') } }
}

/** What {@link verifyPlans} asks of the kind. */
interface ManyVerifier<D extends KindDocument, O extends SpliceOrigin> {
  parse(text: string): D
  verify(origin: O, doc: D, plan: SplicePlan): KindVerifyResult
}

/** True when every written block of `plans` reads back with its data, at the place the changes before it shift it to. */
function writtenBlocksRead(doc: KindDocument, plans: readonly SplicePlan[]): boolean {
  const byStart = new Map(doc.state.blocks.map(block => [block.nodeRange[0], block]))
  let shift = 0
  for (const plan of plans) {
    if (plan.data !== undefined) {
      const written = byStart.get(writtenBlockStart(plan) + shift)
      if (written?.kind !== 'ok' || JSON.stringify(written.data) !== JSON.stringify(plan.data)) return false
    }
    shift += plan.insert.length - (plan.end - plan.start)
  }
  return true
}

/**
 * The post-splice check of `verifyKindSplice`, for many plans: the new text is
 * the plans applied and nothing else, every delete took exactly one block and
 * one comment node, the kind's own check passes on the composed range, and
 * each written block reads back. Any failure: fail closed.
 *
 * @param origin - The document the plans were made on, without its parse tree.
 * @param newText - The text the write would leave.
 * @param composed - {@link composePlans}' answer.
 * @param kind - The kind's parse and its own check.
 * @returns The new document, or why the write must not happen.
 */
export function verifyPlans<D extends KindDocument, O extends SpliceOrigin>(
  origin: O,
  newText: string,
  composed: ComposedPlans,
  kind: ManyVerifier<D, O>
): SpliceVerifyResult<D> {
  if (newText !== applySplice(origin.text, composed.plan)) return { ok: false, reason: 'bytes' }
  const doc = kind.parse(newText)
  const removed = composed.plans.filter(plan => plan.op === 'delete').length
  if (doc.state.blocks.length !== origin.blockCount - removed) return { ok: false, reason: 'block-count' }
  if (doc.index.comments.length !== origin.commentCount - removed) return { ok: false, reason: 'comment-count' }
  const own = kind.verify(origin, doc, composed.plan)
  if (!own.ok) return own
  return writtenBlocksRead(doc, composed.plans) ? { ok: true, doc } : { ok: false, reason: 'block-data' }
}
