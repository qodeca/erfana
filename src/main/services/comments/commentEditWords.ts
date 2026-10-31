// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of an EXISTING comment: what Edit on its first message offers in
 * the Narrow to words field, and the check of the words it sends back (spec
 * 024 024-FR-004; comments-v2 C-07 "add a field … to Edit on a thread's first
 * message").
 *
 * - **The text** is the target's text from main's own parse, the same text a
 *   new comment's words are chosen from: in HTML parse5's readable text of
 *   the element, collapsed as a selection reads it (`commentWordsCore.ts`'s
 *   `targetTextOf`); in Markdown the target's rendered text as
 *   `markdownSelection` searches it (`mdAnchor.ts`). The target is the one
 *   the comment is about – in Markdown the inner target `anchor.runtime`
 *   names below the carrier. A script-built HTML element has no words in the
 *   file, and other kinds offer none.
 * - **The check** is the add path's, word for word: HTML keeps a valid
 *   `anchor.sel` found exactly once in its context (`planAdd`'s rule);
 *   Markdown keeps what `markdownSelection` keeps. Anything else is dropped,
 *   and the comment is about the whole target (D-16).
 * - **The cap** is the new-comment path's: at most
 *   {@link COMMENT_WORDS_TEXT_MAX_CHARS} characters, else the part around the
 *   words ({@link fittedWords}), else nothing. A list reads at most
 *   {@link WORDS_SCAN_MAX_CHARS} of one target's text, and each target once.
 *
 * Pure: runs in the comment parse worker as part of the `list` and `write` jobs.
 */
import { anchorSelectionOf, isAnchorSelection, type AnchorSelection } from '../../../shared/comments/anchorSel'
import type { KindDocument } from '../../../shared/comments/fileKind'
import type { CommentAnchor, CommentData, TextQuote } from '../../../shared/comments/format'
import type { ParsedBlock } from '../../../shared/comments/blocks'
import { collapseRange, locateWords, occurrencesInContext } from '../../../shared/comments/selectionWords'
import type { IndexedTarget } from '../../../shared/comments/targetIndex'
import { COMMENT_WORDS_TEXT_MAX_CHARS, type CommentDraftWords } from '../../../shared/ipc/comment-common-schema'
import { innerTargetOf, markdownSelection, selectableText } from '../../../shared/markdownComments/mdAnchor'
import { MdIndex, type MdTarget } from '../../../shared/markdownComments/mdIndex'

/** Characters kept on each side of the words when the target's text is too long to send whole. */
export const WORDS_WINDOW_MARGIN_CHARS = 2_000

/** Characters of one target's readable text a list collapses for the field; a longer target offers none. */
export const WORDS_SCAN_MAX_CHARS = 100_000

/**
 * `words` cut to at most {@link COMMENT_WORDS_TEXT_MAX_CHARS} characters
 * around its range; `undefined` when the text is longer and there is no range.
 */
export function fittedWords(words: CommentDraftWords): CommentDraftWords | undefined {
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

/** The text a comment's words are chosen from, and the add path's rule for keeping words in it. */
interface WordsTarget {
  readonly text: string
  readonly keep: (sel: TextQuote) => AnchorSelection | undefined
}

/** True when `index` is the HTML kind's: only it has a tag sequence. */
function isHtmlIndex(index: KindDocument['index']): boolean {
  return 'tagSequence' in index
}

/** The Markdown target the comment is about: the carrier, or the inner target `anchor.runtime` names. */
function markdownTarget(index: MdIndex, carrier: IndexedTarget, anchor: CommentAnchor): MdTarget | undefined {
  const outer = carrier as MdTarget
  return anchor.runtime === undefined ? outer : innerTargetOf(index, outer, anchor.runtime)
}

/**
 * The words target of a comment on `carrier`, or `undefined` when it has no
 * words in the file. `scanMax`: the most readable characters read (a list's
 * cap); a write reads all, as the add path does.
 */
function wordsTargetOf(doc: KindDocument, carrier: IndexedTarget, anchor: CommentAnchor, scanMax: number): WordsTarget | undefined {
  const { index } = doc
  if (index instanceof MdIndex) {
    const target = markdownTarget(index, carrier, anchor)
    const text = target === undefined ? undefined : selectableText(index, target)
    if (target === undefined || text === undefined || text === '') return undefined
    return { text, keep: sel => markdownSelection(index, target, sel) }
  }
  // A script-built element's words are not in the file (`planAdd` keeps none for it).
  if (!isHtmlIndex(index) || anchor.runtime !== undefined || carrier.textEnd - carrier.textStart > scanMax) return undefined
  const text = collapseRange(index.visibleText.slice(carrier.textStart, carrier.textEnd), 0, 0).text
  if (text === '') return undefined
  return {
    text,
    keep: sel =>
      isAnchorSelection(sel) && occurrencesInContext(text, sel).length === 1 ? { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } : undefined
  }
}

/**
 * The words an edit of a comment's first message may store as `anchor.sel`:
 * `sel` when the add path would keep it on the comment's target in `doc`,
 * else `undefined` – the words are not in the file as written (D-16).
 *
 * @param doc - The file as the write read it.
 * @param carrier - The element or block the comment's block is attached to.
 * @param anchor - The comment's stored anchor (its `runtime` names a Markdown inner target).
 * @param sel - The words the window sent.
 * @returns The words to store, or `undefined`.
 */
export function editedSelection(doc: KindDocument, carrier: IndexedTarget, anchor: CommentAnchor, sel: TextQuote): AnchorSelection | undefined {
  return wordsTargetOf(doc, carrier, anchor, Number.POSITIVE_INFINITY)?.keep(sel)
}

/**
 * A reader of the Narrow to words field's text for listed comments: each
 * target's text is collapsed once per list, however many comments it holds.
 *
 * @param doc - The listed file.
 * @returns For a comment on `carrier` with `anchor`: its target's text and the
 *   range of its stored words (none when it has none, or they are not found),
 *   capped as a draft's is; `undefined` when there is nothing to offer.
 */
export function threadWordsReader(doc: KindDocument): (carrier: IndexedTarget, anchor: CommentAnchor) => CommentDraftWords | undefined {
  const read = new Map<IndexedTarget, WordsTarget | undefined>()
  return (carrier, anchor) => {
    // A script-built HTML element has no words in the file; its carrier may hold another comment that does.
    if (!(doc.index instanceof MdIndex) && anchor.runtime !== undefined) return undefined
    // Keyed by the target itself: in Markdown two comments on one carrier may name different inner targets.
    const target = doc.index instanceof MdIndex ? markdownTarget(doc.index, carrier, anchor) : carrier
    if (target === undefined) return undefined
    if (!read.has(target)) read.set(target, wordsTargetOf(doc, carrier, anchor, WORDS_SCAN_MAX_CHARS))
    const words = read.get(target)
    if (words === undefined) return undefined
    const sel = anchorSelectionOf(anchor)
    const found = sel === undefined ? null : locateWords(words.text, sel)
    return fittedWords({ text: words.text, start: found?.start ?? 0, end: found?.end ?? 0, cut: false })
  }
}

type OkBlock = Extract<ParsedBlock, { kind: 'ok' }>

/**
 * The element or block `block` is attached to in `doc`, or `undefined` when
 * it is not attached. In Markdown several targets may start where the block
 * points (a table and its header row); the one with the anchor's tag and path
 * is the carrier, as the target hint finds it (`mdHints.ts`).
 */
export function attachedCarrierOf(doc: KindDocument, block: OkBlock): IndexedTarget | undefined {
  if (block.target.state !== 'attached') return undefined
  const { startOffset } = block.target
  const { anchor } = block.data
  if (!(doc.index instanceof MdIndex)) return doc.index.elementAt(startOffset)
  const at = doc.index.targetsAt(startOffset)
  return at.find(t => t.tag === anchor.tag && t.path === anchor.path) ?? at.find(t => t.tag === anchor.tag) ?? at[0]
}

/** `anchor` without its words. */
function withoutWords(anchor: CommentAnchor): CommentAnchor {
  return Object.fromEntries(Object.entries(anchor).filter(([key]) => key !== 'sel')) as CommentAnchor
}

/**
 * `data` – the thread after an edit of its first message – with the words
 * that edit asked for (C-07): `sel` kept by the add path's rule on the
 * block's target in `doc` replaces the stored words in place; `null`, or
 * words the rule does not keep, leave the comment about the whole target.
 *
 * @param doc - The file as the write read it.
 * @param block - The thread's block in `doc`.
 * @param data - The edited thread.
 * @param sel - The words the window sent, or `null` for the whole target.
 * @returns The thread to write, and `dropped` when words were asked for and not kept.
 */
export function withEditedWords(
  doc: KindDocument,
  block: OkBlock,
  data: CommentData,
  sel: TextQuote | null
): { readonly data: CommentData; readonly dropped: boolean } {
  const carrier = attachedCarrierOf(doc, block)
  const kept = sel === null || carrier === undefined ? undefined : editedSelection(doc, carrier, block.data.anchor, sel)
  const anchor = kept === undefined ? withoutWords(data.anchor) : { ...data.anchor, sel: kept }
  return { data: { ...data, anchor }, dropped: sel !== null && kept === undefined }
}
