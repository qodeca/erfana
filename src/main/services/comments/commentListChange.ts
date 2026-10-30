// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The derived "Changed" and "Words changed" states of a listed thread
 * (comments-v2 C-06; spec 024 state table S-03, S-04, § 4 precedence).
 *
 * Derived only, never written: the list job compares the target as it is now
 * with what the block stored and says what differs.
 *
 * - **Words changed** (S-04, wins over Changed): a selection comment whose
 *   `anchor.sel.exact` is no longer in its target. When a unique
 *   `prefix … suffix` pair with at most {@link WORDS_GAP_MAX_CHARS} between
 *   them is found, the text between is "now"; otherwise there is no "now"
 *   ("The words this comment is about are gone").
 * - **Changed** (S-03): the target's visible text (collapsed, NFC) is not
 *   `anchor.quote.exact`; in HTML also when its `id` or classes differ, or its
 *   re-attach went through anything but position.
 *
 * Pure: reads the parse, never changes it. Bounded: a target's text is read
 * only up to {@link CHANGE_TEXT_MAX_CHARS}, so 500 comments on one huge
 * target cannot make a list slow.
 */
import { visibleInline, type CommentAnchor } from '../../../shared/htmlComments'
import { anchorSelectionOf, type AnchorSelection } from '../../../shared/comments/anchorSel'
import { exactOf } from '../../../shared/comments/quoteText'
import type { TargetVia } from '../../../shared/comments/reattach'
import { locateWords, occurrences } from '../../../shared/comments/selectionWords'
import type { IndexedTarget, TargetIndex } from '../../../shared/comments/targetIndex'
import type { CommentThreadView } from '../../../shared/ipc/comment-common-schema'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'

/** The wire form of a derived change. */
export type ListedChange = NonNullable<CommentThreadView['change']>

/** Characters at most between a found prefix and suffix (C-06 (b)). */
export const WORDS_GAP_MAX_CHARS = 400
/** Characters of a target's text the words search reads at most. */
export const CHANGE_TEXT_MAX_CHARS = 20_000

const WHITESPACE_RUN = /\s+/g

/** What the list knows about a thread's target now. */
export interface ChangeInput {
  readonly index: TargetIndex
  /** The target the block is on now. */
  readonly target: IndexedTarget & { readonly classes?: readonly string[] }
  readonly anchor: CommentAnchor
  /** How the target was found; `undefined` when only the position names it (a Markdown target whose text changed). */
  readonly via?: TargetVia
  /** HTML: identity and re-attach differences count too (state table S-03). */
  readonly html: boolean
}

/** Visible and cut to the quote cap, whole characters and escapes only – as `storedQuoteOf`. */
function shown(text: string): string {
  let out = ''
  for (const char of text) {
    const visible = visibleInline(char)
    if (out.length + visible.length > PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS) break
    out += visible
  }
  return out
}

/** The target's text as a selection reads it, or `undefined` past the read cap. */
function selectableText(index: TargetIndex, target: IndexedTarget): string | undefined {
  if (target.textEnd - target.textStart > CHANGE_TEXT_MAX_CHARS) return undefined
  return index.visibleText.slice(target.textStart, target.textEnd).replace(WHITESPACE_RUN, ' ').trim().normalize('NFC')
}

/**
 * The text between the one `prefix` and the first `suffix` after it, when the
 * pair is unique and at most {@link WORDS_GAP_MAX_CHARS} apart; else `undefined`.
 */
export function wordsBetween(text: string, sel: AnchorSelection): string | undefined {
  if (sel.prefix === '' && sel.suffix === '') return undefined
  const starts = sel.prefix === '' ? [0] : occurrences(text, sel.prefix).map(at => at + sel.prefix.length)
  const found: string[] = []
  for (const start of starts) {
    const end = sel.suffix === '' ? text.length : text.indexOf(sel.suffix, start)
    if (end < 0 || end - start > WORDS_GAP_MAX_CHARS) continue
    found.push(text.slice(start, end).trim())
    if (found.length > 1) return undefined
  }
  return found.length === 1 && found[0] !== '' ? found[0] : undefined
}

function sameClasses(stored: readonly string[] | undefined, now: readonly string[] | undefined): boolean {
  const a = stored ?? []
  const b = now ?? []
  return a.length === b.length && a.every((cls, i) => cls === b[i])
}

/** Words changed (S-04), or `undefined` when the comment has no valid words or they are still there. */
function wordsChange(input: ChangeInput): ListedChange | undefined {
  const sel = anchorSelectionOf(input.anchor)
  if (sel === undefined) return undefined
  const text = selectableText(input.index, input.target)
  if (text === undefined || locateWords(text, sel) !== null) return undefined
  const now = wordsBetween(text, sel)
  return { state: 'words', was: shown(sel.exact), ...(now === undefined ? {} : { now: shown(now) }) }
}

/**
 * The derived change of an attached open thread, or `undefined` when its
 * target reads as the comment stored it.
 *
 * @param input - The target now and the stored anchor.
 * @returns Words changed, Changed, or nothing.
 */
export function changeOf(input: ChangeInput): ListedChange | undefined {
  const words = wordsChange(input)
  if (words !== undefined) return words
  const { index, target, anchor, via, html } = input
  const now = exactOf(index, target)
  const was = anchor.quote?.exact
  const textChanged = was !== undefined && now !== was
  const moved = via === undefined || (html && via !== 'position')
  const identity = html && ((anchor.id ?? undefined) !== (target.id ?? undefined) || !sameClasses(anchor.cls, target.classes))
  if (!textChanged && !moved && !identity) return undefined
  return { state: 'changed', was: shown(was ?? ''), now: shown(now) }
}
