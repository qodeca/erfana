// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scroll Anomaly Detector
 *
 * Pure logic module for detecting anomalous scroll-to-top events
 * caused by Claude Code's Ink library buffer redraws.
 *
 * Issue #22 Enhanced: Now detects screen-clearing escape sequences
 * that Ink sends when output exceeds terminal height:
 * - \x1b[2J (ED 2) - Clear entire screen
 * - \x1b[3J (ED 3) - Clear scrollback buffer
 * - \x1b[H - Cursor home
 *
 * Related: https://github.com/anthropics/claude-code/issues/826
 */

/**
 * Escape sequence signals detected in PTY data stream
 * Used to trigger immediate recovery when screen-clearing sequences are detected
 */
export interface EscapeSequenceSignals {
  /** ED 2: Clear entire screen (\x1b[2J) */
  hasScreenClear: boolean
  /** ED 3: Clear scrollback buffer (\x1b[3J) */
  hasScrollbackClear: boolean
  /** Cursor home (\x1b[H or \x1b[;H) */
  hasCursorHome: boolean
}

export interface ScrollAnomalyConfig {
  /**
   * Window to consider user scroll as "recent" (ms)
   * 300ms captures typical scroll gesture duration
   */
  userScrollRecencyMs: number

  /**
   * Window to consider data streaming as "active" (ms)
   * 500ms accounts for gaps in Claude Code output
   */
  dataStreamRecencyMs: number

  /**
   * Minimum lines jumped to be considered anomalous
   * 10 lines filters out normal scroll adjustments
   */
  jumpThresholdLines: number

  /**
   * Lines from top to be considered "near top"
   * 3 lines catches position 0, 1, 2
   */
  nearTopThreshold: number

  /**
   * @deprecated Use recoveryIntervalMs instead. Kept for backwards compatibility.
   * Debounce between recovery actions (ms)
   */
  recoveryDebounceMs: number

  /**
   * Fixed interval for checking anomaly queue and triggering recovery (ms)
   * Issue #22: Reduced from 500ms to 100ms for faster recovery from Ink redraws
   */
  recoveryIntervalMs: number

  /**
   * Threshold for buffer truncation detection (lines)
   * If baseY shrinks by this many lines, scrollback was likely cleared
   */
  bufferTruncationThreshold: number

  /**
   * Enable immediate recovery when clear sequences detected
   * When true, triggers recovery immediately instead of waiting for interval
   */
  immediateRecoveryOnClear: boolean
}

export interface ScrollState {
  /** Timestamp of last user-initiated scroll (wheel/touch) */
  lastUserScrollTs: number
  /** Timestamp of last terminal data received */
  lastDataTs: number
  /** Viewport Y position before data write */
  viewportYBefore: number
  /** Viewport Y position after data write */
  viewportYAfter: number
  /** Bottom of scrollback buffer */
  baseY: number
  /** Current timestamp for comparison */
  currentTs: number
}

export const DEFAULT_SCROLL_ANOMALY_CONFIG: ScrollAnomalyConfig = {
  userScrollRecencyMs: 300,
  dataStreamRecencyMs: 500,
  jumpThresholdLines: 10,
  nearTopThreshold: 3,
  recoveryDebounceMs: 100, // @deprecated - kept for backwards compatibility
  recoveryIntervalMs: 50, // Issue #22 + parser hooks: Reduced from 100ms to 50ms for faster fallback recovery
  bufferTruncationThreshold: 10, // Issue #22: Detect buffer clears
  immediateRecoveryOnClear: true // Issue #22: Recover immediately on ED 2/3
}

/**
 * Check if user scrolled recently (within time window)
 */
export function wasUserScrollRecent(
  lastUserScrollTs: number,
  currentTs: number,
  windowMs: number
): boolean {
  if (lastUserScrollTs === 0) return false
  return currentTs - lastUserScrollTs < windowMs
}

/**
 * Check if data was streaming recently (within time window)
 */
export function wasDataStreamActive(
  lastDataTs: number,
  currentTs: number,
  windowMs: number
): boolean {
  if (lastDataTs === 0) return false
  return currentTs - lastDataTs < windowMs
}

/**
 * Calculate absolute jump magnitude in lines
 */
export function calculateJumpMagnitude(before: number, after: number): number {
  return Math.abs(before - after)
}

/**
 * Check if viewport position is near the top
 */
export function isNearTop(viewportY: number, threshold: number): boolean {
  return viewportY <= threshold
}

/**
 * Detect if a scroll event is anomalous (caused by Ink library redraw)
 *
 * An anomalous scroll is characterized by:
 * 1. Large instant jump (viewportY goes from far to near 0)
 * 2. Occurs while output is actively streaming
 * 3. User did NOT initiate the scroll (no recent wheel/touch events)
 * 4. User was NOT already near the top (intentionally viewing top)
 */
export function isAnomalousScroll(
  state: ScrollState,
  config: ScrollAnomalyConfig
): boolean {
  const {
    lastUserScrollTs,
    lastDataTs,
    viewportYBefore,
    viewportYAfter,
    currentTs
  } = state

  // Signal 1: User did NOT recently scroll
  // If user is actively scrolling, respect their intent
  const userScrolledRecently = wasUserScrollRecent(
    lastUserScrollTs,
    currentTs,
    config.userScrollRecencyMs
  )
  if (userScrolledRecently) {
    return false
  }

  // Signal 2: Data was streaming (we were receiving output)
  // Ink anomalies only occur during active streaming
  const dataWasStreaming = wasDataStreamActive(
    lastDataTs,
    currentTs,
    config.dataStreamRecencyMs
  )
  if (!dataWasStreaming) {
    return false
  }

  // Signal 3: Large jump to near-top
  const jumpMagnitude = calculateJumpMagnitude(viewportYBefore, viewportYAfter)
  const isLargeJump = jumpMagnitude >= config.jumpThresholdLines
  const landedNearTop = isNearTop(viewportYAfter, config.nearTopThreshold)

  // Additional check: user was NOT already near top
  // If user was intentionally viewing top content, don't "recover"
  const wasNearTop = isNearTop(viewportYBefore, config.nearTopThreshold)

  return isLargeJump && landedNearTop && !wasNearTop
}

/**
 * Detect screen-clearing escape sequences in PTY data stream
 *
 * Ink library (used by Claude Code) sends these sequences when output
 * exceeds terminal height, causing viewport to jump to top.
 *
 * @param data Raw PTY data string
 * @returns Object with detection flags for each sequence type
 */
export function detectClearSequences(data: string): EscapeSequenceSignals {
  return {
    // ED 2: Clear entire screen - erases all content in visible area
    // eslint-disable-next-line no-control-regex
    hasScreenClear: /\x1b\[2J/.test(data),
    // ED 3: Clear scrollback buffer - THIS is the main culprit that wipes history
    // eslint-disable-next-line no-control-regex
    hasScrollbackClear: /\x1b\[3J/.test(data),
    // Cursor home - moves cursor to position 1,1 (usually follows clear)
    // Matches \x1b[H and \x1b[;H (both are valid cursor home sequences)
    // eslint-disable-next-line no-control-regex
    hasCursorHome: /\x1b\[(?:;)?H/.test(data)
  }
}

/**
 * Check if any destructive clear sequences are present
 *
 * Shorthand for checking if screen clear OR scrollback clear was detected.
 * These are the sequences that cause viewport jumps.
 *
 * @param signals Escape sequence detection results
 * @returns true if either screen clear or scrollback clear was detected
 */
export function hasDestructiveClearSequence(signals: EscapeSequenceSignals): boolean {
  return signals.hasScreenClear || signals.hasScrollbackClear
}

/**
 * Detect if scrollback buffer was truncated (shrunk significantly)
 *
 * When Ink sends ED 3 (clear scrollback), the buffer's baseY drops dramatically.
 * This function detects that scenario by comparing before/after baseY values.
 *
 * @param baseYBefore Buffer baseY before write operation
 * @param baseYAfter Buffer baseY after write operation
 * @param threshold Minimum shrinkage to consider as truncation (default: 10 lines)
 * @returns true if buffer shrank by at least threshold lines
 */
export function wasBufferTruncated(
  baseYBefore: number,
  baseYAfter: number,
  threshold: number = 10
): boolean {
  // Buffer shrank significantly = scrollback was likely cleared
  // baseY is the scroll position of the "bottom" of the buffer
  // If it decreases substantially, content was removed
  return baseYBefore - baseYAfter >= threshold
}

/**
 * Check if multiple clear sequences arrived in rapid succession
 *
 * Ink sometimes sends multiple clear sequences in quick succession during
 * UI redraws. This function detects that pattern to avoid multiple
 * recovery attempts.
 *
 * @param timestamps Array of timestamps when clear sequences were detected
 * @param now Current timestamp
 * @param windowMs Time window to consider as "rapid" (default: 200ms)
 * @param threshold Number of events to consider as "rapid" (default: 3)
 * @returns true if threshold or more clear events occurred within window
 */
export function isRapidRedraw(
  timestamps: number[],
  now: number,
  windowMs: number = 200,
  threshold: number = 3
): boolean {
  const recent = timestamps.filter((t) => now - t < windowMs)
  return recent.length >= threshold
}

/**
 * Reading position tracker for smart recovery
 *
 * Instead of always scrolling to bottom, we can try to restore the user's
 * approximate reading position relative to the bottom of the buffer.
 */
export interface ReadingPosition {
  /** Viewport Y position when captured */
  viewportY: number
  /** Buffer baseY when captured (bottom of scrollback) */
  baseY: number
  /** Timestamp when position was captured */
  timestamp: number
}

/**
 * Calculate smart recovery target position
 *
 * Instead of blindly scrolling to bottom, this calculates where the user
 * was reading relative to the bottom of the buffer, and maps that to the
 * new buffer state.
 *
 * @param savedPosition Last known reading position before anomaly
 * @param newBaseY Current buffer baseY after anomaly
 * @returns Target viewport Y position for recovery, or null to use scrollToBottom
 */
export function calculateRecoveryTarget(
  savedPosition: ReadingPosition | null,
  newBaseY: number
): number | null {
  if (!savedPosition) {
    return null // No saved position, use scrollToBottom
  }

  const { viewportY, baseY } = savedPosition

  // Calculate how far from bottom the user was reading
  // offsetFromBottom = 0 means they were at the very bottom
  const offsetFromBottom = baseY - viewportY

  // If user was at or very near bottom, just scroll to bottom
  if (offsetFromBottom <= 3) {
    return null
  }

  // Map the offset to the new buffer state
  // This preserves the user's relative position from the bottom
  const targetY = Math.max(0, newBaseY - offsetFromBottom)

  return targetY
}
