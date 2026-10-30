// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Splice plans: add, edit and delete one block so that every other byte of
 * the file stays identical, whatever kind of file holds it
 * (docs/designs/comments/html-preview-comments.md decision 24, §5.2, §7.6
 * steps 6–8; spec 024 architecture note 001 § 1 `splice`, § 5, § 8 C2, C10).
 *
 * A plan is `{start, end, insert}` on the decoded text; applying it is
 * `text[0:start] + insert + text[end:]` and nothing else. `spliceBytes` applies
 * the same plan to the original BYTES by copying the untouched prefix and
 * suffix verbatim, so line endings, a BOM and every other byte outside the
 * block are preserved by construction, and `verifySpliceBytes` re-checks it
 * independently.
 *
 * WHERE a new block goes is the file kind's choice (a {@link Slot}); this
 * module turns a slot into the exact bytes of its shape:
 *
 * - `before-target`, own lines – `block + eol + indent` (HTML, as shipped);
 * - `before-target`, mid-line – `block` alone (HTML, as shipped);
 * - `line-start` – `indent + block + eol` at a line start (Markdown).
 *
 * Either way the inserted text is the block's removable range (`blocks.ts`),
 * so `delete(add(f)) === f`. Nothing is ever written into a read-only file,
 * and a damaged or newer block is never rewritten. A kind may refuse a change
 * for its own reason (HTML: a `<meta charset>` pushed out of the prescan)
 * through a {@link GrowthCheck}, and adds its own pre-write check to
 * {@link verifyKindSplice} (HTML: the same elements in the same order).
 */
import { PREVIEW_LIMITS } from '../preview-limits'
import type { FileCommentState, ParsedBlock, SpliceShape } from './blocks'
import { encodeText, utf8Length } from './encoding'
import { serializeBlock, type BlockLayout, type CommentData, type Eol, type SerializeFailure } from './format'
import type { KindDocument, KindVerifyResult, Slot } from './fileKind'

/** What a plan does to the file. */
export type SpliceOp = 'insert' | 'replace' | 'delete'

/** The two forms of a `before-target` block (§5.2). */
export type Placement = 'own-lines' | 'mid-line'

/** One contiguous change to the decoded text. */
export interface SplicePlan {
  readonly op: SpliceOp
  readonly start: number
  readonly end: number
  readonly insert: string
  /** How an inserted block sits in the file (C2); set on every insert. */
  readonly shape?: SpliceShape
  /** How a `before-target` block was placed. */
  readonly placement?: Placement
  /** What the written block must read back as (insert and replace). */
  readonly data?: CommentData
}

/** Why no plan could be made. Nothing is written in any of these cases. */
export type PlanFailure =
  /** The file is read-only for comments (`state.readOnlyReason`). */
  | 'read-only'
  /** No eligible target starts at the requested offset (§5.6). */
  | 'not-eligible'
  /** No block with that id or start offset. */
  | 'not-found'
  /** The block is damaged or newer, so it is never rewritten (decision 12, 22). */
  | 'not-editable'
  /** The block's bytes changed since the caller read them (compare-and-swap, U-061). */
  | 'stale'
  /** HTML: the block would push a `<meta charset>` out of the browser's 1,024-byte prescan (§5.6). */
  | 'meta-charset'
  | SerializeFailure

export type PlanResult =
  | { readonly ok: true; readonly plan: SplicePlan }
  | { readonly ok: false; readonly reason: PlanFailure }

/** What a plan reads of a parsed file. */
export interface SpliceDocument {
  readonly text: string
  readonly state: FileCommentState
}

/** Rewrite the `ok` block `id`, whose node hashed to `rawHash` when it was read. */
export interface ReplaceRequest {
  readonly id: string
  readonly rawHash: string
  readonly data: CommentData
}

/** Remove a block, chosen by thread id or by its node's start offset (damaged blocks). */
export interface DeleteRequest {
  readonly block: { readonly id: string } | { readonly start: number }
  readonly rawHash: string
}

/** Where a start tag sits on its line, and the line's indent and line break (§5.2). */
export interface LineLayout extends BlockLayout {
  readonly atLineStart: boolean
}

/**
 * A kind's own reason to refuse putting `insert` in place of
 * `text[range[0]:range[1]]`, or `undefined` to allow it. Runs on every
 * insert and replace, after the block serialized.
 */
