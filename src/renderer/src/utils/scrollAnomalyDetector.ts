/**
 * Scroll Anomaly Detector
 *
 * Pure logic module for detecting anomalous scroll-to-top events
 * caused by Claude Code's Ink library buffer redraws.
 *
 * Related: https://github.com/anthropics/claude-code/issues/826
 */

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
   * 500ms balances responsiveness with batching efficiency
   * Issue #22: Changed from debounce to fixed-interval queue approach
   */
  recoveryIntervalMs: number
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
  recoveryIntervalMs: 500  // Issue #22: Fixed-interval queue approach
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
