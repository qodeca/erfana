// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain, WebContents } from 'electron'
import { directoryWatcherService } from '../services/DirectoryWatcherService'
import { logger } from '../services/LoggingService'

/**
 * Register all directory watcher IPC handlers
 */
export function registerDirectoryWatcherHandlers(): void {
  // Start watching a directory
  ipcMain.handle('directory-watch:start', async (event, dirPath: string) => {
    try {
      // Validate input
      if (!dirPath || typeof dirPath !== 'string') {
        return { success: false, error: 'Invalid directory path' }
      }

      const webContents = event.sender as WebContents
      await directoryWatcherService.watchDirectory(dirPath, webContents)

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error starting directory watch', error instanceof Error ? error : undefined)
      return { success: false, error: errorMessage }
    }
  })

  // Stop watching a directory
  ipcMain.handle('directory-watch:stop', async (event, dirPath: string) => {
    try {
      if (!dirPath || typeof dirPath !== 'string') {
        return { success: false, error: 'Invalid directory path' }
      }

      const webContents = event.sender as WebContents
      await directoryWatcherService.unwatchDirectory(dirPath, webContents)

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error stopping directory watch', error instanceof Error ? error : undefined)
      return { success: false, error: errorMessage }
    }
  })

  // Stop watching all directories (cleanup)
  ipcMain.handle('directory-watch:stop-all', async (event) => {
    try {
      const webContents = event.sender as WebContents
      await directoryWatcherService.unwatchAll(webContents)

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error stopping all directory watches', error instanceof Error ? error : undefined)
      return { success: false, error: errorMessage }
    }
  })

  // Pause directory watching (during internal operations)
  ipcMain.handle('directory-watch:pause', async (_event, dirPath: string) => {
    try {
      if (!dirPath || typeof dirPath !== 'string') {
        return { success: false, error: 'Invalid directory path' }
      }

      directoryWatcherService.pauseWatch(dirPath)

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error pausing directory watch', error instanceof Error ? error : undefined)
      return { success: false, error: errorMessage }
    }
  })

  // Resume directory watching
  ipcMain.handle('directory-watch:resume', async (_event, dirPath: string) => {
    try {
      if (!dirPath || typeof dirPath !== 'string') {
        return { success: false, error: 'Invalid directory path' }
      }

      const resumed = directoryWatcherService.resumeWatch(dirPath)
      if (!resumed) {
        return { success: false, error: `No watcher found for ${dirPath}` }
      }

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error resuming directory watch', error instanceof Error ? error : undefined)
      return { success: false, error: errorMessage }
    }
  })

  // Get statistics (for debugging)
  ipcMain.handle('directory-watch:get-stats', async () => {
    try {
      const stats = directoryWatcherService.getStats()
      return { success: true, stats }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error getting directory watch stats', error instanceof Error ? error : undefined)
      return { success: false, error: errorMessage }
    }
  })

  // Git index watching migrated to GitWatcherService (Issue #74)
  // git-index-watch:start and git-index-watch:stop handlers removed

  logger.info('✅ Directory watcher IPC handlers registered')
}
