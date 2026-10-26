// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Anchors: how a block names its element, and how it finds it again
 * (docs/designs/html-preview-comments.md §5.3, §5.9, §19 R3-10).
 *
 * A block normally sits right before its element, so the first rule –
 * POSITION – is "the next start tag in the SOURCE TEXT after the block,
 * skipping whitespace and other erfana blocks, has the stored tag". Source
 * order, not DOM order: an implied `tbody` or an unclosed `<p>`/`<li>` puts the
 * comment node somewhere else in the tree than its element (spike S7, 7 of 9
 * cases), but never somewhere else in the text.
 *
 * When the file was edited around the block, the backups are tried in order,
 * cheapest first: a unique `id` + tag, the unique CSS path, a unique text
 * quote (exact text, then the text around it). Two equal candidates leave the
 * block ORPHANED – a guess is worse than "element not found" – and nothing
 * here ever moves or deletes a block (decision 21).
 *
 * Quote text is the element's readable text (no `script`, `style`,
 * `noscript`, template content) with whitespace runs collapsed to one space,
 * trimmed and NFC-normalised, so reformatting and NFD file names typed on
 * macOS do not break a match (U-088).
 */
import {
  defaultTreeAdapter,
  html as htmlSpec,
  parseFragment,
  type DefaultTreeAdapterMap
} from 'parse5'
import { PREVIEW_LIMITS } from '../preview-limits'
import { utf8Length } from './encoding'
import {
  ANCHOR_CLASS_MAX_CHARS,
  ANCHOR_ID_MAX_CHARS,
  ANCHOR_PATH_MAX_CHARS,
  type CommentAnchor,
  type RuntimeAnchor,
  type TextQuote
} from './format'
import type { HtmlIndex, IndexedElement, Parse5Element } from './htmlIndex'

type ChildNode = DefaultTreeAdapterMap['childNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']

/** Characters of context kept on each side of a quote. */
export const QUOTE_CONTEXT_CHARS = 32
/** Raw characters scanned on each side of an element for its context. */
const CONTEXT_WINDOW = 512
/** Extra characters collected before NFC, which may compose a few away. */
const NFC_SLACK = 8

const WHITESPACE = /\s/
const HTML_WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\f', '\r'])
const NTH_SEGMENT = /^(.+):nth-of-type\((\d+)\)$/
/** The anchored header test of §5.5, applied to a short head of the comment text. */
export const BLOCK_HEADER = /^\s*erfana:comment\s+v(\d+)\b/
const HEADER_PROBE_CHARS = 64

/** Which rule attached a block to its element. */
export type TargetVia = 'position' | 'id' | 'path' | 'quote'

/** Where a block's element is now (§5.7). */
export type TargetResolution =
  | { readonly state: 'attached'; readonly startOffset: number; readonly via: TargetVia }
  | { readonly state: 'orphaned' }

/** True when a comment's text opens with the erfana header (any version). */
export function isBlockHeader(commentData: string): boolean {
  return BLOCK_HEADER.test(commentData.slice(0, HEADER_PROBE_CHARS))
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff
}

/** Whitespace collapsed to single spaces, trimmed, NFC. */
export function normalizeQuoteText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().normalize('NFC')
}

/** At most `max` characters from the start, never splitting a surrogate pair. */
function cutHead(text: string, max: number): string {
  if (text.length <= max) return text
  const end = isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max
  return text.slice(0, end).trimEnd()
}

/** At most `max` characters from the end, never splitting a surrogate pair. */
function cutTail(text: string, max: number): string {
  if (text.length <= max) return text
  const start = text.length - max
  return text.slice(isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start).trimStart()
}

/** Normalised text of `text[from, to)`, read forwards, at most `max` characters. */
function headText(text: string, from: number, to: number, max: number): string {
  let out = ''
  let gap = false
  for (let i = from; i < to && out.length < max + NFC_SLACK; i += 1) {
    const ch = text[i]
    if (WHITESPACE.test(ch)) {
      gap = out.length > 0
      continue
    }
    if (gap) out += ' '
    gap = false
    out += ch
  }
  return cutHead(out.normalize('NFC'), max)
}

/** Normalised text of `text[from, to)`, read backwards, at most `max` characters. */
function tailText(text: string, from: number, to: number, max: number): string {
  let out = ''
  let gap = false
  for (let i = to - 1; i >= from && out.length < max + NFC_SLACK; i -= 1) {
    const ch = text[i]
    if (WHITESPACE.test(ch)) {
      gap = out.length > 0
      continue
    }
    if (gap) out = ` ${out}`
    gap = false
    out = ch + out
  }
  return cutTail(out.normalize('NFC'), max)
}

function exactOf(index: HtmlIndex, el: IndexedElement): string {
  return headText(
    index.visibleText,
    el.textStart,
    el.textEnd,
    PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS
  )
}

