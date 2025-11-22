/**
 * useScrollAnomalyRecovery Hook
 *
 * React hook that detects anomalous scroll-to-top events in xterm.js
 * and auto-recovers by scrolling back to bottom.
 *
 * Used to work around Claude Code's Ink library buffer redraws that
 * cause unexpected viewport jumps during streaming output.
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

export interface UseScrollAnomalyRecoveryOptions {
  /** Enable/disable auto-recovery (default: true) */
  enabled?: boolean
  /** Override default configuration */
  config?: Partial<ScrollAnomalyConfig>
  /** Callback when recovery occurs (for telemetry/debugging) */
  onRecovery?: () => void
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
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafIdRef = useRef<number | null>(null)

  // Attach user scroll listeners to .xterm-viewport element
  useEffect(() => {
    if (!enabled || !terminalRef.current) return

    const viewport = terminalRef.current.querySelector(XTERM_VIEWPORT_SELECTOR)
    if (!viewport) return

    const handleUserScroll = () => {
      lastUserScrollTsRef.current = Date.now()
    }

    // wheel and touchmove capture user-initiated scrolls
    // Note: xterm.js onScroll does NOT fire on user scroll (only on programmatic/new lines)
    viewport.addEventListener('wheel', handleUserScroll, { passive: true })
    viewport.addEventListener('touchmove', handleUserScroll, { passive: true })

    return () => {
      viewport.removeEventListener('wheel', handleUserScroll)
      viewport.removeEventListener('touchmove', handleUserScroll)
    }
  }, [enabled, terminalRef])

  // Cleanup RAF and timeout on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      if (recoveryTimeoutRef.current !== null) {
        clearTimeout(recoveryTimeoutRef.current)
      }
    }
  }, [])

  // Wrapper for onData handler that adds anomaly detection
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

        // Check for anomaly AFTER write completes
        // Use requestAnimationFrame to ensure DOM has updated
        rafIdRef.current = requestAnimationFrame(() => {
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
            // Debounce recovery to avoid rapid-fire corrections
            if (recoveryTimeoutRef.current === null) {
              recoveryTimeoutRef.current = setTimeout(() => {
                // Final check that xterm still exists
                if (xtermRef.current) {
                  xtermRef.current.scrollToBottom()
                  onRecovery?.()
                }
                recoveryTimeoutRef.current = null
              }, config.recoveryDebounceMs)
            }
          }
        })
      }
    },
    [enabled, xtermRef, config, onRecovery]
  )

  return { wrapOnDataHandler }
}
