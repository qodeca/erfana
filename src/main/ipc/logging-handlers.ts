// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * IPC handlers for logging operations
 *
 * Handles communication between renderer and main process for logging
 *
 * @see LoggingService.ts - main process logging implementation
 * @see logger.ts - renderer process logger
 * @see Issue #49 - logging layer implementation
 */
import { shell } from 'electron'
import { loggingService, logger } from '../services/LoggingService'
import { SenderRateCap } from '../utils/SenderRateCap'
import { RateLimitedLogger } from '../utils/RateLimitedLogger'
import { LogEntrySchema, type LogEntry } from '../../shared/ipc/logging-schema'
import { registerHandle, registerOn } from './registry'

/** Normal-level renderer records accepted per sender per window */
export const MAX_RENDERER_LOGS_PER_WINDOW = 200
/** Characters accepted per sender per window for normal-level records */
export const MAX_RENDERER_LOG_CHARS_PER_WINDOW = 256 * 1024
/** error / fatal records accepted per sender per window (own budget) */
export const MAX_RENDERER_SEVERE_LOGS_PER_WINDOW = 50
/** Characters accepted per sender per window for error / fatal records */
export const MAX_RENDERER_SEVERE_LOG_CHARS_PER_WINDOW = 128 * 1024
/** Length of the per-sender rate window */
export const RENDERER_LOG_WINDOW_MS = 10_000
/** At most one "invalid entry" warning per this interval */
const INVALID_ENTRY_WARN_INTERVAL_MS = 10_000

/** Rough size of an entry, for the per-sender size budget. */
function entrySize(entry: LogEntry): number {
  let size = entry.message.length
  if (entry.error) size += entry.error.message.length + (entry.error.stack?.length ?? 0)
  if (entry.context) size += JSON.stringify(entry.context).length
  return size
}

/**
 * Register all logging IPC handlers
 */
export function registerLoggingHandlers(): void {
  // A renderer stuck in a log loop must not flood the log files and push real
  // history out of the rotation window. Extra records are dropped and counted;
  // error / fatal records have their own budget so noise cannot starve them.
  const rateCap = new SenderRateCap(
    { maxRecords: MAX_RENDERER_LOGS_PER_WINDOW, maxBytes: MAX_RENDERER_LOG_CHARS_PER_WINDOW },
    {
      maxRecords: MAX_RENDERER_SEVERE_LOGS_PER_WINDOW,
      maxBytes: MAX_RENDERER_SEVERE_LOG_CHARS_PER_WINDOW
    },
    RENDERER_LOG_WINDOW_MS,
    (senderId, summary) => {
      logger.warn('[RENDERER] log records dropped (rate cap)', { senderId, ...summary })
    }
  )
  const invalidEntryWarning = new RateLimitedLogger(
    'logging-invalid-entry',
    INVALID_ENTRY_WARN_INTERVAL_MS
  )

  /**
   * Receive log entry from renderer process
   * One-way channel (ipcMain.on) for performance - renderer doesn't need response
   */
  registerOn('logging:log', (event, entry: unknown) => {
    // Oversized fields are shortened by the schema; only a malformed shape is rejected
    const result = LogEntrySchema.safeParse(entry)
    if (!result.success) {
      invalidEntryWarning.log('warn', 'Invalid log entry from renderer', {
        issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      })
      return
    }

    const isSevere = result.data.level === 'error' || result.data.level === 'fatal'
    if (!rateCap.allow(event.sender.id, entrySize(result.data), isSevere)) return

    // Forward to logging service
    loggingService.logFromRenderer(result.data)
  })

  /**
   * Get current log level
   * Used by renderer to sync its initial level
   */
  registerHandle('logging:getLevel', async () => {
    return loggingService.getLevel()
  })

  /**
   * Get logs directory path
   * Used by renderer to display the path in settings
   */
  registerHandle('logging:getLogsDir', async () => {
    return loggingService.getLogsDir()
  })

  /**
   * Open logs folder in the system file manager
   * Returns empty string on success, error string on failure
   */
  registerHandle('logging:openLogsFolder', async () => {
    return shell.openPath(loggingService.getLogsDir())
  })
}
