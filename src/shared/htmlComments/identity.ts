// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The characters an author name or email may not carry (docs/designs/
 * html-preview-comments.md §5.4, decision 3).
 *
 * One rule for the two places that check an identity: the writer, which
 * refuses to write such an author (`CommentWriter.ts`), and the app settings,
 * which refuse to store one (`global-settings-schema.ts`). Its own module, with
 * no imports, so the settings schema – loaded by the renderer – does not pull
 * in the HTML parser.
 */

/**
 * Code points refused in an author name or email, by Unicode property rather
 * than by a hand list, so every invisible character is caught: controls (Cc),
 * format characters (Cf – bidi marks, embeddings, overrides and isolates,
 * zero-width characters, the BOM, the tag characters U+E0000–E007F), lone
 * surrogates (Cs), private-use (Co) and unassigned (Cn) code points, the line
 * and paragraph separators, and every default-ignorable code point (U+2060
 * word joiner, variation selectors, Hangul fillers).
 */
export const REFUSED_IN_IDENTITY =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u

/** True when `text` carries a code point {@link REFUSED_IN_IDENTITY} refuses. */
export function hasRefusedIdentityChar(text: string): boolean {
  return REFUSED_IN_IDENTITY.test(text)
}
