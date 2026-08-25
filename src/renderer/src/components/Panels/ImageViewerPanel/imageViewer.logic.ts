// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure logic for ImageViewerPanel zoom, pan, and keyboard handling.
 *
 * Contains no React code or side effects - all functions are pure.
 * Adapted from diagramViewer.logic.ts with image-specific enhancements.
 *
 * @module imageViewer.logic
 * @see {@link ImageViewerPanel} for the React component
 * @see {@link diagramViewer.logic} for the original diagram viewer logic
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Transform state for image position and scale.
 *
 * Represents the current view transform of the image within its container.
 * Used by ImageViewerPanel to track zoom and pan state.
 */
export interface Transform {
  /** Current zoom scale (1 = 100%, 0.5 = 50%, 2 = 200%) */
  scale: number
  /** Horizontal translation in pixels (positive = right) */
  translateX: number
  /** Vertical translation in pixels (positive = down) */
  translateY: number
}

/**
 * Keyboard event information for action mapping.
 */
export interface KeyEventInfo {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Possible keyboard actions in the image viewer.
 *
 * - 'zoomIn': Increase zoom level
 * - 'zoomOut': Decrease zoom level
 * - 'reset': Reset to 100% zoom
 * - 'fit': Fit image to container
 * - 'fullscreen': Toggle full-screen mode
 * - 'panUp': Pan image up
 * - 'panDown': Pan image down
 * - 'panLeft': Pan image left
 * - 'panRight': Pan image right
 * - null: No recognized action
 */
export type ImageViewerKeyAction =
  | 'zoomIn'
  | 'zoomOut'
  | 'reset'
  | 'fit'
  | 'fullscreen'
  | 'panUp'
  | 'panDown'
  | 'panLeft'
  | 'panRight'
  | null

// ============================================================================
// Constants
// ============================================================================

/**
 * Small value for floating-point comparisons to avoid precision issues.
 * Used when comparing zoom levels to handle floating-point rounding.
 */
export const EPSILON = 0.001

/**
 * Zoom configuration constants.
 *
 * Defines the bounds and step size for zoom operations.
 * These values are used to constrain zoom levels within reasonable limits.
 */
export const ZOOM_CONFIG = {
  /** Minimum allowed zoom scale (1% = 0.01) */
  MIN_SCALE: 0.01,
  /** Maximum allowed zoom scale (1000% = 10) */
  MAX_SCALE: 10,
  /** Step size for continuous zoom (wheel) */
  ZOOM_STEP: 0.2,
  /** Initial scale when image is loaded */
  INITIAL_SCALE: 1
} as const

/**
 * Pan configuration constants.
 *
 * Defines settings for pan operations (keyboard navigation, bounds).
 */
export const PAN_CONFIG = {
  /** Step size in pixels for keyboard pan operations */
  STEP_SIZE: 50,
  /** Maximum pan distance in pixels (prevents image from being dragged off-screen) */
  MAX_PAN: 10000
} as const

/**
 * Discrete zoom levels for stepped zoom (button/keyboard).
 *
 * Users can jump between these levels using +/- buttons or keyboard shortcuts.
 * Values are scale factors (not percentages): 0.01 = 1%, 1 = 100%, 10 = 1000%.
 *
 * @example
 * ```ts
 * // Get next zoom level
 * const current = 1; // 100%
 * const next = getNextZoomLevel(current, 'in'); // Returns 1.25 (125%)
 * ```
 */
export const ZOOM_LEVELS = [
  0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 7, 8, 10
] as const

/**
 * Initial transform state for a newly loaded image.
 */
export const INITIAL_TRANSFORM: Transform = {
  scale: ZOOM_CONFIG.INITIAL_SCALE,
  translateX: 0,
  translateY: 0
}

// ============================================================================
// Zoom Functions
// ============================================================================

/**
 * Get the next zoom level in the discrete zoom steps.
 *
 * Used for button and keyboard zoom operations.
 * Finds the next step in ZOOM_LEVELS based on direction.
 *
 * @param currentScale - Current zoom scale
 * @param direction - Zoom direction ('in' to increase, 'out' to decrease)
 * @returns Next zoom level from ZOOM_LEVELS, clamped to bounds
 *
 * @example
 * ```ts
 * getNextZoomLevel(1, 'in');      // 1.25
 * getNextZoomLevel(1, 'out');     // 0.75
 * getNextZoomLevel(0.01, 'out');  // 0.01 (at minimum)
 * getNextZoomLevel(10, 'in');     // 10 (at maximum)
 * getNextZoomLevel(0.8, 'in');    // 1 (snaps to nearest level)
 * ```
 */
export function getNextZoomLevel(
  currentScale: number,
  direction: 'in' | 'out'
): number {
  if (direction === 'in') {
    // Find first level greater than current (use EPSILON for floating-point comparison)
    for (const level of ZOOM_LEVELS) {
      if (level > currentScale + EPSILON) {
        return level
      }
    }
    // Already at or above max
    return ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
  } else {
    // Find last level less than current (use EPSILON for floating-point comparison)
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
      if (ZOOM_LEVELS[i] < currentScale - EPSILON) {
        return ZOOM_LEVELS[i]
      }
    }
    // Already at or below min
    return ZOOM_LEVELS[0]
  }
}

