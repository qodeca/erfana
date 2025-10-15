/**
 * Panel utilities for opening panels and sending content
 * Provides consistent "open panel → wait → send content" workflow
 * Used by context menus and other components that need to programmatically
 * open panels and send content to them.
 */

import { useActivityBarStore } from '../stores/useActivityBarStore'
import { useCopilotStore } from '../stores/useCopilotStore'
import { useTerminalStore } from '../stores/useTerminalStore'

interface SendToPanelOptions {
  panel: 'terminal' | 'claude'
  location: 'left' | 'right'
  content: string
  sendImmediately?: boolean
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
 * // Send message to Copilot with immediate send
 * await openPanelAndSendContent({
 *   panel: 'claude',
 *   location: 'right',
 *   content: 'Explain this code',
 *   sendImmediately: true
 * })
 */
export async function openPanelAndSendContent({
  panel,
  location,
  content,
  sendImmediately = false
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
    return await sendToTerminal(content)
  } else if (panel === 'claude') {
    const { setPendingMessage } = useCopilotStore.getState()
    setPendingMessage(content, sendImmediately)
    return true
  }

  return false
}
