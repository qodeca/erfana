// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Classifying comment blocks, whatever kind of file holds them
 * (docs/designs/comments/html-preview-comments.md §5.5, §5.7, decision 12;
 * spec 024 architecture note 001 § 1 `parse`, § 8 C2).
 *
 * A kind's parser finds the comment nodes (`htmlComments/parse.ts` walks
 * parse5's comment nodes, so block-shaped text inside `<script>`, an
 * attribute or another comment is never a block). This module decides what
 * each node is. A comment is a block when its text matches the anchored
 * header `^\s*erfana:comment\s+v(\d+)\b`.
 *
 * Every block is `ok`, `newer` (a later version: read-only, never rewritten)
 * or `damaged` with a reason. A damaged block is read-only and is never
 * overwritten (decision 12); the user may delete it or fix it in source. The
 * checks run cheapest and most dangerous first, and the size cap and the JSON
 * depth/duplicate scan run BEFORE `JSON.parse` (threat S16), so a hostile block
 * costs linear time and cannot overflow the stack or pollute a prototype.
 *
 * The readable text is display only, but it is what a human or an agent reads
 * first, so a block whose readable text no longer says what `@data` says is
 * damaged (`readable-mismatch`, §3). The comparison ignores whitespace-only
 * differences (indentation, line breaks, trailing blanks), so a re-indent or a
 * CRLF checkout never damages a block, and it skips the note to agents after
 * the header, which carries no data.
 *
 * What deleting a block removes depends on the shape its kind inserts it in
 * (C2): `before-target` (HTML, exactly as shipped) or `line-start` (Markdown,
 * spec 024 design `markdown-format.md` § 2). Either way `delete(add(f)) === f`.
 */
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { PREVIEW_LIMITS } from '../preview-limits'
import { hasConflictHunk, lineHasMarkerPrefix } from './conflictMarkers'
import { encodeText, utf8Length } from './encoding'
import {
  AGENT_NOTE_PREFIX,
  CommentDataSchema,
  LINE_BREAK,
  renderReadableLines,
  type CommentData
} from './format'
import type { TargetResolution } from './reattach'
import type { IndexedCommentNode, TargetIndex } from './targetIndex'

/** The anchored header test of §5.5, applied to a short head of the comment text. */
export const BLOCK_HEADER = /^\s*erfana:comment\s+v(\d+)\b/
const HEADER_PROBE_CHARS = 64

/** True when a comment's text opens with the erfana header (any version). */
export function isBlockHeader(commentData: string): boolean {
  return BLOCK_HEADER.test(commentData.slice(0, HEADER_PROBE_CHARS))
}

/**
 * How a block sits in its file (C2):
 * - `before-target` – right before the target's first character, on its own
 *   lines or mid-line (HTML, as shipped);
 * - `line-start` – `indent + block + eol` inserted at a line start (Markdown).
 */
export type SpliceShape = 'before-target' | 'line-start'

/** Why a block is damaged (§5.7). */
export type DamageReason =
  | 'no-data'
  | 'bad-json'
  | 'schema'
  | 'limits'
  | 'readable-mismatch'
  | 'conflict-marker'
  | 'duplicate-id'
  | 'in-template'
  | 'id-mismatch'
  | 'unterminated'

/** Why a whole file is read-only for comments. */
export type ReadOnlyReason =
  | 'encoding'
  | 'conflict-markers'
  | 'too-large'
  | 'too-many-blocks'
  /** An unterminated block swallows the rest of the file, so nothing may be written after it. */
  | 'unterminated-block'

interface BlockBase {
  /**
   * What deleting the block removes: the comment node, plus the whitespace
   * and line break its kind's insert shape added around it (§5.2, C2). For a
   * block Erfana added, this is exactly the inserted text.
   */
  readonly range: readonly [number, number]
  /** The comment node itself, from `<!--` to its closing `>`. */
  readonly nodeRange: readonly [number, number]
  /** SHA-256 (hex) of the comment node's UTF-8 bytes; the compare-and-swap key for edits. */
  readonly rawHash: string
}

