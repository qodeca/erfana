// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer process logger
 *
 * Singleton logger that sends logs to main process via IPC
 *
 * Features:
 * - 6 log levels: trace, debug, info, warn, error, fatal
 * - Syncs level with global settings
 * - Automatic error capture (unhandledrejection, error events)
 * - Structured log entries with timestamp, source, context
 *
 * @see LoggingService.ts - main process logging implementation
 * @see Issue #49 - logging layer implementation
 */
import type { LogLevel, LogEntry } from '../../../shared/ipc/logging-schema'
import { shouldLog } from '../../../shared/ipc/logging-schema'

/** Console prefix used when no log entry can be delivered over IPC. */
const SEND_FAILURE_PREFIX = 'Failed to send log to main process:'

/** Stand-in for a value that could not be read or stringified at all. */
const UNREADABLE_VALUE = '[unreadable]'

/**
 * Coerce an unknown value to a string without ever throwing.
 *
 * The values reaching this logger during a crash are arbitrary: a rejected
 * promise carries any value, and an error object can have a hostile `message`
 * or `stack` accessor. `String(value)` throws for those, and a throwing logger
 * turns a recoverable incident into a second, unrecorded one.
 *
 * @param value - Any value, including one with throwing accessors
 * @returns Its string form, or {@link UNREADABLE_VALUE}
 */
function safeString(value: unknown): string {
  try {
    return typeof value === 'string' ? value : String(value)
  } catch {
    return UNREADABLE_VALUE
  }
}

/**
 * Read a value through an accessor that may itself throw.
 *
 * @param read - Accessor to evaluate
 * @param fallback - Value to use when the accessor throws
 */
function readSafely<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

/**
 * Coerce a value to a finite number, defaulting to 0.
 *
 * @param value - Any value; `undefined`, `NaN` and non-numerics become 0
 */
function toFiniteNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

/**
 * Normalise an arbitrary thrown / rejected value into an `Error`.
 *
 * @param value - The thrown value; `null` / `undefined` yield `undefined`
 */
function toErrorOrUndefined(value: unknown): Error | undefined {
  if (value === undefined || value === null) return undefined
  if (value instanceof Error) return value
  return new Error(safeString(value))
}

/**
 * Serialise an `Error` field by field, each read guarded independently.
 *
 * A hostile or exotic error (a Proxy, a partially-constructed subclass) can
 * throw from any one accessor. Guarding per field means one bad property costs
 * that field, not the whole record.
 *
 * @param error - The error to describe
 * @returns The `LogEntry.error` payload — shape unchanged from a plain read
 */
function describeError(error: Error): LogEntry['error'] {
  const stack = readSafely(() => error.stack, undefined)
  return {
    name: readSafely(() => safeString(error.name), UNREADABLE_VALUE),
    message: readSafely(() => safeString(error.message), UNREADABLE_VALUE),
    stack: stack === undefined ? undefined : safeString(stack)
  }
}

/**
 * Resolve the log transport available in THIS renderer.
 *
 * The editor window is given `window.api.logging.log` by `preload/index.ts`.
 * The screenshot-overlay window has no `window.api` at all — its split preload
 * (`preload/screenshotOverlay.ts`, #164 F[6]) exposes `window.overlayApi.log`
 * over the same `logging:log` channel, which is the only evidence trail that
 * window can produce (#60).
 *
 * Resolved per call, never cached: a log can be emitted before the bridge is
 * attached, and a cached miss would silence the window permanently.
 *
 * @returns A send function, or `undefined` when no bridge is present
 */
function resolveLogSink(): ((entry: LogEntry) => void) | undefined {
  const mainBridge = window.api?.logging
  if (typeof mainBridge?.log === 'function') {
    return (entry) => mainBridge.log(entry)
  }

  const overlayBridge = window.overlayApi
  if (typeof overlayBridge?.log === 'function') {
    return (entry) => overlayBridge.log?.(entry)
  }

  return undefined
}

