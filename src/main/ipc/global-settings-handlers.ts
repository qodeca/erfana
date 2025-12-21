/**
 * Global Settings IPC Handlers
 *
 * Handles global settings IPC communication between renderer and main process.
 * Manages ~/.erfana/settings.json configuration.
 *
 * @see Issue #50 - global settings service
 */

import { ipcMain, BrowserWindow } from 'electron'
import { globalSettingsService } from '../services/GlobalSettingsService'
import type { GlobalSettings, GlobalSettingsChanged } from '../../shared/ipc/global-settings-schema'

/**
 * Register all global settings IPC handlers
 */
export function registerGlobalSettingsHandlers(): void {
  // Get all global settings
  ipcMain.handle('globalSettings:get', async () => {
    try {
      const settings = globalSettingsService.getSettings()
      return { success: true, settings }
    } catch (error) {
      console.error('❌ Error getting global settings:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Set a specific global setting
  ipcMain.handle('globalSettings:set', async (_event, payload: { key: keyof GlobalSettings; value: unknown }) => {
    try {
      await globalSettingsService.setSetting(payload.key, payload.value as GlobalSettings[typeof payload.key])
      return { success: true }
    } catch (error) {
      console.error('❌ Error setting global setting:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Reset all global settings to defaults
  ipcMain.handle('globalSettings:reset', async () => {
    try {
      await globalSettingsService.resetSettings()
      return { success: true }
    } catch (error) {
      console.error('❌ Error resetting global settings:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Subscribe to settings changes and broadcast to all windows
  globalSettingsService.onSettingsChanged((event: GlobalSettingsChanged) => {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('globalSettings:changed', event)
      }
    }
  })

  console.log('✅ Global settings IPC handlers registered')
}