/** One block found in a file. */
export type ParsedBlock =
  | (BlockBase & {
      readonly kind: 'ok'
      readonly data: CommentData
      readonly target: TargetResolution
    })
  | (BlockBase & {
      readonly kind: 'damaged'
      readonly reason: DamageReason
      /** The id in the header line, when one can be read. */
      readonly headerId?: string
    })
  | (BlockBase & { readonly kind: 'newer'; readonly version: number })

/** Every block of a file and whether comments may be written to it (§5.7). */
export interface FileCommentState {
  readonly blocks: readonly ParsedBlock[]
  readonly writable: boolean
  readonly readOnlyReason?: ReadOnlyReason
}

/**
 * Where an `ok` block's target is now. The kind supplies it: HTML resolves
 * through `reattach.ts`'s `resolveBlockTarget`.
 *
 * @param node - The block's comment node.
 * @param data - The block's `@data`.
 * @param blockEnds - Start → end of every erfana block of the file, for the position rule.
 */
export type BlockTargetResolver = (
  node: IndexedCommentNode,
  data: CommentData,
  blockEnds: ReadonlyMap<number, number>
) => TargetResolution

type Classified =
  | { readonly kind: 'ok'; readonly data: CommentData }
  | { readonly kind: 'damaged'; readonly reason: DamageReason; readonly headerId?: string }
  | { readonly kind: 'newer'; readonly version: number }

/** Keys the `@data` reviver drops, so no parsed object can carry a prototype hook (S16). */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const HEADER_LINE = /^erfana:comment\s+v1\s+id=(\S+)$/
const HEADER_ID = /^\s*erfana:comment\s+v1\s+id=(\S+)/
const DATA_LINE = /^\s*@data(?:\s|$)/
/** How every readable part starts after the agent note (`renderReadableLines`). */
const STATUS_PREFIX = 'status: '

/** SHA-256 (hex) of a string's UTF-8 bytes. */
export function hashText(text: string): string {
  return bytesToHex(sha256(encodeText(text)))
}

function damaged(reason: DamageReason, headerId?: string): Classified {
  return headerId === undefined
    ? { kind: 'damaged', reason }
    : { kind: 'damaged', reason, headerId }
}

/** Index of the `"` closing the string literal opened at `start`, or -1. */
function stringEnd(json: string, start: number): number {
  for (let i = start + 1; i < json.length; i += 1) {
    if (json[i] === '\\') i += 1
    else if (json[i] === '"') return i
  }
  return -1
}

/**
 * One linear pass over JSON text, before it is parsed: nesting deeper than
 * `maxDepth` (the root object is depth 1) and a key repeated within one object
 * (which `JSON.parse` would silently resolve to the last value, U-015).
 * Malformed text passes; `JSON.parse` reports it.
 */
export function scanJson(json: string, maxDepth: number): 'ok' | 'too-deep' | 'duplicate-key' {
  const stack: Array<Set<string> | null> = []
  let expectKey = false
  for (let i = 0; i < json.length; i += 1) {
    const ch = json[i]
    if (ch === '"') {
      const end = stringEnd(json, i)
      if (end < 0) return 'ok'
      if (expectKey) {
        let key: string
        try {
          key = JSON.parse(json.slice(i, end + 1)) as string
        } catch {
          return 'ok'
        }
        const keys = stack[stack.length - 1]!
        if (keys.has(key)) return 'duplicate-key'
        keys.add(key)
        expectKey = false
      }
      i = end
    } else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? new Set() : null)
      if (stack.length > maxDepth) return 'too-deep'
      expectKey = ch === '{'
    } else if (ch === '}' || ch === ']') {
      stack.pop()
      expectKey = false
    } else if (ch === ',') {
      expectKey = stack[stack.length - 1] instanceof Set
    }
  }
  return 'ok'
}

/** `JSON.parse` that drops `__proto__`, `constructor` and `prototype` keys at every level. */
export function parseDataJson(json: string): unknown {
  return JSON.parse(json, (key, value: unknown) => (FORBIDDEN_KEYS.has(key) ? undefined : value))
}

function normalizedLines(lines: readonly string[]): string[] {
  return lines.map(line => line.trim()).filter(Boolean)
}

/**
 * Normalized readable lines without the agent note (`AGENT_NOTE_LINES`): when
 * the first line after the header starts with `note to agents:`, everything up
 * to the `status:` line is the note. Readers skip it, so a block reads the same
 * with the note, without it (another writer) or with other wording (a later
 * Erfana, another file kind), and it never makes a block `readable-mismatch`.
 */
