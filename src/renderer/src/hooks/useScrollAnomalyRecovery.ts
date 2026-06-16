// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useScrollAnomalyRecovery Hook
 *
 * React hook that detects anomalous scroll-to-top events in xterm.js
 * and auto-recovers by scrolling back to bottom.
 *
 * Used to work around Claude Code's Ink library buffer redraws that
 * cause unexpected viewport jumps during streaming output.
 *
 * Architecture (issue #22 enhanced fix):
 * - Multiple detection signals: Position-based AND escape sequence detection
 * - Escape sequence detection: Detects \x1b[2J, \x1b[3J BEFORE write
 * - Buffer truncation detection: Detects when baseY shrinks significantly
 * - Fast recovery interval: 100ms instead of 500ms
 * - Immediate recovery: When clear sequences detected, recover immediately
 * - Smart recovery target: Restore reading position, not just scroll to bottom
 * - xterm.js onRender: More reliable than RAF for post-render operations
 *
 * Related: https://github.com/anthropics/claude-code/issues/826
 */

import { useCallback, useEffect, useRef, useMemo } from 'react'
import type { Terminal } from '@xterm/xterm'
import {
  isAnomalousScroll,
  detectClearSequences,
  hasDestructiveClearSequence,
  wasBufferTruncated,
  calculateRecoveryTarget,
  DEFAULT_SCROLL_ANOMALY_CONFIG,
  type ScrollAnomalyConfig,
  type ScrollState,
  type ReadingPosition
} from '../utils/scrollAnomalyDetector'
import { logger } from '../utils/logger'

// User scroll detection listeners attach to the container element directly
// rather than querying xterm.js internal DOM nodes (e.g., .xterm-viewport).
// xterm v6 replaced the native scrollbar with DomScrollableElement, which
// may intercept wheel events before they reach internal elements.

// Keys that indicate user-initiated scroll navigation
const SCROLL_NAVIGATION_KEYS = new Set([
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End'
])

export interface UseScrollAnomalyRecoveryOptions {
  /** Enable/disable auto-recovery (default: true) */
  enabled?: boolean
  /** Override default configuration */
  config?: Partial<ScrollAnomalyConfig>
  /** Callback when recovery occurs (for telemetry/debugging), receives anomaly count */
  onRecovery?: (count: number) => void
  /**
   * Parser handled ref - when true, skip interval recovery this frame.
   * Used to coordinate with useTerminalParserHooks to avoid double-recovery.
   */
  parserHandledRef?: React.MutableRefObject<boolean>
  /**
   * Shared last user scroll timestamp ref – injected from parent for coordination
   * with useTerminalParserHooks. If provided, used instead of creating an internal one.
   * User scroll events still update this ref from within this hook.
   */
  lastUserScrollTsRef?: React.MutableRefObject<number>
}

export interface UseScrollAnomalyRecoveryReturn {
  /**
   * Wrap the onData handler to add anomaly detection
   * @param handler Original data handler that calls xterm.write()
   * @returns Wrapped handler with anomaly detection
   */
  wrapOnDataHandler: <T extends { terminalId: string; data: string }>(
    handler: (data: T) => void
  ) => (data: T) => void

  /**
   * Clear the anomaly queue (issue #22)
   * Call this when scroll lock engages to prevent queued anomalies from triggering recovery
   */
  resetQueue: () => void

  /**
   * Reset all tracking state (call on terminal/project change)
   */
  resetAll: () => void

  /**
   * Last user scroll timestamp ref – reflects the active ref (injected or internal).
   * Parser hooks use this to avoid restoring position when user recently scrolled.
   */
  lastUserScrollTsRef: React.MutableRefObject<number>
}

/**
 * Hook for detecting and recovering from scroll anomalies
 *
 * Architecture (issue #22 enhanced fix):
 * - Multiple detection signals: Position-based + escape sequence detection
 * - Escape sequence detection: Detects \x1b[2J, \x1b[3J BEFORE write
 * - Buffer truncation detection: Detects when baseY shrinks significantly
 * - Fast recovery interval: 100ms instead of 500ms
 * - Immediate recovery: When clear sequences detected, recover immediately
 * - Smart recovery target: Restore reading position, not just scroll to bottom
 * - Keyboard scroll detection: Page Up/Down, arrows mark user scroll
 *
 * @param xtermRef Ref to xterm Terminal instance
 * @param terminalRef Ref to terminal container div (for attaching scroll listeners)
 * @param options Configuration options
 * @returns Object with wrapOnDataHandler function
 *
 * @example
 * ```tsx
 * const { wrapOnDataHandler } = useScrollAnomalyRecovery(xtermRef, terminalRef)
 *
 * const wrappedHandler = wrapOnDataHandler((data) => {
 *   if (data.terminalId === terminalId && xtermRef.current) {
 *     xtermRef.current.write(data.data)
 *   }
 * })
 *
 * const unsubscribe = window.api.terminal.onData(wrappedHandler)
 * ```
 */
export function useScrollAnomalyRecovery(
  xtermRef: React.RefObject<Terminal | null>,
  terminalRef: React.RefObject<HTMLDivElement | null>,
  options: UseScrollAnomalyRecoveryOptions = {}
): UseScrollAnomalyRecoveryReturn {
  const {
    enabled = true,
    config: configOverrides,
    onRecovery,
    parserHandledRef,
    lastUserScrollTsRef: injectedLastUserScrollTsRef
  } = options

  // Merge config with defaults
  const config = useMemo<ScrollAnomalyConfig>(
    () => ({
      ...DEFAULT_SCROLL_ANOMALY_CONFIG,
      ...configOverrides
    }),
    [configOverrides]
  )

  // Internal ref as fallback when no shared ref is injected
  const internalLastUserScrollTsRef = useRef(0)
  // Use injected ref if provided (shared with parser hooks), otherwise internal
  const lastUserScrollTsRef = injectedLastUserScrollTsRef ?? internalLastUserScrollTsRef
  const lastDataTsRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)

  // Issue #22 Enhanced: Fixed-interval queue approach
  // Anomalies are counted, and every recoveryIntervalMs we check if count > 0
  const anomalyCountRef = useRef(0)
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Issue #22 Enhanced: Immediate recovery flag for clear sequences
  const immediateRecoveryRef = useRef(false)

  // Issue #22 Enhanced: Track reading position for smart recovery
  const lastReadingPositionRef = useRef<ReadingPosition | null>(null)

  // Issue #22 Enhanced: Track clear sequence timestamps for rapid redraw detection
  const clearSequenceTimestampsRef = useRef<number[]>([])

  // Issue #22 Enhanced: Track baseY for buffer truncation detection
  const lastBaseYRef = useRef<number>(0)

  // Store refs for use in interval callback (avoids stale closure)
  const xtermRefStable = useRef(xtermRef)
  const onRecoveryRef = useRef(onRecovery)
  const configRef = useRef(config)

  useEffect(() => {
    xtermRefStable.current = xtermRef
  }, [xtermRef])

  useEffect(() => {
    onRecoveryRef.current = onRecovery
  }, [onRecovery])

  useEffect(() => {
    configRef.current = config
  }, [config])

  // Attach user scroll listeners to the container element directly
  useEffect(() => {
    const container = terminalRef.current
    if (!enabled || !container) return

    const handleUserScroll = () => {
      lastUserScrollTsRef.current = Date.now()
    }

    // Handle keyboard navigation (Page Up/Down, arrows, Home/End)
    const handleKeyScroll = (e: Event) => {
      const keyEvent = e as KeyboardEvent
      if (SCROLL_NAVIGATION_KEYS.has(keyEvent.key)) {
        lastUserScrollTsRef.current = Date.now()
      }
    }

    // wheel and touchmove capture user-initiated scrolls
    // Note: xterm.js onScroll does NOT fire on user scroll (only on programmatic/new lines)
    container.addEventListener('wheel', handleUserScroll, { passive: true })
    container.addEventListener('touchmove', handleUserScroll, { passive: true })
    // Issue #22: Add keyboard scroll detection
    container.addEventListener('keydown', handleKeyScroll, { passive: true })

    return () => {
      container.removeEventListener('wheel', handleUserScroll)
      container.removeEventListener('touchmove', handleUserScroll)
      container.removeEventListener('keydown', handleKeyScroll)
    }
  }, [enabled, terminalRef])

  // Issue #22 Enhanced: Perform recovery with smart target positioning
  // This is called by both the interval and immediate recovery paths
  const performRecovery = useCallback((count: number) => {
    const xterm = xtermRefStable.current.current
    if (!xterm) return

    const newBaseY = xterm.buffer.active.baseY

    // Try smart recovery first - restore user's reading position
    const targetY = calculateRecoveryTarget(lastReadingPositionRef.current, newBaseY)

    if (targetY !== null) {
      // Smart recovery: restore to approximate reading position
      xterm.scrollToLine(targetY)
      logger.debug(`[ScrollRecovery] Smart recovery to line ${targetY} (count: ${count})`)
    } else {
      // Fallback: scroll to bottom
      xterm.scrollToBottom()
      logger.debug(`[ScrollRecovery] Bottom recovery (count: ${count})`)
    }

    // Clear reading position after recovery
    lastReadingPositionRef.current = null

    // Callback for telemetry
    onRecoveryRef.current?.(count)
  }, [])

  // Issue #22 Enhanced: Fixed-interval recovery check + immediate recovery
  // Every recoveryIntervalMs, check if anomalies were queued and recover
  // Parser hooks (when present) handle same-frame recovery via microtask;
  // this interval acts as a fallback for edge cases parser hooks miss
  useEffect(() => {
    if (!enabled) return

    // Track RAF scheduled from interval (separate from data handler RAF)
    let intervalRafId: number | null = null

    intervalIdRef.current = setInterval(() => {
      // Skip if parser hook already handled scroll recovery this frame
      // This prevents double-recovery which could cause scroll position fights
      if (parserHandledRef?.current) {
        // Reset anomaly count since parser already handled it
        anomalyCountRef.current = 0
        immediateRecoveryRef.current = false
        return
      }

      // Check for immediate recovery flag (set when clear sequences detected)
      const needsImmediateRecovery = immediateRecoveryRef.current
      immediateRecoveryRef.current = false

      if (anomalyCountRef.current > 0 || needsImmediateRecovery) {
        // Capture count and reset SYNCHRONOUSLY (before async scroll)
        // This ensures no anomaly is lost during the scroll operation
        const count = Math.max(1, anomalyCountRef.current)
        anomalyCountRef.current = 0

        // Cancel previous interval RAF if still pending (unlikely but defensive)
        if (intervalRafId !== null) {
          cancelAnimationFrame(intervalRafId)
        }

        // Scroll asynchronously via RAF
        intervalRafId = requestAnimationFrame(() => {
          intervalRafId = null
          performRecovery(count)
        })
      }
    }, config.recoveryIntervalMs)

    return () => {
      // Cleanup interval
      if (intervalIdRef.current !== null) {
        clearInterval(intervalIdRef.current)
        intervalIdRef.current = null
      }
      // Cleanup any pending RAF from interval
      if (intervalRafId !== null) {
        cancelAnimationFrame(intervalRafId)
      }
      // Cleanup any pending RAF from data handler
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [enabled, config.recoveryIntervalMs, performRecovery])

  // Wrapper for onData handler that adds anomaly detection
  // Note: Refs (lastUserScrollTsRef, lastDataTsRef, rafIdRef, anomalyCountRef) are intentionally
  // excluded from deps - their .current values are accessed at call time, not capture time,
  // and ref identity is stable across re-renders
  const wrapOnDataHandler = useCallback(
    <T extends { terminalId: string; data: string }>(
      originalHandler: (data: T) => void
    ) => {
      return (data: T) => {
        // If disabled or no xterm, just call original handler
        if (!enabled || !xtermRef.current) {
          originalHandler(data)
          return
        }

        const xterm = xtermRef.current
        const buffer = xterm.buffer.active
        const currentConfig = configRef.current

        // Capture position BEFORE write
        const viewportYBefore = buffer.viewportY
        const baseYBefore = buffer.baseY

        // Issue #22 Enhanced: Detect escape sequences BEFORE write
        const escapeSignals = detectClearSequences(data.data)
        const hasDestructiveSequence = hasDestructiveClearSequence(escapeSignals)

        // Track clear sequence timestamps for rapid redraw detection
        if (hasDestructiveSequence) {
          const now = Date.now()
          clearSequenceTimestampsRef.current.push(now)
          // Keep only recent timestamps (last 1 second)
          clearSequenceTimestampsRef.current = clearSequenceTimestampsRef.current.filter(
            (t) => now - t < 1000
          )
        }

        // Issue #22 Enhanced: Save reading position BEFORE potential buffer clear
        // Only save if user is NOT at the bottom (they're reading back in history)
        const isAtBottom = viewportYBefore >= baseYBefore - 3
        if (!isAtBottom && hasDestructiveSequence) {
          lastReadingPositionRef.current = {
            viewportY: viewportYBefore,
            baseY: baseYBefore,
            timestamp: Date.now()
          }
        }

        // Update baseY tracking
        lastBaseYRef.current = baseYBefore

        // Mark data activity timestamp
        lastDataTsRef.current = Date.now()

        // Call original handler (which calls xterm.write)
        try {
          originalHandler(data)
        } catch (err) {
          logger.error('[ScrollRecovery] Handler error:', err instanceof Error ? err : undefined)
          return // Skip anomaly detection on error
        }

        // Issue #22 Enhanced: Trigger immediate recovery for clear sequences
        if (hasDestructiveSequence && currentConfig.immediateRecoveryOnClear) {
          immediateRecoveryRef.current = true
          logger.debug('[ScrollRecovery] Clear sequence detected, scheduling immediate recovery')
        }

        // Cancel previous RAF if still pending (prevents overlapping callbacks)
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current)
        }

        // Check for anomaly AFTER write completes
        // Use requestAnimationFrame to ensure DOM has updated
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null // Mark as completed

          // Re-check xterm ref in case component unmounted
          if (!xtermRef.current) return

          const bufferAfter = xtermRef.current.buffer.active
          const viewportYAfter = bufferAfter.viewportY
          const baseYAfter = bufferAfter.baseY
          const currentTs = Date.now()

          // Issue #22 Enhanced: Check for buffer truncation
          const bufferWasTruncated = wasBufferTruncated(
            baseYBefore,
            baseYAfter,
            currentConfig.bufferTruncationThreshold
          )

          if (bufferWasTruncated) {
            logger.debug(`[ScrollRecovery] Buffer truncated: ${baseYBefore} -> ${baseYAfter}`)
            // Buffer was cleared - trigger recovery
            anomalyCountRef.current++
            return
          }

          // Standard position-based anomaly detection
          const state: ScrollState = {
            lastUserScrollTs: lastUserScrollTsRef.current,
            lastDataTs: lastDataTsRef.current,
            viewportYBefore,
            viewportYAfter,
            baseY: baseYBefore,
            currentTs
          }

          if (isAnomalousScroll(state, currentConfig)) {
            // Issue #22: Queue the anomaly instead of immediate recovery
            // The fixed-interval check will handle recovery
            anomalyCountRef.current++
          }
        })
      }
    },
    [enabled, xtermRef]
  )

  // Issue #22: Clear the anomaly queue when scroll lock engages
  // This prevents queued anomalies from triggering recovery while user is locked
  const resetQueue = useCallback(() => {
    anomalyCountRef.current = 0
  }, [])

  // Issue #22 Enhanced: Reset all tracking state (call on terminal/project change)
  // Note: zeroes the shared lastUserScrollTsRef, affecting both this hook and parser hooks
  const resetAll = useCallback(() => {
    anomalyCountRef.current = 0
    immediateRecoveryRef.current = false
    lastReadingPositionRef.current = null
    clearSequenceTimestampsRef.current = []
    lastBaseYRef.current = 0
    lastUserScrollTsRef.current = 0
    lastDataTsRef.current = 0
  }, [])

  return { wrapOnDataHandler, resetQueue, resetAll, lastUserScrollTsRef }
}
