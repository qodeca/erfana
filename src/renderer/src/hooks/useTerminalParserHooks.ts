// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useTerminalParserHooks
 *
 * Registers xterm.js parser hooks to intercept scroll-affecting escape sequences
 * BEFORE they affect the viewport, enabling same-frame scroll position restoration.
 *
 * This solves the flicker issue where:
 * - Old approach: Detect sequences → write → SCROLL JUMP VISIBLE → RAF/interval recovery
 * - New approach: Parser intercepts → save position → let execute → restore (microtask, same frame)
 *
 * Key sequences intercepted:
 * - CSI 2 J (ED 2): Clear entire screen - Claude Code Ink library sends this
 * - CSI 3 J (ED 3): Clear scrollback buffer - Claude Code Ink library sends this
 *
 * References:
 * - https://xtermjs.org/docs/guides/hooks/
 * - https://github.com/anthropics/claude-code/issues/826
 * - https://github.com/xtermjs/xterm.js/issues/1727
 */

import { useCallback, useRef, useEffect } from 'react'
import type { Terminal, IDisposable } from '@xterm/xterm'

// User scroll cooldown - don't restore if user scrolled within this window
const USER_SCROLL_COOLDOWN_MS = 300

// Note: ED2+ED3 coalescing is handled by restorationPendingRef (no timer needed)

export interface ParserHookOptions {
  /** Enable/disable parser hooks (default: true) */
  enabled?: boolean
  /** Callback when ED sequence is intercepted (for debugging/telemetry) */
  onIntercept?: (type: 'ED2' | 'ED3') => void
  /** Last user scroll timestamp ref - shared with useScrollAnomalyRecovery */
  lastUserScrollTsRef?: React.MutableRefObject<number>
}

export interface ParserHookReturn {
  /**
   * Register parser hooks on a terminal instance.
   * Call this after xterm.open() and store the disposables for cleanup.
   * @returns Array of IDisposable to clean up on unmount
   */
  registerHooks: (terminal: Terminal) => IDisposable[]

  /**
   * Flag indicating parser hook handled scroll recovery this frame.
   * Used to coordinate with useScrollAnomalyRecovery to avoid double-recovery.
   */
  parserHandledRef: React.MutableRefObject<boolean>
}

/**
 * Hook for registering xterm.js parser hooks that intercept ED sequences
 * and restore scroll position in the same frame via queueMicrotask.
 *
 * @example
 * ```tsx
 * const { registerHooks, parserHandledRef } = useTerminalParserHooks({
 *   enabled: true,
 *   lastUserScrollTsRef
 * })
 *
 * // After xterm.open()
 * const parserDisposables = registerHooks(xterm)
 *
 * // Pass parserHandledRef to useScrollAnomalyRecovery for coordination
 *
 * // On cleanup
 * parserDisposables.forEach(d => d.dispose())
 * ```
 */
