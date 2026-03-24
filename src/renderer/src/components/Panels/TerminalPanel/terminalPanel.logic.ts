/**
 * Pure Logic Functions for TerminalPanel
 *
 * Contains pure functions and constants extracted from TerminalPanel.
 * These functions have no side effects and are easily testable.
 *
 * @module TerminalPanel/logic
 */

import type { ITheme } from '@xterm/xterm'
import type { TerminalState } from './types'

/**
 * Compute terminal state from availability and error status.
 *
 * @param isAvailable - Terminal availability status (null = checking)
 * @param error - Error message if any
 * @returns Terminal state for UI rendering
 *
 * @example
 * ```ts
 * computeTerminalState(null, null)    // 'checking'
 * computeTerminalState(false, null)   // 'unavailable'
 * computeTerminalState(true, 'error') // 'error'
 * computeTerminalState(true, null)    // 'ready'
 * ```
 */
export function computeTerminalState(
  isAvailable: boolean | null,
  error: string | null
): TerminalState {
  if (isAvailable === null) {
    return 'checking'
  }
  if (!isAvailable) {
    return 'unavailable'
  }
  if (error) {
    return 'error'
  }
  return 'ready'
}

/**
 * Command to fix node-pty build issues.
 * Copied to clipboard when user clicks "Copy Fix Command".
 */
export const NODE_PTY_FIX_COMMAND = 'npm rebuild node-pty --build-from-source'

/**
 * xterm.js theme configuration.
 * Dark theme with colors matching the application style.
 */
export const TERMINAL_THEME: ITheme = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: '#4fc1ff',
  cursorAccent: '#000000',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
  // xterm v6: scrollbar colors via ITheme (primary mechanism, CSS as fallback)
  // Values match design tokens: --color-gray-700, --color-gray-600, --color-gray-500
  scrollbarSliderBackground: '#454545',
  scrollbarSliderHoverBackground: '#6e6e6e',
  scrollbarSliderActiveBackground: '#858585'
}

/**
 * xterm.js terminal options.
 * Configuration for terminal behavior and appearance.
 */
export const TERMINAL_OPTIONS = {
  cursorBlink: true,
  fontSize: 12,
  fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace",
  fontWeight: 'normal' as const,
  fontWeightBold: 'bold' as const,
  allowTransparency: false,
  theme: TERMINAL_THEME,
  scrollback: 10000,
  // Scroll behavior configuration to prevent unwanted viewport jumps
  scrollOnUserInput: false, // Don't auto-scroll when user types (preserve manual scroll position)
  smoothScrollDuration: 0, // Disable smooth scroll for instant response (no animation lag)
  allowProposedApi: true
}

/**
 * Warmup duration in milliseconds.
 * Activity during this period after terminal creation is ignored
 * to prevent false positives from shell initialization output.
 */
export const TERMINAL_WARMUP_MS = 500

/**
 * Resize threshold constants.
 * Prevents flickering from devicePixelRatio rounding oscillation.
 */
export const RESIZE_COL_THRESHOLD = 2
export const RESIZE_ROW_THRESHOLD = 1

/**
 * Debounce delays in milliseconds.
 */
export const RESIZE_INITIAL_DELAY_MS = 100
export const RESIZE_DEBOUNCE_MS = 10
export const FIT_DELAY_MS = 50
export const RESTART_CLEANUP_DELAY_MS = 100

/**
 * Check if a resize should be applied based on dimension changes.
 * Prevents flickering from tiny changes caused by devicePixelRatio rounding.
 *
 * @param newCols - New column count
 * @param newRows - New row count
 * @param lastCols - Previous column count
 * @param lastRows - Previous row count
 * @returns Whether resize should be applied
 */
export function shouldApplyResize(
  newCols: number,
  newRows: number,
  lastCols: number,
  lastRows: number
): boolean {
  const colsDiff = Math.abs(newCols - lastCols)
  const rowsDiff = Math.abs(newRows - lastRows)

  return (
    (colsDiff >= RESIZE_COL_THRESHOLD || rowsDiff >= RESIZE_ROW_THRESHOLD) &&
    newCols > 0 &&
    newRows > 0
  )
}
