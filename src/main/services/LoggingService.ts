/**
 * LoggingService
 *
 * Centralized logging service for Erfana application using electron-log
 *
 * Features:
 * - Singleton pattern for consistent logging state
 * - 6 log levels: trace, debug, info, warn, error, fatal
 * - Two log files: combined.log (all logs) and main-only.log (error/fatal from main)
 * - 10MB file size rotation with daily rotation
 * - 7-day retention policy
 * - Dynamic log level from GlobalSettingsService
 * - IPC integration for renderer process logs
 *
 * File locations:
 * - combined.log: ~/.erfana/logs/combined.log
 * - main-only.log: ~/.erfana/logs/main-only.log
 *
 * @see Issue #49 - logging layer implementation
 */
import log from 'electron-log'
import { homedir } from 'os'
import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { globalSettingsService } from './GlobalSettingsService'
import { AppError, ErrorCode } from '../../shared/errors'
import { type LogLevel, type LogEntry, shouldLog } from '../../shared/ipc/logging-schema'
import type { LoggingLevel } from '../../shared/ipc/global-settings-schema'

/** Logs directory */
const LOGS_DIR = '.erfana/logs'
/** Combined log file (all logs from both processes) */
const COMBINED_LOG = 'combined.log'
/** Main-only log file (error/fatal from main process only) */
const MAIN_ONLY_LOG = 'main-only.log'
/** Log retention period in days */
const RETENTION_DAYS = 7
/** Maximum log file size before rotation (10MB) */
const MAX_SIZE = 10 * 1024 * 1024

/**
 * Map our log levels to electron-log levels
 * - trace -> verbose (electron-log doesn't have trace)
 * - fatal -> error (electron-log doesn't have fatal)
 */
type ElectronLogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly'
function mapToElectronLogLevel(level: LogLevel): ElectronLogLevel {
  switch (level) {
    case 'trace':
      return 'verbose'
    case 'debug':
      return 'debug'
    case 'info':
      return 'info'
    case 'warn':
      return 'warn'
    case 'error':
      return 'error'
    case 'fatal':
      return 'error'
  }
}

/**
 * Logging service implementation
 */
export class LoggingService {
  private currentLevel: LogLevel = 'info'
  private unsubscribeSettings: (() => void) | null = null

