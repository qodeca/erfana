// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Panel utilities for opening panels and sending content
 * Provides consistent "open panel → wait → send content" workflow
 * Used by context menus and other components that need to programmatically
 * open panels and send content to them.
 *
 * Uses dependency injection for testability - accepts managers as optional
 * parameters, defaulting to Zustand store implementations.
 *
 * Error handling:
 * - Returns PromptResult with success/error information
 * - Shows toast notifications for user-facing errors
 * - Uses AppError with typed ErrorCode for structured error handling
 */

import { PROMPT_REGISTRY } from '../prompts/registry'
import { promptRenderer } from '../prompts/renderer'
import { withApplyFooter } from '../prompts/applyFooter'
import { validateVariables } from '../prompts/validation'
import { createDefaultManagers } from './panelManager.factory'
import { showErrorToast } from './toastHelpers'
import { AppError, ErrorCode, ERROR_MESSAGES } from '../../../shared/errors'
import type { PromptVariables } from '../prompts/types'
import type { ITerminalManager, PanelManagers } from './panelManager.types'
import { logger } from './logger'

/**
 * Result of a prompt execution
 */
export interface PromptResult {
  success: boolean
  error?: AppError
  /**
   * Timestamp when sendToTerminal() completed (includes autoExecute delay).
   * Used to schedule forced scroll-to-bottom after prompt execution.
   */
  completionTs?: number
}

interface SendToPanelOptions {
  panel: 'terminal'
  location: 'left' | 'right'
  content: string
  sendImmediately?: boolean
  autoExecute?: boolean
  /** Optional managers for dependency injection (testing) */
  managers?: PanelManagers
  /** Timeout for terminal readiness in ms (default: 5000) */
  terminalTimeout?: number
  /** Show toast notification on error (default: true) */
  showToast?: boolean
}

/** Default managers lazily initialized */
let defaultManagers: PanelManagers | null = null

/**
 * Get or create default managers
 * Lazily initialized to avoid importing stores at module load time
 */
function getDefaultManagers(): PanelManagers {
  if (!defaultManagers) {
    defaultManagers = createDefaultManagers()
  }
  return defaultManagers
}

/**
 * Wait for terminal to be ready (activeTerminalId set in store)
 * Uses event-based waiting if available (preferred), falls back to polling.
 *
 * @param terminalManager - Terminal manager to check readiness
 * @param timeoutMs - Maximum time to wait (default 5000ms)
 * @param intervalMs - Polling interval for fallback (default 50ms)
 * @returns true if terminal is ready, false if timed out
 */