/**
 * Renderer logger implementation
 */
export class RendererLogger {
  private currentLevel: LogLevel = 'info'

  /**
   * Initialize logger
   * - Sync level from main process
   * - Install error handlers
   */
  async initialize(): Promise<void> {
    try {
      // Get initial level from main process
      const level = await window.api.logging.getLevel()
      this.currentLevel = level as LogLevel

      // Install global error handlers
      this.installErrorHandlers()
    } catch (error) {
      console.error('Failed to initialize renderer logger:', error)
      // Fallback to default level
      this.currentLevel = 'info'
    }
  }

  /**
   * Set current log level (called when settings change)
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.currentLevel
  }

  /**
   * Log trace message (lowest severity)
   */
  trace(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('trace', this.currentLevel)) return
    this.sendLog('trace', message, undefined, context)
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('debug', this.currentLevel)) return
    this.sendLog('debug', message, undefined, context)
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('info', this.currentLevel)) return
    this.sendLog('info', message, undefined, context)
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('warn', this.currentLevel)) return
    this.sendLog('warn', message, undefined, context)
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!shouldLog('error', this.currentLevel)) return
    this.sendLog('error', message, error, context)
  }

  /**
   * Log fatal message (highest severity)
   */
  fatal(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!shouldLog('fatal', this.currentLevel)) return
    this.sendLog('fatal', message, error, context)
  }

  /**
   * Send log entry to main process via IPC
   *
   * The entry is built INSIDE the try: `error.message` / `error.stack` are
   * arbitrary accessors, and building the payload outside meant a throwing one
   * propagated out of `sendLog` into the caller — turning a logged incident
   * into an unlogged crash. Field reads are guarded individually
   * ({@link describeError}) so a hostile accessor costs one field, not the record.
   *
   * Falls back to the overlay bridge when `window.api` is absent, and to the
   * console when neither bridge exists.
   */
  private sendLog(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    try {
      const entry: LogEntry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        source: 'renderer',
        context,
        error: error ? describeError(error) : undefined
      }

      const send = resolveLogSink()
      if (send) {
        send(entry)
        return
      }

      // No bridge in this renderer (pre-bridge boot failure, or a window whose
      // preload never finished). The console is the last place the record can
      // still be seen — main mirrors it via the webContents console trail.
      console.error(`${SEND_FAILURE_PREFIX} no logging bridge available`, entry)
    } catch (err) {
      // Last resort - log to console if IPC fails
      console.error(SEND_FAILURE_PREFIX, err)
    }
  }

  /**
   * Install global error handlers to capture unhandled errors
   *
   * Every value here is attacker-shaped by definition — a rejection reason is
   * any value at all, and event fields can be exotic — so each is read through
   * a guarded accessor and stringified with {@link safeString}. Never call
   * `.toString()` on an unknown reason directly.
   */
  private installErrorHandlers(): void {
    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const reason = readSafely(() => event?.reason, undefined)
      const error = toErrorOrUndefined(reason) ?? new Error(safeString(reason))
      this.error('Unhandled promise rejection', error, {
        promise: readSafely(() => safeString(event?.promise), UNREADABLE_VALUE)
      })
    })

    // Capture uncaught errors
    window.addEventListener('error', (event) => {
      const error = toErrorOrUndefined(readSafely(() => event?.error, undefined))
      this.error('Uncaught error', error, {
        filename: readSafely(() => safeString(event?.filename ?? ''), UNREADABLE_VALUE),
        lineno: readSafely(() => toFiniteNumber(event?.lineno), 0),
        colno: readSafely(() => toFiniteNumber(event?.colno), 0)
      })
    })
  }
}

/** Singleton instance */
export const logger = new RendererLogger()

/**
 * Initialize renderer logger
 * Should be called once on app startup
 */
export async function initializeLogger(): Promise<void> {
  await logger.initialize()
}
