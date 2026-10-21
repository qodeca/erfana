// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Path redaction for error messages that main and the renderer both log. It
 * moved here from main's `redactUserInput.ts` so a renderer log line can drop
 * the same paths a main log line does. No imports, on purpose.
 */

/**
 * A quoted path operand inside a Node errno message.
 *
 * Node writes the path it failed on into `Error.message`, always as a quoted
 * operand: `ENOENT: no such file or directory, open '/Users/alice/notes.md'`,
 * and `rename` contributes two of them. The match requires the quoted content
 * to START with a separator or a `C:`-style drive prefix, so ordinary quoted
 * prose in a message survives while every absolute path (POSIX, Windows, UNC)
 * is caught. `[^'"]*` is a single quantifier over a negated class — linear, no
 * backtracking blow-up on a long value.
 */
const QUOTED_PATH = /(['"])(?:[A-Za-z]:)?[\\/][^'"]*\1/g

const PATH_PLACEHOLDER = '[redacted-path]'

/**
 * Replace each quoted absolute path in `message` with `[redacted-path]`.
 *
 * @param message - An error message, e.g. a Node errno message
 * @returns The message without its quoted absolute paths
 */
export function redactQuotedPaths(message: string): string {
  return message.replace(QUOTED_PATH, PATH_PLACEHOLDER)
}
