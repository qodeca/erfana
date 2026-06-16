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
 * Build the `Error` to hand to `logger.error` so user-derived filename text
 * never reaches the log file — neither via `Error.message` NOR via
 * `Error.stack` (the stack embeds the message verbatim).
 *
 * - Non-`Error` input → `undefined` (matches the existing
 *   `error instanceof Error ? error : undefined` convention at the IPC call
 *   sites).
 * - An error whose message has nothing to redact → the ORIGINAL error, so its
 *   stack trace is preserved for debugging.
 * - An error whose message IS redacted → a fresh `Error` carrying only the
 *   redacted message; this deliberately drops the original stack, which would
 *   otherwise re-leak the raw filename.
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
  const redacted = redactUserInput(error.message, code)
  return redacted === error.message ? error : new Error(redacted)
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