function withoutAgentNote(lines: readonly string[]): readonly string[] {
  if (!lines[0]?.startsWith(AGENT_NOTE_PREFIX)) return lines
  const status = lines.findIndex(line => line.startsWith(STATUS_PREFIX))
  return status < 0 ? lines.slice(1) : lines.slice(status)
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

/** Classify the `@data` and readable parts of a terminated v1 block body. */
function classifyBody(body: string, headerId: string | undefined): Classified {
  const lines = body.split(LINE_BREAK)
  if (lines.some(lineHasMarkerPrefix)) return damaged('conflict-marker', headerId)
  const dataAt = lines.findIndex((line, i) => i > 0 && DATA_LINE.test(line))
  if (dataAt < 0) return damaged('no-data', headerId)
  const json = [lines[dataAt].trimStart().slice('@data'.length), ...lines.slice(dataAt + 1)]
    .join('\n')
    .trim()
  const scan = scanJson(json, PREVIEW_LIMITS.COMMENT_JSON_MAX_DEPTH)
  if (scan === 'too-deep') return damaged('limits', headerId)
  if (scan === 'duplicate-key') return damaged('bad-json', headerId)
  let raw: unknown
  try {
    raw = parseDataJson(json)
  } catch {
    return damaged('bad-json', headerId)
  }
  if (!CommentDataSchema.safeParse(raw).success) return damaged('schema', headerId)
  const data = raw as CommentData
  const header = HEADER_LINE.exec(lines[0].trim())
  if (!header) return damaged('readable-mismatch', headerId)
  if (header[1] !== data.id) return damaged('id-mismatch', headerId)
  const readable = withoutAgentNote(normalizedLines(lines.slice(1, dataAt)))
  if (!sameLines(readable, normalizedLines(renderReadableLines(data)))) {
    return damaged('readable-mismatch', headerId)
  }
  return { kind: 'ok', data }
}

/** Classify one comment node whose text opens with the erfana header. */
function classifyBlock(raw: string, node: IndexedCommentNode): Classified {
  const version = BLOCK_HEADER.exec(node.data)![1]
  const headerId = HEADER_ID.exec(node.data)?.[1]
  const closeLength = raw.endsWith('--!>') ? 4 : raw.endsWith('-->') ? 3 : 0
  if (closeLength === 0) return damaged('unterminated', headerId)
  if (version !== '1') {
    const number = Number(version)
    return number > 1 ? { kind: 'newer', version: number } : damaged('schema', headerId)
  }
  if (node.inTemplate) return damaged('in-template', headerId)
  if (utf8Length(raw) > PREVIEW_LIMITS.COMMENT_BLOCK_MAX_BYTES) return damaged('limits', headerId)
  return classifyBody(raw.slice(4, raw.length - closeLength), headerId)
}

/** Length of the line break starting at `at`: 2 for CRLF, 1 for LF or CR, else 0. */
function eolLengthAt(text: string, at: number): number {
  if (text.startsWith('\r\n', at)) return 2
  return text[at] === '\n' || text[at] === '\r' ? 1 : 0
}

/** True when `at` is a line start: right after a line break, or the first offset after the BOM. */
function isLineStart(text: string, at: number, bomLength: number): boolean {
  if (at <= bomLength) return true
  const prev = text[at - 1]
  return prev === '\n' || prev === '\r'
}

/**
 * The `before-target` removable range, exactly as shipped (§5.2): the node,
 * plus its trailing line break and the indentation it repeats when the block
 * starts its line after only blanks and is followed by a line break and that
 * same indentation – the own-lines insert. Otherwise the node alone (mid-line).
 */
function beforeTargetRange(
  text: string,
  bomLength: number,
  start: number,
  end: number
): [number, number] {
  let lineStart = start
  while (lineStart > bomLength && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
    lineStart -= 1
  }
  if (!isLineStart(text, lineStart, bomLength)) return [start, end]
  const eolLength = eolLengthAt(text, end)
  const indent = text.slice(lineStart, start)
  if (eolLength === 0 || !text.startsWith(indent, end + eolLength)) return [start, end]
  return [start, end + eolLength + indent.length]
}

/**
 * The `line-start` removable range (spec 024 design `markdown-format.md` § 2,
 * "Reading the delete range"): when only spaces stand between the line start
 * and `<!--`, and `-->` is followed directly by a line break, the range is
 * from that line start to the end of the line break – `indent + block + eol`,
 * exactly what a `line-start` insert wrote. Otherwise (a block another tool
 * wrote mid-line, or one that ends the file) the node alone.
 *
 * @param start - Offset of the node's `<!--`.
 * @param end - Offset just after the node's close.
 */
export function lineStartRange(
  text: string,
  bomLength: number,
  start: number,
  end: number
): [number, number] {
  let lineStart = start
  while (lineStart > bomLength && text[lineStart - 1] === ' ') lineStart -= 1
  if (!isLineStart(text, lineStart, bomLength)) return [start, end]
  const eolLength = eolLengthAt(text, end)
  return eolLength === 0 ? [start, end] : [lineStart, end + eolLength]
}

/** The block's removable range for its kind's insert shape (C2). */
export function removableRange(
  text: string,
  bomLength: number,
  node: readonly [number, number],
  shape: SpliceShape
): [number, number] {
  const [start, end] = node
  return shape === 'line-start'
    ? lineStartRange(text, bomLength, start, end)
    : beforeTargetRange(text, bomLength, start, end)
}

/** Blocks sharing an id are all damaged: none of them can be told apart as the real one. */
function markDuplicateIds(blocks: ParsedBlock[]): void {
  const counts = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind === 'ok') counts.set(block.data.id, (counts.get(block.data.id) ?? 0) + 1)
  }
  blocks.forEach((block, i) => {
    if (block.kind !== 'ok' || counts.get(block.data.id) === 1) return
    const { range, nodeRange, rawHash } = block
    blocks[i] = {
      kind: 'damaged',
      reason: 'duplicate-id',
      headerId: block.data.id,
      range,
      nodeRange,
      rawHash
    }
  })
}

