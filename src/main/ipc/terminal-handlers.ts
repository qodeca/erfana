/**
 * Terminal IPC Handlers
 *
 * Handles IPC communication for terminal operations using TerminalService.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { terminalService } from '../services/TerminalService'

type TerminalCreateConfig = {
  shell?: string
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export function registerTerminalHandlers() {
  console.log('📝 Registering Terminal IPC handlers...')

  /**
   * Check if terminal support is available (node-pty loaded)
   * Optionally check initialization state for a specific terminal
   */
  ipcMain.handle('terminal:isAvailable', (_event, terminalId?: string) => {
    const result = terminalService.isAvailable(terminalId)
    console.log(`🔍 Terminal available: ${result.available}, initialized: ${result.initialized ?? 'N/A'}`)
    return { success: true, ...result }
  })

  /**
   * Create a new terminal instance
   */
  ipcMain.handle('terminal:create', async (_event, config?: TerminalCreateConfig) => {
    console.log('🚀 Creating terminal with config:', config)

    try {
      const terminalId = await terminalService.createTerminal(config)

      if (!terminalId) {
        return { success: false, error: 'Failed to create terminal' }
      }

      return { success: true, terminalId }
    } catch (error) {
      console.error('❌ Failed to create terminal:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  /**
   * Write data to terminal
   */
  ipcMain.handle('terminal:write', async (_event, { terminalId, data }) => {
    try {
      const success = await terminalService.write(terminalId, data)
      return { success }
    } catch (error) {
      console.error('❌ Failed to write to terminal:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  /**
   * Resize terminal
   */
  ipcMain.on('terminal:resize', (_event, { terminalId, cols, rows }) => {
    terminalService.resize(terminalId, cols, rows)
  })

  /**
   * Kill terminal
   */
  ipcMain.handle('terminal:kill', async (_event, terminalId: string) => {
    try {
      const success = terminalService.killTerminal(terminalId)
      return { success }
    } catch (error) {
      console.error('❌ Failed to kill terminal:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  /**
   * Get terminal info
   */
  ipcMain.handle('terminal:getInfo', async (_event, terminalId: string) => {
    try {
      const info = terminalService.getTerminalInfo(terminalId)

      if (!info) {
        return { success: false, error: 'Terminal not found' }
      }

      return { success: true, info }
    } catch (error) {
      console.error('❌ Failed to get terminal info:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  /**
   * List all terminals
   */
  ipcMain.handle('terminal:list', async () => {
    try {
      const terminals = terminalService.listTerminals()
      return { success: true, terminals }
    } catch (error) {
      console.error('❌ Failed to list terminals:', error)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Forward TerminalService events to renderer
  terminalService.on('data', ({ terminalId, data }) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:data', { terminalId, data })
    }
  })

  terminalService.on('exit', ({ terminalId, exitCode, signal }) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:exit', { terminalId, exitCode, signal })
    }
  })

  terminalService.on('error', ({ terminalId, error }) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:error', { terminalId, error })
    }
  })

  // Clear terminal control event (separate from data channel)
  terminalService.on('clearTerminal', ({ terminalId }) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:clear', { terminalId })
    }
  })

  // Receive confirmation that clear was processed
  ipcMain.on('terminal:clearComplete', (_event, { terminalId }) => {
    terminalService.markInitializationComplete(terminalId)
  })

  console.log('✅ Terminal IPC handlers registered')
}
