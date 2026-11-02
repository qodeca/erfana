// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selected words in the page (spec 024 024-FR-004, 024-AC-004; comments-v2
 * C-07, C-12).
 *
 * Two directions, both reading an element's text the way a selection reads
 * it – whitespace runs to one space, trimmed, NFC – as the shared rules do
 * (`shared/comments/selectionWords.ts`, which this sealed preload cannot
 * import, ADR 0006; `words.test.ts` runs both on the same samples):
 *
 * - {@link readSelection}: the page's selection as a pick's words – the
 *   target (the smallest element holding the whole selection; never `html`,
 *   `body` or `main`, where it is cut to the element it started in), the
 *   words cut to 200 code points on a grapheme boundary, and 32 code points of
 *   context on each side. Only spaces: no words. The whole element's text: the
 *   element, no words. Main looks the words up in its own parse; nothing here
 *   is trusted there.
 * - {@link rectsOfWords}: where stored words are in an element now, for the
 *   comment mark – none when they are gone or appear more than once.
 *
 * Nothing here writes to the page's DOM or its selection.
 */
import { SEL_CONTEXT_MAX_CHARS, SEL_EXACT_MAX_CHARS, WORDS_TEXT_MAX_CHARS } from './constants'

/** `anchor.sel`'s shape: the words and the text on each side of them. */
export interface PageSel {
  readonly exact: string
  readonly prefix: string
  readonly suffix: string
}

/** A selection, as a pick says it. */
export interface PageWords {
  readonly target: Element
  /** Absent: the selection is the whole element's text – a comment on the element. */
  readonly sel?: PageSel
  /** The selection was longer than {@link SEL_EXACT_MAX_CHARS} code points. */
  readonly long?: true
  /** The selection ran past the target and was cut to the element it started in. */
  readonly crossed?: true
}

/** Elements a selection's target is never: the selection is cut to where it started instead. */
const NEVER_TARGETS: ReadonlySet<string> = new Set(['html', 'head', 'body', 'main'])
const SPACE = /\s/

/** Number of code points in `text`. */
function codePoints(text: string): number {
  return Array.from(text).length
}

function graphemes(text: string): Intl.SegmentData[] {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)]
}

/** At most `max` code points from the start of `text`, cut on a grapheme boundary. */
export function headOf(text: string, max: number): string {
  let count = 0
  let end = 0
  for (const { segment, index } of graphemes(text.slice(0, max * 16))) {
    count += codePoints(segment)
    if (count > max) break
    end = index + segment.length
  }
  return text.slice(0, end)
}

/** At most `max` code points from the end of `text`, cut on a grapheme boundary. */
export function tailOf(text: string, max: number): string {
  const window = text.slice(-max * 16)
  const segments = graphemes(window)
  let count = 0
  let start = window.length
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    count += codePoints(segments[i].segment)
    if (count > max) break
    start = segments[i].index
  }
  return window.slice(start)
}

/** `raw` with whitespace collapsed and trimmed, and `[start, end)` carried along; each part NFC. */
export function collapse(raw: string, start: number, end: number): { text: string; start: number; end: number } {
  let out = ''
  let outStart = 0
  let outEnd = 0
  for (let i = 0; i <= raw.length; i += 1) {
    if (i === start) outStart = out.length
    if (i === end) outEnd = out.length
    if (i === raw.length) break
    if (!SPACE.test(raw[i])) out += raw[i]
    else if (out !== '' && !out.endsWith(' ')) out += ' '
  }
  if (out.endsWith(' ')) out = out.slice(0, -1)
  const s = Math.min(outStart, out.length)
  const e = Math.max(s, Math.min(outEnd, out.length))
  const before = out.slice(0, s).normalize('NFC')
  const words = out.slice(s, e).normalize('NFC')
  return { text: before + words + out.slice(e).normalize('NFC'), start: before.length, end: before.length + words.length }
}

/** The element a node is, or is in. */
function elementOf(node: Node): Element | null {
  return node.nodeType === 1 ? (node as Element) : node.parentElement
}

/**
 * The smallest element holding all of `range`, or – when that is `html`,
 * `body` or `main` – the child of it the range starts in (`crossed`).
 */
