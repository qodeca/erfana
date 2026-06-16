// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interfaces for panel management
 * Enables dependency injection and testability for panelUtils
 */

/**
 * Interface for panel management operations
 * Abstracts the activity bar store's panel control
 */
export interface IPanelManager {
  /**
   * Set the active panel in a specific location
   * @param panel - Panel type to activate
   * @param location - Where to place the panel
   */
  setActivePanel(panel: 'terminal', location: 'left' | 'right'): void
}

/**
 * Interface for terminal operations
 * Abstracts the terminal store's operations
 */
export interface ITerminalManager {
  /**
   * Check if terminal is ready (has active terminal ID)
   * @returns True if terminal is initialized and ready
   */
  isReady(): boolean

  /**
   * Send text content to the terminal
   * @param content - Text to send
   * @param autoExecute - Whether to auto-execute (send Enter)
   * @returns Promise resolving to success status
   */
  sendToTerminal(content: string, autoExecute?: boolean): Promise<boolean>

  /**
   * Wait for terminal to become ready using events (not polling)
   * Uses Zustand subscription for immediate notification when terminal is ready.
   * @param timeoutMs - Maximum time to wait (default 5000ms)
   * @returns Promise resolving to true if ready, false if timed out
   */
  waitForReady?(timeoutMs?: number): Promise<boolean>
}

/**
 * Combined managers for panel operations
 */
export interface PanelManagers {
  panelManager: IPanelManager
  terminalManager: ITerminalManager
}
