// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PowerShell single-quote escaping.
 *
 * PowerShell treats the plain apostrophe and the typographic single quotes
 * U+2018, U+2019, U+201A and U+201B as the same quote character. Inside a
 * single-quoted literal each of them is written by doubling it, so every
 * character of that class must be doubled, not only `'`.
 */
const POWERSHELL_SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/g

/** Double every single-quote-class character so the text stays inside one literal. */
export function escapePowerShellSingleQuotes(text: string): string {
  return text.replace(POWERSHELL_SINGLE_QUOTES, (m) => m + m)
}

/** Wrap text in a PowerShell single-quoted literal, escaping quote characters. */
export function quotePowerShellLiteral(text: string): string {
  return "'" + escapePowerShellSingleQuotes(text) + "'"
}