export function selectionTarget(range: Range): { readonly target: Element; readonly crossed: boolean } | null {
  const common = elementOf(range.commonAncestorContainer)
  if (common === null) return null
  if (!NEVER_TARGETS.has(common.localName)) return { target: common, crossed: false }
  let child = elementOf(range.startContainer)
  while (child !== null && child.parentElement !== common) child = child.parentElement
  if (child === null || NEVER_TARGETS.has(child.localName)) return null
  return { target: child, crossed: true }
}

/** Characters of `target`'s text before the boundary point `(node, offset)`. */
function offsetIn(target: Element, node: Node, offset: number): number {
  const before = target.ownerDocument.createRange()
  before.setStart(target, 0)
  before.setEnd(node, offset)
  return before.toString().length
}

/** The words of `range` inside `target`; `null` when only spaces are selected. */
export function wordsOf(target: Element, range: Range, crossed: boolean): PageWords | null {
  const raw = target.textContent ?? ''
  if (raw.length > WORDS_TEXT_MAX_CHARS) return { target }
  const ends = target.contains(range.endContainer)
  const from = offsetIn(target, range.startContainer, range.startOffset)
  const to = ends ? offsetIn(target, range.endContainer, range.endOffset) : raw.length
  const { text, start, end } = collapse(raw, from, to)
  let s = start
  let e = end
  while (s < e && text[s] === ' ') s += 1
  while (e > s && text[e - 1] === ' ') e -= 1
  if (s === e) return null
  if (s === 0 && e === text.length) return { target }
  let exact = text.slice(s, e)
  const long = codePoints(exact) > SEL_EXACT_MAX_CHARS
  // Not trimmed: main finds these 200 and reaches one character past them, so the window cuts and says so.
  if (long) exact = headOf(exact, SEL_EXACT_MAX_CHARS)
  const sel = {
    exact,
    prefix: tailOf(text.slice(0, s), SEL_CONTEXT_MAX_CHARS),
    suffix: headOf(text.slice(s + exact.length), SEL_CONTEXT_MAX_CHARS)
  }
  return { target, sel, ...(long ? { long: true as const } : {}), ...(crossed || !ends ? { crossed: true as const } : {}) }
}

/**
 * The page's selection as a pick's words; `null` when nothing (or only
 * spaces) is selected, or the selection is in Erfana's own overlay.
 */
export function readSelection(win: Window, isOverlay: (node: Node) => boolean): PageWords | null {
  const selection = win.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (isOverlay(range.commonAncestorContainer)) return null
  const place = selectionTarget(range)
  return place === null ? null : wordsOf(place.target, range, place.crossed)
}

/** Every offset of `exact` in `text`. */
function occurrences(text: string, exact: string): number[] {
  const found: number[] = []
  for (let at = text.indexOf(exact); at !== -1; at = text.indexOf(exact, at + 1)) found.push(at)
  return found
}

/** Where `sel` is in `text`: the one occurrence in its context, else the one at all; `null` otherwise. */
export function locate(text: string, sel: PageSel): number | null {
  const all = occurrences(text, sel.exact)
  const inContext = all.filter(at => text.slice(0, at).endsWith(sel.prefix) && text.startsWith(sel.suffix, at + sel.exact.length))
  const found = inContext.length > 0 ? inContext : all
  return found.length === 1 ? found[0] : null
}

/** One character of an element's collapsed text, and the text node it came from. */
interface Source {
  readonly node: Text
  readonly offset: number
}

/** `element`'s collapsed text with each character's source. */
function mappedText(element: Element): { text: string; at: Source[] } {
  let text = ''
  const at: Source[] = []
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const data = node.data
    for (let i = 0; i < data.length; i += 1) {
      if (SPACE.test(data[i])) {
        if (text === '' || text.endsWith(' ')) continue
        text += ' '
      } else text += data[i]
      at.push({ node, offset: i })
    }
    if (text.length > WORDS_TEXT_MAX_CHARS) return { text: '', at: [] }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    at.pop()
  }
  return { text, at }
}

/**
 * A `Range` over `sel` in `element` now; `null` when the words are gone,
 * appear more than once, or the text is not NFC (no mark then).
 */
export function rangeOfWords(element: Element, sel: PageSel): Range | null {
  const { text, at } = mappedText(element)
  if (text === '' || text !== text.normalize('NFC')) return null
  const start = locate(text, sel)
  if (start === null) return null
  const first = at[start]
  const last = at[start + sel.exact.length - 1]
  const range = element.ownerDocument.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}

/** The line boxes of `range` that have an area. */
export function rectsOf(range: Range): DOMRect[] {
  return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
}
