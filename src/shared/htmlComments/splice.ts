// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Splice plans in HTML files: where a new block goes, and the HTML-only
 * checks around the shared splice (docs/designs/comments/html-preview-comments.md
 * decision 24, §5.2, §5.6, §7.6 steps 6–8, §19 R3-8; spec 024 architecture
 * note 001 § 1 `splice`, § 8 C10).
 *
 * The plans themselves, their bytes and the shared checks are in
 * `../comments/splice.ts` and re-exported here, so this module stays the HTML
 * entry for splices.
 *
 * PLACEMENT (final rule, R3-8). A new block goes directly before the target's
 * start tag – after any blocks already there – in one of two forms of the
 * `before-target` shape:
 *
 * - own lines – `<!-- … -->` + EOL + indent, so the block is indented like the
 *   target and the target line is byte-identical in `git diff` – only when
 *   ALL hold: the start tag is the first non-blank on its line, the target has
 *   no `pre`/`textarea`/`listing`/`plaintext` ancestor, and the pick reported
 *   the parent's computed `white-space-collapse` as `collapse` (`ws`);
 * - mid-line – `<!-- … -->` only, `-->` directly followed by the target's `<`
 *   – in every other case, including a missing `ws` (an edit, a re-anchor).
 *
 * Spike S7: own-lines placement changed rendering in 12 of 67 cases without
 * the `ws` check (CSS `white-space: pre*`, SVG `xml:space`), 0 with it.
 *
 * OTHER TOOLS' COMMENTS (spec 024 024-FR-023; `htmlForeign.ts`). The block
 * goes before a directive run of other tools' comments right before the
 * target (`<!-- prettier-ignore -->`), never between a directive and its
 * element; with none there the slot is the start tag, as before. A target
 * inside a generated START/END region is refused (`generated-region`).
 */
import { CHARSET_PRESCAN_BYTES, utf8Length } from '../comments/encoding'
import type { CommentData } from '../comments/format'
import type { BlockNote, KindVerifyResult, Slot } from '../comments/fileKind'
import {
  insertRefusal,
  lineLayoutAt,
  planReplace as planSharedReplace,
  planSlotInsert,
  sharedOriginOf,
  verifyKindSplice,
  type GrowthCheck,
  type PlanResult,
  type ReplaceRequest,
  type SpliceOrigin as SharedSpliceOrigin,
  type SplicePlan,
  type SpliceVerifyResult
} from '../comments/splice'
import { directiveRunStart, inHtmlGeneratedRegion } from './htmlForeign'
import type { IndexedElement } from './htmlIndex'
import { analyzeCommentDocument, type CommentDocument } from './parse'

export {
  applySplice,
  lineLayoutAt,
  planDelete,
  spliceBytes,
  verifySplice,
  verifySpliceBytes,
  type DeleteRequest,
  type LineLayout,
  type Placement,
  type PlanFailure,
  type PlanResult,
  type ReplaceRequest,
  type SpliceOp,
  type SplicePlan,
  type VerifyFailure
} from '../comments/splice'
export { inHtmlGeneratedRegion } from './htmlForeign'

/** Add a block before the eligible element whose start tag begins at `targetStart`. */
export interface InsertRequest {
  readonly targetStart: number
  readonly data: CommentData
  /** The pick's computed `white-space-collapse` of the target's parent (R3-8); missing → mid-line. */
  readonly ws?: string
}

/** A `<meta …charset…>` start, for the prescan check. Run on a 1,024-character head only. */
const META_CHARSET_TAG = /<meta\b[^>]*?charset/gi

/**
 * True when putting `insert` in place of `text[start:end]` pushes a
 * `<meta charset>` that now ends inside the browser's 1,024-byte prescan past
 * it. An insert is the empty range; an edit grows a block in place (a reply,
 * a resolve), so it can push one just as far (review finding L2). A change that
 * does not grow the file moves nothing later, and a match inside the replaced
 * range is the old block's own text, not a tag.
 */
function pushesMetaCharset(text: string, range: readonly [number, number], insert: string): boolean {
  const [start, end] = range
  const growth = utf8Length(insert) - utf8Length(text, start, end)
  if (growth <= 0) return false
  for (const match of text.slice(0, CHARSET_PRESCAN_BYTES).matchAll(META_CHARSET_TAG)) {
    if (match.index < end) continue
    const close = text.indexOf('>', match.index)
    const endByte = utf8Length(text, 0, close < 0 ? text.length : close + 1)
    if (endByte <= CHARSET_PRESCAN_BYTES && endByte + growth > CHARSET_PRESCAN_BYTES) {
      return true
    }
  }
  return false
}

