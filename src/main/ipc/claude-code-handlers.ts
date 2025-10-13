/**
 * Claude CLI IPC Handlers - Persistent Session Architecture
 *
 * Handles IPC communication for persistent Claude CLI sessions.
 * Session lifecycle: start when project opens, stop when project closes.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { claudeCliService } from '../services/ClaudeCliService'

export function registerClaudeCodeHandlers() {
  console.log('📝 Registering Claude Code IPC handlers...')

  /**
   * Start persistent Claude CLI session
   */
  ipcMain.handle('claudeCode:startSession', async (_event, projectPath: string, planningMode?: boolean) => {
    try {
      console.log(`🚀 Starting Claude session for project: ${projectPath}${planningMode ? ' (planning mode)' : ''}`)
      await claudeCliService.startSession(projectPath, planningMode || false)
      return { success: true }
    } catch (error: any) {
      console.error('❌ Failed to start session:', error)
      return { success: false, error: error.message }
    }
  })

  /**
   * Stop persistent Claude CLI session
   */
  ipcMain.handle('claudeCode:stopSession', async () => {
    try {
      console.log('🛑 Stopping Claude session')
      claudeCliService.stopSession()
      return { success: true }
    } catch (error: any) {
      console.error('❌ Failed to stop session:', error)
      return { success: false, error: error.message }
    }
  })

  /**
   * Send message to running Claude CLI session
   */
  ipcMain.on('claudeCode:sendMessage', (_event, { prompt, context, sessionId }) => {
    console.log(`📤 Sending message to Claude: ${prompt.substring(0, 100)}...`)

    try {
      // Send message to persistent session (writes to stdin)
      claudeCliService.sendMessage(prompt, context)

      // Messages will arrive via the 'message' event from ClaudeCliService
      // No need to loop here - the persistent session handles streaming
    } catch (error: any) {
      console.error(`❌ Failed to send message:`, error)

      // Send error to renderer
      const windows = BrowserWindow.getAllWindows()
      if (windows.length > 0) {
        windows[0].webContents.send('claudeCode:error', {
          sessionId,
          error: error.message
        })
      }
    }
  })

  /**
   * Stop generation (not supported in persistent mode)
   * In persistent mode, there's no way to cancel mid-generation
   */
  ipcMain.on('claudeCode:stop', () => {
    console.log('⚠️ Stop generation not supported in persistent session mode')
    // Could potentially implement by restarting the session
  })

  /**
   * Check if Claude CLI is installed
   */
  ipcMain.handle('claudeCode:isInstalled', async () => {
    try {
      const isInstalled = await claudeCliService.isClaudeInstalled()
      console.log(`🔍 Claude CLI installed: ${isInstalled}`)
      return isInstalled
    } catch (error: any) {
      console.error('❌ Error checking Claude CLI installation:', error)
      return false
    }
  })

  /**
   * Check authentication status
   */
  ipcMain.handle('claudeCode:checkAuth', async () => {
    try {
      const authStatus = await claudeCliService.checkAuthStatus()
      console.log(`🔑 Claude CLI auth status:`, authStatus)
      return authStatus
    } catch (error: any) {
      console.error('❌ Error checking authentication:', error)
      return { isAuthenticated: false, error: error.message }
    }
  })

  /**
   * Set OAuth token
   */
  ipcMain.handle('claudeCode:setToken', async (_event, token: string) => {
    try {
      claudeCliService.setOAuthToken(token)
      console.log('🔑 OAuth token set successfully')
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error setting OAuth token:', error)
      return { success: false, error: error.message }
    }
  })

  /**
   * Get current session state
   */
  ipcMain.handle('claudeCode:getSessionState', async () => {
    try {
      const state = claudeCliService.getSessionState()
      return { success: true, state }
    } catch (error: any) {
      console.error('❌ Error getting session state:', error)
      return { success: false, error: error.message }
    }
  })

  /**
   * Approve tool use and restart session with updated permissions
   */
  ipcMain.handle('claudeCode:approveTool', async (_event, toolName: string, remember: boolean) => {
    try {
      console.log(`✅ Approving tool: ${toolName} (remember: ${remember})`)
      await claudeCliService.approveTool(toolName, remember)
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error approving tool:', error)
      return { success: false, error: error.message }
    }
  })

  /**
   * Deny tool use and restart session
   */
  ipcMain.handle('claudeCode:denyTool', async (_event, toolName: string) => {
    try {
      console.log(`❌ Denying tool: ${toolName}`)
      await claudeCliService.denyTool(toolName)
      return { success: true }
    } catch (error: any) {
      console.error('❌ Error denying tool:', error)
      return { success: false, error: error.message }
    }
  })

  // Forward ClaudeCliService events to renderer
  // Get window dynamically to avoid timing issues

  // Forward messages from persistent session to renderer
  claudeCliService.on('message', (message) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('claudeCode:message', {
        sessionId: 'persistent-session',
        message
      })
    }
  })

  // Forward streaming message updates (--include-partial-messages)
  claudeCliService.on('message-update', (message) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('claudeCode:messageUpdate', { message })
    }
  })

  claudeCliService.on('message-complete', (message) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      windows[0].webContents.send('claudeCode:messageComplete', { message })
    }
  })

  // Forward session events
  claudeCliService.on('session-started', (data) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      console.log('✅ Session started, notifying renderer')
      windows[0].webContents.send('claudeCode:sessionStarted', data)
    }
  })

  claudeCliService.on('session-stopped', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      console.log('🛑 Session stopped, notifying renderer')
      windows[0].webContents.send('claudeCode:sessionStopped')
    }
  })

  claudeCliService.on('session-restarting', (data) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      console.log('🔄 Session restarting, notifying renderer')
      windows[0].webContents.send('claudeCode:sessionRestarting', data)
    }
  })

  claudeCliService.on('error', (error) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      console.error('❌ Session error, notifying renderer:', error)
      windows[0].webContents.send('claudeCode:sessionError', error)
    }
  })

  claudeCliService.on('tool-approval-needed', (request) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      console.log(`⚠️ Tool approval needed: ${request.toolName}`)
      windows[0].webContents.send('claudeCode:toolApprovalNeeded', request)
    }
  })

  claudeCliService.on('session-resumed', (data) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0].isDestroyed()) {
      console.log('✅ Session resumed with new tools, notifying renderer')
      windows[0].webContents.send('claudeCode:sessionResumed', data)
    }
  })

  console.log('✅ Claude Code IPC handlers registered')
}
