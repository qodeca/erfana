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
 * The keyboard picker's excerpt (comments-v2 C-10) is the same text, cut to
 * its first 60 code points: the `excerpt` job, on the token's element in bytes
 * that still hash to what was served – never page text, which would widen
 * what the sealed preload sends (PIN-S-003).
 *
 * Pure: runs in the comment parse worker as part of the `draft` and `excerpt` jobs.
 */
import { isAnchorSelection, type AnchorSelection } from '../../../../shared/comments/anchorSel'
import { collapseRange, locateWords, occurrencesInContext } from '../../../../shared/comments/selectionWords'
import { spokenExcerptOf } from '../../../../shared/comments/spokenExcerpt'
import type { HtmlIndex, IndexedElement } from '../../../../shared/htmlComments'
import type { CommentDraftWords, CommentPickSel } from '../../../../shared/ipc/preview-comment-schema'
import type { JobDocument } from '../../comments/commentJobDocs'
import { fittedWords } from '../../comments/commentEditWords'
import type { DraftEntry } from './commentDraftCore'

// The cap a thread's words share with a draft's (C-07): one definition, in the shared base.
export { WORDS_WINDOW_MARGIN_CHARS } from '../../comments/commentEditWords'

/**
 * Characters of an element's readable text the excerpt reads (C-10): plenty
 * for 60 code points, while a `<body>` of a 25 MB page is never collapsed
 * whole for one picker step.
 */
export const EXCERPT_SCAN_CHARS = 4_096

/** The picker's excerpt of the token's element (C-10). */
export interface ExcerptJob {
  readonly kind: 'excerpt'
  readonly entry: DraftEntry
}

/** The excerpt; absent when the file changed since it was served, or the element has no words. */
export interface ExcerptJobResult {
  readonly kind: 'excerpt'
  readonly excerpt?: string
}

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
  const words = fittedWords({ text, ...range, cut: found !== null && pick.crossed === true })
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

/**
 * The `excerpt` job (C-10): the first words of the element main recorded for
 * the token, from its own parse – only in bytes that still hash to what was
 * served, at the recorded offset, with the recorded tag.
 */
export function runExcerptJob(document: JobDocument, job: ExcerptJob): ExcerptJobResult {
  const none: ExcerptJobResult = { kind: 'excerpt' }
  if (!document.ok || document.hash !== job.entry.fileHash) return none
  const { index } = document.doc
  const el = index.elementAt(job.entry.startOffset)
  if (el === undefined || el.tag !== job.entry.tagName) return none
  const end = Math.min(el.textEnd, el.textStart + EXCERPT_SCAN_CHARS)
  const excerpt = spokenExcerptOf(index.visibleText.slice(el.textStart, end), end < el.textEnd)
  return excerpt === '' ? none : { kind: 'excerpt', excerpt }
}
