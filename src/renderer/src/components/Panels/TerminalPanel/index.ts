// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal Panel Module
 *
 * Re-exports the TerminalPanel component and related types/utilities.
 *
 * @module TerminalPanel
 */

// Main component - still in original location during refactoring
// Will be moved here in Phase 6
export { TerminalPanel } from '../TerminalPanel'

// Types
export type {
  TerminalState,
  ScreenshotCaptureMode,
  DragHandlerRefs,
  TerminalControls,
  DisplayInfo
} from './types'

// Pure logic functions
export {
  computeTerminalState,
  NODE_PTY_FIX_COMMAND,
  TERMINAL_THEME,
  TERMINAL_OPTIONS,
  shouldApplyResize,
  TERMINAL_WARMUP_MS,
  RESIZE_COL_THRESHOLD,
  RESIZE_ROW_THRESHOLD,
  RESIZE_INITIAL_DELAY_MS,
  RESIZE_DEBOUNCE_MS,
  FIT_DELAY_MS,
  RESTART_CLEANUP_DELAY_MS
} from './terminalPanel.logic'

// Hooks
export {
  useTerminalDragDrop,
  useScreenshotCapture,
  useTerminalResize,
  useTerminalPortal
} from './hooks'

// Components
export { TerminalToolbar, TerminalStatusContent } from './components'
export type { TerminalToolbarProps, TerminalStatusContentProps } from './components'
