// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useScrollLock - Hook for terminal scroll lock functionality
 *
 * Provides three mechanisms to enforce scroll-to-bottom:
 * 1. Wheel event handler - intercepts mouse wheel scroll-up
 * 2. Keyboard handler wrapper - blocks PageUp/Home/ArrowUp keys
 * 3. Polling watcher - catches scrollbar drag (no native event available)
 *
 * @requires xterm.js 6.x+ (uses buffer.active.viewportY/baseY APIs)
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'

// ============================================================================
// Configuration Constants (OCP: extracted for discoverability and potential override)
// ============================================================================

/** Default keys that scroll terminal up */
const DEFAULT_SCROLL_UP_KEYS = ['PageUp', 'ArrowUp', 'Home']

/** Default polling interval for scrollbar drag detection (ms) */
const DEFAULT_POLLING_INTERVAL_MS = 100

/** Default tolerance for scroll position detection (lines) */
const DEFAULT_SCROLL_TOLERANCE_LINES = 1

// ============================================================================
// Interfaces (ISP: minimal terminal interface for DIP compliance)
// ============================================================================

/**
 * Minimal terminal interface required by scroll lock
 * Abstracts xterm.js dependency for testability (DIP)
 */
export interface IScrollableTerminal {
  scrollToBottom(): void
  buffer: {
    active: {
      viewportY: number
      baseY: number
    }
  }
}

/**
 * State accessor interface for dependency injection (DIP)
 * Decouples hook from specific store implementation
 */
export interface ScrollLockStateAccessor {
  /** Get current scroll lock state */
  getScrollLocked: () => boolean
}

/**
 * Configuration options for scroll lock behavior (OCP: extensible)
 */
export interface UseScrollLockConfig {
  /** Keys that trigger scroll-up blocking (default: PageUp, ArrowUp, Home) */
  scrollUpKeys?: string[]
  /** Polling interval in ms for scrollbar drag detection (default: 100) */
  pollingIntervalMs?: number
  /** Tolerance in lines for scroll position detection (default: 1) */
  scrollToleranceLines?: number
}

/**
 * Callback options for scroll lock events
 */
export interface UseScrollLockCallbacks {
  /** Called when scroll lock engages (e.g., to reset anomaly recovery queue) */
  onLockEngage?: () => void
}

/**
 * Combined options interface
 */
export interface UseScrollLockOptions extends UseScrollLockConfig, UseScrollLockCallbacks {}

/**
 * Return type for useScrollLock hook
 */
export interface UseScrollLockReturn {
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

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for terminal scroll lock functionality
 *
 * @param xtermRef - Reference to terminal instance (DIP: uses IScrollableTerminal interface)
 * @param stateAccessor - State accessor for scroll lock state (DIP: injected dependency)
 * @param options - Configuration and callback options (OCP: extensible)
 */
export function useScrollLock(
  xtermRef: React.RefObject<IScrollableTerminal | null>,
  stateAccessor: ScrollLockStateAccessor,
  options?: UseScrollLockOptions
): UseScrollLockReturn {
  // Destructure options with defaults (OCP: configurable)
  const {
    scrollUpKeys = DEFAULT_SCROLL_UP_KEYS,
    pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
    scrollToleranceLines = DEFAULT_SCROLL_TOLERANCE_LINES,
    onLockEngage
  } = options ?? {}

  // Create Set for O(1) key lookup (memoized to avoid recreation on every render)
  const scrollUpKeysSet = useMemo(() => new Set(scrollUpKeys), [scrollUpKeys])

  // Track lock state transitions for onLockEngage callback
  const lastLockStateRef = useRef(false)

  // Reset lock state ref on unmount to ensure onLockEngage fires correctly on remount
  useEffect(() => {
    return () => {
      lastLockStateRef.current = false
    }
  }, [])

  /**
   * Centralized scroll lock check (Shotgun Surgery fix)
   * Single point of access for scroll lock state
   */
  const checkScrollLocked = useCallback((): boolean => {
    return stateAccessor.getScrollLocked()
  }, [stateAccessor])

  /**
   * Detect and handle lock state transitions
   * Extracted to avoid divergent change in handlers (SRP)
   */
  const handleLockTransition = useCallback((isLocked: boolean): void => {
    if (isLocked && !lastLockStateRef.current) {
      lastLockStateRef.current = true
      onLockEngage?.()
    } else if (!isLocked) {
      lastLockStateRef.current = false
    }
  }, [onLockEngage])

  /**
   * Wheel event handler - blocks scroll-up (deltaY < 0) when locked
   */
  const handleWheelEvent = useCallback((event: WheelEvent): boolean => {
    const scrollLocked = checkScrollLocked()
    handleLockTransition(scrollLocked)

    if (!scrollLocked) {
      return true // Allow all scroll when unlocked
    }

    // Block scroll-up (negative deltaY = scrolling up)
    if (event.deltaY < 0) {
      xtermRef.current?.scrollToBottom()
      return false // Block the scroll event
    }

    return true // Allow scroll-down (towards bottom)
  }, [xtermRef, checkScrollLocked, handleLockTransition])

  /**
   * Keyboard handler wrapper - blocks scroll-up keys when locked
   * Designed to wrap the existing clipboard handler
   */
  const wrapKeyHandler = useCallback(
    (originalHandler: (event: KeyboardEvent) => boolean) => {
      return (event: KeyboardEvent): boolean => {
        const scrollLocked = checkScrollLocked()

        // Check scroll lock first
        if (scrollLocked && scrollUpKeysSet.has(event.key)) {
          xtermRef.current?.scrollToBottom()
          return false
        }

        // Delegate to original handler (clipboard operations)
        return originalHandler(event)
      }
    },
    [xtermRef, checkScrollLocked, scrollUpKeysSet]
  )

  /**
   * Polling watcher for scrollbar drag detection
   * xterm.js doesn't expose scrollbar events, so we poll viewportY
   */
  const startPollingWatcher = useCallback(() => {
    const intervalId = setInterval(() => {
      const xterm = xtermRef.current
      const scrollLocked = checkScrollLocked()

      if (!xterm || !scrollLocked) return

      const buffer = xterm.buffer.active
      const baseY = buffer.baseY
      const viewportY = buffer.viewportY

      // If viewport is scrolled up from bottom, snap back
      if (viewportY < baseY - scrollToleranceLines) {
        xterm.scrollToBottom()
      }
    }, pollingIntervalMs)

    return () => clearInterval(intervalId)
  }, [xtermRef, checkScrollLocked, pollingIntervalMs, scrollToleranceLines])

  return {
    handleWheelEvent,
    wrapKeyHandler,
    startPollingWatcher
  }
}