function prefixOf(index: HtmlIndex, el: IndexedElement): string {
  const from = Math.max(0, el.textStart - CONTEXT_WINDOW)
  return tailText(index.visibleText, from, el.textStart, QUOTE_CONTEXT_CHARS)
}

function suffixOf(index: HtmlIndex, el: IndexedElement): string {
  const to = Math.min(index.visibleText.length, el.textEnd + CONTEXT_WINDOW)
  return headText(index.visibleText, el.textEnd, to, QUOTE_CONTEXT_CHARS)
}

/** The element's text quote, or `undefined` when it has no text. */
export function quoteOf(index: HtmlIndex, el: IndexedElement): TextQuote | undefined {
  const exact = exactOf(index, el)
  if (!exact) return undefined
  return { exact, prefix: prefixOf(index, el), suffix: suffixOf(index, el) }
}

/** The in-file anchor of an element: tag, id, classes, CSS path and quote. */
export function buildAnchor(index: HtmlIndex, el: IndexedElement): CommentAnchor {
  const path = index.pathOf(el.node)
  const id = el.id && el.id.length <= ANCHOR_ID_MAX_CHARS ? el.id : undefined
  const cls = el.classes
    .filter(name => name.length <= ANCHOR_CLASS_MAX_CHARS)
    .slice(0, PREVIEW_LIMITS.COMMENT_MAX_CLASSES)
  const quote = quoteOf(index, el)
  return {
    tag: el.tag,
    ...(id ? { id } : {}),
    ...(cls.length ? { cls } : {}),
    path: path.length <= ANCHOR_PATH_MAX_CHARS ? path : '',
    ...(quote ? { quote } : {})
  }
}

function attached(el: IndexedElement, via: TargetVia): TargetResolution {
  return { state: 'attached', startOffset: el.start, via }
}

function unique<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined
}

function byQuote(index: HtmlIndex, anchor: CommentAnchor): IndexedElement | undefined {
  const quote = anchor.quote
  if (!quote) return undefined
  const sameTag = index.elements.filter(el => el.tag === anchor.tag)
  const exact = sameTag.filter(el => exactOf(index, el) === quote.exact)
  if (exact.length === 1) return exact[0]
  if (!quote.prefix && !quote.suffix) return undefined
  const pool = exact.length > 1 ? exact : sameTag
  return unique(
    pool.filter(el => prefixOf(index, el) === quote.prefix && suffixOf(index, el) === quote.suffix)
  )
}

/**
 * Find an anchor's element without the position rule – for a block whose
 * position no longer matches, or for a draft re-anchored at Save (§7.6).
 */
export function findAnchorTarget(index: HtmlIndex, anchor: CommentAnchor): TargetResolution {
  if (anchor.id) {
    const el = unique(index.elementsWithId(anchor.id).filter(cand => cand.tag === anchor.tag))
    if (el) return attached(el, 'id')
  }
  if (anchor.path) {
    const el = index.elementAtPath(anchor.path)
    if (el && el.tag === anchor.tag) return attached(el, 'path')
  }
  const el = byQuote(index, anchor)
  return el ? attached(el, 'quote') : { state: 'orphaned' }
}

/** Input for {@link resolveBlockTarget}. */
export interface BlockTargetQuery {
  /** Offset just after the block's `-->`. */
  readonly after: number
  readonly anchor: CommentAnchor
  /** Start → end of every erfana block in the file, skipped by the position rule. */
  readonly blockEnds: ReadonlyMap<number, number>
}

/** Where a block's element is: position first, then the backups (§5.9). */
export function resolveBlockTarget(index: HtmlIndex, query: BlockTargetQuery): TargetResolution {
  const { text } = index
  let pos = query.after
  for (;;) {
    while (pos < text.length && HTML_WHITESPACE.has(text[pos])) pos += 1
    const end = query.blockEnds.get(pos)
    if (end === undefined) break
    pos = end
  }
  const next = index.elementAt(pos)
  if (next && next.tag === query.anchor.tag) return attached(next, 'position')
  return findAnchorTarget(index, query.anchor)
}

// ---------------------------------------------------------------------------
// Paths below an in-file element (JS-built and climbed targets, §5.6, R3-11)
// ---------------------------------------------------------------------------

/**
 * The path of `node` below `ancestor` (`ul:nth-of-type(1) > li:nth-of-type(3)`),
 * `''` for the ancestor itself, `undefined` when it is not a descendant.
 */
export function relativePath(
  index: HtmlIndex,
  ancestor: Parse5Element,
  node: Parse5Element
): string | undefined {
  const segments: string[] = []
  for (let cur: ParentNode | null = node; cur !== ancestor; cur = cur.parentNode) {
    if (!cur || !('tagName' in cur)) return undefined
    segments.push(`${cur.tagName}:nth-of-type(${index.nthOf(cur)})`)
  }
  return segments.reverse().join(' > ')
}

