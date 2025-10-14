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
  // Get approved tools list
  ipcMain.handle('settings:getApprovedTools', async () => {
    try {
      const tools = await settingsService.getApprovedTools()
      return { success: true, tools }
    } catch (error: any) {
      console.error('❌ Error getting approved tools:', error)
      return { success: false, error: error.message }
    }
  })

  // Set approved tools list (replace entire list)
  ipcMain.handle('settings:setApprovedTools', async (_event, tools: string[]) => {
    try {
      await settingsService.setApprovedTools(tools)
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error setting approved tools:', error)
      return { success: false, error: error.message }
    }
  })

  // Add a single approved tool
  ipcMain.handle('settings:addApprovedTool', async (_event, toolName: string) => {
    try {
      await settingsService.addApprovedTool(toolName)
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error adding approved tool:', error)
      return { success: false, error: error.message }
    }
  })

  // Remove a single approved tool
  ipcMain.handle('settings:removeApprovedTool', async (_event, toolName: string) => {
    try {
      await settingsService.removeApprovedTool(toolName)
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error removing approved tool:', error)
      return { success: false, error: error.message }
    }
  })

  // Reset to safe defaults (Read, Glob, Grep)
  ipcMain.handle('settings:resetApprovedTools', async () => {
    try {
      await settingsService.resetApprovedTools()
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error resetting approved tools:', error)
      return { success: false, error: error.message }
    }
  })

  // Get project filter mode
  ipcMain.handle('settings:getProjectFilterMode', async () => {
    try {
      const mode = await settingsService.getProjectFilterMode()
      return { success: true, mode }
    } catch (error: any) {
      console.error('❌ Error getting project filter mode:', error)
      return { success: false, error: error.message }
    }
  })

  // Set project filter mode
  ipcMain.handle('settings:setProjectFilterMode', async (_event, mode: string) => {
    try {
      await settingsService.setProjectFilterMode(mode)
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error setting project filter mode:', error)
      return { success: false, error: error.message }
    }
  })

  console.log('✅ Settings IPC handlers registered')
}
