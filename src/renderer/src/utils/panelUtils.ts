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
 * Opens a panel and sends content to it with proper initialization wait
 *
 * This function ensures reliable content delivery by:
 * 1. Opening the target panel
 * 2. Waiting 100ms for panel initialization
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
 *
 * @example
 * // Copilot removed; prompts target terminal
 */
export async function openPanelAndSendContent({
  panel,
  location,
  content,
  sendImmediately = false,
  autoExecute = false
}: SendToPanelOptions): Promise<boolean> {
  // Get store actions
  const { setActivePanel } = useActivityBarStore.getState()

  // Open panel
  setActivePanel(panel, location)

  // Wait for panel initialization (ensures component is mounted)
  // This prevents race conditions where content is sent before the panel is ready
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Send content based on panel type
  if (panel === 'terminal') {
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
  const targetPanel: 'terminal' = 'terminal'

  // Execute prompt by sending to target panel
  return await openPanelAndSendContent({
    panel: targetPanel,
    location: 'right',
    content: renderedPrompt,
    sendImmediately: config.sendDirectly || false,
    autoExecute: config.autoExecute || false
  })
}