/** The element a relative path names below `ancestor`, if it exists in the file. */
export function resolveRelativePath(
  ancestor: Parse5Element,
  path: string
): Parse5Element | undefined {
  let cur: Parse5Element | undefined = ancestor
  for (const segment of path ? path.split(' > ') : []) {
    const match = NTH_SEGMENT.exec(segment)
    if (!match || !cur) return undefined
    const [, tag, nth] = match
    const sameTag: Parse5Element[] = cur.childNodes.filter(
      (child: ChildNode): child is Parse5Element => 'tagName' in child && child.tagName === tag
    )
    cur = sameTag[Number(nth) - 1]
  }
  return cur
}

/**
 * The anchor for a new comment on `el`, the in-file element a pick resolved
 * to. A `runtime` part from the page keeps its snapshot only when its path
 * does NOT name an element that exists in the file: decisions 16–17 give
 * snapshots to JS-built elements only (M-054).
 */
export function buildDraftAnchor(
  index: HtmlIndex,
  el: IndexedElement,
  runtime?: RuntimeAnchor
): CommentAnchor {
  const anchor = buildAnchor(index, el)
  if (!runtime) return anchor
  if (!resolveRelativePath(el.node, runtime.path)) return { ...anchor, runtime }
  const inFile: RuntimeAnchor = { ...runtime }
  delete inFile.snapshot
  delete inFile.truncated
  return { ...anchor, runtime: inFile }
}

// ---------------------------------------------------------------------------
// Snapshots (§5.3, decision 34)
// ---------------------------------------------------------------------------

/** A snapshot ready to store: stripped, and cut to the byte limit. */
export interface PreparedSnapshot {
  readonly snapshot: string
  readonly truncated: boolean
}

/** Byte ranges of nested erfana blocks and `data-erfana-el` attributes in a markup snippet. */
function snapshotCuts(html: string): Array<[number, number]> {
  // A <template> context accepts any snippet – a lone <tr> or <li> included –
  // without dropping its start tag, so every attribute keeps its location.
  const context = defaultTreeAdapter.createElement('template', htmlSpec.NS.HTML, [])
  const fragment = parseFragment(context, html, { sourceCodeLocationInfo: true })
  const cuts: Array<[number, number]> = []
  const pending: ChildNode[] = [...fragment.childNodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ('data' in node && node.nodeName === '#comment' && isBlockHeader(node.data)) {
      // parse5 gives every comment it parses a location when sourceCodeLocationInfo is on.
      const loc = node.sourceCodeLocation!
      cuts.push([loc.startOffset, loc.endOffset])
    }
    if (!('tagName' in node)) continue
    const attr = node.sourceCodeLocation?.attrs?.['data-erfana-el']
    if (attr) {
      let start = attr.startOffset
      while (start > 0 && HTML_WHITESPACE.has(html[start - 1])) start -= 1
      cuts.push([start, attr.endOffset])
    }
    pending.push(...node.childNodes)
    if ('content' in node) pending.push(...(node.content as ParentNode).childNodes)
  }
  return cuts.sort((a, b) => a[0] - b[0])
}

/**
 * The token attribute exactly as the instrumenter writes it and a browser's
 * `outerHTML` serializes it. The parse above misses a tag the tree builder
 * drops (a `<tr>` that a script appended to an `<li>`), so whatever is left in
 * this canonical form is removed as a last step.
 */
const CANONICAL_TOKEN_ATTRIBUTE = / data-erfana-el="[a-z2-7]{12}"/g

/** `text` cut to at most `maxBytes` UTF-8 bytes on a code-point boundary. */
function cutUtf8(text: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const ch of text) {
    const size = utf8Length(ch)
    if (bytes + size > maxBytes) break
    bytes += size
    end += ch.length
  }
  return text.slice(0, end)
}

/**
 * Prepare a JS-built element's `outerHTML` for `runtime.snapshot`: nested
 * erfana blocks and `data-erfana-el` attributes removed, then cut to
 * `COMMENT_SNAPSHOT_MAX_BYTES` on a code-point boundary. A cut never ends in
 * `-`, so it cannot leave half of a `--` or `<!--` at the end.
 */
export function prepareSnapshot(
  outerHtml: string,
  maxBytes: number = PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES
): PreparedSnapshot {
  let stripped = ''
  let pos = 0
  for (const [start, end] of snapshotCuts(outerHtml)) {
    // Cuts never overlap today; the max() keeps an overlapping one from repeating text.
    stripped += outerHtml.slice(pos, Math.max(pos, start))
    pos = Math.max(pos, end)
  }
  stripped = (stripped + outerHtml.slice(pos)).replace(CANONICAL_TOKEN_ATTRIBUTE, '')
  if (utf8Length(stripped) <= maxBytes) return { snapshot: stripped, truncated: false }
  return { snapshot: cutUtf8(stripped, maxBytes).replace(/-+$/, ''), truncated: true }
}
