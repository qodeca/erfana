// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * Directory Watcher Configuration
 *
 * Added per lens-review on PR #241: now that DirectoryWatcherService also
 * broadcasts on file content edits (chokidar `change` events), the
 * consumer of `'directory-watch:changed'` must debounce to avoid
 * thrashing the recursive project-tree re-list on multi-file write
 * storms (e.g., `prettier --write .`, snapshot updates, AI multi-file
 * edits). Symmetric with GIT_STATUS.DEBOUNCE_DELAY below so the two
 * consumers of the broadcast behave consistently.
 */
export const DIRECTORY_WATCHER = {
  /** Debounce delay in ms for project tree refresh on directory changes. */
  DEBOUNCE_DELAY: 250
} as const

/**
 * Git Status Configuration
 *
 * Issue #74: Reduced timing constants for faster git status latency.
 * End-to-end latency reduced from ~2 seconds to ~750ms.
 */
export const GIT_STATUS = {
  /**
   * Debounce delay in ms for git status refresh (250ms).
   * Waits for rapid file changes to settle before refreshing.
   * Reduced from 500ms per Issue #74 to improve latency.
   */
  DEBOUNCE_DELAY: 250,

  /**
   * Cooldown duration in ms between git status refreshes.
   * Prevents excessive refreshes during continuous file activity.
   * (500ms - reduced from 1500ms per Issue #74)
   */
  COOLDOWN_DURATION: 500
} as const
