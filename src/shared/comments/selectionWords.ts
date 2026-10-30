// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The selected words of a comment, worked out from a target's text and a
 * range in it – the one rule set both main (`mdAnchor.markdownSelection`)
 * and the renderer's comment window use (spec 024 024-FR-004; comments-v2
 * C-07; selection design S2).
 *
 * - **Text** is the target's text as a selection reads it: whitespace runs
 *   to one space, trimmed, NFC ({@link collapseRange}).
 * - **The words** are trimmed; only spaces are refused; the whole text is a
 *   comment on the whole target; more than {@link SEL_EXACT_MAX_CHARS} code
 *   points are cut there, on a grapheme boundary.
 * - **Context** is up to {@link SEL_CONTEXT_MAX_CHARS} code points each side –
 *   the widest the format stores, so a tie is final: when another occurrence
 *   has the same words and the same context, the words cannot be found again
 *   and the window offers the whole target instead.
 *
 * Pure: no DOM, no globals beyond `Intl`.
 */
import { codePointLength } from './format'
import { isAnchorSelection, SEL_CONTEXT_MAX_CHARS, SEL_EXACT_MAX_CHARS, type AnchorSelection } from './anchorSel'

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })
/** UTF-16 units read around a selection for its context: far more than 32 graphemes need. */
const CONTEXT_WINDOW = SEL_CONTEXT_MAX_CHARS * 16
const SPACE = /\s/

/** At most `max` code points from the end of `text`, cut on a grapheme boundary. */
export function tailOf(text: string, max: number): string {
  const window = text.slice(-CONTEXT_WINDOW)
  const segments = [...GRAPHEMES.segment(window)]
  let count = 0
  let start = window.length
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    count += codePointLength(segments[i].segment)
    if (count > max) break
    start = segments[i].index
  }
  return window.slice(start)
}

/** At most `max` code points from the start of `text`, cut on a grapheme boundary. */
export function headOf(text: string, max: number, window = CONTEXT_WINDOW): string {
  let count = 0
  let end = 0
  for (const { segment, index } of GRAPHEMES.segment(text.slice(0, window))) {
    count += codePointLength(segment)
    if (count > max) break
    end = index + segment.length
  }
  return text.slice(0, end)
}

/** Every offset `exact` starts at in `text`. */
export function occurrences(text: string, exact: string): number[] {
  const found: number[] = []
  if (exact === '') return found
  for (let at = text.indexOf(exact); at !== -1; at = text.indexOf(exact, at + 1)) found.push(at)
  return found
}

/** The offsets in `text` where `exact` sits between `prefix` and `suffix`. */
export function occurrencesInContext(text: string, sel: AnchorSelection): number[] {
  return occurrences(text, sel.exact).filter(
    at => text.slice(0, at).endsWith(sel.prefix) && text.startsWith(sel.suffix, at + sel.exact.length)
  )
}

/** A target's text and a range in it (UTF-16 offsets, `start <= end`). */
export interface WordsRange {
  readonly text: string
  readonly start: number
  readonly end: number
}

/**
 * `raw` – a target's text as the page holds it – collapsed the way a
 * selection reads it, with the range `[start, end)` carried along.
 *
 * Each of the three parts is normalised to NFC on its own, so the offsets
 * stay exact; a join that NFC would compose is left as it is, and the
 * format's own check refuses such words later ({@link chooseWords}).
 */
export function collapseRange(raw: string, start: number, end: number): WordsRange {
  const from = Math.max(0, Math.min(start, raw.length))
  const to = Math.max(from, Math.min(end, raw.length))
  let out = ''
  let outStart = -1
  let outEnd = -1
  for (let i = 0; i <= raw.length; i += 1) {
    if (i === from) outStart = out.length
    if (i === to) outEnd = out.length
    if (i === raw.length) break
    const char = raw[i]
    if (SPACE.test(char)) {
      if (out !== '' && !out.endsWith(' ')) out += ' '
    } else out += char
  }
  if (out.endsWith(' ')) out = out.slice(0, -1)
  const clamp = (n: number): number => Math.min(n, out.length)
  const s = clamp(outStart)
  const e = Math.max(s, clamp(outEnd))
  const before = out.slice(0, s).normalize('NFC')
  const words = out.slice(s, e).normalize('NFC')
  const after = out.slice(e).normalize('NFC')
  return { text: before + words + after, start: before.length, end: before.length + words.length }
}

/** What a range in a target's text comments on. */
export type WordsChoice =
  /** No range, or the whole text: a comment on the whole target. */
  | { readonly kind: 'whole' }
  /** Only spaces are selected: refused. */
  | { readonly kind: 'blank' }
  /** The words could not be found again (a tie, or not storable): the window offers the whole target. */
  | { readonly kind: 'tie' }
  /** The words, as `anchor.sel`; `cut` when the selection was longer than {@link SEL_EXACT_MAX_CHARS}. */
  | { readonly kind: 'words'; readonly sel: AnchorSelection; readonly cut: boolean; readonly start: number; readonly end: number }

/**
 * The words a comment is about, from a range in a target's collapsed text.
 *
 * @param range - From {@link collapseRange}.
 * @returns {@link WordsChoice}
 *
 * @example
 * ```ts
 * chooseWords({ text: 'Ship by Friday.', start: 5, end: 14 })
 * // { kind: 'words', sel: { exact: 'by Friday', prefix: 'Ship ', suffix: '.' }, cut: false, start: 5, end: 14 }
 * ```
 */
export function chooseWords(range: WordsRange): WordsChoice {
  const { text } = range
  let start = Math.max(0, Math.min(range.start, text.length))
  let end = Math.max(start, Math.min(range.end, text.length))
  if (start === end) return { kind: 'whole' }
  if (text.slice(start, end).trim() === '') return { kind: 'blank' }
  while (text[start] === ' ') start += 1
  while (text[end - 1] === ' ') end -= 1
  if (start === 0 && end === text.length) return { kind: 'whole' }
  let exact = text.slice(start, end)
  let cut = false
  if (codePointLength(exact) > SEL_EXACT_MAX_CHARS) {
    exact = headOf(exact, SEL_EXACT_MAX_CHARS, exact.length).trimEnd()
    end = start + exact.length
    cut = true
  }
  const sel = {
    exact,
    prefix: tailOf(text.slice(0, start), SEL_CONTEXT_MAX_CHARS),
    suffix: headOf(text.slice(end), SEL_CONTEXT_MAX_CHARS)
  }
  if (!isAnchorSelection(sel) || occurrencesInContext(text, sel).length !== 1) return { kind: 'tie' }
  return { kind: 'words', sel, cut, start, end }
}

/**
 * Where stored words are in a target's collapsed text now: the one
 * occurrence inside their context, else the one occurrence at all; `null`
 * when they are gone or ambiguous (no underline is drawn then).
 */
export function locateWords(text: string, sel: AnchorSelection): { readonly start: number; readonly end: number } | null {
  const inContext = occurrencesInContext(text, sel)
  const found = inContext.length > 0 ? inContext : occurrences(text, sel.exact)
  if (found.length !== 1) return null
  return { start: found[0], end: found[0] + sel.exact.length }
}