/**
 * Clamp a scale value within configured bounds.
 *
 * @param scale - Scale value to clamp
 * @returns Clamped scale between MIN_SCALE and MAX_SCALE
 *
 * @example
 * ```ts
 * clampScale(1.5);    // 1.5
 * clampScale(0.005);  // 0.01 (MIN_SCALE)
 * clampScale(15);     // 10 (MAX_SCALE)
 * ```
 */
export function clampScale(scale: number): number {
  return Math.max(ZOOM_CONFIG.MIN_SCALE, Math.min(ZOOM_CONFIG.MAX_SCALE, scale))
}

/**
 * Clamp a pan value within configured bounds.
 *
 * Prevents the image from being panned too far off-screen.
 *
 * @param pan - Pan value (translateX or translateY) to clamp
 * @returns Clamped pan between -MAX_PAN and MAX_PAN
 *
 * @example
 * ```ts
 * clampPan(100);       // 100
 * clampPan(-100);      // -100
 * clampPan(15000);     // 10000 (MAX_PAN)
 * clampPan(-15000);    // -10000 (-MAX_PAN)
 * ```
 */
export function clampPan(pan: number): number {
  return Math.max(-PAN_CONFIG.MAX_PAN, Math.min(PAN_CONFIG.MAX_PAN, pan))
}

/**
 * Calculate scale to fit image within container.
 *
 * Computes the scale needed to fit the entire image within the container
 * while maintaining aspect ratio. Optionally adds padding around the image.
 * Never scales up (max scale is 1).
 *
 * @param imageWidth - Original image width in pixels
 * @param imageHeight - Original image height in pixels
 * @param containerWidth - Container width in pixels
 * @param containerHeight - Container height in pixels
 * @param padding - Optional padding in pixels (default: 40)
 * @returns Scale factor to fit image (0 < scale <= 1)
 *
 * @example
 * ```ts
 * // Image fits without scaling
 * calculateFitScale(100, 100, 800, 600);     // 1
 *
 * // Wide image needs scaling
 * calculateFitScale(1600, 100, 800, 600);    // ~0.45 (considering padding)
 *
 * // Tall image needs scaling
 * calculateFitScale(100, 1200, 800, 600);    // ~0.43 (considering padding)
 *
 * // Invalid dimensions
 * calculateFitScale(0, 100, 800, 600);       // 1
 * ```
 */
export function calculateFitScale(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding: number = 40
): number {
  // Guard against invalid dimensions
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return 1
  }

  const availableWidth = containerWidth - padding * 2
  const availableHeight = containerHeight - padding * 2

  // Protect against negative available space
  if (availableWidth <= 0 || availableHeight <= 0) {
    return 1
  }

  const scaleX = availableWidth / imageWidth
  const scaleY = availableHeight / imageHeight

  // Use smaller scale to fit entirely, cap at 1 (don't upscale)
  return Math.min(scaleX, scaleY, 1)
}

