// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Line-ending helpers for comparing file text across platforms.
 *
 * @module lineEndings
 */

/**
 * Normalizes line endings to LF, so a file written with CRLF on Windows and
 * the same text with LF compare equal.
 *
 * @example
 * ```ts
 * normalizeLF('a\r\nb') // 'a\nb'
 * ```
 */
export function normalizeLF(content: string): string {
  return content.replace(/\r\n/g, '\n')
}