/** HTML's own refusal of a grown file: a `<meta charset>` pushed out of the prescan (§5.6). */
export const htmlGrowthCheck: GrowthCheck = (text, range, insert) =>
  pushesMetaCharset(text, range, insert) ? 'meta-charset' : undefined

/**
 * The one slot of an eligible element: right before its start tag – or before
 * the directive run of other tools' comments in front of it (024-FR-023) – on
 * its own lines or mid-line (R3-8).
 */
export function htmlSlotOf(doc: CommentDocument, el: IndexedElement, ws: string | undefined): Slot {
  const offset = directiveRunStart(doc.index, el) ?? el.start
  const layout = lineLayoutAt(doc.text, offset, doc.index.bomLength)
  const ownLines = layout.atLineStart && !el.preformatted && ws === 'collapse'
  return {
    offset,
    shape: 'before-target',
    indent: layout.indent,
    placement: ownLines ? 'own-lines' : 'mid-line'
  }
}

/**
 * Plan a new block before an eligible element (§5.2, §5.6, R3-8), or refuse
 * one inside a generated region (024-FR-023).
 *
 * @param note - The kind whose agent note and hints the block carries
 *   (`htmlKind`); absent: the v0.23.1 note, as the writer byte pins expect.
 */
export function planInsert(doc: CommentDocument, request: InsertRequest, note?: BlockNote): PlanResult {
  const refused = insertRefusal(doc)
  if (refused) return { ok: false, reason: refused }
  const el = doc.index.elementAt(request.targetStart)
  if (!el) return { ok: false, reason: 'not-eligible' }
  if (inHtmlGeneratedRegion(doc.index, el)) return { ok: false, reason: 'generated-region' }
  return planSlotInsert(doc, htmlSlotOf(doc, el, request.ws), request.data, htmlGrowthCheck, note)
}

/**
 * Plan an edit of one `ok` block (reply, edit, resolve, …). Only the comment
 * node is replaced; the line break and indent after it stay as they are, so a
 * later delete still restores the original bytes (U-053).
 *
 * @param note - The kind whose agent note and hints the rewritten block
 *   carries, rebuilt from `request.data`; absent: the v0.23.1 note.
 */
export function planReplace(doc: CommentDocument, request: ReplaceRequest, note?: BlockNote): PlanResult {
  return planSharedReplace(doc, request, htmlGrowthCheck, note)
}

/**
 * What {@link verifyCommentSplice} needs of the document a splice was planned
 * on: the shared counts, and the tag of every element in tree order
 * ({@link CommentDocument.index}'s `tagSequence`). It holds no parse tree.
 */
export interface SpliceOrigin extends SharedSpliceOrigin {
  readonly tagSequence: readonly string[]
}

/** The {@link SpliceOrigin} of a parsed document. */
export function spliceOriginOf(doc: CommentDocument): SpliceOrigin {
  return { ...sharedOriginOf(doc), tagSequence: doc.index.tagSequence }
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

/** HTML's own pre-write check: exactly the same elements in the same order, so no text escaped a comment (S13). */
export function verifyHtmlElements(origin: SpliceOrigin, doc: CommentDocument): KindVerifyResult {
  return sameTags(origin.tagSequence, doc.index.tagSequence) ? { ok: true } : { ok: false, reason: 'elements' }
}

/** The result of {@link verifyCommentSplice}. */
export type VerifyResult = SpliceVerifyResult<CommentDocument>

/**
 * The post-splice check of §7.6 step 8, run on the new text before anything
 * is written: the shared checks of `verifyKindSplice`, with HTML's element
 * check between the counts and the read-back. Any failure: fail closed.
 *
 * @param old - The document the plan was made on, or its {@link SpliceOrigin}
 *   when the caller has already let its parse tree go.
 */
export function verifyCommentSplice(
  old: CommentDocument | SpliceOrigin,
  newText: string,
  plan: SplicePlan
): VerifyResult {
  const origin = 'tagSequence' in old ? old : spliceOriginOf(old)
  return verifyKindSplice(origin, newText, plan, {
    parse: analyzeCommentDocument,
    verify: verifyHtmlElements
  })
}
