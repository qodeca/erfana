// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Log-redaction for error messages that embed verbatim user-typed input.
 *
 * Some `AppError`s carry the user's raw input inside `Error.message` so the
 * renderer can surface it in a toast (full fidelity is desirable there). That
 * same text must NOT be written to the on-disk log, where it is PII / leak
 * surface. Redaction happens at the log call site (see `redactedLogError`)
 * rather than inside `LoggingService`, keeping the logger generic.
 *
 * See issue #167 (Bundle B, D5).
 */

import { AppError, ErrorCode } from '../../shared/errors'

/**
 * Error codes whose `Error.message` embeds verbatim user-typed input that must
 * never reach the log file. Currently only `INVALID_FILENAME` (thrown by
 * `assertValidUserFilename` in `validateFilename.ts`), whose message is:
 *
 *   `"<displayName>" is not a valid filename<reasonSuffix>`
 *
 * where `<displayName>` is the raw filename the user typed and, for the
 * `reserved` reason, `<reasonSuffix>` adds a SECOND user-derived quoted
 * segment: ` — try "<suggestion>"`. Both quoted segments are user-derived.
 *
 * NOTE: `PREVIEW_LOCAL_FILE_MISSING` (Issue #74) is intentionally NOT listed. Its
 * code is used only as a renderer badge reason (which keeps the full path by
 * design); no `logger.*` site ever logs its message, so a redaction entry would
 * guard a log line that does not exist. Re-add it here together with any future
 * producer that logs that error.
 */
const USER_INPUT_CODES = new Set<ErrorCode>([ErrorCode.INVALID_FILENAME])

const REDACTION_PLACEHOLDER = '[redacted-filename]'

/**
 * Greedy first-quote-to-last-quote match. We collapse everything between the
 * first and last double-quote into a single placeholder rather than redacting
 * each quoted pair (`/"[^"]*"/g`), because:
 *
 *   - the `reserved` message has TWO user-derived quoted segments, AND
 *   - the `invalid_chars` message contains a STRAY single `"` in its static
 *     prose (`— remove the characters < > : " / \ | ? *`), AND
 *   - the user's filename can itself contain a `"` (an invalid char on
 *     Windows, so it appears verbatim in `<displayName>`).
 *
 * Pairwise redaction mis-pairs those quotes and lets a fragment of the
 * filename survive between two placeholders. Spanning first→last quote
 * guarantees no user-derived text survives — the only text after the final
 * quote is static suffix prose. `[\s\S]` (not `.`) so control chars such as
 * newlines inside the filename are also covered.
 */
const QUOTED_SPAN = /"[\s\S]*"/

/**
 * Strip user-typed input from an error message before it is logged.
 *
 * Returns `message` unchanged unless `code` is a known user-input-bearing code,
 * in which case the quoted user content is replaced with a fixed placeholder.
 * The static prose (`is not a valid filename`, `— try`, etc.) is allowed to
 * survive; the contract is only that NO user-derived filename text remains.
 *
 * @param message - The raw error message (e.g. `AppError.message`).
 * @param code - The associated `ErrorCode`, if known.
 * @returns The message with user input redacted, or the original message.
 */
export function redactUserInput(message: string, code?: ErrorCode): string {
  if (!code || !USER_INPUT_CODES.has(code)) return message
  return message.replace(QUOTED_SPAN, REDACTION_PLACEHOLDER)
}

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
 * `true` when the error looks like it came from a syscall.
 *
 * Deliberately loose: any of the three fields Node sets is enough. The cost of
 * a false positive is nil — the rewrite below is a no-op unless the message
 * actually contains a quoted absolute path — while a false negative writes a
 * user's folder layout into the log file.
 */
function carriesSyscallFields(error: Error): boolean {
  const candidate = error as { errno?: unknown; code?: unknown; syscall?: unknown }
  return (
    typeof candidate.errno === 'number' ||
    typeof candidate.code === 'string' ||
    typeof candidate.syscall === 'string'
  )
}

/**
 * Build the `Error` to hand to `logger.error` so neither user-derived filename
 * text NOR an absolute path reaches the log file — and neither via
 * `Error.message` nor via `Error.stack` (the stack embeds the message
 * verbatim).
 *
 * - Non-`Error` input → `undefined` (matches the existing
 *   `error instanceof Error ? error : undefined` convention at the IPC call
 *   sites).
 * - A user-input-bearing `AppError` → a fresh `Error` with the quoted user
 *   content replaced (see `redactUserInput`).
 * - A syscall-shaped error (`errno` / `code` / `syscall`) whose message quotes
 *   an absolute path → a fresh `Error` with each path operand replaced. This
 *   is the branch that stops a caller's carefully redacted `destination` field
 *   sitting next to the same path, unredacted, in the errno message beside it.
 * - Anything else → the ORIGINAL error, so its stack survives for debugging.
 *
 * A rewrite always drops the original stack, which would otherwise re-leak the
 * text that was just removed.
 *
 * Callers MUST still re-throw the ORIGINAL (unredacted) error so the renderer
 * toast keeps the full filename. This helper only shapes the logged copy.
 *
 * @param error - The caught error (any value from a `catch` clause).
 * @returns An `Error` safe to log, or `undefined` for non-`Error` input.
 */
export function redactedLogError(error: unknown): Error | undefined {
  if (!(error instanceof Error)) return undefined

  const code = error instanceof AppError ? error.code : undefined
  const withoutUserInput = redactUserInput(error.message, code)
  if (withoutUserInput !== error.message) return new Error(withoutUserInput)

  if (!carriesSyscallFields(error)) return error
  const withoutPaths = error.message.replace(QUOTED_PATH, PATH_PLACEHOLDER)
  return withoutPaths === error.message ? error : new Error(withoutPaths)
}

/**
 * Redact a filesystem path for logging: keep only the basename (file/dir name),
 * replace the rest with [redacted]. Empty/falsy values pass through unchanged.
 *
 * Example:
 *   redactPath('C:\\Users\\alice\\Documents\\secret-project')
 *     => '[redacted]/secret-project'
 *   redactPath('/Users/alice/Documents/secret-project/sub/dir')
 *     => '[redacted]/dir'
 *   redactPath('')                 => ''
 *   redactPath('single-segment')   => 'single-segment'  (no path separators present)
 *
 * Use at every logger.* site that would otherwise emit a full filesystem path.
 */
export function redactPath(p: string): string {
  if (!p) return p
  const segments = p.split(/[\\/]+/)
  const tail = segments.pop() ?? ''
  // If no separators were present, return the input unchanged (already non-revealing)
  if (segments.length === 0 || segments.every((s) => s === '')) return tail
  return `[redacted]/${tail}`
}