/**
 * Calculate zoom transformation centered on cursor position.
 *
 * When zooming with the mouse wheel, the point under the cursor should
 * remain stationary. This function calculates the new transform to achieve that.
 *
 * @param currentTransform - Current transform state
 * @param newScale - Target scale after zoom
 * @param cursorX - Cursor X position in viewport coordinates
 * @param cursorY - Cursor Y position in viewport coordinates
 * @param containerRect - Container's bounding rectangle
 * @returns New transform with adjusted translation to center zoom on cursor
 *
 * @example
 * ```ts
 * const current = { scale: 1, translateX: 0, translateY: 0 };
 * const containerRect = { left: 0, top: 0, width: 800, height: 600 };
 *
 * // Zoom in centered on cursor at (400, 300) - container center
 * const result = calculateCursorCenteredZoom(
 *   current,
 *   1.5,
 *   400,
 *   300,
 *   containerRect
 * );
 * // result.scale = 1.5, translateX and translateY adjusted
 * ```
 */
export function calculateCursorCenteredZoom(
  currentTransform: Transform,
  newScale: number,
  cursorX: number,
  cursorY: number,
  containerRect: DOMRect
): Transform {
  const { scale, translateX, translateY } = currentTransform

  // Guard against division by zero (defensive, scale should always be >= MIN_SCALE)
  if (scale <= 0) {
    return { scale: newScale, translateX, translateY }
  }

  // Calculate cursor position relative to container center
  const containerCenterX = containerRect.left + containerRect.width / 2
  const containerCenterY = containerRect.top + containerRect.height / 2
  const cursorRelX = cursorX - containerCenterX
  const cursorRelY = cursorY - containerCenterY

  // Calculate scale ratio
  const scaleFactor = newScale / scale

  // Adjust translation to keep point under cursor stationary
  // The math: newPos = (oldPos - translate) * scaleFactor + newTranslate
  // We want newPos = oldPos for the cursor point
  // Solving: newTranslate = oldPos - (oldPos - translate) * scaleFactor
  //                       = oldPos * (1 - scaleFactor) + translate * scaleFactor
  const newTranslateX = cursorRelX * (1 - scaleFactor) + translateX * scaleFactor
  const newTranslateY = cursorRelY * (1 - scaleFactor) + translateY * scaleFactor

  return {
    scale: newScale,
    translateX: newTranslateX,
    translateY: newTranslateY
  }
}

// ============================================================================
// Display Formatting Functions
// ============================================================================

/**
 * Format zoom level as percentage string.
 *
 * @param scale - Zoom scale (1 = 100%)
 * @returns Formatted percentage string (e.g., "100%")
 *
 * @example
 * ```ts
 * formatZoomLevel(1);      // "100%"
 * formatZoomLevel(0.5);    // "50%"
 * formatZoomLevel(1.25);   // "125%"
 * formatZoomLevel(0.333);  // "33%"
 * ```
 */
