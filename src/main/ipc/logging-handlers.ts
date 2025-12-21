/**
 * IPC handlers for logging operations
 *
 * Handles communication between renderer and main process for logging
 *
 * @see LoggingService.ts - main process logging implementation
 * @see logger.ts - renderer process logger
 * @see Issue #49 - logging layer implementation
 */
import { ipcMain } from 'electron'
import { loggingService } from '../services/LoggingService'
import { LogEntrySchema } from '../../shared/ipc/logging-schema'

/**
 * Register all logging IPC handlers
 */
export function registerLoggingHandlers(): void {
  /**
   * Receive log entry from renderer process
   * One-way channel (ipcMain.on) for performance - renderer doesn't need response
   */
  ipcMain.on('logging:log', (_event, entry: unknown) => {
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
  ipcMain.handle('logging:getLevel', async () => {
    return loggingService.getLevel()
  })
}
