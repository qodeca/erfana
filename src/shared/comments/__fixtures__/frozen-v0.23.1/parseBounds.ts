// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Bounds on one parse5 pass over a page (docs/designs/html-preview-comments.md
 * §19 Rev 4 "Element cap"; security review S-M).
 *
 * Counting start tags before the parse (`hasMoreStartTagsThan`) bounds what a
 * well-formed page makes the parser build, but not what a hostile one can:
 *
 * - **Elements no start tag names.** The tree builder makes elements of its
 *   own: "reconstruct the active formatting elements" re-opens every open
 *   `<b>`, `<i>`, `<a>`… in each new paragraph (1,000 distinct `<b a=N>` and
 *   2,000 `<p>x` – 17 KB – build 2 million elements), and every stray `</p>`
 *   in a body builds an empty `<p>` (with no start tag at all). So elements are
 *   counted as the parser CREATES them, and the parse stops at the cap.
 * - **Work no element shows.** parse5 rescans its open-element stack, and its
 *   list of active formatting elements, for every new tag: 100,000 unclosed
 *   `<div>` (500 KB) take minutes, 20,000 unclosed distinct `<b a=N>` take
 *   11 s. Every scan goes through the tree adapter, so its calls are counted
 *   as the parse's work, against a budget per character of page: real pages
 *   measured 1.1 calls a character, a page nested 512 deep (Chromium's own
 *   limit) 12, so {@link PARSE_WORK_PER_CHAR} never refuses one of them.
 * - **Attributes.** The tokenizer looks for a duplicate of each attribute
 *   among the tag's earlier ones, so one tag with 40,000 attributes takes 6.5 s
 *   before the tree builder sees it. That never reaches the tree adapter, so
 *   it is bounded on the bytes before the parse ({@link hasAttributeFlood}).
 *
 * A page past any bound is "page too large", like one past the start-tag
 * count: served raw, read-only, no comments. The cost is bounded either way;
 * the crash or the worker's time limit is the last resort, not the plan.
 */
import { defaultTreeAdapter, type DefaultTreeAdapterMap, type TreeAdapter } from 'parse5-v0.23.1'
import { PREVIEW_LIMITS } from './preview-limits'

/**
 * Elements a parse may create beyond the token cap: the ones a page builds
 * without a start tag of its own (the implied `html`, `head`, `body`,
 * `tbody`, a reconstructed formatting element now and then). Inside it, the
 * start-tag count and the token cap stay the judges of a page at the cap; at
 * the cap plus this, a tree still fits the worker's heap (650,000 elements
 * ran with 1,536 MB of its 2,048 MB, §19 Rev 4).
 */
export const PARSE_ELEMENT_SLACK = 65_536
/** Tree-adapter calls one parse may make per character of page (module comment). */
export const PARSE_WORK_PER_CHAR = 16
/** Tree-adapter calls every parse may make, however short the page. */
export const PARSE_WORK_FLOOR = 1_000_000
/** Attribute comparisons the tokenizer may make per byte of page (see {@link hasAttributeFlood}). */
export const ATTRIBUTE_PAIRS_PER_BYTE = 4
/** Attribute comparisons every page may make, however short. */
export const ATTRIBUTE_PAIRS_FLOOR = 1_000_000

/** What a parse may use. */
export interface HtmlParseLimits {
  /** Elements the parser may create, its own included. */
  readonly maxElements: number
  /** Tree-adapter calls the parse may make. */
  readonly maxWork: number
}

/** Why a parse was stopped before it finished: the page needs more than one parse may use. */
export class HtmlParseLimitError extends Error {
  constructor(readonly limit: 'elements' | 'work') {
    super(`htmlComments: the page needs more ${limit} than one parse may use`)
    this.name = 'HtmlParseLimitError'
  }
}

/** The limits for a page of `chars` UTF-16 units. */
export function parseLimitsFor(
  chars: number,
  maxElements = PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT + PARSE_ELEMENT_SLACK
): HtmlParseLimits {
  return { maxElements, maxWork: PARSE_WORK_FLOOR + PARSE_WORK_PER_CHAR * chars }
}

/** No bounds: for a suite that tests the walk over a tree the bounds would refuse. */
export const UNBOUNDED_PARSE: HtmlParseLimits = Object.freeze({ maxElements: Infinity, maxWork: Infinity })

type AdapterMethod = (...args: unknown[]) => unknown

/**
 * parse5's default tree adapter, counting: every call is work, every
 * `createElement` an element, and either past its limit throws
 * {@link HtmlParseLimitError} out of `parse`. One adapter per parse.
 */
