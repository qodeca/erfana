// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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

export type ViewerKeyAction = 'zoom-in' | 'zoom-out' | 'reset' | 'fit' | 'none'

export const ZOOM_CONFIG = {
  MIN_SCALE: 0.1,
  MAX_SCALE: 5,
  ZOOM_STEP: 0.2,
  INITIAL_SCALE: 1
} as const

/** Get keyboard shortcut action from key event */
export function getKeyboardAction(event: KeyEventInfo): ViewerKeyAction {
  const hasModifier = event.ctrlKey || event.metaKey

  // Non-modifier shortcuts only
  if (!hasModifier) {
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
      // Note: Escape no longer closes viewer - use X button instead
      default:
        return 'none'
    }
  }

  return 'none'
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

// ============================================================================
// ViewBox-based zoom functions (fixes pixelation issue #31)
// ============================================================================

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

/** Parse SVG viewBox attribute string to object */
export function parseViewBox(viewBoxAttr: string | null): ViewBox | null {
  if (!viewBoxAttr || typeof viewBoxAttr !== 'string') {
    return null
  }

  const parts = viewBoxAttr.trim().split(/[\s,]+/)
  if (parts.length !== 4) {
    return null
  }

  const [x, y, width, height] = parts.map(Number)

  // Validate all values are finite numbers
  if ([x, y, width, height].some(v => !Number.isFinite(v))) {
    return null
  }

  // Width and height must be positive
  if (width <= 0 || height <= 0) {
    return null
  }

  return { x, y, width, height }
}

/** Create viewBox from SVG dimensions when viewBox attribute is missing */
export function createViewBoxFromDimensions(width: number, height: number): ViewBox | null {
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }
  return { x: 0, y: 0, width, height }
}

/** Calculate new viewBox based on scale and pan offset */
export function calculateViewBox(
  original: ViewBox,
  scale: number,
  panX: number,
  panY: number
): ViewBox {
  // Clamp scale to avoid division issues
  const safeScale = Math.max(scale, 0.01)

  const newWidth = original.width / safeScale
  const newHeight = original.height / safeScale

  // Center the scaled view, then apply pan
  // Pan is in viewBox units, positive panX moves content left (viewBox x decreases)
  const centerOffsetX = (original.width - newWidth) / 2
  const centerOffsetY = (original.height - newHeight) / 2

  return {
    x: original.x + centerOffsetX - panX,
    y: original.y + centerOffsetY - panY,
    width: newWidth,
    height: newHeight
  }
}

/** Format viewBox object to SVG attribute string */
export function formatViewBox(viewBox: ViewBox): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
}

/** Convert pixel delta to viewBox units for panning */
export function pixelToViewBoxDelta(
  pixelDelta: number,
  viewportSize: number,
  viewBoxSize: number
): number {
  if (viewportSize <= 0) {
    return 0
  }
  return pixelDelta * (viewBoxSize / viewportSize)
}
