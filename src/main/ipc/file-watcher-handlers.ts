import { ipcMain, WebContents } from 'electron'
import { fileWatcherService } from '../services/FileWatcherService'

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
      console.error('Error starting file watch:', error)
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
      console.error('Error stopping file watch:', error)
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
      console.error('Error stopping all file watches:', error)
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
      console.error('Error pausing file watch:', error)
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
      console.error('Error resuming file watch:', error)
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
      console.error('Error getting watch stats:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  console.log('✅ File watcher IPC handlers registered')
}
