// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Splice plans: add, edit and delete one block so that every other byte of
 * the file stays identical (docs/designs/comments/html-preview-comments.md decision 24,
 * §5.2, §7.6 steps 6–8, §19 R3-8).
 *
 * A plan is `{start, end, insert}` on the decoded text; applying it is
 * `text[0:start] + insert + text[end:]` and nothing else. `spliceBytes` applies
 * the same plan to the original BYTES by copying the untouched prefix and
 * suffix verbatim, so line endings, a BOM and every other byte outside the
 * block are preserved by construction, and `verifySpliceBytes` re-checks it
 * independently.
 *
 * PLACEMENT (final rule, R3-8). A new block goes directly before the target's
 * start tag – after any blocks already there – in one of two shapes:
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
 * Either way the inserted text is the block's removable range (parse.ts), so
 * `delete(add(f)) === f`. Nothing is ever written into a read-only file, and a
 * damaged or newer block is never rewritten.
 */
import { PREVIEW_LIMITS } from '../preview-limits'
import { CHARSET_PRESCAN_BYTES, encodeText, utf8Length } from './encoding'
import {
  serializeBlock,
  type BlockLayout,
  type CommentData,
  type Eol,
  type SerializeFailure
} from './format'
import {
  analyzeCommentDocument,
  type CommentDocument,
  type FileCommentState,
  type ParsedBlock
} from './parse'

/** What a plan does to the file. */
export type SpliceOp = 'insert' | 'replace' | 'delete'

/** The two block shapes of §5.2. */
export type Placement = 'own-lines' | 'mid-line'

/** One contiguous change to the decoded text. */
export interface SplicePlan {
  readonly op: SpliceOp
  readonly start: number
  readonly end: number
  readonly insert: string
  /** How an inserted block was placed. */
  readonly placement?: Placement
  /** What the written block must read back as (insert and replace). */
  readonly data?: CommentData
}

/** Why no plan could be made. Nothing is written in any of these cases. */
export type PlanFailure =
  /** The file is read-only for comments (`state.readOnlyReason`). */
  | 'read-only'
  /** No eligible element starts at the requested offset (§5.6). */
  | 'not-eligible'
  /** No block with that id or start offset. */
  | 'not-found'
  /** The block is damaged or newer, so it is never rewritten (decision 12, 22). */
  | 'not-editable'
  /** The block's bytes changed since the caller read them (compare-and-swap, U-061). */
  | 'stale'
  /** The block would push a `<meta charset>` out of the browser's 1,024-byte prescan (§5.6). */
  | 'meta-charset'
  | SerializeFailure

export type PlanResult =
  | { readonly ok: true; readonly plan: SplicePlan }
  | { readonly ok: false; readonly reason: PlanFailure }

/** Add a block before the eligible element whose start tag begins at `targetStart`. */
export interface InsertRequest {
  readonly targetStart: number
  readonly data: CommentData
  /** The pick's computed `white-space-collapse` of the target's parent (R3-8); missing → mid-line. */
  readonly ws?: string
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

/** A `<meta …charset…>` start, for the prescan check. Run on a 1,024-character head only. */
const META_CHARSET_TAG = /<meta\b[^>]*?charset/gi

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
    eol: eolFrom(text, offset) ?? eolFrom(text, 0) ?? '\n'
  }
}

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

