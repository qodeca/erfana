/**
 * ProjectTree Constants
 *
 * Centralized configuration values for the ProjectTree component.
 * Extracted to improve maintainability and reduce magic numbers.
 */

/**
 * Drag-and-Drop Configuration
 */
export const DRAG_DROP = {
  /** Minimum distance in pixels to activate drag (prevents accidental drags) */
  ACTIVATION_DISTANCE: 5
} as const

/**
 * Terminal Integration
 */
export const TERMINAL = {
  /** Time window in ms to consider terminal "recently active" (20 seconds) */
  RECENT_ACTIVITY_WINDOW: 20_000,

  /** Ctrl+C character code for terminal interrupt signal */
  INTERRUPT_SIGNAL: '\u0003',

  /** Delay in ms after sending Ctrl+C before checking activity (300ms) */
  SIGNAL_DELAY: 300,

  /** Time window in ms to check if terminal is still active after signal (300ms) */
  ACTIVITY_CHECK_WINDOW: 300
} as const

/**
 * Auto-Scroll Configuration
 */
export const AUTO_SCROLL = {
  /** Distance in pixels from top edge to trigger upward scroll */
  TRIGGER_DISTANCE_TOP: 50,

  /** Distance in pixels from bottom edge to trigger downward scroll */
  TRIGGER_DISTANCE_BOTTOM: 50,

  /** Scroll amount in pixels per frame (negative = up, positive = down) */
  SCROLL_AMOUNT: 5,

  /** Interval in ms between scroll updates (~60fps) */
  SCROLL_INTERVAL: 16
} as const

/**
 * Auto-Expand Configuration
 */
export const AUTO_EXPAND = {
  /** Delay in ms before auto-expanding a folder when hovering (1 second) */
  HOVER_DELAY: 1_000
} as const

/**
 * Git Status Configuration
 */
export const GIT_STATUS = {
  /**
   * Debounce delay in ms for git status refresh.
   * Waits for rapid file changes to settle before refreshing.
   * Tuned for responsiveness (500ms vs original 1000ms).
   */
  DEBOUNCE_DELAY: 500,

  /**
   * Cooldown duration in ms between git status refreshes.
   * Prevents excessive refreshes during continuous file activity.
   * Tuned for responsiveness (1500ms vs original 2000ms).
   */
  COOLDOWN_DURATION: 1_500
} as const
