/**
 * useScrollLock - Hook for terminal scroll lock functionality
 *
 * Provides three mechanisms to enforce scroll-to-bottom:
 * 1. Wheel event handler - intercepts mouse wheel scroll-up
 * 2. Keyboard handler wrapper - blocks PageUp/Home/ArrowUp keys
 * 3. Polling watcher - catches scrollbar drag (no native event available)
 */

import { useCallback, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '../stores/useTerminalStore'

/** Keys that scroll terminal up */
const SCROLL_UP_KEYS = new Set(['PageUp', 'ArrowUp', 'Home'])

interface UseScrollLockOptions {
  /** Callback when scroll lock engages (to reset anomaly recovery queue) */
  onLockEngage?: () => void
}

interface UseScrollLockReturn {
  /**
   * Wheel event handler for xterm.attachCustomWheelEventHandler
   * Returns false to block scroll-up when locked, true to allow
   */
  handleWheelEvent: (event: WheelEvent) => boolean

  /**
   * Wraps existing key handler to add scroll-key blocking
   * Checks scroll-lock first, then delegates to original handler
   */
  wrapKeyHandler: (
    originalHandler: (event: KeyboardEvent) => boolean
  ) => (event: KeyboardEvent) => boolean

  /**
   * Start polling watcher for scrollbar drag detection
   * Returns cleanup function - call in useEffect when scrollLocked changes
   */
  startPollingWatcher: () => () => void
}

export function useScrollLock(
  xtermRef: React.RefObject<Terminal | null>,
  options?: UseScrollLockOptions
): UseScrollLockReturn {
  const { onLockEngage } = options ?? {}
  const lastLockStateRef = useRef(false)

  /**
   * Wheel event handler - blocks scroll-up (deltaY < 0) when locked
   */
  const handleWheelEvent = useCallback((event: WheelEvent): boolean => {
    const scrollLocked = useTerminalStore.getState().scrollLocked

    if (!scrollLocked) {
      return true // Allow all scroll when unlocked
    }

    // Detect lock state transition for onLockEngage callback
    if (scrollLocked && !lastLockStateRef.current) {
      lastLockStateRef.current = true
      onLockEngage?.()
    }

    // Block scroll-up (negative deltaY = scrolling up)
    if (event.deltaY < 0) {
      // Force scroll to bottom immediately
      xtermRef.current?.scrollToBottom()
      return false // Block the scroll event
    }

    return true // Allow scroll-down (towards bottom)
  }, [xtermRef, onLockEngage])

  /**
   * Keyboard handler wrapper - blocks scroll-up keys when locked
   * Designed to wrap the existing clipboard handler
   */
  const wrapKeyHandler = useCallback(
    (originalHandler: (event: KeyboardEvent) => boolean) => {
      return (event: KeyboardEvent): boolean => {
        const scrollLocked = useTerminalStore.getState().scrollLocked

        // Check scroll lock first
        if (scrollLocked && SCROLL_UP_KEYS.has(event.key)) {
          // Block scroll-up keys and force to bottom
          xtermRef.current?.scrollToBottom()
          return false
        }

        // Delegate to original handler (clipboard operations)
        return originalHandler(event)
      }
    },
    [xtermRef]
  )

  /**
   * Polling watcher for scrollbar drag detection
   * xterm.js doesn't expose scrollbar events, so we poll viewportY
   */
  const startPollingWatcher = useCallback(() => {
    const POLL_INTERVAL_MS = 100

    const intervalId = setInterval(() => {
      const xterm = xtermRef.current
      const scrollLocked = useTerminalStore.getState().scrollLocked

      if (!xterm || !scrollLocked) return

      const buffer = xterm.buffer.active
      const baseY = buffer.baseY
      const viewportY = buffer.viewportY

      // If viewport is scrolled up from bottom, snap back
      // Use small tolerance (1 line) to avoid micro-adjustments
      if (viewportY < baseY - 1) {
        xterm.scrollToBottom()
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [xtermRef])

  return {
    handleWheelEvent,
    wrapKeyHandler,
    startPollingWatcher
  }
}
