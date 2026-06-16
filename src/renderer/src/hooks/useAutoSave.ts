// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Auto-save Hook for Markdown Editor
 *
 * Provides true debounced auto-save with a maximum interval failsafe.
 * The debounce timer resets on each content change (via signalChange),
 * firing only after the user stops editing for the specified delay.
 * The max interval timer guarantees periodic saves during continuous
 * editing to prevent data loss.
 *
 * @module useAutoSave
 */

import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Configuration options for useAutoSave hook
 */
export interface UseAutoSaveOptions {
  /** Delay in milliseconds before auto-save triggers after last change (default: 2000) */
  delay?: number
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean
  /** Maximum interval in milliseconds between saves during continuous editing (default: 30000). Set 0 to disable. */
  maxInterval?: number
}

/**
 * Return type for useAutoSave hook
 */
export interface UseAutoSaveReturn {
  /** Whether an auto-save is currently in progress */
  isAutoSaving: boolean
  /** Set the auto-saving state (for external control) */
  setIsAutoSaving: (value: boolean) => void
  /** Cancel any pending auto-save (debounce + max interval) */
  cancelAutoSave: () => void
  /** Signal a content change to reset the debounce timer. Call on each keystroke. */
  signalChange: () => void
}

/**
 * Hook for auto-saving content with true debouncing and max interval failsafe.
 *
 * Uses two complementary timers:
 * - **Debounce timer**: Resets on each `signalChange()` call. Fires `delay` ms
 *   after the last content change. Provides responsive "save after idle" behavior.
 * - **Max interval timer**: Started when `isModified` becomes true. Fires after
 *   `maxInterval` ms regardless of debounce resets. Prevents data loss during
 *   continuous typing sessions.
 *
 * Whichever timer fires first clears both and triggers the save.
 *
 * @param isModified - Whether the content has unsaved changes
 * @param onSave - Callback to execute when auto-save triggers
 * @param options - Configuration options
 * @returns Auto-save state and controls
 *
 * @example
 * ```tsx
 * function Editor({ content, onSave }) {
 *   const [isModified, setIsModified] = useState(false)
 *
 *   const { isAutoSaving, signalChange } = useAutoSave(
 *     isModified,
 *     async () => {
 *       await saveContent(content)
 *       setIsModified(false)
 *     },
 *     { delay: 2000, maxInterval: 30000 }
 *   )
 *
 *   return (
 *     <div>
 *       {isAutoSaving && <span>Auto-saving...</span>}
 *       <textarea onChange={(e) => {
 *         setContent(e.target.value)
 *         setIsModified(true)
 *         signalChange()
 *       }} />
 *     </div>
 *   )
 * }
 * ```
 */
export function useAutoSave(
  isModified: boolean,
  onSave: () => void | Promise<void>,
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn {
  const { delay = 2000, enabled = true, maxInterval = 30000 } = options

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const maxIntervalTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Use useState instead of useRef for isAutoSaving to trigger re-renders (fixes stale closure bug)
  const [isAutoSaving, setIsAutoSavingState] = useState(false)

  // Use ref pattern to avoid stale closures and infinite re-renders from onSave
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  // Ref mirrors for signalChange – reads current values without closure deps,
  // keeping signalChange identity stable across renders.
  const isModifiedRef = useRef(isModified)
  useEffect(() => {
    isModifiedRef.current = isModified
  }, [isModified])

  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const delayRef = useRef(delay)
  useEffect(() => {
    delayRef.current = delay
  }, [delay])

  /**
   * Clear the debounce timer only
   */
  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  /**
   * Clear the max interval timer only
   */
  const clearMaxIntervalTimer = useCallback(() => {
    if (maxIntervalTimerRef.current) {
      clearTimeout(maxIntervalTimerRef.current)
      maxIntervalTimerRef.current = null
    }
  }, [])

  /**
   * Cancel all pending auto-save timers (debounce + max interval)
   */
  const cancelAutoSave = useCallback(() => {
    clearDebounceTimer()
    clearMaxIntervalTimer()
  }, [clearDebounceTimer, clearMaxIntervalTimer])

  /**
   * Set auto-saving state (for external control)
   */
  const setIsAutoSaving = useCallback((value: boolean) => {
    setIsAutoSavingState(value)
  }, [])

  /**
   * Core save trigger – clears both timers and invokes save.
   * Used by both the debounce and max interval timers.
   */
  const triggerSave = useCallback(() => {
    clearDebounceTimer()
    clearMaxIntervalTimer()
    onSaveRef.current()
  }, [clearDebounceTimer, clearMaxIntervalTimer])

  /**
   * Signal a content change to reset the debounce timer.
   *
   * Call this on each content change (keystroke) to get true debounce behavior.
   * The timer fires `delay` ms after the LAST call. The max interval timer
   * is not affected – it runs independently as a safety net.
   *
   * No-op when disabled or when the file is not yet marked as modified
   * (the useEffect handles the initial modified: false→true transition).
   */
  const signalChange = useCallback(() => {
    if (!enabledRef.current || !isModifiedRef.current) return
    clearDebounceTimer()
    debounceTimerRef.current = setTimeout(() => {
      triggerSave()
    }, delayRef.current)
  }, [clearDebounceTimer, triggerSave])

  // Manage timer lifecycle based on isModified transitions
  useEffect(() => {
    if (enabled && isModified) {
      // isModified just became true (or initial mount with modified content)
      // Start debounce timer (backward compat for consumers not calling signalChange)
      clearDebounceTimer()
      debounceTimerRef.current = setTimeout(() => {
        triggerSave()
      }, delay)

      // Start max interval timer if configured
      if (maxInterval > 0) {
        clearMaxIntervalTimer()
        maxIntervalTimerRef.current = setTimeout(() => {
          triggerSave()
        }, maxInterval)
      }
    } else {
      // Not modified or disabled – clear everything
      cancelAutoSave()
    }

    return cancelAutoSave
  }, [isModified, delay, enabled, maxInterval, cancelAutoSave, clearDebounceTimer, clearMaxIntervalTimer, triggerSave])

  return {
    isAutoSaving,
    setIsAutoSaving,
    cancelAutoSave,
    signalChange
  }
}
