// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Crash-detail extraction for the root error boundary.
 *
 * Pure, dependency-free helpers. They run on the ONE code path where nothing
 * else in the renderer can be trusted to still work, so every property read is
 * defensive: a thrown value may be a string, `undefined`, a plain object, or an
 * `Error` whose `stack` / `message` getters throw. Nothing in this module may
 * throw — a failure here would take out the fallback UI itself and fall through
 * to `FallbackGuard`'s dependency-free last resort.
 *
 * Two stacks are produced on purpose:
 * - {@link ErrorDetails.displayStack} is truncated to {@link MAX_DISPLAY_STACK_LINES}
 *   and carries the literal elision marker, because a 4 000-frame stack renders
 *   the Restart button off-screen.
 * - {@link ErrorDetails.stack} keeps everything, and {@link formatErrorReport}
 *   copies it (capped at {@link MAX_REPORT_CHARS}) — which is what makes the
 *   elision marker's "use Copy error details for the full stack" truthful.
 *
 * @see docs/design/design-issue-60.md §2.3 (error containment) and §5 (test rows)
 * @module components/RootErrorBoundary/errorDetails
 */

/** Lines of stack kept in the on-screen (truncated) stack. */
export const MAX_DISPLAY_STACK_LINES = 100

/**
 * Hard cap on the copyable report, in UTF-16 code units (~16 KB).
 *
 * Well under `CLIPBOARD_MAX_TEXT_LENGTH` (5 MB, `shared/ipc/clipboard-schema`),
 * so the report can never be rejected by the clipboard bridge's own cap — the
 * user always gets *something* on the clipboard.
 */
export const MAX_REPORT_CHARS = 16 * 1024

/** Trailing note appended when a report is cut down to {@link MAX_REPORT_CHARS}. */
export const REPORT_TRUNCATION_NOTICE = '\n… report truncated'

/**
 * Hard cap on the extracted `message`, in UTF-16 code units.
 *
 * The message is attacker-influenced in practice — a parser failure can embed a
 * whole document in it. `formatErrorReport` puts the message BEFORE the stack,
 * so an uncapped 16 KB message would push the stack past
 * {@link MAX_REPORT_CHARS} and the copied report would contain no stack at all,
 * which is the one thing it exists to carry. 2 000 characters is ~25 lines of
 * prose: far more than any real message, far less than the report budget.
 */
export const MAX_MESSAGE_CHARS = 2000

/** Suffix that replaces the last character when a message is cut. */
export const MESSAGE_TRUNCATION_SUFFIX = '…'

/**
 * Tail of the stack-elision marker.
 *
 * Exported so tests can assert the literal without re-encoding the pluralised
 * prefix. The full marker reads
 * `… 42 more lines – use Copy error details for the full stack`.
 */
export const ELISION_MARKER_SUFFIX = 'use Copy error details for the full stack'

/** Value substituted whenever a property is unreadable or absent. */
const UNKNOWN = 'unknown'

/**
 * Build-time app version, resolved defensively.
 *
 * `__APP_VERSION__` is inlined by the renderer build (`electron.vite.config.ts`)
 * and mirrored in `vitest.renderer.ts`. The guard costs nothing and keeps this
 * module usable from any host that forgot the `define`.
 */
export const APP_VERSION: string = ((): string => {
  try {
    return typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
      ? __APP_VERSION__
      : UNKNOWN
  } catch {
    return UNKNOWN
  }
})()

/** Everything the fallback UI and the crash log need about one caught error. */
export interface ErrorDetails {
  /** Error constructor name, or `Error` when unreadable */
  name: string
  /**
   * UNTRUSTED error message, capped at {@link MAX_MESSAGE_CHARS} — render as
   * text only, never as HTML
   */
  message: string
  /** Complete stack as captured; `''` when the value carried none */
  stack: string
  /** Stack truncated for display, with the elision marker appended when cut */
  displayStack: string
  /** Number of stack lines omitted from {@link displayStack} (0 when whole) */
  elidedStackLines: number
  /** React component stack, or `''` when unavailable (render-phase capture) */
  componentStack: string
  /** App version the crash happened on */
  version: string
  /** ISO-8601 capture time, or `''` when the clock read failed */
  timestamp: string
}

/**
 * Read a value that may be behind a throwing getter, coercing to a string.
 *
 * @param read - Thunk performing the (possibly throwing) property access
 * @param fallback - Value returned when the read throws or yields nothing
 * @returns The string value, or `fallback`
 */
function readString(read: () => unknown, fallback: string): string {
  try {
    const value = read()
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return fallback
    // May itself throw for a hostile `toString` — the catch below covers it.
    return String(value)
  } catch {
    return fallback
  }
}

/**
 * Cut an error message down to {@link MAX_MESSAGE_CHARS}.
 *
 * The result is never longer than the cap: the ellipsis replaces the last kept
 * character rather than being appended past it.
 *
 * @param message - Raw, untrusted message text
 * @returns The message, truncated with an ellipsis when it was too long
 */
function capMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_CHARS) return message
  return (
    message.slice(0, MAX_MESSAGE_CHARS - MESSAGE_TRUNCATION_SUFFIX.length) +
    MESSAGE_TRUNCATION_SUFFIX
  )
}

/**
 * Coerce an arbitrary thrown value into an `Error` the logger can serialise.
 *
 * The renderer logger reads `name` / `message` / `stack` off whatever it is
 * given, so a thrown string or object must be wrapped rather than passed
 * through.
 *
 * @param value - The thrown value, of any type
 * @returns `value` itself when it is already an `Error`, otherwise a wrapper
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  const wrapped = new Error(readString(() => value, UNKNOWN))
  wrapped.name = 'NonError'
  return wrapped
}

/**
 * The literal marker appended in place of elided stack lines.
 *
 * @param count - Number of lines omitted (always ≥ 1 when called)
 * @returns Marker text, e.g. `… 42 more lines – use Copy error details for the full stack`
 */
export function formatElisionMarker(count: number): string {
  const noun = count === 1 ? 'line' : 'lines'
  return `… ${count} more ${noun} – ${ELISION_MARKER_SUFFIX}`
}

/**
 * Extract everything the crash UI needs from a caught value.
 *
 * Never throws, for any input.
 *
 * @param error - The thrown value (any type; hostile getters tolerated)
 * @param componentStack - React component stack, when the boundary has one yet
 * @param version - App version to stamp on the report
 * @returns A fully populated {@link ErrorDetails}
 */
export function buildErrorDetails(
  error: unknown,
  componentStack: string | null | undefined,
  version: string
): ErrorDetails {
  const name = readString(() => (error as Error | null | undefined)?.name, 'Error')
  const message = readString(
    () => (error as Error | null | undefined)?.message,
    readString(() => error, UNKNOWN)
  )
  const stack = readString(() => (error as Error | null | undefined)?.stack, '')

  const lines = stack.length > 0 ? stack.split('\n') : []
  const elidedStackLines = Math.max(0, lines.length - MAX_DISPLAY_STACK_LINES)
  const displayStack =
    elidedStackLines > 0
      ? [...lines.slice(0, MAX_DISPLAY_STACK_LINES), formatElisionMarker(elidedStackLines)].join(
          '\n'
        )
      : stack

  return {
    name,
    // Capped at extraction, not at render: every consumer (fallback UI, log
    // context, copied report) then works from the same bounded string.
    message: capMessage(message),
    stack,
    displayStack,
    elidedStackLines,
    componentStack: readString(() => componentStack, ''),
    version: readString(() => version, UNKNOWN) || UNKNOWN,
    // Impure read in a render-phase caller (`getDerivedStateFromError`),
    // accepted knowingly: under StrictMode's double render the two invocations
    // differ by a few milliseconds, which is timestamp jitter on a crash
    // report — not a correctness problem worth threading a clock through.
    timestamp: readString(() => new Date().toISOString(), '')
  }
}

/**
 * A details object for the case where even extraction failed.
 *
 * @param version - App version to stamp on the placeholder
 * @returns A minimal but complete {@link ErrorDetails}
 */
export function emptyErrorDetails(version: string): ErrorDetails {
  return {
    name: 'Error',
    message: UNKNOWN,
    stack: '',
    displayStack: '',
    elidedStackLines: 0,
    componentStack: '',
    version: readString(() => version, UNKNOWN) || UNKNOWN,
    timestamp: ''
  }
}

/**
 * Structured context attached to the crash log line.
 *
 * Shared by `RootErrorBoundary` and `installGlobalErrorTrail` so a crash and an
 * async failure produce the same shape in the log file.
 *
 * @param details - Extracted crash details
 * @returns Log context for `logger.fatal`
 */
export function buildLogContext(details: ErrorDetails): Record<string, unknown> {
  return {
    componentStack: details.componentStack,
    appVersion: details.version,
    errorName: details.name,
    stackTruncated: details.elidedStackLines > 0
  }
}

/**
 * Render the copyable crash report.
 *
 * Uses the FULL stack (not `displayStack`), capped at {@link MAX_REPORT_CHARS}.
 * Never throws.
 *
 * @param details - Extracted crash details
 * @returns Plain-text report, at most {@link MAX_REPORT_CHARS} characters
 */
export function formatErrorReport(details: ErrorDetails): string {
  let report: string
  try {
    report = [
      'Erfana crash report',
      `version: ${details.version}`,
      `timestamp: ${details.timestamp}`,
      `error: ${details.name}: ${details.message}`,
      '',
      'stack:',
      details.stack.length > 0 ? details.stack : '(no stack captured)',
      '',
      'component stack:',
      details.componentStack.length > 0 ? details.componentStack : '(no component stack captured)'
    ].join('\n')
  } catch {
    return 'Erfana crash report\n(report could not be assembled)'
  }

  if (report.length <= MAX_REPORT_CHARS) return report
  return (
    report.slice(0, MAX_REPORT_CHARS - REPORT_TRUNCATION_NOTICE.length) + REPORT_TRUNCATION_NOTICE
  )
}
