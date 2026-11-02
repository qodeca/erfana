// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Cutting display text to a length (spec 024 architecture note 001 § 8 C22:
 * `cutText` moves to the shared base). Used for the menu's element excerpt
 * (HTML) and the raw preview of a damaged block in the comment list (shared).
 */

/** `text` cut to `max` UTF-16 units, never through a surrogate pair. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}
