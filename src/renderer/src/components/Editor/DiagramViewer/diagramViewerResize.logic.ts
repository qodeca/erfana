/**
 * DiagramViewer Resize Logic
 *
 * Pure functions for managing the split pane resize between
 * diagram view and terminal panel in DiagramViewer.
 */

export const SPLIT_CONFIG = {
  /** Minimum width for either pane in pixels */
  MIN_PANE_WIDTH: 200,

  /** Default terminal panel width in pixels */
  DEFAULT_TERMINAL_WIDTH: 400,

  /** Default split ratio (diagram gets 60%) */
  DEFAULT_RATIO: 0.6
} as const

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Calculate pane widths from container width and terminal width
 */
export function calculatePaneWidths(
  containerWidth: number,
  terminalWidth: number
): { diagramWidth: number; terminalWidth: number } {
  const maxTerminalWidth = containerWidth - SPLIT_CONFIG.MIN_PANE_WIDTH
  const clampedTerminalWidth = clamp(
    terminalWidth,
    SPLIT_CONFIG.MIN_PANE_WIDTH,
    maxTerminalWidth
  )

  return {
    diagramWidth: containerWidth - clampedTerminalWidth,
    terminalWidth: clampedTerminalWidth
  }
}

/**
 * Calculate new terminal width during resize drag
 *
 * @param startTerminalWidth - Terminal width when drag started
 * @param deltaX - Mouse movement from start (positive = moved right)
 * @param containerWidth - Total container width
 * @returns New terminal width (clamped to valid range)
 */
export function handleResizeDrag(
  startTerminalWidth: number,
  deltaX: number,
  containerWidth: number
): number {
  // Dragging left (negative deltaX) = increase terminal width
  // Dragging right (positive deltaX) = decrease terminal width
  const newWidth = startTerminalWidth - deltaX

  const maxWidth = containerWidth - SPLIT_CONFIG.MIN_PANE_WIDTH
  return clamp(newWidth, SPLIT_CONFIG.MIN_PANE_WIDTH, maxWidth)
}

/**
 * Calculate initial terminal width from container width
 * Uses default width or ratio-based calculation
 */
export function getInitialTerminalWidth(containerWidth: number): number {
  // Use default width if container is wide enough
  if (containerWidth >= SPLIT_CONFIG.DEFAULT_TERMINAL_WIDTH + SPLIT_CONFIG.MIN_PANE_WIDTH) {
    return SPLIT_CONFIG.DEFAULT_TERMINAL_WIDTH
  }

  // Otherwise use ratio-based split
  const terminalWidth = containerWidth * (1 - SPLIT_CONFIG.DEFAULT_RATIO)
  return clamp(
    terminalWidth,
    SPLIT_CONFIG.MIN_PANE_WIDTH,
    containerWidth - SPLIT_CONFIG.MIN_PANE_WIDTH
  )
}

/**
 * Check if container is too narrow for split view
 */
export function isTooNarrowForSplit(containerWidth: number): boolean {
  return containerWidth < SPLIT_CONFIG.MIN_PANE_WIDTH * 2
}
