/**
 * Pure logic for DiagramViewer keyboard handling and zoom calculations.
 * Follows project pattern from terminalClipboard.logic.ts
 */

export interface KeyEventInfo {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export type ViewerKeyAction = 'zoom-in' | 'zoom-out' | 'reset' | 'fit' | 'close' | 'none'

export const ZOOM_CONFIG = {
  MIN_SCALE: 0.1,
  MAX_SCALE: 5,
  ZOOM_STEP: 0.2,
  INITIAL_SCALE: 1
} as const

/** Get keyboard shortcut action from key event */
export function getKeyboardAction(event: KeyEventInfo): ViewerKeyAction {
  // Ignore modified keys (except for +/- which can use shift)
  if (event.ctrlKey || event.metaKey) return 'none'

  switch (event.key) {
    case '+':
    case '=':
      return 'zoom-in'
    case '-':
      return 'zoom-out'
    case '0':
      return 'reset'
    case 'f':
    case 'F':
      return 'fit'
    case 'Escape':
      return 'close'
    default:
      return 'none'
  }
}

/** Calculate zoom percentage for display */
export function calculateZoomPercentage(scale: number): number {
  return Math.round(scale * 100)
}

/** Format zoom level for display */
export function formatZoomLevel(scale: number): string {
  return `${calculateZoomPercentage(scale)}%`
}

/** Clamp scale within bounds */
export function clampScale(scale: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, scale))
}

/** Check if zoom buttons should be disabled */
export function getZoomButtonStates(scale: number, minScale: number, maxScale: number): {
  zoomInDisabled: boolean
  zoomOutDisabled: boolean
} {
  return {
    zoomInDisabled: scale >= maxScale,
    zoomOutDisabled: scale <= minScale
  }
}

/** Calculate initial scale to fit diagram in viewport */
export function calculateFitScale(
  svgWidth: number,
  svgHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 40
): number {
  if (svgWidth <= 0 || svgHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return 1
  }

  const availableWidth = viewportWidth - padding * 2
  const availableHeight = viewportHeight - padding * 2

  const scaleX = availableWidth / svgWidth
  const scaleY = availableHeight / svgHeight

  // Use the smaller scale to fit entire diagram, but cap at 1 (don't upscale)
  return Math.min(scaleX, scaleY, 1)
}