/** Plan a new block before an eligible element (§5.2, §5.6, R3-8). */
export function planInsert(doc: CommentDocument, request: InsertRequest): PlanResult {
  const { text, index, state } = doc
  if (!state.writable) return fail('read-only')
  if (state.blocks.length >= PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE) return fail('limit')
  const el = index.elementAt(request.targetStart)
  if (!el) return fail('not-eligible')
  const layout = lineLayoutAt(text, el.start, index.bomLength)
  const placement: Placement =
    layout.atLineStart && !el.preformatted && request.ws === 'collapse' ? 'own-lines' : 'mid-line'
  const serialized = serializeBlock(request.data, layout)
  if (!serialized.ok) return fail(serialized.reason)
  const insert =
    placement === 'own-lines' ? serialized.block + layout.eol + layout.indent : serialized.block
  if (pushesMetaCharset(text, [el.start, el.start], insert)) return fail('meta-charset')
  return {
    ok: true,
    plan: { op: 'insert', start: el.start, end: el.start, insert, placement, data: request.data }
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
 * node is replaced; the line break and indent after it stay as they are, so a
 * later delete still restores the original bytes (U-053).
 */
export function planReplace(doc: CommentDocument, request: ReplaceRequest): PlanResult {
  if (!doc.state.writable) return fail('read-only')
  const block = findBlock(doc.state, { id: request.id })
  if (!block) return fail('not-found')
  if (block.kind !== 'ok') return fail('not-editable')
  if (block.rawHash !== request.rawHash) return fail('stale')
  if (request.data.id !== request.id) return fail('invalid')
  const serialized = serializeBlock(request.data, blockLayout(doc.text, block))
  if (!serialized.ok) return fail(serialized.reason)
  if (pushesMetaCharset(doc.text, block.nodeRange, serialized.block)) return fail('meta-charset')
  const [start, end] = block.nodeRange
  return {
    ok: true,
    plan: { op: 'replace', start, end, insert: serialized.block, data: request.data }
  }
}

/**
 * Plan the removal of one block: an `ok` block, or a damaged one whose bytes
 * still match (§7.6 step 6, "Delete block"). A newer block is never removed;
 * an unterminated one never reaches here, because it makes the file read-only.
 */
export function planDelete(doc: CommentDocument, request: DeleteRequest): PlanResult {
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

/** Why a spliced file failed its verification; the write must not happen. */
export type VerifyFailure = 'bytes' | 'block-count' | 'comment-count' | 'elements' | 'block-data'

export type VerifyResult =
  | { readonly ok: true; readonly doc: CommentDocument }
  | { readonly ok: false; readonly reason: VerifyFailure }

const BLOCK_DELTA: Readonly<Record<SpliceOp, number>> = { insert: 1, replace: 0, delete: -1 }

/**
 * What {@link verifyCommentSplice} needs of the document a splice was planned
 * on. It holds no parse tree, so a caller can let that tree go before the new
 * text is parsed: a dense 25 MB page's tree is most of a gigabyte, and two of
 * them alive at once would double the parse worker's peak (§19 Rev 4).
 */
export interface SpliceOrigin {
  readonly text: string
  readonly blockCount: number
  readonly commentCount: number
  /** The tag of every element in tree order ({@link CommentDocument.index}'s `tagSequence`). */
  readonly tagSequence: readonly string[]
}

/** The {@link SpliceOrigin} of a parsed document. */
export function spliceOriginOf(doc: CommentDocument): SpliceOrigin {
  return {
    text: doc.text,
    blockCount: doc.state.blocks.length,
    commentCount: doc.index.comments.length,
    tagSequence: doc.index.tagSequence
  }
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

/**
 * The post-splice check of §7.6 step 8, run on the new text before anything
 * is written: the text is the plan applied and nothing else; the file has
 * exactly one block (and one comment node) more, the same, or one fewer; it
 * has exactly the same elements in the same order – so no text escaped a
 * comment (threat S13); and a written block reads back `ok` with the intended
 * data. Any failure: fail closed.
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
  if (!verifySplice(origin.text, newText, plan)) return { ok: false, reason: 'bytes' }
  const doc = analyzeCommentDocument(newText)
  const delta = BLOCK_DELTA[plan.op]
  if (doc.state.blocks.length - origin.blockCount !== delta) {
    return { ok: false, reason: 'block-count' }
  }
  if (doc.index.comments.length - origin.commentCount !== delta) {
    return { ok: false, reason: 'comment-count' }
  }
  if (!sameTags(origin.tagSequence, doc.index.tagSequence)) return { ok: false, reason: 'elements' }
  if (plan.data) {
    const written = doc.state.blocks.find(block => block.nodeRange[0] === plan.start)
    if (written?.kind !== 'ok' || JSON.stringify(written.data) !== JSON.stringify(plan.data)) {
      return { ok: false, reason: 'block-data' }
    }
  }
  return { ok: true, doc }
}