export type GrowthCheck = (
  text: string,
  range: readonly [number, number],
  insert: string
) => PlanFailure | undefined

function fail(reason: PlanFailure): PlanResult {
  return { ok: false, reason }
}

/** The first line break at or after `from`, or `undefined`. */
function eolFrom(text: string, from: number): Eol | undefined {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '\n') return '\n'
    if (text[i] === '\r') return text[i + 1] === '\n' ? '\r\n' : '\r'
  }
  return undefined
}

/**
 * The line break a block inserted at `offset` uses: the line's own, else the
 * file's first, else LF (§5.2 grammar, `EOL`).
 */
export function eolAt(text: string, offset: number): Eol {
  return eolFrom(text, offset) ?? eolFrom(text, 0) ?? '\n'
}

/**
 * The layout of the line holding `offset`: its leading blanks, whether only
 * blanks precede `offset` on it, and its own line break – else the file's
 * first line break, else LF (§5.2 grammar, `EOL` and `ind`).
 */
export function lineLayoutAt(text: string, offset: number, bomLength = 0): LineLayout {
  let lineStart = offset
  while (lineStart > bomLength && text[lineStart - 1] !== '\n' && text[lineStart - 1] !== '\r') {
    lineStart -= 1
  }
  let blanksEnd = lineStart
  while (blanksEnd < offset && (text[blanksEnd] === ' ' || text[blanksEnd] === '\t')) blanksEnd += 1
  return {
    indent: text.slice(lineStart, blanksEnd),
    atLineStart: blanksEnd === offset,
    eol: eolAt(text, offset)
  }
}

/**
 * The shared refusals of a new block, before the kind is asked where it goes:
 * the file is read-only, or already holds `COMMENT_MAX_BLOCKS_PER_FILE` blocks.
 */
export function insertRefusal(doc: SpliceDocument): PlanFailure | undefined {
  if (!doc.state.writable) return 'read-only'
  if (doc.state.blocks.length >= PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE) return 'limit'
  return undefined
}

/** The exact text a slot's shape inserts around a serialized block. */
function insertTextOf(slot: Slot, block: string, eol: Eol): string {
  if (slot.shape === 'line-start') return slot.indent + block + eol
  return slot.placement === 'own-lines' ? block + eol + slot.indent : block
}

/**
 * Plan a new block at the slot the kind chose. The caller has run
 * {@link insertRefusal} and the kind's own target checks first.
 *
 * @param check - The kind's own refusal of the grown file, if it has one.
 */
export function planSlotInsert(
  doc: SpliceDocument,
  slot: Slot,
  data: CommentData,
  check?: GrowthCheck
): PlanResult {
  const eol = eolAt(doc.text, slot.offset)
  const serialized = serializeBlock(data, { indent: slot.indent, eol })
  if (!serialized.ok) return fail(serialized.reason)
  const insert = insertTextOf(slot, serialized.block, eol)
  const refused = check?.(doc.text, [slot.offset, slot.offset], insert)
  if (refused) return fail(refused)
  const { offset } = slot
  const placed = slot.shape === 'before-target' ? { placement: slot.placement } : {}
  return {
    ok: true,
    plan: { op: 'insert', start: offset, end: offset, insert, shape: slot.shape, ...placed, data }
  }
}

function findBlock(
  state: FileCommentState,
  selector: DeleteRequest['block']
): ParsedBlock | undefined {
  if ('start' in selector) return state.blocks.find(block => block.nodeRange[0] === selector.start)
  return (
    state.blocks.find(block => block.kind === 'ok' && block.data.id === selector.id) ??
    state.blocks.find(block => block.kind === 'damaged' && block.headerId === selector.id)
  )
}

/** A block's own indent (its second line's blanks) and line break (its first). */
function blockLayout(text: string, block: ParsedBlock): BlockLayout {
  const raw = text.slice(block.nodeRange[0], block.nodeRange[1])
  // An `ok` block has a header, readable and `@data` lines, so it holds a line break.
  const eol = eolFrom(raw, 0)!
  const second = raw.slice(raw.indexOf(eol) + eol.length)
  return { indent: /^[ \t]*/.exec(second)![0], eol }
}

