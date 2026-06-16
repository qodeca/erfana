// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal IPC Handlers
 *
 * Handles IPC communication for terminal operations using TerminalService.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { terminalService } from '../services/TerminalService'
import { logger } from '../services/LoggingService'

type TerminalCreateConfig = {
  shell?: string
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

// Track registered event listeners for cleanup on reload (issue #59)
// This prevents listener accumulation during HMR/dev refresh
type TerminalEventListener = (...args: unknown[]) => void
const registeredListeners = new Map<string, TerminalEventListener>()

export function registerTerminalHandlers() {
  logger.info('📝 Registering Terminal IPC handlers...')

  // Remove any existing listeners first (handles HMR reload case - issue #59)
  // Safety check: only cleanup if no terminals are actively initializing to prevent
  // race condition where clearTerminal event is lost, leaving terminal stuck (issue #59)
  const activeTerminals = terminalService.listTerminals()
  if (activeTerminals.length > 0) {
    logger.warn('⚠️  Terminals still active during handler registration, preserving listeners')
    // Note: This means HMR may accumulate listeners, but that's safer than losing events
    // Proper cleanup happens in webContents 'destroyed' handler
  } else {
    for (const [eventName, listener] of registeredListeners.entries()) {
      terminalService.off(eventName, listener)
    }
    registeredListeners.clear()
  }

  /**
   * Check if terminal support is available (node-pty loaded)
   * Optionally check initialization state for a specific terminal
   */
  ipcMain.handle('terminal:isAvailable', (_event, terminalId?: string) => {
    const result = terminalService.isAvailable(terminalId)
    logger.info(`🔍 Terminal available: ${result.available}, initialized: ${result.initialized ?? 'N/A'}`)
    return { success: true, ...result }
  })

  /**
   * Create a new terminal instance
   * Passes webContentsId to TerminalService for cleanup on window close (issue #59).
   *
   * The response carries `shellKind` so the renderer can quote pasted paths
   * correctly without a follow-up IPC round-trip (#164 round-2 F#1).
   */
  ipcMain.handle('terminal:create', async (event, config?: TerminalCreateConfig) => {
    logger.info('🚀 Creating terminal', config)

    try {
      const webContentsId = event.sender.id
      const result = await terminalService.createTerminal(config, webContentsId)

      if (!result) {
        return { success: false, error: 'Failed to create terminal' }
      }

      return { success: true, terminalId: result.terminalId, shellKind: result.shellKind }
    } catch (error) {
      logger.error('❌ Failed to create terminal', error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  /**
   * Write data to terminal
   */
  ipcMain.handle('terminal:write', (_event, { terminalId, data }) => {
    try {
      const success = terminalService.write(terminalId, data)
      return { success }
    } catch (error) {
      logger.error('❌ Failed to write to terminal', error instanceof Error ? error : undefined)
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
      logger.error('❌ Failed to kill terminal', error instanceof Error ? error : undefined)
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
      logger.error('❌ Failed to get terminal info', error instanceof Error ? error : undefined)
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
      logger.error('❌ Failed to list terminals', error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Note: `terminal:getShellKind` was removed in #164 round-2 (F#1). The kind
  // now ships with the `terminal:create` response so a screenshot capture or
  // drag-drop paste doesn't need a follow-up IPC round-trip.

  // Forward TerminalService events to renderer (with tracking for cleanup - issue #59)
  const dataListener = ({ terminalId, data }: { terminalId: string; data: string }): void => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:data', { terminalId, data })
    }
  }
  terminalService.on('data', dataListener)
  registeredListeners.set('data', dataListener as TerminalEventListener)

  const exitListener = ({
    terminalId,
    exitCode,
    signal
  }: {
    terminalId: string
    exitCode: number
    signal?: number
  }): void => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:exit', { terminalId, exitCode, signal })
    }
  }
  terminalService.on('exit', exitListener)
  registeredListeners.set('exit', exitListener as TerminalEventListener)

  const errorListener = ({ terminalId, error }: { terminalId: string; error: string }): void => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:error', { terminalId, error })
    }
  }
  terminalService.on('error', errorListener)
  registeredListeners.set('error', errorListener as TerminalEventListener)

  // Clear terminal control event (separate from data channel)
  const clearListener = ({ terminalId }: { terminalId: string }): void => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('terminal:clear', { terminalId })
    }
  }
  terminalService.on('clearTerminal', clearListener)
  registeredListeners.set('clearTerminal', clearListener as TerminalEventListener)

  // Receive confirmation that clear was processed
  ipcMain.on('terminal:clearComplete', (_event, { terminalId }) => {
    terminalService.markInitializationComplete(terminalId)
  })

  logger.info('✅ Terminal IPC handlers registered')
}
