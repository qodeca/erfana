// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview limits added by issue #124 (multi-page preview).
 *
 * Caps and timers for drop-point logging, the drag freeze, frames, a tab's own
 * history and the same-tab navigation contract. They live here rather than in
 * `constants.ts`, which is already
 * past the file-size cap; the older `PREVIEW` block stays where it is (moving
 * it is recorded debt). Main and the renderer both read these, so this module
 * imports nothing.
 *
 * @see docs/design/design-issue-124.md §2 (New constants)
 */
export const PREVIEW_LIMITS = {
  /**
   * After the first drop of a reason, later drops of that reason are logged at
   * most once per this window, with how many were swallowed (ms).
   */
  BOUNDS_DROP_LOG_WINDOW_MS: 5_000,
  /**
   * Drop reasons one reporter tracks separately. Reasons are code constants,
   * so this bounds memory against a caller bug; it is not a budget.
   */
  BOUNDS_DROP_MAX_REASONS: 16,
  /** Pointer travel on a splitter before the drag freeze engages (CSS px). */
  DRAG_FREEZE_MOVE_THRESHOLD_PX: 3,
  /** A drag hide confirmed later than this after the hold began is logged (ms). */
  DRAG_HOLD_SLOW_LOG_MS: 150,
  /** Wait for the settled bounds push after a window-edge resize ends (ms). */
  RESIZE_HOLD_SETTLE_TIMEOUT_MS: 500,
  /**
   * A window-edge hold that hears no `will-resize` for this long ends as if
   * `resized` had arrived, so a lost event can never keep a page hidden (ms).
   */
  RESIZE_HOLD_MAX_IDLE_MS: 2_000,
  /** Deepest `src` frame that may load; a frame in the page itself is depth 1. */
  MAX_FRAME_DEPTH: 3,
  /** `src` frames one page may load; the next one is refused (spike S12). */
  MAX_FRAMES_PER_PAGE: 50,
  /** Quiet time after the last over-limit refusal before its entry is written (ms). */
  FRAME_OVER_LIMIT_QUIET_MS: 500,
  /** Subframe console messages one view admits per second, before any parsing. */
  FRAME_CONSOLE_MAX_PER_SECOND: 100,
  /** A subframe console message is cut to this many characters before matching. */
  FRAME_CSP_CONSOLE_MAX_CHARS: 4_096,
  /** Request-kind ledger entries per session, oldest dropped first. */
  REQUEST_KIND_LEDGER_MAX: 256,
  /** A request-kind ledger entry older than this is forgotten (ms). */
  REQUEST_KIND_LEDGER_TTL_MS: 10_000,
  /** Entries in one tab's history; the oldest is dropped past this. */
  MAX_HISTORY_ENTRIES: 50,
  /**
   * A page's own in-page step – a `#section` jump, a script's hash change – is
   * recorded as a new history entry only when a user gesture reached the view
   * this recently; otherwise it takes the current entry's place, so a page
   * cannot fill the list and evict where the reader came from (ms; QG-7 S1).
   */
  HISTORY_GESTURE_WINDOW_MS: 1_000,
  /**
   * The anchor bound of the same-tab navigation contract: its schema refuses a
   * longer anchor, and main cuts a page's fragment to it (QG-6 A3).
   */
  NAV_MAX_ANCHOR_CHARS: 1_024,
  /** Idle time after the last real input before the still picture is refreshed (ms). */
  STILL_FRAME_IDLE_REFRESH_MS: 500
} as const
