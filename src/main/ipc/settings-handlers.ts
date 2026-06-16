// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Settings IPC Handlers
 *
 * Handles settings-related IPC communication between renderer and main process.
 * Manages approved tools list and other persistent settings.
 */

import { ipcMain } from 'electron'
import { settingsService } from '../services/SettingsService'
import { logger } from '../services/LoggingService'

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
      logger.error('❌ Error getting project filter mode', error instanceof Error ? error : undefined)
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
      logger.error('❌ Error setting project filter mode', error instanceof Error ? error : undefined)
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
      logger.error('❌ Error getting directory watch depth', error instanceof Error ? error : undefined)
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
      logger.error('❌ Error setting directory watch depth', error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Get recent projects
  ipcMain.handle('settings:getRecentProjects', async () => {
    try {
      const projects = await settingsService.getRecentProjects()
      return { success: true, projects }
    } catch (error) {
      logger.error('❌ Error getting recent projects', error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Add recent project
  ipcMain.handle('settings:addRecentProject', async (_event, path: string, name: string) => {
    try {
      await settingsService.addRecentProject(path, name)
      return { success: true }
    } catch (error) {
      logger.error('❌ Error adding recent project', error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Remove recent project
  ipcMain.handle('settings:removeRecentProject', async (_event, path: string) => {
    try {
      await settingsService.removeRecentProject(path)
      return { success: true }
    } catch (error) {
      logger.error('❌ Error removing recent project', error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  logger.info('✅ Settings IPC handlers registered')
}
