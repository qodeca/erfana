// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Panel Handler Types
 *
 * Strategy pattern interfaces for extensible panel execution.
 * Allows new panel types to be added without modifying core logic.
 */

import type { PromptResult } from './panelUtils'

/**
 * Context passed to panel handlers
 */
export interface PanelHandlerContext {
  /** Content to send to the panel */
  content: string
  /** Panel location */
  location: 'left' | 'right'
  /** Whether to auto-execute (e.g., press Enter after pasting) */
  autoExecute?: boolean
  /** Timeout for panel readiness in ms */
  timeout?: number
  /** Show toast notifications on error */
  showToast?: boolean
}

/**
 * Interface for panel handlers
 * Each panel type (terminal, copilot, etc.) implements this interface
 */
export interface IPanelHandler {
  /** Unique identifier for this panel type */
  readonly panelType: string

  /** Human-readable name for error messages */
  readonly displayName: string

  /**
   * Open the panel at the specified location
   */
  open(location: 'left' | 'right'): void

  /**
   * Wait for the panel to be ready to receive content
   * @returns true if ready, false if timed out
   */
  waitForReady(timeoutMs?: number): Promise<boolean>

  /**
   * Send content to the panel
   * @returns PromptResult with success status
   */
  send(context: PanelHandlerContext): Promise<PromptResult>

  /**
   * Check if this panel type is currently available/enabled
   */
  isAvailable(): boolean
}

/**
 * Factory function type for creating panel handlers
 */
export type PanelHandlerFactory = () => IPanelHandler
