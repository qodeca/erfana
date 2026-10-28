// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LoggingService
 *
 * Centralized logging service for Erfana application using electron-log
 *
 * Features:
 * - Singleton pattern for consistent logging state
 * - 6 log levels: trace, debug, info, warn, error, fatal
 * - Three log files: combined.log (all logs), main.log (main process), renderer.log (renderer process)
 * - 10MB file size rotation, at most 5 rotated files per log (bounded disk use)
 * - 7-day retention policy, pruned oldest-first
 * - Dynamic log level from GlobalSettingsService
 * - IPC integration for renderer process logs
 *
 * File locations:
 * - combined.log: ~/.erfana/logs/combined.log (all logs from both processes)
 * - main.log: ~/.erfana/logs/main.log (main process only)
 * - renderer.log: ~/.erfana/logs/renderer.log (renderer process only)
 *
 * @see Issue #49 - logging layer implementation
 */
import log from 'electron-log'
import type Logger from 'electron-log'
import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'os'
import { readdir, stat, unlink, statfs } from 'fs/promises'
import { join, dirname, basename, extname } from 'path'
import { renameSync, lstatSync } from 'fs'
import { globalSettingsService } from './GlobalSettingsService'
import { AppError, ErrorCode } from '../../shared/errors'
import { LOGS_DIR_RELATIVE } from '../../shared/constants'
import { type LogLevel, type LogEntry, shouldLog, validateLogLevel } from '../../shared/ipc/logging-schema'
import type { LoggingLevel } from '../../shared/ipc/global-settings-schema'

/** Logs directory, relative to the home directory (shared with the crash fallback) */
const LOGS_DIR = LOGS_DIR_RELATIVE
/** Combined log file (all logs from both processes) */
const COMBINED_LOG = 'combined.log'
/** Main process log file */
const MAIN_LOG = 'main.log'
/** Renderer process log file */
const RENDERER_LOG = 'renderer.log'
/** Log retention period in days */
const RETENTION_DAYS = 7
/** Maximum log file size before rotation (10MB) */
const MAX_SIZE = 10 * 1024 * 1024
/**
 * Maximum number of rotated files per log (main.1.log through main.5.log).
 * With three logs of MAX_SIZE each this bounds the logs directory to roughly
 * 180MB; it used to be 100 files per log, about 3GB.
 */
const MAX_ROTATED_FILES = 5
/** Free space below which a warning is logged (cleanup still runs) */
const LOW_DISK_THRESHOLD_MB = 100
/** Longest renderer log message / stack written to a log line, in characters */
const MAX_RENDERER_FIELD_LENGTH = 16_000

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

/** C0 and C1 control characters, DEL, and the Unicode line / paragraph separators */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS =/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

const NAMED_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }

/**
 * Escape every control character so one log call can only ever produce one
 * log line: a CR/LF (or a separator some viewers treat as a line break) in a
 * message would otherwise let its author forge a second line, and the rest can
 * garble a terminal that tails the file. `\n`, `\r`, `\t` keep their familiar
 * spelling; the others become `\uXXXX`.
 */
