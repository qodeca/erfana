/**
 * useScrollAnomalyRecovery Hook
 *
 * React hook that detects anomalous scroll-to-top events in xterm.js
 * and auto-recovers by scrolling back to bottom.
 *
 * Used to work around Claude Code's Ink library buffer redraws that
 * cause unexpected viewport jumps during streaming output.
 *
 * Architecture (issue #22 fix):
 * - Fixed-interval queue: Anomalies are queued (counted) continuously
 * - Every 500ms: If queue > 0, reset counter sync, scroll async via RAF
 * - No anomaly lost: Counter reset happens before async scroll
 * - Keyboard scroll detection: Page Up/Down, arrows prevent recovery
 *
 * Related: https://github.com/anthropics/claude-code/issues/826
 */

import { useCallback, useEffect, useRef, useMemo } from 'react'
import type { Terminal } from '@xterm/xterm'
import {
  isAnomalousScroll,
  DEFAULT_SCROLL_ANOMALY_CONFIG,
  type ScrollAnomalyConfig,
  type ScrollState
} from '../utils/scrollAnomalyDetector'

// xterm.js internal class name - may change in future versions
const XTERM_VIEWPORT_SELECTOR = '.xterm-viewport'

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
}

/**
 * Hook for detecting and recovering from scroll anomalies
 *
 * Architecture (issue #22 fix):
 * - Fixed-interval queue: Anomalies are queued (counted) continuously
 * - Every recoveryIntervalMs (500ms): If queue > 0, reset counter sync, scroll async via RAF
 * - No anomaly lost: Counter reset happens before async scroll
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
  const { enabled = true, config: configOverrides, onRecovery } = options

  // Merge config with defaults
  const config = useMemo<ScrollAnomalyConfig>(
    () => ({
      ...DEFAULT_SCROLL_ANOMALY_CONFIG,
      ...configOverrides
    }),
    [configOverrides]
  )

  // Refs for tracking state without causing re-renders
  const lastUserScrollTsRef = useRef(0)
  const lastDataTsRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)

  // Issue #22: Fixed-interval queue approach
  // Anomalies are counted, and every recoveryIntervalMs we check if count > 0
  const anomalyCountRef = useRef(0)
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Store refs for use in interval callback (avoids stale closure)
  const xtermRefStable = useRef(xtermRef)
  const onRecoveryRef = useRef(onRecovery)

  useEffect(() => {
    xtermRefStable.current = xtermRef
  }, [xtermRef])

  useEffect(() => {
    onRecoveryRef.current = onRecovery
  }, [onRecovery])

  // Attach user scroll listeners to .xterm-viewport element
  useEffect(() => {
    if (!enabled || !terminalRef.current) return

    const viewport = terminalRef.current.querySelector(XTERM_VIEWPORT_SELECTOR)
    if (!viewport) return

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
    viewport.addEventListener('wheel', handleUserScroll, { passive: true })
    viewport.addEventListener('touchmove', handleUserScroll, { passive: true })
    // Issue #22: Add keyboard scroll detection
    viewport.addEventListener('keydown', handleKeyScroll, { passive: true })

    return () => {
      viewport.removeEventListener('wheel', handleUserScroll)
      viewport.removeEventListener('touchmove', handleUserScroll)
      viewport.removeEventListener('keydown', handleKeyScroll)
    }
  }, [enabled, terminalRef])

  // Issue #22: Fixed-interval recovery check
  // Every recoveryIntervalMs, check if anomalies were queued and recover
  useEffect(() => {
    if (!enabled) return

    // Track RAF scheduled from interval (separate from data handler RAF)
    let intervalRafId: number | null = null

    intervalIdRef.current = setInterval(() => {
      if (anomalyCountRef.current > 0) {
        // Capture count and reset SYNCHRONOUSLY (before async scroll)
        // This ensures no anomaly is lost during the scroll operation
        const count = anomalyCountRef.current
        anomalyCountRef.current = 0

        // Cancel previous interval RAF if still pending (unlikely but defensive)
        if (intervalRafId !== null) {
          cancelAnimationFrame(intervalRafId)
        }

        // Scroll asynchronously via RAF
        intervalRafId = requestAnimationFrame(() => {
          intervalRafId = null
          const xterm = xtermRefStable.current.current
          if (xterm) {
            xterm.scrollToBottom()
            onRecoveryRef.current?.(count)
          }
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
  }, [enabled, config.recoveryIntervalMs])

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

        // Capture position BEFORE write
        const viewportYBefore = buffer.viewportY
        const baseY = buffer.baseY

        // Mark data activity timestamp
        lastDataTsRef.current = Date.now()

        // Call original handler (which calls xterm.write)
        try {
          originalHandler(data)
        } catch (err) {
          console.error('[ScrollRecovery] Handler error:', err)
          return // Skip anomaly detection on error
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

          const viewportYAfter = xtermRef.current.buffer.active.viewportY
          const currentTs = Date.now()

          const state: ScrollState = {
            lastUserScrollTs: lastUserScrollTsRef.current,
            lastDataTs: lastDataTsRef.current,
            viewportYBefore,
            viewportYAfter,
            baseY,
            currentTs
          }

          if (isAnomalousScroll(state, config)) {
            // Issue #22: Queue the anomaly instead of immediate recovery
            // The fixed-interval check will handle recovery
            anomalyCountRef.current++
          }
        })
      }
    },
    [enabled, xtermRef, config]
  )

  return { wrapOnDataHandler }
}
