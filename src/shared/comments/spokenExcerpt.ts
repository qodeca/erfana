// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The opening words a keyboard picker speaks about its target (comments-v2
 * C-10 "first 60 characters"): whitespace runs collapsed to one space,
 * trimmed, and at most {@link SPOKEN_EXCERPT_MAX_CODE_POINTS} code points –
 * never half a surrogate pair – with "…" when it was cut.
 *
 * Main cuts the HTML picker's excerpt with it from its own parse of the file
 * served (`commentWordsCore.ts`), and the step schema checks the result
 * (`CommentPickerElementSchema`). The text is the file's, read for a screen
 * reader only: it is never logged.
 */

/** Code points of a target's text the picker speaks (C-10). */
export const SPOKEN_EXCERPT_MAX_CODE_POINTS = 60

/** What a cut excerpt ends with. */
export const SPOKEN_EXCERPT_ELLIPSIS = '…'

/**
 * `text` as the picker speaks it (module comment).
 *
 * @param text - The target's text; any whitespace.
 * @param cutBefore - The text was already cut short before this call (only its head was read): end with "…" anyway.
 * @returns The excerpt; `''` when the text has no words.
 */
export function spokenExcerptOf(text: string, cutBefore = false): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const points = Array.from(collapsed)
  if (points.length <= SPOKEN_EXCERPT_MAX_CODE_POINTS) {
    return cutBefore && collapsed !== '' ? `${collapsed}${SPOKEN_EXCERPT_ELLIPSIS}` : collapsed
  }
  return `${points.slice(0, SPOKEN_EXCERPT_MAX_CODE_POINTS).join('').trimEnd()}${SPOKEN_EXCERPT_ELLIPSIS}`
}

/**
 * Whether `excerpt` is one {@link spokenExcerptOf} could return: words, at
 * most the cap in code points plus the ellipsis.
 */
export function isSpokenExcerpt(excerpt: string): boolean {
  const points = Array.from(excerpt)
  const cap = SPOKEN_EXCERPT_MAX_CODE_POINTS + (excerpt.endsWith(SPOKEN_EXCERPT_ELLIPSIS) ? 1 : 0)
  return excerpt.trim() !== '' && points.length <= cap
}
