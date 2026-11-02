// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Build the bytes for typing prompt text into a terminal as one bracketed
 * paste (spec 025, 025-FR-032, solution design § 9.3).
 *
 * Every control character is removed except line breaks, so the text cannot
 * carry its own escape sequences: no ESC, BEL, DEL or C1 code reaches the
 * terminal, and an embedded paste end marker (`ESC [201~`) loses its ESC and
 * arrives as the plain text `[201~` inside the paste instead of ending it.
 * A tab becomes a space, so words it separated stay apart.
 */

/** Start and end markers of the bracketed-paste protocol (xterm). */
export const BRACKETED_PASTE_START = '\x1b[200~'
export const BRACKETED_PASTE_END = '\x1b[201~'

/** Every C0 control, DEL and every C1 control (Unicode general category Cc). */
const CONTROL_CHARACTER = /\p{Cc}/gu

/**
 * Remove control characters except line breaks, and turn every line break
 * (`\r\n`, `\r` or `\n`) into `\r`, the byte the Enter key sends.
 */
export function stripControlCharacters(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL_CHARACTER, (c) => (c === '\n' ? c : ''))
    .replace(/\n/g, '\r')
}

/** The text, stripped, wrapped in exactly one bracketed paste – also when it is a single line. */
export function toBracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${stripControlCharacters(text)}${BRACKETED_PASTE_END}`
}
