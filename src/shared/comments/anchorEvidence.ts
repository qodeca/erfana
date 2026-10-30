// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What an element says about a block's stored anchor: whether a position
 * match is corroborated, and which elements a backup tier must not take
 * (docs/designs/comments/html-preview-comments.md §5.9, §19 Rev 4 "position match must
 * be corroborated", owner decision on the X-001 finding).
 *
 * Checking the tag alone handed an open comment to the NEXT element with that
 * tag when an agent removed its element – the next product card – so a second
 * pass could act on the wrong element. The CSS path does not catch that case:
 * the next sibling with the same tag moves into the removed element's
 * `:nth-of-type` slot, so the path "agrees" exactly when the element is gone.
 * The text does: the element that slid into place holds the text that used
 * to FOLLOW the target, which is what the stored quote's `suffix` recorded.
 *
 * Position – the element right after the block has the stored tag; the first
 * row that applies decides:
 *
 * | # | Evidence (stored anchor vs. element)                        | Match    | Typical edit                                      |
 * |---|-------------------------------------------------------------|----------|---------------------------------------------------|
 * | 1 | stored `id`, element has a different `id`                   | rejected | target removed, next card has its own id          |
 * | 2 | stored `id`, element has the same `id`                      | counts   | text, class or style of the target edited         |
 * | 3 | text matches the stored quote: exact text, or the text just | counts   | attribute change; text edit, neighbours unchanged |
 * |   | before AND after it                                         |          |                                                   |
 * | 4 | text begins the stored `suffix`, or the suffix begins it    | rejected | X-001: the card after the removed one slid in     |
 * | 5 | same CSS path                                               | counts   | text edited together with a neighbour's text      |
 * | 6 | the anchor stores no `id`, no path and no quote             | counts   | nothing to compare; position is all there is      |
 * | 7 | anything else                                               | rejected | other text at another path                        |
 *
 * An element without an `id` gives no id evidence (rows 1–2 skip it), so
 * dropping an `id` is an attribute change like any other. A rejected position
 * match does not orphan the block by itself: the backups run (unique `id`,
 * path, quote), and the block is orphaned only when none of them gives exactly
 * one element. The path backup refuses what rows 1 and 4 reject, and the quote
 * backup what row 1 rejects, so no backup hands the comment to the element the
 * position rule just turned down, and a block never attaches to an element
 * whose `id` differs from the stored one.
 *
 * Rows 3–4 read the element's quote on the parse's shared quote budget
 * (`anchorLookup.ts`). Once the budget is spent they have no answer, and the
 * path decides (row 5, else row 7).
 *
 * Known limits, inherent to what an anchor stores: an element with no `id`
 * and no text (an `<img>`) that slid into a removed sibling's slot has the
 * same path and is taken (row 5); so is a slid-in sibling whose own text was
 * edited in the same pass, and the second of two adjacent elements with the
 * same text.
 */
import type { AnchorLookup } from './anchorLookup'
import type { CommentAnchor, TextQuote } from './format'
import type { IndexedTarget, TargetIndex } from './targetIndex'

/** What an element's `id` says: same as stored, another one, or nothing (none stored or none on the element). */
type IdEvidence = 'same' | 'other' | 'none'

/**
 * What an element's text says: `same` (row 3), `slid` (row 4), `other`, or
 * `unknown` – no quote stored, or the quote budget is spent.
 */
type TextEvidence = 'same' | 'slid' | 'other' | 'unknown'

function idEvidence(el: IndexedTarget, anchor: CommentAnchor): IdEvidence {
  if (!anchor.id || !el.id) return 'none'
  return el.id === anchor.id ? 'same' : 'other'
}

/**
 * Row 4: the element's text and the text that followed the target share a
 * start. Both are normalised the same way; the suffix is at most 32
 * characters, so a longer element text begins with it, a shorter one is its
 * start.
 */
function isSlidIn(exact: string, storedSuffix: string): boolean {
  if (!exact || !storedSuffix) return false
  return exact.startsWith(storedSuffix) || storedSuffix.startsWith(exact)
}

/**
 * Rows 3–4, matched the way the quote tier matches (exact text, then the
 * text on both sides – never an empty context on both sides), and read on the
 * shared budget.
 */
function textEvidence(
  lookup: AnchorLookup,
  el: IndexedTarget,
  quote: TextQuote | undefined
): TextEvidence {
  if (!quote) return 'unknown'
  const exact = lookup.exactQuote(el)
  if (exact === undefined) return 'unknown'
  if (exact === quote.exact) return 'same'
  if (quote.prefix || quote.suffix) {
    const context = lookup.quoteContext(el)
    if (context === undefined) return 'unknown'
    if (context.prefix === quote.prefix && context.suffix === quote.suffix) return 'same'
  }
  return isSlidIn(exact, quote.suffix) ? 'slid' : 'other'
}

/**
 * True when the element right after a block – already known to have the
 * stored tag – is corroborated as the block's element (rows 1–7 above).
 */
export function positionCorroborated<T extends IndexedTarget>(
  index: TargetIndex<T>,
  lookup: AnchorLookup,
  el: T,
  anchor: CommentAnchor
): boolean {
  const id = idEvidence(el, anchor)
  if (id !== 'none') return id === 'same'
  const text = textEvidence(lookup, el, anchor.quote)
  if (text === 'same') return true
  if (text === 'slid') return false
  if (anchor.path) return index.pathOfTarget(el) === anchor.path
  return !anchor.id && !anchor.quote
}

/**
 * True when the path backup must not take `el`, the element at the stored
 * path: it carries another `id` (row 1), or it is the element that slid into
 * a removed target's place (row 4) – the case where the path agrees because
 * the element is gone.
 */
export function pathBackupRefuses(
  lookup: AnchorLookup,
  el: IndexedTarget,
  anchor: CommentAnchor
): boolean {
  const id = idEvidence(el, anchor)
  if (id !== 'none') return id === 'other'
  return textEvidence(lookup, el, anchor.quote) === 'slid'
}

/**
 * True when the quote backup must not take `el`: it carries another `id`
 * (row 1). Row 4 cannot apply – the quote tier only finds elements whose text
 * matches.
 */
export function quoteBackupRefuses(el: IndexedTarget, anchor: CommentAnchor): boolean {
  return idEvidence(el, anchor) === 'other'
}
