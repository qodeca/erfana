// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a pick says about an element that is not in the file
 * (docs/designs/html-preview-comments.md §5.3 `runtime`, §5.6, §6
 * "JS-built elements", decisions 16–17 and 34, §19 R3-8; test J-007).
 *
 * A JS-built element has no token of its own. The pick names its nearest
 * tokened ancestor and describes the element below it: a structural path in
 * the same form main's `relativePath` writes (`ul:nth-of-type(1) >
 * li:nth-of-type(3)`), its tag, a text quote and an `outerHTML` snapshot.
 * Main re-validates all of it – the snapshot is untrusted page text, stripped
 * and cut again by `prepareSnapshot` before it is stored.
 */
import {
  BLOCK_HEADER,
  QUOTE_CONTEXT_CHARS,
  QUOTE_MAX_CHARS,
  SNAPSHOT_MAX_BYTES,
  TOKEN_ATTRIBUTE
} from './constants'

/** A text quote of an element (§5.3 `quote`). */
export interface PickQuote {
  readonly exact: string
  readonly prefix: string
  readonly suffix: string
}

/** A snapshot ready to send, cut to {@link SNAPSHOT_MAX_BYTES}. */
export interface PickSnapshot {
  readonly snapshot: string
  readonly truncated: boolean
}

const SEGMENT = /^(.+):nth-of-type\((\d+)\)$/
const WHITESPACE = /\s+/g

/** 1-based position of `element` among its parent's element children with the same tag. */
function nthOfType(element: Element): number {
  let n = 1
  for (let cur = element.previousElementSibling; cur !== null; cur = cur.previousElementSibling) {
    if (cur.localName === element.localName) n += 1
  }
  return n
}

/**
 * The path of `element` below `ancestor`, `''` for the ancestor itself,
 * `undefined` when it is not a descendant.
 */
export function pathBelow(ancestor: Element, element: Element): string | undefined {
  const segments: string[] = []
  for (let cur: Element | null = element; cur !== ancestor; cur = cur.parentElement) {
    if (cur === null) return undefined
    segments.push(`${cur.localName}:nth-of-type(${nthOfType(cur)})`)
  }
  return segments.reverse().join(' > ')
}

/** The element a {@link pathBelow} path names below `ancestor`, if it is there now. */
export function resolvePath(ancestor: Element, path: string): Element | undefined {
  let cur: Element | undefined = ancestor
  for (const segment of path === '' ? [] : path.split(' > ')) {
    const match = SEGMENT.exec(segment)
    if (match === null || cur === undefined) return undefined
    const [, tag, nth] = match
    cur = [...cur.children].filter(child => child.localName === tag)[Number(nth) - 1]
  }
  return cur
}

/** Whether `unit` is the first half of a surrogate pair. */
function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}

/** At most `max` UTF-16 units from the start, never splitting a surrogate pair. */
function head(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max).trimEnd()
}

/** At most `max` UTF-16 units from the end, never splitting a surrogate pair. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text
  const start = text.length - max
  return text.slice(isHighSurrogate(text.charCodeAt(start - 1)) ? start + 1 : start).trimStart()
}

function normalized(text: string): string {
  return text.replace(WHITESPACE, ' ').trim().normalize('NFC')
}

/** Text of `scope` before (or after) `element`, in document order. */
function textAround(scope: Element, element: Element, before: boolean): string {
  const walker = scope.ownerDocument.createTreeWalker(scope, 4 /* NodeFilter.SHOW_TEXT */)
  let out = ''
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (element.contains(node)) continue
    const precedes = (element.compareDocumentPosition(node) & 2) !== 0 // DOCUMENT_POSITION_PRECEDING
    if (precedes === before) out += (node as Text).data
  }
  return out
}

/** The quote of `element` inside `scope` (its tokened ancestor), or `undefined` when it has no text. */
export function quoteOf(scope: Element, element: Element): PickQuote | undefined {
  const exact = head(normalized(element.textContent ?? ''), QUOTE_MAX_CHARS)
  if (exact === '') return undefined
  return {
    exact,
    prefix: tail(normalized(textAround(scope, element, true)), QUOTE_CONTEXT_CHARS),
    suffix: head(normalized(textAround(scope, element, false)), QUOTE_CONTEXT_CHARS)
  }
}

/** UTF-8 length of one code point. */
function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  return codePoint < 0x10000 ? 3 : 4
}

/** `text` cut to at most `maxBytes` UTF-8 bytes on a code-point boundary. */
function cutUtf8(text: string, maxBytes: number): string | undefined {
  let bytes = 0
  let end = 0
  for (const ch of text) {
    bytes += utf8Size(ch.codePointAt(0) as number)
    if (bytes > maxBytes) return text.slice(0, end)
    end += ch.length
  }
  return undefined
}

/** Remove nested erfana blocks and token attributes from serialized markup. */
function strip(html: string): string {
  const tokenAttribute = new RegExp(` ${TOKEN_ATTRIBUTE}="[^"]*"`, 'g')
  let out = ''
  let pos = 0
  for (let open = html.indexOf('<!--'); open >= 0; open = html.indexOf('<!--', pos)) {
    const close = html.indexOf('-->', open + 4)
    const end = close < 0 ? html.length : close + 3
    out += html.slice(pos, open)
    if (!BLOCK_HEADER.test(html.slice(open + 4, end))) out += html.slice(open, end)
    pos = end
  }
  return (out + html.slice(pos)).replace(tokenAttribute, '')
}

/**
 * `element`'s `outerHTML` (§5.3 snapshot): nested erfana blocks and token
 * attributes removed, then cut to {@link SNAPSHOT_MAX_BYTES} on a code-point
 * boundary, never ending in `-` (decision 34). Read from the live element –
 * never cloned, so no page constructor runs during a pick.
 */
export function snapshotOf(element: Element): PickSnapshot {
  const stripped = strip(element.outerHTML)
  const cut = cutUtf8(stripped, SNAPSHOT_MAX_BYTES)
  if (cut === undefined) return { snapshot: stripped, truncated: false }
  return { snapshot: cut.replace(/-+$/, ''), truncated: true }
}

/**
 * `collapse` when the parent of `anchor` collapses white space, else
 * `preserve` (R3-8). Main places a block on its own lines only for
 * `collapse`, so an unknown or missing value takes the safe side.
 */
export function whiteSpaceOf(anchor: Element): 'collapse' | 'preserve' {
  const parent = anchor.parentElement
  if (parent === null) return 'preserve'
  const style = anchor.ownerDocument.defaultView?.getComputedStyle(parent)
  if (style === undefined) return 'preserve'
  const collapse = style.getPropertyValue('white-space-collapse')
  if (collapse !== '') return collapse === 'collapse' ? 'collapse' : 'preserve'
  const whiteSpace = style.getPropertyValue('white-space')
  return whiteSpace === 'normal' || whiteSpace === 'nowrap' ? 'collapse' : 'preserve'
}
