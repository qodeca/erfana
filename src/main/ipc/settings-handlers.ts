/**
 * Settings IPC Handlers
 *
 * Handles settings-related IPC communication between renderer and main process.
 * Manages approved tools list and other persistent settings.
 */

import { ipcMain } from 'electron'
import { settingsService } from '../services/SettingsService'

/**
 * Register all settings-related IPC handlers
 */
export function registerSettingsHandlers(): void {
  // Approved tools removed with Copilot

  // Get project filter mode
  ipcMain.handle('settings:getProjectFilterMode', async () => {
    try {
      const mode = await settingsService.getProjectFilterMode()
      return { success: true, mode }
    } catch (error) {
      console.error('❌ Error getting project filter mode:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Set project filter mode
  ipcMain.handle('settings:setProjectFilterMode', async (_event, mode: string) => {
    try {
      await settingsService.setProjectFilterMode(mode)
      return { success: true }
    } catch (error) {
      console.error('❌ Error setting project filter mode:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Get directory watcher depth
  ipcMain.handle('settings:getDirectoryWatchDepth', async () => {
    try {
      const depth = await settingsService.getDirectoryWatchDepth()
      return { success: true, depth }
    } catch (error) {
      console.error('❌ Error getting directory watch depth:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Set directory watcher depth
  ipcMain.handle('settings:setDirectoryWatchDepth', async (_event, depth: number | null) => {
    try {
      await settingsService.setDirectoryWatchDepth(depth)
      return { success: true }
    } catch (error) {
      console.error('❌ Error setting directory watch depth:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  console.log('✅ Settings IPC handlers registered')
}
