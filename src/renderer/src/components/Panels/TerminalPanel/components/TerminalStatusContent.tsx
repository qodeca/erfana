// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal Status Content Component
 *
 * Renders different UI states for the terminal panel content area:
 * - Checking: Shows loading message
 * - Unavailable: Shows error with recheck and fix options
 * - Error: Shows error message
 * - Ready: Shows terminal container
 *
 * @module TerminalPanel/components/TerminalStatusContent
 */

import { TEST_IDS } from '../../../../constants/testids'
import type { TerminalState } from '../types'
import { NODE_PTY_FIX_COMMAND } from '../terminalPanel.logic'
import './TerminalStatusContent.css'

/**
 * Props for the TerminalStatusContent component.
 */
export interface TerminalStatusContentProps {
  /** Current terminal state */
  state: TerminalState
  /** Error message (for unavailable and error states) */
  errorMessage: string | null
  /** Whether recheck is on cooldown */
  recheckCooldown: boolean
  /** Whether the terminal is a drop target */
  isDropTarget: boolean
  /** Ref for the terminal container element */
  terminalContainerRef: React.RefObject<HTMLDivElement>
  /** Handle recheck button click */
  onRecheck: () => void
  /** Handle copy fix command button click */
  onCopyFix: () => void
}

/**
 * Content area for the terminal panel.
 *
 * Renders appropriate UI based on terminal state:
 * - checking: Loading indicator
 * - unavailable: Error message with recheck/fix options
 * - error: Error message
 * - ready: Terminal container with drop target support
 *
 * @param props - Component props
 * @returns Rendered content element
 */
export function TerminalStatusContent({
  state,
  errorMessage,
  recheckCooldown,
  isDropTarget,
  terminalContainerRef,
  onRecheck,
  onCopyFix
}: TerminalStatusContentProps): JSX.Element {
  return (
    <div className="sidebar-panel-content" data-testid={TEST_IDS.TERMINAL_DROP_ZONE}>
      {state === 'checking' && (
        <div className="terminal-status" data-testid={TEST_IDS.TERMINAL_STATUS_CHECKING}>
          <p>Checking terminal availability...</p>
        </div>
      )}

      {state === 'unavailable' && (
        <div className="terminal-status" data-testid={TEST_IDS.TERMINAL_STATUS_UNAVAILABLE}>
          <div className="terminal-error-icon">⚠️</div>
          <h3>Terminal not available</h3>
          <p>
            node-pty is not available. Terminal functionality requires node-pty to be built
            successfully.
          </p>
          {errorMessage && <p className="error-details">{errorMessage}</p>}
          <div className="terminal-status-actions">
            <button
              className="icon-btn"
              onClick={onRecheck}
              disabled={recheckCooldown}
              aria-label="Recheck availability"
            >
              Recheck
            </button>
            <button className="icon-btn" onClick={onCopyFix} aria-label="Copy fix command">
              Copy fix command
            </button>
          </div>
          <p className="terminal-status-hint">
            Run: <code>{NODE_PTY_FIX_COMMAND}</code>
          </p>
        </div>
      )}

      {state === 'error' && (
        <div className="terminal-status" data-testid={TEST_IDS.TERMINAL_STATUS_ERROR}>
          <div className="terminal-error-icon">❌</div>
          <h3>Terminal error</h3>
          {errorMessage && <p className="error-details">{errorMessage}</p>}
        </div>
      )}

      {state === 'ready' && (
        <div
          ref={terminalContainerRef}
          className="terminal-container"
          data-testid={TEST_IDS.TERMINAL_INSTANCE}
          data-drop-target={isDropTarget}
          aria-dropeffect={isDropTarget ? 'copy' : 'none'}
          aria-label={isDropTarget ? 'Drop files here to insert paths' : undefined}
        />
      )}
    </div>
  )
}
