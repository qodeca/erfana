// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Hint lines in the note area, and the one encoder that writes them (spec 024
 * 024-FR-008, architecture note 001 § 8 C1; comments-v2 § C-01; design
 * `markdown-format.md` § 6).
 *
 * The note area is everything between a block's `note to agents:` line and
 * its `status:` line. Readers skip it (`blocks.ts`, and v0.23.1 the same way),
 * so lines there are hints for agents only: no reader ever compares them, and
 * `@data` stays the truth. That is why new information goes there and not
 * into the readable lines v0.23.1 checks.
 *
 * Every value written into a hint goes through {@link encodeNoteText}: line
 * breaks fold to a space, the text is cut on a grapheme boundary, then `\` and
 * `"` are escaped, control, bidi and zero-width characters become a visible
 * `\uXXXX`, and `--` becomes `-\-`. Each hint starts with a fixed ASCII lead,
 * so no hint line starts with `status: `, `@`, `\` or a merge-marker run, and
 * {@link isSafeNoteLine} holds for every one (`serializeBlock` re-checks).
 *
 * Hints are built from `@data` only ({@link selectionHints}), so a reply or a
 * resolve by this version rebuilds them; v0.23.1 rewrites the note area from
 * its fixed text and drops them, which is accepted (024-FR-010, owner
 * decision 2026-10-29).
 */
import { anchorSelectionOf } from './anchorSel'
import { codePointLength, escapeReadableInline, type CommentData } from './format'

/** The words hint's lead (Naming contracts). */
export const WORDS_HINT_LEAD = 'comment is about the words (when commented): '
/** The Markdown target hint's lead (Naming contracts). */
export const TARGET_HINT_LEAD = 'target in Markdown (when commented): '
/** Longest quoted words in the words hint, in code points, `…` included. */
export const WORDS_HINT_MAX_CHARS = 200
/** Longest quoted source text in the Markdown target hint, in code points, `…` included. */
export const TARGET_HINT_TEXT_MAX_CHARS = 60
/** Longest target name (`item 2 of the list`) in the Markdown target hint. */
export const TARGET_HINT_NAME_MAX_CHARS = 80

const ELLIPSIS = '…'
const LINE_BREAKS = /\r\n|\r|\n/g
const QUOTE_OR_BACKSLASH = /[\\"]/g
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })

/**
 * `text` cut to at most `max` code points on a grapheme boundary, ending in
 * `…` when cut (the `…` counts). Stops reading at the cut, so a long source
 * line costs only what is kept. A single grapheme longer than the room left
 * is dropped whole, never split.
 */
export function cutOnGrapheme(text: string, max: number): string {
  if (text.length <= max) return text
  let count = 0
  let kept = 0
  for (const { segment, index } of GRAPHEMES.segment(text)) {
    count += codePointLength(segment)
    if (count > max) return text.slice(0, kept) + ELLIPSIS
    if (count < max) kept = index + segment.length
  }
  return text
}

/**
 * The shared agent-note-line encoder (C1): one value made safe for a line of
 * the note area – line breaks folded to a space, cut to `max` code points on
 * a grapheme boundary, then `\` → `\\` and `"` → `\"`, controls, bidi and
 * zero-width characters (and lone surrogates) as visible `\uXXXX`, and `--`
 * as `-\-`. The result holds no line break and no `--`.
 */
export function encodeNoteText(text: string, max: number): string {
  const cut = cutOnGrapheme(text.replace(LINE_BREAKS, ' '), max)
  return escapeReadableInline(cut.replace(QUOTE_OR_BACKSLASH, ch => `\\${ch}`))
}

/** `comment is about the words (when commented): "{exact}"`. */
export function wordsHint(exact: string): string {
  return `${WORDS_HINT_LEAD}"${encodeNoteText(exact, WORDS_HINT_MAX_CHARS)}"`
}

/**
 * `target in Markdown (when commented): {target} starting "{text}"` – the
 * target named by kind or position (`paragraph`, `item 2 of the list`) and
 * the start of its first source line, which identifies it.
 */
export function markdownTargetHint(target: string, text: string): string {
  const name = encodeNoteText(target, TARGET_HINT_NAME_MAX_CHARS)
  return `${TARGET_HINT_LEAD}${name} starting "${encodeNoteText(text, TARGET_HINT_TEXT_MAX_CHARS)}"`
}

/** The words hint for a block's valid `anchor.sel`, or none (an invalid `sel` is ignored). */
export function selectionHints(data: CommentData): readonly string[] {
  const sel = anchorSelectionOf(data.anchor)
  return sel === undefined ? [] : [wordsHint(sel.exact)]
}
