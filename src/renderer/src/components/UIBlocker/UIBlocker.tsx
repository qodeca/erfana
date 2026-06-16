// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useProjectStore } from '../../stores/useProjectStore'
import { TEST_IDS } from '../../constants/testids'
import './UIBlocker.css'

/**
 * Props for the reusable UIBlocker component (todo031)
 */
export interface UIBlockerProps {
  /** Whether the blocker is visible */
  visible: boolean
  /** Message to display */
  message?: string
  /** Tooltip text */
  tooltip?: string
}

/**
 * UIBlockerBase - Reusable overlay component
 *
 * Blocks ALL user interactions when visible:
 * - Mouse clicks (left, right, middle)
 * - Context menus
 * - Keyboard input
 * - Scrolling
 */
export function UIBlockerBase({
  visible,
  message = 'Please wait...',
  tooltip = message
}: UIBlockerProps) {
  if (!visible) {
    return null
  }

  return (
    <div
      className="ui-blocker"
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.preventDefault()}
      onDoubleClick={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onMouseUp={(e) => e.preventDefault()}
      onKeyDown={(e) => e.preventDefault()}
      onKeyUp={(e) => e.preventDefault()}
      onWheel={(e) => e.preventDefault()}
      title={tooltip}
      role="status"
      aria-live="polite"
      aria-label={message}
      data-testid={TEST_IDS.UI_BLOCKER}
    >
      <div className="ui-blocker-content">
        <div className="ui-blocker-spinner"></div>
        <div className="ui-blocker-message">{message}</div>
      </div>
    </div>
  )
}

/**
 * UIBlocker - Project-aware wrapper (backward compatible)
 *
 * Automatically shows when isProjectChanging === true.
 * Use UIBlockerBase directly for custom visibility control.
 */
export function UIBlocker() {
  const isProjectChanging = useProjectStore((state) => state.isProjectChanging)

  return (
    <UIBlockerBase
      visible={isProjectChanging}
      message="Waiting for folder selection..."
      tooltip="Waiting for folder selection..."
    />
  )
}
