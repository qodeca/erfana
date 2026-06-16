// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain, WebContents } from 'electron'
import { fileWatcherService } from '../services/FileWatcherService'
import { logger } from '../services/LoggingService'

export function registerFileWatcherHandlers(): void {
  const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)
  /**
   * Start watching a file
   */
  ipcMain.handle('file-watch:start', async (event, filePath: string) => {
    try {
      // Validate input
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path')
      }

      const webContents = event.sender as WebContents
      await fileWatcherService.watchFile(filePath, webContents)

      return { success: true }
    } catch (error) {
      logger.error('Error starting file watch', error instanceof Error ? error : undefined)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Stop watching a file
   */
  ipcMain.handle('file-watch:stop', async (event, filePath: string) => {
    try {
      // Validate input
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path')
      }

      const webContents = event.sender as WebContents
      await fileWatcherService.unwatchFile(filePath, webContents)

      return { success: true }
    } catch (error) {
      logger.error('Error stopping file watch', error instanceof Error ? error : undefined)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Stop watching all files for this window
   */
  ipcMain.handle('file-watch:stopAll', async (event) => {
    try {
      const webContents = event.sender as WebContents
      await fileWatcherService.unwatchAll(webContents)

      return { success: true }
    } catch (error) {
      logger.error('Error stopping all file watches', error instanceof Error ? error : undefined)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Pause watching a file (during save operations)
   */
  ipcMain.handle('file-watch:pause', async (_event, filePath: string) => {
    try {
      // Validate input
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path')
      }

      fileWatcherService.pauseWatch(filePath)

      return { success: true }
    } catch (error) {
      logger.error('Error pausing file watch', error instanceof Error ? error : undefined)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Resume watching a file (after save completes)
   */
  ipcMain.handle('file-watch:resume', async (_event, filePath: string) => {
    try {
      // Validate input
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path')
      }

      fileWatcherService.resumeWatch(filePath)

      return { success: true }
    } catch (error) {
      logger.error('Error resuming file watch', error instanceof Error ? error : undefined)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Get watch statistics (for debugging)
   */
  ipcMain.handle('file-watch:stats', async () => {
    try {
      const stats = fileWatcherService.getStats()
      return { success: true, stats }
    } catch (error) {
      logger.error('Error getting watch stats', error instanceof Error ? error : undefined)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  logger.info('✅ File watcher IPC handlers registered')
}
