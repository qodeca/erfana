// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Anchors in HTML: how a block names its element
 * (docs/designs/comments/html-preview-comments.md §5.3, §5.9, §19 R3-10).
 *
 * The anchor builder reads the parse5 tree: tag, `id`, classes, the CSS path
 * from `html` down, and the text quote. How a block finds its element again
 * is kind-agnostic and lives in `../comments/reattach.ts`, and the header test
 * in `../comments/blocks.ts`; both are re-exported here, so this module stays
 * the HTML entry for anchors.
 *
 * Quote text is the element's readable text (no `script`, `style`,
 * `noscript`, template content) with whitespace runs collapsed to one space,
 * trimmed and NFC-normalised, so reformatting and NFD file names typed on
 * macOS do not break a match (U-088; `quoteText.ts`).
 */
import {
  defaultTreeAdapter,
  html as htmlSpec,
  parseFragment,
  type DefaultTreeAdapterMap
} from 'parse5'
import { PREVIEW_LIMITS } from '../preview-limits'
import { isBlockHeader } from '../comments/blocks'
import { utf8Length } from '../comments/encoding'
import {
  ANCHOR_CLASS_MAX_CHARS,
  ANCHOR_ID_MAX_CHARS,
  ANCHOR_PATH_MAX_CHARS,
  type CommentAnchor,
  type RuntimeAnchor,
  type TextQuote
} from '../comments/format'
import type { HtmlIndex, IndexedElement, Parse5Element } from './htmlIndex'
import { exactOf, prefixOf, suffixOf } from '../comments/quoteText'

export { QUOTE_CONTEXT_CHARS } from '../comments/quoteText'
export { BLOCK_HEADER, isBlockHeader } from '../comments/blocks'
export {
  findAnchorTarget,
  resolveBlockTarget,
  type BlockTargetQuery,
  type TargetResolution,
  type TargetVia
} from '../comments/reattach'

type ChildNode = DefaultTreeAdapterMap['childNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']

const HTML_WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\f', '\r'])
const NTH_SEGMENT = /^(.+):nth-of-type\((\d+)\)$/

/** Whitespace collapsed to single spaces, trimmed, NFC. */
export function normalizeQuoteText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().normalize('NFC')
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