/**
 * Plan an edit of one `ok` block (reply, edit, resolve, …). Only the comment
 * node is replaced; the whitespace and line break around it stay as they
 * are, so a later delete still restores the original bytes (U-053).
 *
 * @param check - The kind's own refusal of the grown file, if it has one.
 */
export function planReplace(
  doc: SpliceDocument,
  request: ReplaceRequest,
  check?: GrowthCheck
): PlanResult {
  if (!doc.state.writable) return fail('read-only')
  const block = findBlock(doc.state, { id: request.id })
  if (!block) return fail('not-found')
  if (block.kind !== 'ok') return fail('not-editable')
  if (block.rawHash !== request.rawHash) return fail('stale')
  if (request.data.id !== request.id) return fail('invalid')
  const serialized = serializeBlock(request.data, blockLayout(doc.text, block))
  if (!serialized.ok) return fail(serialized.reason)
  const refused = check?.(doc.text, block.nodeRange, serialized.block)
  if (refused) return fail(refused)
  const [start, end] = block.nodeRange
  return {
    ok: true,
    plan: { op: 'replace', start, end, insert: serialized.block, data: request.data }
  }
}

/**
 * Plan the removal of one block: an `ok` block, or a damaged one whose bytes
 * still match (§7.6 step 6, "Delete block"). The range is the block's
 * removable range, which its kind's insert shape decided (`blocks.ts`). A
 * newer block is never removed; an unterminated one never reaches here,
 * because it makes the file read-only.
 */
export function planDelete(doc: SpliceDocument, request: DeleteRequest): PlanResult {
  if (!doc.state.writable) return fail('read-only')
  const block = findBlock(doc.state, request.block)
  if (!block) return fail('not-found')
  if (block.kind === 'newer') return fail('not-editable')
  if (block.rawHash !== request.rawHash) return fail('stale')
  const [start, end] = block.range
  return { ok: true, plan: { op: 'delete', start, end, insert: '' } }
}

// ---------------------------------------------------------------------------
// Applying and verifying
// ---------------------------------------------------------------------------

/** `text[0:start] + insert + text[end:]`. */
export function applySplice(text: string, plan: SplicePlan): string {
  return text.slice(0, plan.start) + plan.insert + text.slice(plan.end)
}

/** True when `newText` is exactly `oldText` with `plan` applied, character for character. */
export function verifySplice(oldText: string, newText: string, plan: SplicePlan): boolean {
  return (
    newText.length === oldText.length - (plan.end - plan.start) + plan.insert.length &&
    newText.startsWith(oldText.slice(0, plan.start)) &&
    newText.startsWith(plan.insert, plan.start) &&
    newText.endsWith(oldText.slice(plan.end))
  )
}

/** Byte offsets of a plan's range in the UTF-8 encoding of `text`. */
function byteRange(text: string, plan: SplicePlan): [number, number] {
  const start = utf8Length(text, 0, plan.start)
  return [start, start + utf8Length(text, plan.start, plan.end)]
}

/**
 * Apply `plan` to the file's original bytes. `oldText` must be the lossless
 * decoding of `oldBytes` (`decodeLossless`). The prefix and suffix are copied
 * byte for byte; only the inserted text is encoded.
 */
export function spliceBytes(oldBytes: Uint8Array, oldText: string, plan: SplicePlan): Uint8Array {
  const [startByte, endByte] = byteRange(oldText, plan)
  const insert = encodeText(plan.insert)
  const out = new Uint8Array(startByte + insert.length + oldBytes.length - endByte)
  out.set(oldBytes.subarray(0, startByte), 0)
  out.set(insert, startByte)
  out.set(oldBytes.subarray(endByte), startByte + insert.length)
  return out
}

function bytesEqualAt(
  a: Uint8Array,
  aStart: number,
  b: Uint8Array,
  bStart: number,
  length: number
): boolean {
  for (let i = 0; i < length; i += 1) if (a[aStart + i] !== b[bStart + i]) return false
  return true
}

