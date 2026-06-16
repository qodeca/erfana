// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure logic for scheduling scroll-to-bottom after prompt template execution.
 * Coordinates with user scroll detection to respect user intent.
 *
 * Architecture:
 * - Schedules scroll 1 second after prompt completion
 * - Checks if user scrolled during delay window
 * - Verifies terminal controls are available before scrolling
 * - Returns cancel function for cleanup
 *
 * Issue #52: Forced scroll-to-bottom after prompt execution
 */

import { logger } from './logger'

export enum SkipReason {
  USER_SCROLLED = 'user_scrolled',
  TERMINAL_NOT_READY = 'terminal_not_ready',
  CONTROLS_NOT_AVAILABLE = 'controls_not_available'
}

export interface ScheduleScrollOptions {
  /** Timestamp when terminal write completed (from PromptResult) */
  completionTs: number
  /** Terminal portal context (contains controls and readiness state) */
  terminalPortal: {
    terminalControls: { scrollToBottom: () => void } | null
    isTerminalReady: boolean
  }
  /** Access to lastUserScrollTsRef from useScrollAnomalyRecovery (RefObject or MutableRefObject) */
  lastUserScrollTsRef: React.RefObject<number> | React.MutableRefObject<number>
  /** Delay before scrolling (default: 1000ms) */
  delayMs?: number
  /** Callback for testing/logging when scroll is executed */
  onScroll?: () => void
  /** Callback for testing/logging when scroll is skipped */
  onSkip?: (reason: SkipReason) => void
}

export interface ScheduleScrollReturn {
  /** Cancel the scheduled scroll (clears timeout) */
  cancel: () => void
}

/**
 * Check if user scrolled within window after completion timestamp.
 * Returns true if user scrolled AFTER completion and within the window.
 *
 * @param lastUserScrollTs - Timestamp of last user scroll event
 * @param completionTs - Timestamp when prompt execution completed
 * @param windowMs - Time window to check (default: 1000ms)
 * @returns true if user scrolled recently after completion
 */
export function didUserScrollRecently(
  lastUserScrollTs: number,
  completionTs: number,
  windowMs: number
): boolean {
  // User scrolled AFTER completion
  if (lastUserScrollTs > completionTs) {
    const elapsed = Date.now() - lastUserScrollTs
    return elapsed < windowMs
  }
  return false
}

/**
 * Schedule scroll-to-bottom after prompt execution with user scroll check.
 * Returns cancel function for cleanup.
 *
 * Flow:
 * 1. Schedule scroll after delayMs (default: 1000ms)
 * 2. When timer fires, check if terminal controls are available
 * 3. Check if user scrolled during delay window
 * 4. If all checks pass, execute scrollToBottom()
 * 5. Call callbacks for telemetry/testing
 *
 * @param options - Configuration options
 * @returns Object with cancel() function
 *
 * @example
 * ```ts
 * const { cancel } = scheduleScrollIfNeeded({
 *   completionTs: Date.now(),
 *   terminalPortal,
 *   lastUserScrollTsRef,
 *   onScroll: () => console.log('Scrolled to bottom'),
 *   onSkip: (reason) => console.log('Skipped:', reason)
 * })
 *
 * // Later, if needed:
 * cancel()
 * ```
 */
export function scheduleScrollIfNeeded(
  options: ScheduleScrollOptions
): ScheduleScrollReturn {
  const {
    completionTs,
    terminalPortal,
    lastUserScrollTsRef,
    delayMs = 1000,
    onScroll,
    onSkip
  } = options

  const timeoutId = setTimeout(() => {
    // Check 1: Terminal controls available?
    if (!terminalPortal.terminalControls) {
      onSkip?.(SkipReason.CONTROLS_NOT_AVAILABLE)
      logger.debug('[PromptScroll] Skipped: controls not available')
      return
    }

    if (!terminalPortal.isTerminalReady) {
      onSkip?.(SkipReason.TERMINAL_NOT_READY)
      logger.debug('[PromptScroll] Skipped: terminal not ready')
      return
    }

    // Check 2: User scrolled during delay?
    // Handle RefObject (current may be null) vs MutableRefObject
    const lastScrollTs = lastUserScrollTsRef.current ?? 0
    if (didUserScrollRecently(lastScrollTs, completionTs, delayMs)) {
      onSkip?.(SkipReason.USER_SCROLLED)
      logger.debug('[PromptScroll] Skipped: user scrolled during delay')
      return
    }

    // All checks passed - execute scroll
    terminalPortal.terminalControls.scrollToBottom()
    onScroll?.()
    logger.debug('[PromptScroll] Executed: forced scroll to bottom')
  }, delayMs)

  return {
    cancel: () => {
      clearTimeout(timeoutId)
      logger.debug('[PromptScroll] Canceled: cleanup called')
    }
  }
}