export function boundedTreeAdapter(limits: HtmlParseLimits): TreeAdapter<DefaultTreeAdapterMap> {
  let work = 0
  let elements = 0
  const bounded: Record<string, unknown> = {}
  for (const [name, member] of Object.entries(defaultTreeAdapter)) {
    if (typeof member !== 'function') {
      bounded[name] = member
      continue
    }
    const method = member as AdapterMethod
    const counted: AdapterMethod =
      name === 'createElement'
        ? (...args) => {
            if (++elements > limits.maxElements) throw new HtmlParseLimitError('elements')
            if (++work > limits.maxWork) throw new HtmlParseLimitError('work')
            return method.apply(bounded, args)
          }
        : (...args) => {
            if (++work > limits.maxWork) throw new HtmlParseLimitError('work')
            return method.apply(bounded, args)
          }
    bounded[name] = counted
  }
  return bounded as unknown as TreeAdapter<DefaultTreeAdapterMap>
}

const LESS_THAN = 0x3c
const GREATER_THAN = 0x3e
const SLASH = 0x2f
const EQUALS = 0x3d
const DOUBLE_QUOTE = 0x22
const SINGLE_QUOTE = 0x27
/** OR-ed into an ASCII letter, this bit makes it lower case. */
const ASCII_LOWER_BIT = 0x20
const LOWER_A = 0x61
const LOWER_Z = 0x7a

/** HTML whitespace: tab, LF, FF, CR, space. */
function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x09 || byte === 0x0c || byte === 0x0d
}

/** The end of the run starting at `from` that stops at whitespace, `/`, `>` (and `=` when `stopAtEquals`). */
function skipName(bytes: Uint8Array, from: number, stopAtEquals: boolean): number {
  let at = from
  while (at < bytes.length) {
    const byte = bytes[at]
    if (isSpace(byte) || byte === SLASH || byte === GREATER_THAN || (stopAtEquals && byte === EQUALS)) break
    at += 1
  }
  return at
}

/** Past an attribute's `= value`, if it has one; `at` is just after the name. */
function skipValue(bytes: Uint8Array, from: number): number {
  let at = from
  while (at < bytes.length && isSpace(bytes[at])) at += 1
  if (bytes[at] !== EQUALS) return at
  at += 1
  while (at < bytes.length && isSpace(bytes[at])) at += 1
  const quote = bytes[at]
  if (quote === DOUBLE_QUOTE || quote === SINGLE_QUOTE) {
    const close = bytes.indexOf(quote, at + 1)
    return close === -1 ? bytes.length : close + 1
  }
  while (at < bytes.length && !isSpace(bytes[at]) && bytes[at] !== GREATER_THAN) at += 1
  return at
}

/**
 * Whether `bytes` hold a start tag with more than `perTag` attributes, or
 * make the tokenizer compare more attribute pairs than
 * {@link ATTRIBUTE_PAIRS_FLOOR} + {@link ATTRIBUTE_PAIRS_PER_BYTE} a byte.
 *
 * Read the way the tokenizer reads a start tag – a `<` and an ASCII letter,
 * the name, then attributes, each name up to whitespace, `/`, `>` or `=`, and
 * a quoted or unquoted value – without parsing. The `n`th attribute of a tag
 * is compared with the ones before it, so a tag of `n` costs `n(n-1)/2`. An
 * upper bound, as `hasMoreStartTagsThan` is: a `<a` inside a script counts
 * too, and a duplicate attribute counts as if it were new.
 *
 * @param bytes - The file's bytes.
 * @param perTag - Attributes one start tag may have.
 */
export function hasAttributeFlood(
  bytes: Uint8Array,
  perTag: number = PREVIEW_LIMITS.COMMENT_MAX_ATTRIBUTES_PER_TAG
): boolean {
  const maxPairs = ATTRIBUTE_PAIRS_FLOOR + ATTRIBUTE_PAIRS_PER_BYTE * bytes.length
  let pairs = 0
  let at = bytes.indexOf(LESS_THAN)
  while (at !== -1) {
    // Past the end, `undefined | 0x20` is 0x20: not a letter.
    const first = bytes[at + 1] | ASCII_LOWER_BIT
    if (first < LOWER_A || first > LOWER_Z) {
      at = bytes.indexOf(LESS_THAN, at + 1)
      continue
    }
    let cursor = skipName(bytes, at + 2, false)
    let count = 0
    for (;;) {
      while (cursor < bytes.length && (isSpace(bytes[cursor]) || bytes[cursor] === SLASH)) cursor += 1
      if (cursor >= bytes.length || bytes[cursor] === GREATER_THAN) break
      // The first character of a name may be `=` (the tokenizer takes it as part of the name).
      cursor = skipValue(bytes, skipName(bytes, cursor + 1, true))
      pairs += count
      count += 1
      if (count > perTag || pairs > maxPairs) return true
    }
    at = cursor >= bytes.length ? -1 : bytes.indexOf(LESS_THAN, cursor + 1)
  }
  return false
}
