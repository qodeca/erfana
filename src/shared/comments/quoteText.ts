// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The text of a quote anchor (docs/designs/comments/html-preview-comments.md §5.3,
 * §5.9 step 4): an element's readable text, and the text on each side of it,
 * read from {@link HtmlIndex.visibleText} with whitespace runs collapsed to one
 * space, trimmed and NFC-normalised, so reformatting and NFD file names typed
 * on macOS do not break a match (U-088).
 *
 * Every reader takes an optional {@link WorkMeter}. Building one anchor reads
 * one element; re-attaching orphaned blocks reads the quotes of many elements
 * in one parse, and there the meter caps the characters all those reads may
 * visit together (`anchorLookup.ts`). A read that runs out of meter stops
 * early and its text is incomplete: the caller must discard it.
 */
import { PREVIEW_LIMITS } from '../preview-limits'
import type { HtmlIndex, IndexedElement } from '../htmlComments/htmlIndex'

/** Characters of context kept on each side of a quote. */
export const QUOTE_CONTEXT_CHARS = 32
/** Raw characters scanned on each side of an element for its context. */
const CONTEXT_WINDOW = 512
/** Extra characters collected before NFC, which may compose a few away. */
const NFC_SLACK = 8

const WHITESPACE = /\s/
const SPACE = 0x20
const TAB = 0x09
const CARRIAGE_RETURN = 0x0d
const FIRST_NON_ASCII = 0x80

/**
 * `/\s/` on the one UTF-16 unit at `text[i]`. The ASCII cases – nearly every
 * character of a page – are decided without the regex: space, and U+0009 to
 * U+000D (tab, line feed, vertical tab, form feed, carriage return).
 */
export function isQuoteWhitespace(text: string, i: number): boolean {
  const unit = text.charCodeAt(i)
  if (unit < FIRST_NON_ASCII) return unit === SPACE || (unit >= TAB && unit <= CARRIAGE_RETURN)
  return WHITESPACE.test(text[i])
}

/** Characters the reads it is passed to may still visit, shared by all of them. */
export interface WorkMeter {
  left: number
}

/** A meter that never runs out: a single read, such as building one anchor. */
const UNMETERED: WorkMeter = { left: Number.POSITIVE_INFINITY }

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff
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

/**
 * Normalised text of `text[from, to)`, read forwards, at most `max` characters.
 * Collects up to `max + NFC_SLACK` characters – words joined by one space –
 * then normalises and cuts. A run of non-whitespace is copied in one slice,
 * ending exactly where a character-by-character copy would have stopped.
 */
function headText(text: string, from: number, to: number, max: number, meter: WorkMeter): string {
  const stop = Math.min(to, from + meter.left)
  const limit = max + NFC_SLACK
  let out = ''
  let gap = false
  let i = from
  while (i < stop && out.length < limit) {
    if (isQuoteWhitespace(text, i)) {
      gap = out.length > 0
      i += 1
      continue
    }
    if (gap) out += ' '
    gap = false
    // text[i] goes in; each later character only while `out` is under the limit.
    const runEnd = Math.min(stop, i + Math.max(1, limit - out.length))
    let end = i + 1
    while (end < runEnd && !isQuoteWhitespace(text, end)) end += 1
    out += text.slice(i, end)
    i = end
  }
  meter.left -= i - from
  return cutHead(out.normalize('NFC'), max)
}

/** {@link headText} read backwards from `to`: the text just before a point. */
function tailText(text: string, from: number, to: number, max: number, meter: WorkMeter): string {
  const stop = Math.max(from, to - meter.left)
  const limit = max + NFC_SLACK
  let out = ''
  let gap = false
  let i = to - 1
  while (i >= stop && out.length < limit) {
    if (isQuoteWhitespace(text, i)) {
      gap = out.length > 0
      i -= 1
      continue
    }
    if (gap) out = ` ${out}`
    gap = false
    const runStart = Math.max(stop, i - Math.max(1, limit - out.length) + 1)
    let start = i - 1
    while (start >= runStart && !isQuoteWhitespace(text, start)) start -= 1
    out = text.slice(start + 1, i + 1) + out
    i = start
  }
  meter.left -= to - 1 - i
  return cutTail(out.normalize('NFC'), max)
}

/** The element's own readable text, at most `COMMENT_QUOTE_MAX_CHARS` characters. */
export function exactOf(index: HtmlIndex, el: IndexedElement, meter = UNMETERED): string {
  return headText(
    index.visibleText,
    el.textStart,
    el.textEnd,
    PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS,
    meter
  )
}

/** The readable text just before the element, at most {@link QUOTE_CONTEXT_CHARS}. */
export function prefixOf(index: HtmlIndex, el: IndexedElement, meter = UNMETERED): string {
  const from = Math.max(0, el.textStart - CONTEXT_WINDOW)
  return tailText(index.visibleText, from, el.textStart, QUOTE_CONTEXT_CHARS, meter)
}

/** The readable text just after the element, at most {@link QUOTE_CONTEXT_CHARS}. */
export function suffixOf(index: HtmlIndex, el: IndexedElement, meter = UNMETERED): string {
  const to = Math.min(index.visibleText.length, el.textEnd + CONTEXT_WINDOW)
  return headText(index.visibleText, el.textEnd, to, QUOTE_CONTEXT_CHARS, meter)
}
