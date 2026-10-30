// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `anchor.sel` – the words a comment is about (spec 024, 024-FR-004,
 * 024-FR-008, Naming contracts; comments-v2 § C-01).
 *
 * An optional `{ exact, prefix, suffix }` in `@data`'s anchor: `exact` is 1 to
 * 200 code points, `prefix` and `suffix` up to 32 each, all three rendered text
 * with whitespace collapsed, in NFC, and cut on grapheme boundaries.
 *
 * Its rules are checked HERE, never in `CommentDataSchema`, because an invalid
 * `sel` must not make a block Damaged: the block reads `ok`, the selection is
 * ignored for underlining, and `sel` is kept as it is through every edit (the
 * anchor is loose, and thread operations never touch it). v0.23.1 reads it the
 * same way – its anchor schema is loose too – so a block with `sel` stays `ok`
 * there and keeps `sel` when v0.23.1 rewrites it (024-FR-010).
 */
import { z } from 'zod'
import { codePointLength, type CommentAnchor } from './format'

/** Longest `exact`, in code points. */
export const SEL_EXACT_MAX_CHARS = 200
/** Longest `prefix` or `suffix`, in code points. */
export const SEL_CONTEXT_MAX_CHARS = 32

/** The selected words and up to 32 code points of rendered text on each side. */
export interface AnchorSelection {
  readonly exact: string
  readonly prefix: string
  readonly suffix: string
}

/** Whitespace a preview collapses: any but a single space (`white-space: normal`). */
const UNCOLLAPSED = /[\t\n\f\r]| {2}/

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })

const part = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .refine(text => codePointLength(text) <= max)

/** True when `text` is rendered text as the preview reports it: well formed, NFC, whitespace collapsed. */
function isRenderedText(text: string): boolean {
  return text.isWellFormed() && text === text.normalize('NFC') && !UNCOLLAPSED.test(text)
}

/** True when the joins `prefix|exact` and `exact|suffix` fall on grapheme boundaries of the whole. */
function cutsOnGraphemes(sel: AnchorSelection): boolean {
  const whole = sel.prefix + sel.exact + sel.suffix
  const starts = new Set<number>([whole.length])
  for (const { index } of GRAPHEMES.segment(whole)) starts.add(index)
  return starts.has(sel.prefix.length) && starts.has(sel.prefix.length + sel.exact.length)
}

/** The rules of a valid `anchor.sel`. Loose, so a later version may add fields to it. */
export const AnchorSelectionSchema = z
  .looseObject({
    exact: part(1, SEL_EXACT_MAX_CHARS),
    prefix: part(0, SEL_CONTEXT_MAX_CHARS),
    suffix: part(0, SEL_CONTEXT_MAX_CHARS)
  })
  .refine(sel => isRenderedText(sel.prefix + sel.exact + sel.suffix) && cutsOnGraphemes(sel))

/** True when `value` is a valid `anchor.sel`. */
export function isAnchorSelection(value: unknown): value is AnchorSelection {
  return AnchorSelectionSchema.safeParse(value).success
}

/** The anchor's valid selection, or `undefined` when it has none or an invalid one (ignored, never Damaged). */
export function anchorSelectionOf(anchor: CommentAnchor): AnchorSelection | undefined {
  return isAnchorSelection(anchor.sel) ? anchor.sel : undefined
}
