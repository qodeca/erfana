// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The instrumentation pipeline the comment parse worker runs for one served
 * document (docs/designs/comments/html-preview-comments.md §4.2 "PreviewProtocolHandler",
 * §6 "On every load", §19 R3-12, R3-13).
 *
 * Pure apart from its random source and a hash: no Electron, no file system,
 * no worker API, so it is unit-tested directly and the worker runner
 * (`commentParseWorker.ts`) only moves messages; it runs as the HTML kind's
 * `instrument` job (`htmlCommentJobs.ts`).
 *
 * One pass, from the bytes actually served:
 * 1. size cap, a start-tag count over the token cap or an attribute flood
 *    (`too-many-elements` before any parse, so no tree past the worker's heap
 *    is built – §19 Rev 4, S-M), then `decodeLossless` (UTF-8 ± BOM with a
 *    byte-identical round trip – anything else is served raw with the reason
 *    `encoding`);
 * 2. ONE shared parse (`indexHtml`), used by both steps below, so the tokens
 *    and the blocks can never disagree about where an element starts. It is
 *    bounded (`parseBounds.ts`): a page that makes the parser create more
 *    elements than the cap, or work past its budget, stops it – also
 *    `too-many-elements`;
 * 3. `instrumentHtml` – a token after every eligible start tag's name; a
 *    source that already carries `data-erfana-el` or more elements than the
 *    token cap is served raw (`collision`, `too-many-elements`);
 * 4. `parseIndexedBlocks` – every comment block, and for each the index of
 *    the token of the element it sits on (block → token resolution, §6);
 * 5. the instrumented text encoded back to UTF-8.
 *
 * The token table leaves as plain arrays (one token string, offsets, lines,
 * tag codes) so it crosses the worker boundary cheaply and main never
 * rebuilds a `Map` (S9: the map rebuild was 19.7 of 28.2 ms of main-thread
 * time at 4 MB).
 */
import { createHash } from 'node:crypto'
import { anchorSelectionOf, type AnchorSelection } from '../../../../shared/comments/anchorSel'
import {
  HtmlParseLimitError,
  decodeLossless,
  encodeText,
  hasAttributeFlood,
  hasMoreStartTagsThan,
  indexHtml,
  instrumentHtml,
  mintElementToken,
  parseIndexedBlocks,
  type CommentAnchor,
  type HtmlIndex,
  type ParsedBlock,
  type RandomBytes
} from '../../../../shared/htmlComments'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import type { TargetVia } from '../../../../shared/comments/reattach'
import { changeOf } from '../../comments/commentListChange'

/** Characters in one element token (`ELEMENT_TOKEN_PATTERN`). */
export const TOKEN_CHARS = 12

/** No element: the block is orphaned, or nothing eligible follows it. */
export const NO_TARGET = -1

/** Bytes drawn from `crypto.getRandomValues` at a time (its per-call maximum). */
const RANDOM_POOL_BYTES = 65_536

/** HTML whitespace, which may separate a block from its element (§5.9). */
const HTML_WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\f', '\r'])

/** One comment block of a served document, reduced to what a pin needs (§8 `icons`). */
export interface CommentLoadBlock {
  readonly kind: ParsedBlock['kind']
  /** The comment id (`ok` blocks), or the id the header names (damaged), when readable. */
  readonly id?: string
  /** `ok` blocks only. */
  readonly status?: 'open' | 'resolved'
  /** Index into the load's token table of the element the block sits on, or {@link NO_TARGET}. */
  readonly target: number
  /** A JS-built target below its in-file element (§5.6, R3-11): where the preload looks. */
  readonly runtime?: { readonly path: string; readonly tag: string }
  /** An open thread's valid `anchor.sel`: the words the page marks (spec 024 C-12). */
  readonly sel?: AnchorSelection
  /** An open thread whose target no longer reads as stored – Changed or Words changed (C-06): its pin is notched. */
  readonly changed?: true
}

