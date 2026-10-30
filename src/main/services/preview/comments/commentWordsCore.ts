// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of an HTML Preview comment, checked against main's own parse
 * (spec 024 024-FR-004, 024-AC-004; comments-v2 C-07).
 *
 * The page says which words were selected (`sel` on its pick). That is page
 * text, so it is never trusted: the words are looked up in the target's
 * visible text as MAIN parsed it from disk – parse5's readable text, collapsed
 * the way a selection reads it (`shared/comments/selectionWords.ts`). Found,
 * the draft carries that text with the words' range in it; the window shows
 * them and its Narrow to words field. Not found – a script added them, or the
 * page changed them – the draft carries the text with no range and says the
 * words are missing, and the comment is saved on the whole element.
 *
 * At Save the window sends the words it ended with; {@link verifiedSel} keeps
 * them only when they are a valid `anchor.sel` found exactly once in the text
 * the draft was built with.
 *
 * Pure: runs in the comment parse worker as part of the `draft` job.
 */
import { isAnchorSelection, type AnchorSelection } from '../../../../shared/comments/anchorSel'
import { collapseRange, locateWords, occurrencesInContext } from '../../../../shared/comments/selectionWords'
import type { HtmlIndex, IndexedElement } from '../../../../shared/htmlComments'
import { COMMENT_WORDS_TEXT_MAX_CHARS, type CommentDraftWords, type CommentPickSel } from '../../../../shared/ipc/preview-comment-schema'

/** Characters kept on each side of the words when the target's text is too long to send whole. */
export const WORDS_WINDOW_MARGIN_CHARS = 2_000

/** What a pick says about its words. */
export interface PickWords {
  readonly sel?: CommentPickSel
  readonly long?: true
  readonly crossed?: true
}

/** The words part of a draft. */
export interface DraftWordsPart {
  /** The text and range the window shows; absent when the target has no text, or too much of it. */
  readonly words?: CommentDraftWords
  /** Words were selected but are not in the file as written. */
  readonly wordsMissing?: true
}

/** `el`'s readable text from the parse, collapsed as a selection reads it. */
export function targetTextOf(index: HtmlIndex, el: IndexedElement): string {
  return collapseRange(index.visibleText.slice(el.textStart, el.textEnd), 0, 0).text
}

/**
 * `words` cut to at most {@link COMMENT_WORDS_TEXT_MAX_CHARS} characters
 * around its range; `undefined` when the text is longer and there is no range.
 */
function fitted(words: CommentDraftWords): CommentDraftWords | undefined {
  const { text, start, end } = words
  if (text.length <= COMMENT_WORDS_TEXT_MAX_CHARS) return words
  if (start === end || end - start > COMMENT_WORDS_TEXT_MAX_CHARS - 2 * WORDS_WINDOW_MARGIN_CHARS) return undefined
  let from = Math.max(0, start - WORDS_WINDOW_MARGIN_CHARS)
  let to = Math.min(text.length, end + WORDS_WINDOW_MARGIN_CHARS)
  // Never split a word, or a surrogate pair: move each edge to the nearest space towards the words.
  const space = text.indexOf(' ', from)
  if (from > 0 && space !== -1 && space < start) from = space + 1
  const back = text.lastIndexOf(' ', to)
  if (to < text.length && back >= end) to = back
  return { text: text.slice(from, to), start: start - from, end: end - from, cut: words.cut }
}

/**
 * The words of a draft on `el`. `runtime`: the target is an element a script
 * built, so its words cannot be in the file.
 *
 * - No words selected: the target's text, no range – the window's Narrow to
 *   words field starts from the whole element.
 * - Words found once (in their context, else at all): their range. A
 *   selection longer than 200 code points – the page sends its first 200,
 *   uncut by trimming – reaches one character further, so the window keeps
 *   the first 200 and says so.
 * - Words not found: no range, and `wordsMissing`.
 */
export function draftWordsOf(index: HtmlIndex, el: IndexedElement, pick: PickWords, runtime: boolean): DraftWordsPart {
  const text = runtime ? '' : targetTextOf(index, el)
  const found = pick.sel === undefined || text === '' ? null : locateWords(text, pick.sel)
  const missing = pick.sel !== undefined && found === null ? { wordsMissing: true as const } : {}
  if (text === '') return missing
  const range =
    found === null ? { start: 0, end: 0 } : { start: found.start, end: pick.long ? Math.min(text.length, found.end + 1) : found.end }
  const words = fitted({ text, ...range, cut: found !== null && pick.crossed === true })
  return { ...(words === undefined ? {} : { words }), ...missing }
}

/**
 * `sel` when it is a valid `anchor.sel` found exactly once, in its context,
 * in `text` – the text the window chose it from. Anything else: `undefined`,
 * and the comment is saved on the whole element.
 */
export function verifiedSel(text: string | undefined, sel: CommentPickSel | undefined): AnchorSelection | undefined {
  if (text === undefined || sel === undefined || !isAnchorSelection(sel)) return undefined
  return occurrencesInContext(text, sel).length === 1 ? { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } : undefined
}