export function useTerminalParserHooks(
  options: ParserHookOptions = {}
): ParserHookReturn {
  const { enabled = true, onIntercept, lastUserScrollTsRef } = options

  // Flag to coordinate with useScrollAnomalyRecovery
  const parserHandledRef = useRef(false)

  // Track if we're in a restoration microtask
  const restorationPendingRef = useRef(false)

  // Store options refs for stable callback
  const onInterceptRef = useRef(onIntercept)
  const lastUserScrollTsRefStable = useRef(lastUserScrollTsRef)

  useEffect(() => {
    onInterceptRef.current = onIntercept
  }, [onIntercept])

  useEffect(() => {
    lastUserScrollTsRefStable.current = lastUserScrollTsRef
  }, [lastUserScrollTsRef])

  const registerHooks = useCallback(
    (terminal: Terminal): IDisposable[] => {
      if (!enabled) {
        return []
      }

      const disposables: IDisposable[] = []

      /**
       * Restore scroll position via queueMicrotask for same-frame execution.
       * Uses debouncing to handle ED2 + ED3 sent in quick succession.
       */
      const scheduleRestore = (
        savedViewportY: number,
        savedBaseY: number,
        type: 'ED2' | 'ED3'
      ) => {
        // Coalesce rapid ED2+ED3 in the same microtask batch
        if (restorationPendingRef.current) {
          return
        }

        restorationPendingRef.current = true

        // Use microtask for true same-frame restoration (no setTimeout delay)
        queueMicrotask(() => {
          try {
            // Check if user scrolled recently – respect their position
            const lastUserScrollTs = lastUserScrollTsRefStable.current?.current ?? 0
            if (Date.now() - lastUserScrollTs < USER_SCROLL_COOLDOWN_MS) {
              return
            }

            const buffer = terminal.buffer.active
            const newBaseY = buffer.baseY

            // Only restore if we had meaningful scroll position
            if (savedViewportY > 0 || savedBaseY > 0) {
              // Calculate proportional position in new buffer
              // If user was at bottom, stay at bottom
              const wasAtBottom = savedViewportY >= savedBaseY - 3

              if (wasAtBottom || newBaseY === 0) {
                terminal.scrollToBottom()
              } else {
                // Try to restore relative position from bottom
                const linesFromBottom = savedBaseY - savedViewportY
                const targetY = Math.max(0, newBaseY - linesFromBottom)
                terminal.scrollToLine(targetY)
              }

              // Mark that parser handled this frame
              parserHandledRef.current = true

              // Reset flag after frame completes
              requestAnimationFrame(() => {
                parserHandledRef.current = false
              })
            }

            onInterceptRef.current?.(type)
          } finally {
            restorationPendingRef.current = false
          }
        })
      }

      /**
       * Register CSI handler for 'J' (Erase in Display)
       *
       * ED sequences:
       * - CSI 0 J: Clear from cursor to end of screen
       * - CSI 1 J: Clear from cursor to beginning of screen
       * - CSI 2 J: Clear entire screen (keeps scrollback)
       * - CSI 3 J: Clear entire screen AND scrollback
       *
       * We intercept ED 2 and ED 3 which cause viewport jumps.
       */
      const edHandler = terminal.parser.registerCsiHandler(
        { final: 'J' },
        (params) => {
          // Get the parameter (0 if not specified)
          const param = Array.isArray(params[0]) ? params[0][0] : (params[0] ?? 0)

          // Only intercept ED 2 (clear screen) and ED 3 (clear scrollback)
          if (param === 2 || param === 3) {
            // Capture scroll position BEFORE the sequence executes
            const buffer = terminal.buffer.active
            const savedViewportY = buffer.viewportY
            const savedBaseY = buffer.baseY

            // Schedule restoration via microtask
            scheduleRestore(
              savedViewportY,
              savedBaseY,
              param === 2 ? 'ED2' : 'ED3'
            )
          }

          // Return false to let the sequence execute normally
          // (we're just intercepting to save position, not blocking)
          return false
        }
      )

      disposables.push(edHandler)

      return disposables
    },
    [enabled]
  )

  return { registerHooks, parserHandledRef }
}

// === Pure logic functions for testing ===

/**
 * Check if ED parameter indicates a scroll-affecting clear
 */
export function isScrollAffectingED(param: number): boolean {
  return param === 2 || param === 3
}

/**
 * Calculate target scroll position after buffer clear
 */
export function calculateRestoredPosition(
  savedViewportY: number,
  savedBaseY: number,
  newBaseY: number
): { scrollToBottom: boolean; targetY: number } {
  // If user was at or near bottom, scroll to bottom
  const wasAtBottom = savedViewportY >= savedBaseY - 3

  if (wasAtBottom || newBaseY === 0) {
    return { scrollToBottom: true, targetY: newBaseY }
  }

  // Preserve distance from bottom
  const linesFromBottom = savedBaseY - savedViewportY
  const targetY = Math.max(0, newBaseY - linesFromBottom)

  return { scrollToBottom: false, targetY }
}

/**
 * Check if user scroll should prevent restoration
 */
export function shouldSkipRestoration(
  lastUserScrollTs: number,
  currentTs: number,
  cooldownMs: number = USER_SCROLL_COOLDOWN_MS
): boolean {
  return currentTs - lastUserScrollTs < cooldownMs
}
