// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reading comment blocks from an HTML file
 * (docs/designs/html-preview-comments.md §5.5, §5.7, decision 12).
 *
 * Blocks are found by walking parse5's COMMENT NODES – never by a regex over
 * the file – so block-shaped text inside `<script>`, `<style>`, `<textarea>`,
 * attribute values, CDATA or another comment is never mistaken for a block
 * (U-032). A comment is a block when its text matches the anchored header
 * `^\s*erfana:comment\s+v(\d+)\b`.
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
 * CRLF checkout never damages a block, and it skips the fixed note to agents
 * after the header, which carries no data.
 */
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { PREVIEW_LIMITS } from './preview-limits'
import { BLOCK_HEADER, isBlockHeader, resolveBlockTarget, type TargetResolution } from './anchor'
import { hasConflictHunk, lineHasMarkerPrefix } from './conflictMarkers'
import { decodeLossless, encodeText, utf8Length, type DecodeFailure } from './encoding'
import {
  AGENT_NOTE_PREFIX,
  CommentDataSchema,
  LINE_BREAK,
  renderReadableLines,
  type CommentData
} from './format'
import { hasMoreStartTagsThan, indexHtml, type HtmlIndex, type IndexedComment } from './htmlIndex'
import { HtmlParseLimitError, hasAttributeFlood } from './parseBounds'

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
   * What deleting the block removes: the comment node, plus the line break
   * and indentation after it when the block sits on its own lines (§5.2). For
   * a block Erfana added, this is exactly the inserted text.
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

/** A decoded file with its shared parse and its comment state – the input of every splice. */
export interface CommentDocument {
  readonly text: string
  readonly index: HtmlIndex
  readonly state: FileCommentState
}

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
 * Erfana), and it never makes a block `readable-mismatch`.
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
function classifyBlock(raw: string, comment: IndexedComment): Classified {
  const version = BLOCK_HEADER.exec(comment.data)![1]
  const headerId = HEADER_ID.exec(comment.data)?.[1]
  const closeLength = raw.endsWith('--!>') ? 4 : raw.endsWith('-->') ? 3 : 0
  if (closeLength === 0) return damaged('unterminated', headerId)
  if (version !== '1') {
    const number = Number(version)
    return number > 1 ? { kind: 'newer', version: number } : damaged('schema', headerId)
  }
  if (comment.inTemplate) return damaged('in-template', headerId)
  if (utf8Length(raw) > PREVIEW_LIMITS.COMMENT_BLOCK_MAX_BYTES) return damaged('limits', headerId)
  return classifyBody(raw.slice(4, raw.length - closeLength), headerId)
}

/**
 * The block's removable range: the node, plus its trailing line break and the
 * indentation it repeats when the block starts its line after only blanks and
 * is followed by a line break and that same indentation – the shape of an
 * own-lines insertion (§5.2), so `delete(add(f)) === f`.
 */
function removableRange(index: HtmlIndex, start: number, end: number): [number, number] {
  const { text, bomLength } = index
  let lineStart = start
  while (lineStart > bomLength && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
    lineStart -= 1
  }
  const prev = text[lineStart - 1]
  if (lineStart > bomLength && prev !== '\n' && prev !== '\r') return [start, end]
  const eolLength = text.startsWith('\r\n', end)
    ? 2
    : text[end] === '\n' || text[end] === '\r'
      ? 1
      : 0
  const indent = text.slice(lineStart, start)
  if (eolLength === 0 || !text.startsWith(indent, end + eolLength)) return [start, end]
  return [start, end + eolLength + indent.length]
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

/** Find and classify every comment block of an already indexed file. */
export function parseIndexedBlocks(index: HtmlIndex): FileCommentState {
  const { text } = index
  const found = index.comments.filter(comment => isBlockHeader(comment.data))
  const capped = found.length > PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE
  const comments = found.slice(0, PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
  const blockEnds = new Map(comments.map(comment => [comment.start, comment.end]))
  const blocks: ParsedBlock[] = comments.map(comment => {
    const raw = text.slice(comment.start, comment.end)
    const base: BlockBase = {
      range: removableRange(index, comment.start, comment.end),
      nodeRange: [comment.start, comment.end],
      rawHash: hashText(raw)
    }
    const kind = classifyBlock(raw, comment)
    if (kind.kind !== 'ok') return { ...base, ...kind }
    const target = resolveBlockTarget(index, {
      after: comment.end,
      anchor: kind.data.anchor,
      blockEnds
    })
    return { ...base, kind: 'ok', data: kind.data, target }
  })
  markDuplicateIds(blocks)
  return stateOf(blocks, readOnlyReasonOf(text, blocks, capped))
}

/** True when the decoded file is over the comment size limit (served raw, read-only). */
function isTooLarge(text: string): boolean {
  return utf8Length(text) > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES
}

const TOO_LARGE: FileCommentState = { blocks: [], writable: false, readOnlyReason: 'too-large' }

/**
 * Every comment block of a decoded HTML file and the file's comment state.
 * A file over `COMMENT_FILE_MAX_BYTES` is not parsed: it is read-only with
 * the reason `too-large` and lists no blocks.
 */
export function parseCommentBlocks(text: string): FileCommentState {
  return analyzeCommentDocument(text).state
}

/** The index of `text`, or `undefined` when the parse went past its bounds (`parseBounds.ts`, S-M). */
function boundedIndex(text: string): HtmlIndex | undefined {
  try {
    return indexHtml(text)
  } catch (error) {
    if (error instanceof HtmlParseLimitError) return undefined
    throw error
  }
}

/**
 * Parse once and keep the parse: the input of `planInsert` / `planReplace` /
 * `planDelete`. A page past the parse bounds is `too-large`, like one past the
 * size limit: read-only, no blocks.
 */
export function analyzeCommentDocument(text: string): CommentDocument {
  const index = isTooLarge(text) ? undefined : boundedIndex(text)
  if (index === undefined) return { text, index: indexHtml(''), state: TOO_LARGE }
  return { text, index, state: parseIndexedBlocks(index) }
}

/** Result of {@link parseCommentFile}. */
export type CommentFileResult =
  | { readonly ok: true; readonly doc: CommentDocument }
  | {
      readonly ok: false
      readonly reason: DecodeFailure | 'too-large'
      readonly state: FileCommentState
    }

/**
 * Decode a file's bytes losslessly and analyse it. Anything but UTF-8 is
 * read-only with the reason `encoding` (§3); the bytes are never touched.
 * A file over `COMMENT_FILE_MAX_BYTES`, with more start tags than
 * `COMMENT_MAX_TOKENS_PER_DOCUMENT`, or with an attribute flood
 * (`hasAttributeFlood`) is `too-large` and never parsed: either would build a
 * tree past what the parse worker's heap is sized for, or take it minutes
 * (§19 Rev 4, S-M). One that goes past the parse's own bounds while parsing
 * is `too-large` too.
 */
export function parseCommentFile(bytes: Uint8Array): CommentFileResult {
  if (
    bytes.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES ||
    hasMoreStartTagsThan(bytes, PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT) ||
    hasAttributeFlood(bytes)
  ) {
    return { ok: false, reason: 'too-large', state: TOO_LARGE }
  }
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) {
    return {
      ok: false,
      reason: decoded.reason,
      state: { blocks: [], writable: false, readOnlyReason: 'encoding' }
    }
  }
  const doc = analyzeCommentDocument(decoded.text)
  return doc.state === TOO_LARGE ? { ok: false, reason: 'too-large', state: TOO_LARGE } : { ok: true, doc }
}
