/**
 * Panel utilities for opening panels and sending content
 * Provides consistent "open panel → wait → send content" workflow
 * Used by context menus and other components that need to programmatically
 * open panels and send content to them.
 */

import { useActivityBarStore } from '../stores/useActivityBarStore'
import { useTerminalStore } from '../stores/useTerminalStore'
import { PROMPT_REGISTRY } from '../prompts/registry'
import { promptRenderer } from '../prompts/renderer'
import type { PromptVariables } from '../prompts/types'

interface SendToPanelOptions {
  panel: 'terminal'
  location: 'left' | 'right'
  content: string
  sendImmediately?: boolean
  autoExecute?: boolean
}

/**
 * Wait for terminal to be ready (activeTerminalId set in store)
 * Polls the store until terminal is initialized or timeout is reached.
 *
 * @param timeoutMs - Maximum time to wait (default 5000ms)
 * @param intervalMs - Polling interval (default 50ms)
 * @returns true if terminal is ready, false if timed out
 */
async function waitForTerminalReady(
  timeoutMs = 5000,
  intervalMs = 50
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const { activeTerminalId } = useTerminalStore.getState()
    if (activeTerminalId) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  console.warn('⚠️ Terminal readiness timeout after', timeoutMs, 'ms')
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
 * @returns Promise<boolean> - Success status (true if sent successfully)
 *
 * @example
 * // Send text to terminal
 * await openPanelAndSendContent({
 *   panel: 'terminal',
 *   location: 'right',
 *   content: 'npm install'
 * })
 */
export async function openPanelAndSendContent({
  panel,
  location,
  content,
  autoExecute = false
}: SendToPanelOptions): Promise<boolean> {
  // Get store actions
  const { setActivePanel } = useActivityBarStore.getState()

  // Open panel
  setActivePanel(panel, location)

  // Send content based on panel type
  if (panel === 'terminal') {
    // Wait for terminal to be ready (polls until activeTerminalId is set)
    const isReady = await waitForTerminalReady()
    if (!isReady) {
      console.error('❌ Terminal failed to initialize within timeout')
      return false
    }

    const { sendToTerminal } = useTerminalStore.getState()
    return await sendToTerminal(content, autoExecute)
  }

  return false
}

/**
 * Execute a prompt template with variables
 * Centralized function for executing prompts from any trigger (context menu, button, keyboard shortcut)
 *
 * @param promptId - The prompt template ID from PROMPT_REGISTRY
 * @param variables - Variables to pass to the template renderer
 * @returns Promise<boolean> - Success status
 *
 * @example
 * // Execute a prompt from a button click
 * await executePromptTemplate('mermaid-bug-report', {
 *   mermaidError: 'Parse error',
 *   mermaidCode: 'graph TD...',
 *   filePath: '/path/to/file.md'
 * })
 */
export async function executePromptTemplate(
  promptId: string,
  variables: PromptVariables
): Promise<boolean> {
  // Get prompt configuration from registry
  const config = PROMPT_REGISTRY[promptId]
  if (!config) {
    console.error(`❌ Prompt template not found: ${promptId}`)
    return false
  }

  // Render template with variables
  const renderedPrompt = promptRenderer.render(config.template, variables)

  // Determine target panel (Copilot removed; default to terminal)
  const targetPanel = 'terminal' as const

  // Execute prompt by sending to target panel
  return await openPanelAndSendContent({
    panel: targetPanel,
    location: 'right',
    content: renderedPrompt,
    sendImmediately: config.sendDirectly || false,
    autoExecute: config.autoExecute || false
  })
}