function readOnlyReasonOf(
  text: string,
  blocks: readonly ParsedBlock[],
  capped: boolean
): ReadOnlyReason | undefined {
  if (hasConflictHunk(text)) return 'conflict-markers'
  if (blocks.some(block => block.kind === 'damaged' && block.reason === 'unterminated')) {
    return 'unterminated-block'
  }
  return capped ? 'too-many-blocks' : undefined
}

function stateOf(
  blocks: ParsedBlock[],
  readOnlyReason: ReadOnlyReason | undefined
): FileCommentState {
  return readOnlyReason ? { blocks, writable: false, readOnlyReason } : { blocks, writable: true }
}

/**
 * Find and classify every comment block of an indexed file: blocks past
 * `COMMENT_MAX_BLOCKS_PER_FILE` are not read and make the file read-only,
 * blocks sharing an id are damaged, and a conflict hunk or an unterminated
 * block makes the file read-only.
 *
 * @param index - The kind's parse of the file.
 * @param shape - The kind's insert shape, which decides each block's removable range.
 * @param resolveTarget - Where an `ok` block's target is now.
 */
export function classifyIndexedBlocks(
  index: TargetIndex,
  shape: SpliceShape,
  resolveTarget: BlockTargetResolver
): FileCommentState {
  const { text, bomLength } = index
  const found = index.comments.filter(node => isBlockHeader(node.data))
  const capped = found.length > PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE
  const nodes = found.slice(0, PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
  const blockEnds = new Map(nodes.map(node => [node.start, node.end]))
  const blocks: ParsedBlock[] = nodes.map(node => {
    const raw = text.slice(node.start, node.end)
    const nodeRange: [number, number] = [node.start, node.end]
    const base: BlockBase = {
      range: removableRange(text, bomLength, nodeRange, shape),
      nodeRange,
      rawHash: hashText(raw)
    }
    const kind = classifyBlock(raw, node)
    if (kind.kind !== 'ok') return { ...base, ...kind }
    return { ...base, kind: 'ok', data: kind.data, target: resolveTarget(node, kind.data, blockEnds) }
  })
  markDuplicateIds(blocks)
  return stateOf(blocks, readOnlyReasonOf(text, blocks, capped))
}
