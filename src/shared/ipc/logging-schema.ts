// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schema for logging system
 *
 * Defines log levels, priority mapping, and log entry structure
 * @see LoggingService.ts - main process logging implementation
 * @see logger.ts - renderer process logger
 * @see Issue #49 - logging layer implementation
 */
import { z } from 'zod'

/**
 * Log level enum - ordered from lowest to highest severity
 */
export const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
export type LogLevel = z.infer<typeof LogLevelSchema>

/**
 * Priority mapping for log level comparison
 * Used to determine if a log should be written based on current minimum level
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5
}

/**
 * Bounds on a renderer log entry (the renderer is untrusted input).
 *
 * Oversized fields are SHORTENED, not rejected: the entry that overflows is
 * often the one that explains a crash (a React `componentStack`, a long stack),
 * and dropping it would lose exactly that. Only a malformed shape is rejected.
 */
export const LOG_MESSAGE_MAX_LENGTH = 8_000
export const LOG_ERROR_NAME_MAX_LENGTH = 200
export const LOG_ERROR_STACK_MAX_LENGTH = 16_000
export const LOG_TIMESTAMP_MAX_LENGTH = 64
export const LOG_CONTEXT_MAX_KEYS = 50
/** Longest kept form of a single context value, in characters */
export const LOG_CONTEXT_MAX_VALUE_LENGTH = 4_000
/** Longest allowed JSON form of the whole context object, in characters */
export const LOG_CONTEXT_MAX_JSON_LENGTH = 8_000
/** Appended to a shortened string */
export const TRUNCATION_MARKER = '[truncated]'
/** Context key added when anything in the context was shortened or dropped */
export const CONTEXT_TRUNCATED_KEY = 'truncated'

/** Shorten `text` to `max` characters, marking the cut. */
export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}${TRUNCATION_MARKER}` : text
}

/** A string schema that shortens instead of rejecting. */
const boundedString = (max: number): z.ZodPipe<z.ZodString, z.ZodTransform<string, string>> =>
  z.string().transform((value) => truncateText(value, max))

/**
 * Shorten a context object to fit the bounds, keeping what fits:
 * at most {@link LOG_CONTEXT_MAX_KEYS} keys, each value cut to
 * {@link LOG_CONTEXT_MAX_VALUE_LENGTH} (strings directly, other values via
 * their JSON form), and keys that would push the total JSON past
 * {@link LOG_CONTEXT_MAX_JSON_LENGTH} dropped. Anything cut adds
 * `truncated: true`.
 */
export function shortenContext(context: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let truncated = false
  let total = 2

  const keys = Object.keys(context)
  if (keys.length > LOG_CONTEXT_MAX_KEYS) truncated = true

  for (const key of keys.slice(0, LOG_CONTEXT_MAX_KEYS)) {
    let value: unknown = context[key]
    if (typeof value === 'string') {
      const shortened = truncateText(value, LOG_CONTEXT_MAX_VALUE_LENGTH)
      truncated ||= shortened !== value
      value = shortened
    } else if (value !== null && typeof value === 'object') {
      let json: string | undefined
      try {
        json = JSON.stringify(value)
      } catch {
        json = undefined
      }
      if (json === undefined) {
        value = '[unserializable]'
        truncated = true
      } else if (json.length > LOG_CONTEXT_MAX_VALUE_LENGTH) {
        value = truncateText(json, LOG_CONTEXT_MAX_VALUE_LENGTH)
        truncated = true
      }
    }

    const cost = JSON.stringify(key).length + (JSON.stringify(value)?.length ?? 0) + 2
    if (total + cost > LOG_CONTEXT_MAX_JSON_LENGTH) {
      truncated = true
      continue
    }
    total += cost
    result[key] = value
  }

  if (truncated) result[CONTEXT_TRUNCATED_KEY] = true
  return result
}

/**
 * Log entry structure sent from renderer to main process
 */
export const LogEntrySchema = z.object({
  /** Log severity level */
  level: LogLevelSchema,
  /** Log message (shortened when over the limit) */
  message: boundedString(LOG_MESSAGE_MAX_LENGTH),
  /** ISO timestamp when log was created */
  timestamp: boundedString(LOG_TIMESTAMP_MAX_LENGTH),
  /** Source of the log (main or renderer) */
  source: z.enum(['main', 'renderer']),
  /** Optional context data (e.g., file path, line number, additional metadata); shortened when over the limits */
  context: z
    .record(z.string(), z.unknown())
    .transform((context) => shortenContext(context))
    .optional(),
  /** Optional error object (serialized as { name, message, stack }) */
  error: z
    .object({
      name: boundedString(LOG_ERROR_NAME_MAX_LENGTH),
      message: boundedString(LOG_MESSAGE_MAX_LENGTH),
      stack: boundedString(LOG_ERROR_STACK_MAX_LENGTH).optional()
    })
    .optional()
})
export type LogEntry = z.infer<typeof LogEntrySchema>

/**
 * Determine if a log should be written based on current minimum level
 *
 * @param level - The level of the log message
 * @param minimumLevel - The minimum level to log (from settings)
 * @returns true if the log should be written, false otherwise
 *
 * @example
 * shouldLog('debug', 'info') // false (debug < info)
 * shouldLog('error', 'info') // true (error >= info)
 */
export function shouldLog(level: LogLevel, minimumLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minimumLevel]
}

/**
 * Validate and sanitize log level
 *
 * @param level - Potentially unsafe log level value
 * @returns Valid LogLevel, defaults to 'info' on validation failure
 *
 * @example
 * validateLogLevel('debug') // 'debug'
 * validateLogLevel('invalid') // 'info' (default)
 * validateLogLevel(null) // 'info' (default)
 */
export function validateLogLevel(level: unknown): LogLevel {
  const result = LogLevelSchema.safeParse(level)
  if (!result.success) {
    console.error('[LoggingService] Invalid log level, defaulting to info:', level)
    return 'info'
  }
  return result.data
}

/**
 * Shared contract for the preload `logging` bridge of the app window.
 *
 * Implemented by `window.api.logging` (preload, `loggingBridge.ts`) and
 * consumed by the renderer logging gateway. The screenshot-overlay window has
 * only `window.overlayApi.log` over the same `logging:log` channel.
 */
export interface LoggingBridge {
  /** Fire-and-forget: one log entry to the main process. */
  log(entry: LogEntry): void
  /** The current log level. */
  getLevel(): Promise<string>
  /** The logs folder path. */
  getLogsDir(): Promise<string>
  /** Open the logs folder in the file manager; `''` on success, the error text on failure. */
  openLogsFolder(): Promise<string>
}
