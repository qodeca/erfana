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
import { loggingService } from '../services/LoggingService'
import { LogEntrySchema } from '../../shared/ipc/logging-schema'
import { registerHandle, registerOn } from './registry'

/**
 * Register all logging IPC handlers
 */
export function registerLoggingHandlers(): void {
  /**
   * Receive log entry from renderer process
   * One-way channel (ipcMain.on) for performance - renderer doesn't need response
   */
  registerOn('logging:log', (_event, entry: unknown) => {
    // Validate log entry
    const result = LogEntrySchema.safeParse(entry)
    if (!result.success) {
      console.error('Invalid log entry from renderer:', result.error.issues)
      return
    }

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