/** A served document's token table and blocks. */
export interface InstrumentedDocument {
  readonly kind: 'ok'
  /** The instrumented copy, UTF-8. */
  readonly html: Uint8Array
  /** SHA-256 (hex) of the ORIGINAL bytes – the file as it was when served. */
  readonly fileHash: string
  /** Every token, {@link TOKEN_CHARS} characters each, in source order. */
  readonly tokens: string
  /** `offsets[i]`: UTF-16 offset of token `i`'s start tag in the ORIGINAL decoded text, ascending. */
  readonly offsets: Int32Array
  /**
   * `lines[i]`: 1-based line of token `i`'s start tag, counted as the menu's
   * line is (`lineAt`). What the keyboard picker's announcement says, so a
   * page never words it (security review S-L-A).
   */
  readonly lines: Uint32Array
  /** `tagNames[tagCodes[i]]` is token `i`'s tag. */
  readonly tagCodes: Uint32Array
  readonly tagNames: readonly string[]
  readonly blocks: readonly CommentLoadBlock[]
}

/** Why a document is served raw although comments were expected for it. */
export type InstrumentRefusal = 'too-large' | 'encoding' | 'collision' | 'too-many-elements'

/** `instrumentHtml`'s refusals as this module names them. */
const SERVED_RAW_BECAUSE: Readonly<Record<'collision' | 'too-large', InstrumentRefusal>> = {
  collision: 'collision',
  'too-large': 'too-many-elements'
}

/** Result of {@link instrumentDocument}. */
export type InstrumentOutcome =
  InstrumentedDocument | { readonly kind: 'unavailable'; readonly reason: InstrumentRefusal }

/** Options for {@link instrumentDocument}; production uses the defaults. */
export interface InstrumentDocumentOptions {
  /** Defaults to a pooled `crypto.getRandomValues` source. */
  readonly random?: RandomBytes
  /** Defaults to `COMMENT_MAX_TOKENS_PER_DOCUMENT`. */
  readonly maxTokens?: number
}

/** `length` random bytes, filled in `getRandomValues`-sized pieces. */
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let at = 0; at < length; at += RANDOM_POOL_BYTES) {
    crypto.getRandomValues(out.subarray(at, Math.min(length, at + RANDOM_POOL_BYTES)))
  }
  return out
}

/**
 * A random source that draws `crypto.getRandomValues` 64 KB at a time: a
 * 100,000-token page needs 1.2 MB of randomness, one system call per 5,461
 * tokens instead of one per token.
 */
export function pooledRandom(): RandomBytes {
  let pool: Uint8Array = new Uint8Array(0)
  let used = 0
  return length => {
    if (used + length > pool.length) {
      pool = randomBytes(Math.max(RANDOM_POOL_BYTES, length))
      used = 0
    }
    const out = pool.subarray(used, used + length)
    used += length
    return out
  }
}

/**
 * Mint tokens that never repeat within one document. Two equal tokens would
 * make a pick ambiguous; at 60 random bits a repeat is a one-in-10^8 event
 * even at the token cap, but it costs one `Set` to rule it out.
 */
function uniqueTokenMinter(random: RandomBytes): () => string {
  const seen = new Set<string>()
  return () => {
    let token = mintElementToken(random)
    while (seen.has(token)) token = mintElementToken(random)
    seen.add(token)
    return token
  }
}

/** Index of `offset` in the ascending `offsets`, or {@link NO_TARGET}. */
export function tokenIndexAt(offsets: ArrayLike<number>, offset: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const value = offsets[mid]
    if (value === offset) return mid
    if (value < offset) lo = mid + 1
    else hi = mid - 1
  }
  return NO_TARGET
}

/**
 * The eligible element a block sits on by POSITION – the next start tag in
 * source order after the block, skipping whitespace and other blocks (§5.9
 * step 1, R3-10). Used for blocks without readable anchors (damaged, newer);
 * exported for the pin of a damaged block (`commentDraftOpener.ts`).
 */
export function positionTarget(
  index: HtmlIndex,
  after: number,
  blockEnds: ReadonlyMap<number, number>
): number {
  const { text } = index
  let pos = after
  for (;;) {
    while (pos < text.length && HTML_WHITESPACE.has(text[pos])) pos += 1
    const end = blockEnds.get(pos)
    if (end === undefined) break
    pos = end
  }
  return index.elementAt(pos)?.start ?? NO_TARGET
}

/** The list's own C-06 rule (`commentListChange.ts`), so a pin and its drawer row agree. */
function isChanged(index: HtmlIndex, target: { readonly startOffset: number; readonly via?: TargetVia }, anchor: CommentAnchor): boolean {
  const el = index.elementAt(target.startOffset)
  return el !== undefined && changeOf({ index, target: el, anchor, via: target.via, html: true }) !== undefined
}