/** True when `newBytes` equals `oldBytes` outside the plan's range and holds exactly the inserted text inside it. */
export function verifySpliceBytes(
  oldBytes: Uint8Array,
  newBytes: Uint8Array,
  oldText: string,
  plan: SplicePlan
): boolean {
  const [startByte, endByte] = byteRange(oldText, plan)
  const insert = encodeText(plan.insert)
  const suffixLength = oldBytes.length - endByte
  return (
    newBytes.length === startByte + insert.length + suffixLength &&
    bytesEqualAt(newBytes, 0, oldBytes, 0, startByte) &&
    bytesEqualAt(newBytes, startByte, insert, 0, insert.length) &&
    bytesEqualAt(newBytes, startByte + insert.length, oldBytes, endByte, suffixLength)
  )
}

/** What a kind's own pre-write check can fail on (HTML: the elements changed). */
export type KindVerifyFailure = 'elements'

/** Why a spliced file failed its verification; the write must not happen. */
export type VerifyFailure = 'bytes' | 'block-count' | 'comment-count' | KindVerifyFailure | 'block-data'

/** The result of {@link verifyKindSplice}: the verified new document, or why it failed. */
export type SpliceVerifyResult<D extends KindDocument = KindDocument> =
  | { readonly ok: true; readonly doc: D }
  | { readonly ok: false; readonly reason: VerifyFailure }

const BLOCK_DELTA: Readonly<Record<SpliceOp, number>> = { insert: 1, replace: 0, delete: -1 }

/**
 * What the shared checks of {@link verifyKindSplice} need of the document a
 * splice was planned on. It holds no parse tree, so a caller can let that tree
 * go before the new text is parsed: a dense 25 MB page's tree is most of a
 * gigabyte, and two of them alive at once would double the parse worker's
 * peak (§19 Rev 4). A kind adds what its own check needs.
 */
export interface SpliceOrigin {
  readonly text: string
  readonly blockCount: number
  readonly commentCount: number
}

/** The shared part of a document's {@link SpliceOrigin}. */
export function sharedOriginOf(doc: KindDocument): SpliceOrigin {
  return { text: doc.text, blockCount: doc.state.blocks.length, commentCount: doc.index.comments.length }
}

/**
 * Where the written block's `<!--` is in the new text (C2): a `line-start`
 * insert writes its indent first; every other plan starts with the node.
 */
export function writtenBlockStart(plan: SplicePlan): number {
  if (plan.shape !== 'line-start') return plan.start
  let at = 0
  while (plan.insert[at] === ' ') at += 1
  return plan.start + at
}

/** The parse and the own check of the kind a splice is verified for. */
export interface SpliceVerifier<D extends KindDocument, O extends SpliceOrigin> {
  /** Parse the new text the way the kind parses its files. */
  parse(text: string): D
  /** The kind's own pre-write check of the parsed new text against the origin. */
  verify(origin: O, doc: D, plan: SplicePlan): KindVerifyResult
}

/**
 * The post-splice check of §7.6 step 8 (C10), run on the new text before
 * anything is written: the text is the plan applied and nothing else; the
 * file has exactly one block (and one comment node) more, the same, or one
 * fewer; the kind's own check passes (HTML: the same elements in the same
 * order, so no text escaped a comment – threat S13); and a written block
 * reads back `ok` with the intended data, at the offset its shape puts it.
 * Any failure: fail closed.
 */
export function verifyKindSplice<D extends KindDocument, O extends SpliceOrigin>(
  origin: O,
  newText: string,
  plan: SplicePlan,
  kind: SpliceVerifier<D, O>
): SpliceVerifyResult<D> {
  if (!verifySplice(origin.text, newText, plan)) return { ok: false, reason: 'bytes' }
  const doc = kind.parse(newText)
  const delta = BLOCK_DELTA[plan.op]
  if (doc.state.blocks.length - origin.blockCount !== delta) {
    return { ok: false, reason: 'block-count' }
  }
  if (doc.index.comments.length - origin.commentCount !== delta) {
    return { ok: false, reason: 'comment-count' }
  }
  const own = kind.verify(origin, doc, plan)
  if (!own.ok) return own
  if (plan.data) {
    const start = writtenBlockStart(plan)
    const written = doc.state.blocks.find(block => block.nodeRange[0] === start)
    if (written?.kind !== 'ok' || JSON.stringify(written.data) !== JSON.stringify(plan.data)) {
      return { ok: false, reason: 'block-data' }
    }
  }
  return { ok: true, doc }
}
