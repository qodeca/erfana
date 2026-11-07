// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Page strings made safe to show in Erfana's own interface (spec 025,
 * 025-FR-004, panel finding S10).
 *
 * A page chooses its title, its element ids and classes, its dialog text and
 * its download names. Shown raw, a bidi override can reverse what follows it
 * ("…txt.exe" drawn as "…exe.txt"), an invisible character can hide a word,
 * and a control character can break a line. {@link sanitizePageText} removes:
 *
 * - C0 controls (U+0000–U+001F), DEL and C1 controls (U+0080–U+009F), and the
 *   line and paragraph separators U+2028 / U+2029 – each replaced by a space,
 *   so words on both sides stay apart;
 * - bidi embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069),
 *   the marks U+200E, U+200F and U+061C;
 * - every other default-ignorable (invisible) code point, such as U+200B and
 *   the tag characters, except the variation selectors U+FE0E / U+FE0F and a
 *   zero-width joiner that sits between two emoji, which emoji need;
 * - unpaired surrogates.
 *
 * Runs of white space collapse to one space, the ends are trimmed, and the
 * result is cut at a whole-character boundary.
 *
 * This is for display only. The context file keeps page text as-is
 * (025-FR-036); it is protected there by the fence, not by this function.
 */
import { cutAtCodeUnits } from './textCut'

/** Longest page title Erfana shows, in UTF-16 code units (design § 3.5). */
export const PAGE_TITLE_MAX_CODE_UNITS = 200

// eslint-disable-next-line no-control-regex -- control characters are what this removes
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g
const UNPAIRED_SURROGATES = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
/** Invisible code points, keeping the emoji variation selectors and ZWJ (handled below). */
const INVISIBLES = /(?![\ufe0e\ufe0f\u200d])\p{Default_Ignorable_Code_Point}/gu
/** A zero-width joiner that does not join two emoji. */
const STRAY_ZWJ =
  /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d|\u200d(?!\p{Extended_Pictographic})/gu
const WHITE_SPACE_RUN = /\s+/g

/**
 * `text` with control, bidi and invisible characters removed, white space
 * collapsed, and cut to `maxCodeUnits` at a whole-character boundary.
 */
export function sanitizePageText(text: string, maxCodeUnits = PAGE_TITLE_MAX_CODE_UNITS): string {
  const cleaned = text
    .replace(UNPAIRED_SURROGATES, '')
    .replace(CONTROLS, ' ')
    .replace(BIDI_CONTROLS, '')
    .replace(INVISIBLES, '')
    .replace(STRAY_ZWJ, '')
    .replace(WHITE_SPACE_RUN, ' ')
    .trim()
  return cutAtCodeUnits(cleaned, maxCodeUnits).trimEnd()
}
