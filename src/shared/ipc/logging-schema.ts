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

/** Bounds on a renderer log entry (the renderer is untrusted input) */
export const LOG_MESSAGE_MAX_LENGTH = 8_000
export const LOG_ERROR_NAME_MAX_LENGTH = 200
export const LOG_ERROR_STACK_MAX_LENGTH = 16_000
export const LOG_TIMESTAMP_MAX_LENGTH = 64
export const LOG_CONTEXT_MAX_KEYS = 50
/** Longest allowed JSON form of the context object, in characters */
export const LOG_CONTEXT_MAX_JSON_LENGTH = 8_000

/** True when the context serializes within {@link LOG_CONTEXT_MAX_JSON_LENGTH}. */
function isContextSmallEnough(context: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(context).length <= LOG_CONTEXT_MAX_JSON_LENGTH
  } catch {
    return false
  }
}

/**
 * Log entry structure sent from renderer to main process
 */
export const LogEntrySchema = z.object({
  /** Log severity level */
  level: LogLevelSchema,
  /** Log message */
  message: z.string().max(LOG_MESSAGE_MAX_LENGTH),
  /** ISO timestamp when log was created */
  timestamp: z.string().max(LOG_TIMESTAMP_MAX_LENGTH),
  /** Source of the log (main or renderer) */
  source: z.enum(['main', 'renderer']),
  /** Optional context data (e.g., file path, line number, additional metadata) */
  context: z
    .record(z.string(), z.unknown())
    .refine((context) => Object.keys(context).length <= LOG_CONTEXT_MAX_KEYS, {
      message: `context has more than ${LOG_CONTEXT_MAX_KEYS} keys`
    })
    .refine(isContextSmallEnough, {
      message: `context is larger than ${LOG_CONTEXT_MAX_JSON_LENGTH} characters`
    })
    .optional(),
  /** Optional error object (serialized as { name, message, stack }) */
  error: z
    .object({
      name: z.string().max(LOG_ERROR_NAME_MAX_LENGTH),
      message: z.string().max(LOG_MESSAGE_MAX_LENGTH),
      stack: z.string().max(LOG_ERROR_STACK_MAX_LENGTH).optional()
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