export function escapeControlChars(text: string): string {
  return text.replace(
    CONTROL_CHARS,
    (char) => NAMED_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

/**
 * Make untrusted text safe for a single log line: escape control characters,
 * and bound the length.
 */
export function sanitizeLogText(text: string, maxLength: number = MAX_RENDERER_FIELD_LENGTH): string {
  const escaped = escapeControlChars(text)
  return escaped.length > maxLength ? `${escaped.slice(0, maxLength)}[truncated]` : escaped
}

/**
 * Archive log file using logrotate-style reverse numbering
 * - main.log -> main.1.log (most recent)
 * - main.1.log -> main.2.log
 * - ...
 * - main.4.log -> main.5.log, replacing the oldest
 *
 * This function must be synchronous per electron-log requirement, and runs on
 * the main thread, so it makes one call per file and no more: each shift is a
 * rename onto the next slot, which replaces the file there in one step, so the
 * oldest log goes without a separate delete and a crash mid-rotation never
 * leaves a gap. A missing file is ENOENT on its rename, not an existence check.
 */
function archiveLog(oldLogFile: Logger.LogFile): void {
  const logPath = oldLogFile.path
  const dir = dirname(logPath)
  const ext = extname(logPath)
  const base = basename(logPath, ext)

  try {
    // 1. Shift rotated files down, highest first, so none is overwritten unread
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const currentPath = join(dir, `${base}.${i}${ext}`)
      const nextPath = join(dir, `${base}.${i + 1}${ext}`)
      try {
        renameSync(currentPath, nextPath)
      } catch (err) {
        // Ignore ENOENT (file doesn't exist is fine)
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`[LoggingService] Failed to shift ${currentPath}:`, err)
        }
      }
    }

    // 2. Move current log to .1 (most recent rotated)
    try {
      renameSync(logPath, join(dir, `${base}.1${ext}`))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[LoggingService] Failed to rotate ${logPath}:`, err)
      }
    }
  } catch (error) {
    // Fallback error handler - log to stderr
    console.error(`[LoggingService] archiveLog failed for ${logPath}:`, error)
  }
}

/**
 * Logging service implementation
 */
export class LoggingService {
  private currentLevel: LogLevel = 'info'
  private unsubscribeSettings: (() => void) | null = null
  private isProcessingSettingsChange = false

  /**
   * Unique instance identifier (8 characters)
   * Used to distinguish log entries from different Erfana instances
   * @see Issue #78 - logging instance isolation
   */
  private readonly instanceId: string
  private readonly fullInstanceId: string

  constructor() {
    this.fullInstanceId = randomUUID()
    this.instanceId = this.fullInstanceId.slice(0, 8)
    this.applyTestTransportPolicy()
  }

  /**
   * Under Vitest, initialize() is never called, so the file transport would
   * otherwise fall back to electron-log's DEFAULT path
   * (~/Library/Logs/erfana/main.log) and pollute real user logs with the
   * expected errors that negative-path tests deliberately trigger. Silence the
   * file + console transports on all three loggers during test runs.
   * (initialize() -> configureLogger re-enables them with proper levels in
   * production, so this only affects test processes.)
   */
  private applyTestTransportPolicy(): void {
    if (!process.env.VITEST) return
    for (const l of [this.combinedLogger, this.mainLogger, this.rendererLogger]) {
      l.transports.file.level = false
      l.transports.console.level = false
    }
  }

  // Three independent logger instances
  private combinedLogger = log.create({ logId: 'combined' })
  private mainLogger = log.create({ logId: 'main' })
  private rendererLogger = log.create({ logId: 'renderer' })

  /**
   * Initialize logging service
   * - Configure electron-log transports for all three loggers
   * - Subscribe to global settings changes
   * - Set initial log level
   */
  async initialize(): Promise<void> {
    try {
      const logsDir = this.getLogsDir()

      // Validate logs directory is not a symlink (security)
      this.validateLogsDir(logsDir)

      // Get initial level from global settings
      const settings = globalSettingsService.getSettings()
      this.currentLevel = validateLogLevel(settings.logging.level)

      // Configure all three loggers
      // Only combinedLogger gets console output to avoid duplicate log lines
      this.configureLogger(this.combinedLogger, join(logsDir, COMBINED_LOG), true)
      this.configureLogger(this.mainLogger, join(logsDir, MAIN_LOG), false)
      this.configureLogger(this.rendererLogger, join(logsDir, RENDERER_LOG), false)

      // Subscribe to settings changes with recursion guard
      this.unsubscribeSettings = globalSettingsService.onSettingsChanged((event) => {
        if (this.isProcessingSettingsChange) return

        if (event.changedKey === 'logging' || event.changedKey === 'reset') {
          this.isProcessingSettingsChange = true
          try {
            const newLevel = validateLogLevel(event.settings.logging.level)
            const oldLevel = this.currentLevel
            this.setLevel(newLevel)
            if (oldLevel !== newLevel) {
              this.info('Log level changed', { from: oldLevel, to: newLevel })
            }
          } finally {
            this.isProcessingSettingsChange = false
          }
        }
      })

      this.info('Instance started', {
        instanceId: this.instanceId,
        fullInstanceId: this.fullInstanceId,
        level: this.currentLevel,
        logsDir
      })
    } catch (error) {
      this.fallbackToConsole()
      throw new AppError(
        `Failed to initialize logging service: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.LOGGING_INIT_FAILED,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Last resort when initialize() fails: stop writing to files (their path may
   * be the very thing that is broken) and log to the console instead, so the
   * app keeps a trail while it carries on without file logging.
   */
  private fallbackToConsole(): void {
    for (const l of [this.combinedLogger, this.mainLogger, this.rendererLogger]) {
      l.transports.file.level = false
      l.transports.console.level = process.env.VITEST ? false : mapToElectronLogLevel(this.currentLevel)
    }
  }

  /**
   * Configure a logger instance
   * @param logger - The electron-log logger instance to configure
   * @param filePath - Path to the log file
   * @param enableConsole - Whether to enable console transport for this logger
   */
  private configureLogger(logger: Logger.MainLogger, filePath: string, enableConsole: boolean = false): void {
    // Configure file transport
    logger.transports.file.resolvePathFn = () => filePath
    logger.transports.file.maxSize = MAX_SIZE
    logger.transports.file.format = `[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [${this.instanceId}] [{level}] {text}`
    logger.transports.file.level = mapToElectronLogLevel(this.currentLevel)
    logger.transports.file.archiveLogFn = archiveLog

    // Disable console transport unless explicitly enabled for this logger
    // Only combinedLogger should have console enabled in dev mode to avoid duplicates
    // (since each log call writes to both combinedLogger and mainLogger/rendererLogger)
    if (!enableConsole || !process.env.ELECTRON_RENDERER_URL) {
      logger.transports.console.level = false
    }
  }

  /**
   * Set current log level
   * Updates both internal state and electron-log configuration for all loggers
   */
  setLevel(level: LoggingLevel): void {
    this.currentLevel = level as LogLevel
    const electronLogLevel = mapToElectronLogLevel(this.currentLevel)

    this.combinedLogger.transports.file.level = electronLogLevel
    this.mainLogger.transports.file.level = electronLogLevel
    this.rendererLogger.transports.file.level = electronLogLevel
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.currentLevel
  }

  /**
   * Get instance identifier (8 characters)
   * Useful for correlating logs from this instance
   */
  getInstanceId(): string {
    return this.instanceId
  }

  /**
   * Get full instance identifier (UUID)
   * Useful for unique identification across all instances
   */
  getFullInstanceId(): string {
    return this.fullInstanceId
  }

  /**
   * Log trace message (lowest severity)
   */
  trace(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('trace', this.currentLevel)) return
    const formattedMessage = this.formatMessage(message, context)
    // Write to both combined and main logs
    this.combinedLogger.verbose(formattedMessage)
    this.mainLogger.verbose(formattedMessage)
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('debug', this.currentLevel)) return
    const formattedMessage = this.formatMessage(message, context)
    // Write to both combined and main logs
    this.combinedLogger.debug(formattedMessage)
    this.mainLogger.debug(formattedMessage)
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('info', this.currentLevel)) return
    const formattedMessage = this.formatMessage(message, context)
    // Write to both combined and main logs
    this.combinedLogger.info(formattedMessage)
    this.mainLogger.info(formattedMessage)
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('warn', this.currentLevel)) return
    const formattedMessage = this.formatMessage(message, context)
    // Write to both combined and main logs
    this.combinedLogger.warn(formattedMessage)
    this.mainLogger.warn(formattedMessage)
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!shouldLog('error', this.currentLevel)) return
    const formattedMessage = this.formatErrorMessage(message, error, context)
    // Write to both combined and main logs
    this.combinedLogger.error(formattedMessage)
    this.mainLogger.error(formattedMessage)
  }

  /**
   * Log fatal message (highest severity)
   */
  fatal(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!shouldLog('fatal', this.currentLevel)) return
    const formattedMessage = this.formatErrorMessage(message, error, context)
    // Write to both combined and main logs (electron-log doesn't have fatal, use error)
    this.combinedLogger.error(formattedMessage)
    this.mainLogger.error(formattedMessage)
  }

  /**
   * Log entry from renderer process (via IPC)
   */
  logFromRenderer(entry: LogEntry): void {
    if (!shouldLog(entry.level, this.currentLevel)) return

    const message = this.formatRendererMessage(entry)

    // Write to both combined and renderer logs
    switch (entry.level) {
      case 'trace':
        this.combinedLogger.verbose(message)
        this.rendererLogger.verbose(message)
        break
      case 'debug':
        this.combinedLogger.debug(message)
        this.rendererLogger.debug(message)
        break
      case 'info':
        this.combinedLogger.info(message)
        this.rendererLogger.info(message)
        break
      case 'warn':
        this.combinedLogger.warn(message)
        this.rendererLogger.warn(message)
        break
      case 'error':
        this.combinedLogger.error(message)
        this.rendererLogger.error(message)
        break
      case 'fatal':
        this.combinedLogger.error(message)
        this.rendererLogger.error(message)
        break
    }
  }

  /**
   * Cleanup old log files (older than RETENTION_DAYS)
   * Includes both active logs (.log) and rotated logs (.N.log)
   * Always prunes oldest-first, including when disk space is low – low disk is
   * when pruning matters most, so it only adds a warning.
   * Fire-and-forget - errors are logged but don't throw
   */
  async cleanupOldLogs(): Promise<void> {
    try {
      const logsDir = this.getLogsDir()

      // Warn on low disk space, but still prune: skipping would let the logs
      // keep filling the disk they are short of.
      try {
        const stats = await statfs(logsDir)
        const availableMB = (stats.bavail * stats.bsize) / (1024 * 1024)
        if (availableMB < LOW_DISK_THRESHOLD_MB) {
          this.warn('Low disk space, pruning old logs', {
            availableMB: Math.round(availableMB)
          })
        }
      } catch {
        // Ignore disk space check errors, proceed with cleanup
      }

      const files = await readdir(logsDir)
      const now = Date.now()
      const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000

      // Match both .log files and numbered rotated files (.1.log, .2.log, etc.)
      const logFiles = files.filter((file) => file.endsWith('.log') || /\.\d+\.log$/.test(file))

      const entries: Array<{ file: string; mtimeMs: number }> = []
      for (const file of logFiles) {
        try {
          const stats = await stat(join(logsDir, file))
          entries.push({ file, mtimeMs: stats.mtimeMs })
        } catch (error) {
          // Log but continue with other files
          this.warn('Failed to cleanup log file', { file, error: String(error) })
        }
      }
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs)

      for (const { file, mtimeMs } of entries) {
        const age = now - mtimeMs
        const rotatedIndex = /\.(\d+)\.log$/.exec(file)
        // Rotated files beyond the cap are left over from the old 100-file limit
        const beyondCap = rotatedIndex !== null && Number(rotatedIndex[1]) > MAX_ROTATED_FILES

        if (age > maxAge || beyondCap) {
          try {
            await unlink(join(logsDir, file))
            this.debug('Deleted old log file', {
              file,
              ageInDays: Math.floor(age / (24 * 60 * 60 * 1000))
            })
          } catch (error) {
            this.warn('Failed to cleanup log file', { file, error: String(error) })
          }
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
   * Uses temp directory during tests to avoid polluting production logs
   */
  public getLogsDir(): string {
    if (process.env.VITEST) {
      return join(tmpdir(), 'erfana-test-logs')
    }
    return join(homedir(), LOGS_DIR)
  }

  /**
   * Validate logs directory is not a symlink (security risk)
   * Throws if directory is a symlink
   */
  private validateLogsDir(logsDir: string): void {
    try {
      const stats = lstatSync(logsDir)
      if (stats.isSymbolicLink()) {
        throw new Error('Logs directory is a symlink (security risk)')
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
      // Directory doesn't exist yet - will be created by electron-log
    }
  }

  /**
   * Format message with optional context. Control characters are escaped.
   */
  private formatMessage(message: string, context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) {
      return escapeControlChars(message)
    }
    return escapeControlChars(`${message} ${JSON.stringify(context)}`)
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

    // Main-process callers often interpolate user-derived text (paths, names)
    // into the message, so the same escaping as for renderer entries applies.
    return escapeControlChars(parts.join(' | '))
  }

  /**
   * Format renderer log entry for combined.log
   *
   * The renderer is untrusted input: CR/LF are escaped so an entry can never
   * start a second, forged log line, and each free-text field is bounded.
   */
  private formatRendererMessage(entry: LogEntry): string {
    const parts: string[] = [`[RENDERER] ${sanitizeLogText(entry.message)}`]

    if (entry.error) {
      parts.push(`Error: ${sanitizeLogText(entry.error.message)}`)
      if (entry.error.stack) {
        parts.push(`Stack: ${sanitizeLogText(entry.error.stack)}`)
      }
    }

    if (entry.context && Object.keys(entry.context).length > 0) {
      // JSON.stringify already escapes CR/LF inside string values
      parts.push(sanitizeLogText(JSON.stringify(entry.context)))
    }

    return parts.join(' | ')
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