  /**
   * Initialize logging service
   * - Configure electron-log transports
   * - Subscribe to global settings changes
   * - Set initial log level
   */
  async initialize(): Promise<void> {
    try {
      const logsDir = this.getLogsDir()

      // Configure file transport for combined.log
      log.transports.file.resolvePathFn = () => join(logsDir, COMBINED_LOG)
      log.transports.file.maxSize = MAX_SIZE
      log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

      // Disable console transport in production (we have our own safe-console)
      // Keep it enabled in development for immediate feedback
      if (!process.env.ELECTRON_RENDERER_URL) {
        log.transports.console.level = false
      }

      // Get initial level from global settings
      const settings = globalSettingsService.getSettings()
      this.currentLevel = settings.logging.level as LogLevel

      // Set electron-log level (map to electron-log's levels)
      log.transports.file.level = mapToElectronLogLevel(this.currentLevel)

      // Subscribe to settings changes
      this.unsubscribeSettings = globalSettingsService.onSettingsChanged((event) => {
        if (event.changedKey === 'logging' || event.changedKey === 'reset') {
          const newLevel = event.settings.logging.level as LogLevel
          this.setLevel(newLevel)
          this.info('Log level changed', { from: this.currentLevel, to: newLevel })
        }
      })

      this.info('Logging service initialized', { level: this.currentLevel, logsDir })
    } catch (error) {
      throw new AppError(
        `Failed to initialize logging service: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.LOGGING_INIT_FAILED,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Set current log level
   * Updates both internal state and electron-log configuration
   */
  setLevel(level: LoggingLevel): void {
    this.currentLevel = level as LogLevel
    log.transports.file.level = mapToElectronLogLevel(this.currentLevel)
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
    const formattedMessage = this.formatMessage(message, context)
    log.verbose(formattedMessage) // electron-log uses 'verbose' for trace
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('debug', this.currentLevel)) return
    const formattedMessage = this.formatMessage(message, context)
    log.debug(formattedMessage)
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('info', this.currentLevel)) return
    const formattedMessage = this.formatMessage(message, context)
    log.info(formattedMessage)
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('warn', this.currentLevel)) return
    const formattedMessage = this.formatMessage(message, context)
    log.warn(formattedMessage)
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!shouldLog('error', this.currentLevel)) return
    const formattedMessage = this.formatErrorMessage(message, error, context)
    log.error(formattedMessage)

    // Also write to main-only.log
    this.writeToMainOnly('error', formattedMessage)
  }

  /**
   * Log fatal message (highest severity)
   */
  fatal(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!shouldLog('fatal', this.currentLevel)) return
    const formattedMessage = this.formatErrorMessage(message, error, context)
    log.error(formattedMessage) // electron-log doesn't have fatal, use error

    // Also write to main-only.log
    this.writeToMainOnly('fatal', formattedMessage)
  }

  /**
   * Log entry from renderer process (via IPC)
   */
  logFromRenderer(entry: LogEntry): void {
    if (!shouldLog(entry.level, this.currentLevel)) return

    const message = this.formatRendererMessage(entry)

    // Map log level to electron-log method
    switch (entry.level) {
      case 'trace':
        log.verbose(message)
        break
      case 'debug':
        log.debug(message)
        break
      case 'info':
        log.info(message)
        break
      case 'warn':
        log.warn(message)
        break
      case 'error':
        log.error(message)
        break
      case 'fatal':
        log.error(message)
        break
    }
  }

  /**
   * Cleanup old log files (older than RETENTION_DAYS)
   * Fire-and-forget - errors are logged but don't throw
   */
  async cleanupOldLogs(): Promise<void> {
    try {
      const logsDir = this.getLogsDir()
      const files = await readdir(logsDir)
      const now = Date.now()
      const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000

      for (const file of files) {
        // Only cleanup .log files (not .log.1, .log.2 - electron-log manages those)
        if (!file.endsWith('.log')) continue

        try {
          const filePath = join(logsDir, file)
          const stats = await stat(filePath)
          const age = now - stats.mtimeMs

          if (age > maxAge) {
            await unlink(filePath)
            this.debug('Deleted old log file', { file, ageInDays: Math.floor(age / (24 * 60 * 60 * 1000)) })
          }
        } catch (error) {
          // Log but continue with other files
          this.warn('Failed to cleanup log file', { file, error: String(error) })
        }
      }
    } catch (error) {
      // Log but don't throw - cleanup is best-effort
      this.warn('Failed to cleanup old logs', { error: String(error) })
    }
  }

  /**
   * Dispose service - unsubscribe from settings
   */
  dispose(): void {
    if (this.unsubscribeSettings) {
      this.unsubscribeSettings()
      this.unsubscribeSettings = null
    }
  }

  /**
   * Get logs directory path
   */
  private getLogsDir(): string {
    return join(homedir(), LOGS_DIR)
  }

  /**
   * Format message with optional context
   */
  private formatMessage(message: string, context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) {
      return message
    }
    return `${message} ${JSON.stringify(context)}`
  }

  /**
   * Format error message with error object and context
   */
  private formatErrorMessage(
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): string {
    const parts: string[] = [message]

    if (error) {
      parts.push(`Error: ${error.message}`)
      if (error.stack) {
        parts.push(`Stack: ${error.stack}`)
      }
    }

    if (context && Object.keys(context).length > 0) {
      parts.push(JSON.stringify(context))
    }

    return parts.join(' | ')
  }

  /**
   * Format renderer log entry for combined.log
   */
  private formatRendererMessage(entry: LogEntry): string {
    const parts: string[] = [`[RENDERER] ${entry.message}`]

    if (entry.error) {
      parts.push(`Error: ${entry.error.message}`)
      if (entry.error.stack) {
        parts.push(`Stack: ${entry.error.stack}`)
      }
    }

    if (entry.context && Object.keys(entry.context).length > 0) {
      parts.push(JSON.stringify(entry.context))
    }

    return parts.join(' | ')
  }

  /**
   * Write to main-only.log for error/fatal from main process
   * Uses synchronous fs to ensure write completes
   */
  private writeToMainOnly(level: 'error' | 'fatal', message: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs')
      const logsDir = this.getLogsDir()
      const mainOnlyPath = join(logsDir, MAIN_ONLY_LOG)
      const timestamp = new Date().toISOString()
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`

      // Ensure directory exists
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true })
      }

      // Append to file
      fs.appendFileSync(mainOnlyPath, logLine, 'utf-8')

      // Check file size and rotate if needed
      const stats = fs.statSync(mainOnlyPath)
      if (stats.size > MAX_SIZE) {
        const rotatedPath = `${mainOnlyPath}.${Date.now()}`
        fs.renameSync(mainOnlyPath, rotatedPath)
      }
    } catch (error) {
      // Last resort - log to console (safe-console will handle EPIPE)
      console.error(`Failed to write to main-only.log: ${error}`)
    }
  }
}

/** Singleton instance */
export const loggingService = new LoggingService()

/**
 * Convenience logger object for easy imports
 * Usage: import { logger } from './services/LoggingService'
 */
export const logger = {
  trace: (message: string, context?: Record<string, unknown>): void =>
    loggingService.trace(message, context),
  debug: (message: string, context?: Record<string, unknown>): void =>
    loggingService.debug(message, context),
  info: (message: string, context?: Record<string, unknown>): void =>
    loggingService.info(message, context),
  warn: (message: string, context?: Record<string, unknown>): void =>
    loggingService.warn(message, context),
  error: (message: string, error?: Error, context?: Record<string, unknown>): void =>
    loggingService.error(message, error, context),
  fatal: (message: string, error?: Error, context?: Record<string, unknown>): void =>
    loggingService.fatal(message, error, context)
}