/** Reduce the parsed blocks to pin data, each pointing at its element's token. */
function loadBlocks(index: HtmlIndex, offsets: Int32Array): CommentLoadBlock[] {
  const { blocks } = parseIndexedBlocks(index)
  const blockEnds = new Map(blocks.map(block => [block.nodeRange[0], block.nodeRange[1]]))
  return blocks.map((block): CommentLoadBlock => {
    if (block.kind === 'ok') {
      const target =
        block.target.state === 'attached'
          ? tokenIndexAt(offsets, block.target.startOffset)
          : NO_TARGET
      const runtime = block.data.anchor.runtime
      const sel = block.data.status === 'open' ? anchorSelectionOf(block.data.anchor) : undefined
      const changed = block.data.status === 'open' && block.target.state === 'attached' && isChanged(index, block.target, block.data.anchor)
      return {
        kind: 'ok',
        id: block.data.id,
        status: block.data.status,
        target,
        ...(runtime ? { runtime: { path: runtime.path, tag: runtime.tag } } : {}),
        ...(sel ? { sel: { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } } : {}),
        ...(changed ? { changed: true as const } : {})
      }
    }
    const start = positionTarget(index, block.nodeRange[1], blockEnds)
    const target = start === NO_TARGET ? NO_TARGET : tokenIndexAt(offsets, start)
    const id = block.kind === 'damaged' ? block.headerId : undefined
    return id === undefined ? { kind: block.kind, target } : { kind: block.kind, id, target }
  })
}

/**
 * The 1-based line of every ascending offset, in one pass over `text`. Lines
 * are counted on `\n`, as `lineAt` counts them for the menu's line.
 */
export function linesAt(text: string, offsets: ArrayLike<number>): Uint32Array {
  const lines = new Uint32Array(offsets.length)
  let line = 1
  let at = text.indexOf('\n')
  for (let i = 0; i < offsets.length; i += 1) {
    while (at !== -1 && at < offsets[i]) {
      line += 1
      at = text.indexOf('\n', at + 1)
    }
    lines[i] = line
  }
  return lines
}

/** Intern tag names: a code per token instead of one string per token. */
function tagTable(tags: readonly string[]): { tagCodes: Uint32Array; tagNames: string[] } {
  const codes = new Map<string, number>()
  const tagNames: string[] = []
  const tagCodes = new Uint32Array(tags.length)
  tags.forEach((tag, i) => {
    let code = codes.get(tag)
    if (code === undefined) {
      code = tagNames.length
      codes.set(tag, code)
      tagNames.push(tag)
    }
    tagCodes[i] = code
  })
  return { tagCodes, tagNames }
}

/** The page's index, or `undefined` when its parse went past the parse bounds (S-M: "page too large"). */
function boundedIndexOf(text: string): HtmlIndex | undefined {
  try {
    return indexHtml(text)
  } catch (error) {
    if (error instanceof HtmlParseLimitError) return undefined
    throw error
  }
}

/**
 * Instrument one served document and resolve its blocks to tokens.
 *
 * @param bytes - The file's bytes exactly as read for this response.
 */
export function instrumentDocument(
  bytes: Uint8Array,
  options: InstrumentDocumentOptions = {}
): InstrumentOutcome {
  if (bytes.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES) {
    return { kind: 'unavailable', reason: 'too-large' }
  }
  if (hasMoreStartTagsThan(bytes, options.maxTokens ?? PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT) || hasAttributeFlood(bytes)) {
    return { kind: 'unavailable', reason: 'too-many-elements' }
  }
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) return { kind: 'unavailable', reason: 'encoding' }
  const index = boundedIndexOf(decoded.text)
  if (index === undefined) return { kind: 'unavailable', reason: 'too-many-elements' }
  const result = instrumentHtml(decoded.text, uniqueTokenMinter(options.random ?? pooledRandom()), {
    index,
    maxTokens: options.maxTokens
  })
  // `too-large` cannot happen after the start-tag count above, which bounds the elements indexed.
  if (result.kind !== 'ok') return { kind: 'unavailable', reason: SERVED_RAW_BECAUSE[result.kind] }
  const offsets = Int32Array.from(result.offsets)
  return {
    kind: 'ok',
    html: encodeText(result.html),
    fileHash: createHash('sha256').update(bytes).digest('hex'),
    tokens: result.tokens.join(''),
    offsets,
    lines: linesAt(decoded.text, offsets),
    ...tagTable(result.tags),
    blocks: loadBlocks(index, offsets)
  }
}
