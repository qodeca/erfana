// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal Panel Handler
 *
 * Implements IPanelHandler for the terminal panel.
 * Uses dependency injection for testability.
 */

import type { IPanelHandler, PanelHandlerContext } from './panelHandler.types'
import type { PromptResult } from './panelUtils'
import type { IPanelManager, ITerminalManager, PanelManagers } from './panelManager.types'
import { createDefaultManagers } from './panelManager.factory'
import { showErrorToast } from './toastHelpers'
import { AppError, ErrorCode, ERROR_MESSAGES } from '../../../shared/errors'
import { logger } from './logger'

/**
 * Terminal panel handler implementation
 */
export class TerminalPanelHandler implements IPanelHandler {
  readonly panelType = 'terminal'
  readonly displayName = 'Terminal'

  private readonly panelManager: IPanelManager
  private readonly terminalManager: ITerminalManager

  constructor(managers?: PanelManagers) {
    const resolvedManagers = managers ?? createDefaultManagers()
    this.panelManager = resolvedManagers.panelManager
    this.terminalManager = resolvedManagers.terminalManager
  }

  /**
   * Open the terminal panel at the specified location
   */
  open(location: 'left' | 'right'): void {
    this.panelManager.setActivePanel('terminal', location)
  }

  /**
   * Wait for the terminal to be ready to receive content
   * Uses event-based waiting if available (preferred), falls back to polling.
   *
   * @param timeoutMs - Maximum time to wait (default 5000ms)
   * @returns true if ready, false if timed out
   */
  async waitForReady(timeoutMs = 5000): Promise<boolean> {
    // Prefer event-based waiting (more efficient, immediate response)
    if (this.terminalManager.waitForReady) {
      return this.terminalManager.waitForReady(timeoutMs)
    }

    // Fallback to polling for backwards compatibility
    const intervalMs = 50
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      if (this.terminalManager.isReady()) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }

    logger.warn('Terminal readiness timeout after ' + timeoutMs + ' ms')
    return false
  }

  /**
   * Send content to the terminal
   * Opens the panel, waits for ready, then sends.
   *
   * @param context - Context with content and options
   * @returns PromptResult with success status
   */
  async send(context: PanelHandlerContext): Promise<PromptResult> {
    const { content, location, autoExecute = false, timeout = 5000, showToast = true } = context

    // Open the terminal panel
    this.open(location)

    // Wait for terminal to be ready
    const isReady = await this.waitForReady(timeout)
    if (!isReady) {
      const error = new AppError(
        'Terminal failed to initialize within timeout',
        ErrorCode.PROMPT_TERMINAL_TIMEOUT
      )
      logger.error(error.message, error)
      if (showToast) {
        showErrorToast('Terminal Error', ERROR_MESSAGES[ErrorCode.PROMPT_TERMINAL_TIMEOUT])
      }
      return { success: false, error }
    }

    // Send content to terminal
    const sent = await this.terminalManager.sendToTerminal(content, autoExecute)
    if (!sent) {
      const error = new AppError(
        'Failed to send content to terminal',
        ErrorCode.PROMPT_SEND_FAILED
      )
      logger.error(error.message, error)
      if (showToast) {
        showErrorToast('Terminal Error', ERROR_MESSAGES[ErrorCode.PROMPT_SEND_FAILED])
      }
      return { success: false, error }
    }

    return { success: true }
  }

  /**
   * Check if the terminal panel is available
   * Currently always returns true as terminal is always available.
   */
  isAvailable(): boolean {
    return true
  }
}

/**
 * Factory function to create a terminal panel handler
 */
export function createTerminalPanelHandler(managers?: PanelManagers): IPanelHandler {
  return new TerminalPanelHandler(managers)
}