export async function waitForTerminalReady(
  terminalManager: ITerminalManager,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<boolean> {
  // Prefer event-based waiting (more efficient, immediate response)
  if (terminalManager.waitForReady) {
    return terminalManager.waitForReady(timeoutMs)
  }

  // Fallback to polling for backwards compatibility
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    if (terminalManager.isReady()) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  logger.warn(`Terminal readiness timeout after ${timeoutMs} ms`)
  return false
}

/**
 * Opens a panel and sends content to it with proper initialization wait
 *
 * This function ensures reliable content delivery by:
 * 1. Opening the target panel
 * 2. Polling until terminal is ready (activeTerminalId set)
 * 3. Sending content using panel-specific methods
 *
 * @param options - Panel configuration
 * @returns Promise<PromptResult> - Result with success status and optional error
 *
 * @example
 * // Send text to terminal
 * const result = await openPanelAndSendContent({
 *   panel: 'terminal',
 *   location: 'right',
 *   content: 'npm install'
 * })
 * if (!result.success) {
 *   console.error(result.error?.message)
 * }
 */
export async function openPanelAndSendContent({
  panel,
  location,
  content,
  autoExecute = false,
  managers,
  terminalTimeout = 5000,
  showToast = true
}: SendToPanelOptions): Promise<PromptResult> {
  // Use provided managers or get defaults
  const { panelManager, terminalManager } = managers ?? getDefaultManagers()

  // Open panel
  panelManager.setActivePanel(panel, location)

  // Send content based on panel type
  if (panel === 'terminal') {
    // Wait for terminal to be ready (polls until activeTerminalId is set)
    const isReady = await waitForTerminalReady(terminalManager, terminalTimeout)
    if (!isReady) {
      const error = new AppError(
        'Terminal failed to initialize within timeout',
        ErrorCode.PROMPT_TERMINAL_TIMEOUT
      )
      logger.error(error.message)
      if (showToast) {
        showErrorToast('Terminal Error', ERROR_MESSAGES[ErrorCode.PROMPT_TERMINAL_TIMEOUT])
      }
      return { success: false, error }
    }

    // Debug logging for issue #41
    logger.info(`openPanelAndSendContent: calling sendToTerminal with autoExecute=${autoExecute}`)
    const sent = await terminalManager.sendToTerminal(content, autoExecute)
    if (!sent) {
      const error = new AppError(
        'Failed to send content to terminal',
        ErrorCode.PROMPT_SEND_FAILED
      )
      logger.error(error.message)
      if (showToast) {
        showErrorToast('Terminal Error', ERROR_MESSAGES[ErrorCode.PROMPT_SEND_FAILED])
      }
      return { success: false, error }
    }

    // Capture completion timestamp for scroll scheduling (issue #52)
    const completionTs = Date.now()

    return { success: true, completionTs }
  }

  return { success: false }
}

interface ExecutePromptOptions {
  /** Optional managers for dependency injection (testing) */
  managers?: PanelManagers
  /** Timeout for terminal readiness in ms (default: 5000) */
  terminalTimeout?: number
  /** Show toast notification on error (default: true) */
  showToast?: boolean
}

/**
 * Execute a prompt template with variables
 * Centralized function for executing prompts from any trigger (context menu, button, keyboard shortcut)
 *
 * @param promptId - The prompt template ID from PROMPT_REGISTRY
 * @param variables - Variables to pass to the template renderer
 * @param options - Optional configuration including managers for DI
 * @returns Promise<PromptResult> - Result with success status and optional error
 *
 * @example
 * // Execute a prompt from a button click
 * const result = await executePromptTemplate('mermaid-bug-report', {
 *   mermaidError: 'Parse error',
 *   mermaidCode: 'graph TD...',
 *   filePath: '/path/to/file.md'
 * })
 * if (!result.success) {
 *   console.error(result.error?.message)
 * }
 */
export async function executePromptTemplate(
  promptId: string,
  variables: PromptVariables,
  options?: ExecutePromptOptions
): Promise<PromptResult> {
  const showToast = options?.showToast ?? true

  // Get prompt configuration from registry
  const config = PROMPT_REGISTRY[promptId]
  if (!config) {
    const error = new AppError(
      `Prompt template not found: ${promptId}`,
      ErrorCode.PROMPT_NOT_FOUND
    )
    logger.error(error.message)
    if (showToast) {
      showErrorToast('Prompt Error', ERROR_MESSAGES[ErrorCode.PROMPT_NOT_FOUND])
    }
    return { success: false, error }
  }

  // Validate required variables are present
  const validationResult = validateVariables(promptId, variables)
  if (!validationResult.valid) {
    const error = new AppError(
      validationResult.errorMessage || 'Validation failed',
      ErrorCode.PROMPT_VALIDATION_FAILED
    )
    logger.error(error.message)
    if (showToast) {
      showErrorToast('Prompt Error', validationResult.errorMessage || ERROR_MESSAGES[ErrorCode.PROMPT_VALIDATION_FAILED])
    }
    return { success: false, error }
  }

  // Render template with variables.
  // For mutation prompts, compose the apply-to-document footer onto the
  // template BEFORE rendering so the footer can interpolate {{fileRef}}.
  const renderedPrompt = promptRenderer.render(
    withApplyFooter(config.template, !!config.mutatesDocument),
    variables
  )

  // Determine target panel (Copilot removed; default to terminal)
  const targetPanel = 'terminal' as const

  // Debug logging for issue #41
  logger.info(`executePromptTemplate: promptId=${promptId}, config.autoExecute=${config.autoExecute}, typeof=${typeof config.autoExecute}`)

  // Execute prompt by sending to target panel
  return await openPanelAndSendContent({
    panel: targetPanel,
    location: 'right',
    content: renderedPrompt,
    sendImmediately: config.sendDirectly || false,
    autoExecute: config.autoExecute || false,
    managers: options?.managers,
    terminalTimeout: options?.terminalTimeout,
    showToast
  })
}

/**
 * Reset default managers (for testing)
 * Call this between tests to ensure clean state
 */
export function resetDefaultManagers(): void {
  defaultManagers = null
}