export function formatZoomLevel(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

/**
 * Format file size in human-readable format.
 *
 * Converts bytes to KB or MB with appropriate precision.
 *
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.5 MB", "256 KB", "512 B")
 *
 * @example
 * ```ts
 * formatFileSize(512);           // "512 B"
 * formatFileSize(1024);          // "1 KB"
 * formatFileSize(262144);        // "256 KB"
 * formatFileSize(1572864);       // "1.5 MB"
 * formatFileSize(0);             // "0 B"
 * formatFileSize(-100);          // "0 B"
 * ```
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0 || !Number.isFinite(bytes)) {
    return '0 B'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const kb = bytes / 1024
  if (kb < 1024) {
    // Show decimal for values under 10 KB
    if (kb < 10) {
      return `${kb.toFixed(1)} KB`
    }
    return `${Math.round(kb)} KB`
  }

  const mb = kb / 1024
  // Show one decimal place for MB
  return `${mb.toFixed(1)} MB`
}

/**
 * Format image dimensions as string.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns Formatted dimensions string (e.g., "1920 x 1080")
 *
 * @example
 * ```ts
 * formatDimensions(1920, 1080);  // "1920 x 1080"
 * formatDimensions(0, 0);        // "0 x 0"
 * ```
 */
export function formatDimensions(width: number, height: number): string {
  return `${width} x ${height}`
}

// ============================================================================
// Keyboard Handling
// ============================================================================

/**
 * Map keyboard event to viewer action.
 *
 * Supported shortcuts (without modifiers):
 * - `+` or `=`: Zoom in
 * - `-`: Zoom out
 * - `0`: Reset to 100%
 * - `f` or `F`: Fit to container
 * - `Escape`: Toggle fullscreen (exit if active)
 *
 * @param event - Keyboard event information
 * @returns Action to perform, or null if not recognized
 *
 * @example
 * ```ts
 * getKeyboardAction({ key: '+', ctrlKey: false, metaKey: false, shiftKey: false });
 * // 'zoomIn'
 *
 * getKeyboardAction({ key: 'f', ctrlKey: false, metaKey: false, shiftKey: false });
 * // 'fit'
 *
 * // With modifier - returns null (reserved for system shortcuts)
 * getKeyboardAction({ key: '+', ctrlKey: true, metaKey: false, shiftKey: false });
 * // null
 * ```
 */
export function getKeyboardAction(event: KeyEventInfo): ImageViewerKeyAction {
  // Ignore events with modifiers (reserved for system shortcuts like Cmd+= browser zoom)
  const hasModifier = event.ctrlKey || event.metaKey

  if (!hasModifier) {
    switch (event.key) {
      case '+':
      case '=':
        return 'zoomIn'
      case '-':
        return 'zoomOut'
      case '0':
        return 'reset'
      case 'f':
      case 'F':
        return 'fit'
      case 'Escape':
        return 'fullscreen'
      case 'ArrowUp':
        return 'panUp'
      case 'ArrowDown':
        return 'panDown'
      case 'ArrowLeft':
        return 'panLeft'
      case 'ArrowRight':
        return 'panRight'
    }
  }

  return null
}

// ============================================================================
// UI State Functions
// ============================================================================

/**
 * Get disabled states for zoom buttons.
 *
 * Used to disable zoom buttons when at min/max limits.
 *
 * @param scale - Current zoom scale
 * @returns Object with canZoomIn and canZoomOut boolean flags
 *
 * @example
 * ```ts
 * getZoomButtonStates(1);      // { canZoomIn: true, canZoomOut: true }
 * getZoomButtonStates(0.01);   // { canZoomIn: true, canZoomOut: false }
 * getZoomButtonStates(10);     // { canZoomIn: false, canZoomOut: true }
 * ```
 */
export function getZoomButtonStates(scale: number): {
  canZoomIn: boolean
  canZoomOut: boolean
} {
  return {
    canZoomIn: scale < ZOOM_CONFIG.MAX_SCALE,
    canZoomOut: scale > ZOOM_CONFIG.MIN_SCALE
  }
}

/**
 * Check if the current transform represents the default (non-zoomed, non-panned) state.
 *
 * Used to show/hide reset button or change its appearance.
 *
 * @param transform - Current transform state
 * @returns True if transform is at default values
 *
 * @example
 * ```ts
 * isDefaultTransform({ scale: 1, translateX: 0, translateY: 0 });  // true
 * isDefaultTransform({ scale: 1.5, translateX: 0, translateY: 0 }); // false
 * isDefaultTransform({ scale: 1, translateX: 10, translateY: 0 });  // false
 * ```
 */
export function isDefaultTransform(transform: Transform): boolean {
  return (
    Math.abs(transform.scale - 1) < EPSILON &&
    Math.abs(transform.translateX) < EPSILON &&
    Math.abs(transform.translateY) < EPSILON
  )
}
