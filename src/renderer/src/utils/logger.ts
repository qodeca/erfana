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
   */
  private sendLog(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      source: 'renderer',
      context,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          }
        : undefined
    }

    try {
      window.api.logging.log(entry)
    } catch (err) {
      // Last resort - log to console if IPC fails
      console.error('Failed to send log to main process:', err)
    }
  }

  /**
   * Install global error handlers to capture unhandled errors
   */
  private installErrorHandlers(): void {
    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
      this.error('Unhandled promise rejection', error, {
        promise: String(event.promise)
      })
    })

    // Capture uncaught errors
    window.addEventListener('error', (event) => {
      this.error('Uncaught error', event.error, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
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
