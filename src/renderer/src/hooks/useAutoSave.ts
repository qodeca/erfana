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
 * What an `onSave` callback answers. `false` means the write failed: autosave
 * then backs off (no further max-interval save) until the next
 * `signalChange`; a rejection counts the same. Anything else, including no
 * answer, counts as done. `onSave` reports its own errors: autosave does not
 * log or rethrow a rejection.
 */
export type AutoSaveResult = void | boolean

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
  /**
   * Hold auto-save: cancel the pending timers and keep every later arming
   * (`signalChange`, the modified-state effect) from starting one, until the
   * returned release is called. The release re-arms the timers when the
   * content is still modified. Safe to release more than once.
   */
  holdAutoSave: () => () => void
}

/**
 * Hook for auto-saving content with true debouncing and max interval failsafe.
 *
 * Uses two complementary timers:
 * - **Debounce timer**: Resets on each `signalChange()` call. Fires `delay` ms
 *   after the last content change. Provides responsive "save after idle" behavior.
 * - **Max interval timer**: Started when `isModified` becomes true, and re-armed
 *   by every save that starts while it is still true. Fires after
 *   `maxInterval` ms regardless of debounce resets. Prevents data loss during
 *   continuous typing sessions.
 *
 * Whichever timer fires first clears both and triggers the save.
 *
 * A save that fails (`onSave` answers `false` or rejects) is not retried on a
 * timer: a write that failed once (a missing folder, a full disk) would
 * otherwise fail again every `maxInterval`, with a toast each time. The next
 * `signalChange` (the user edits again) re-arms both timers.
 *
 * @param isModified - Whether the content has unsaved changes
 * @param onSave - Callback to execute when auto-save triggers; answer `false`
 *   for a failed write (see {@link AutoSaveResult})
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
  onSave: () => AutoSaveResult | Promise<AutoSaveResult>,
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

  // Set while a hold is active (see holdAutoSave); checked wherever a timer is armed.
  const heldRef = useRef(false)

  // Set after a failed save: the max-interval timer stays off until the next
  // signalChange. Cleared wherever that timer is armed.
  const backedOffRef = useRef(false)
  // Counts saves, so a failure answered late never backs off a newer save
  const saveSeqRef = useRef(0)
  // The current triggerSave, for the failsafe timer it re-arms (set below)
  const triggerSaveRef = useRef<() => void>(() => {})

  const delayRef = useRef(delay)
  useEffect(() => {
    delayRef.current = delay
  }, [delay])

  const maxIntervalRef = useRef(maxInterval)
  useEffect(() => {
    maxIntervalRef.current = maxInterval
  }, [maxInterval])

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
   *
   * The max interval timer is re-armed here, not only by the modified-state
   * effect: when the save settles `modified` false and a keystroke sets it
   * true again in the same batch, `isModified` never changes, the effect
   * never re-runs, and continuous typing would get no further max-interval
   * save. A save that does leave the content clean turns `isModified` false,
   * and the effect then cancels this timer. A save that fails cancels it too
   * and backs off until the next signalChange (see {@link AutoSaveResult}).
   */
  const triggerSave = useCallback(() => {
    clearDebounceTimer()
    clearMaxIntervalTimer()
    backedOffRef.current = false
    // `!heldRef.current` is defensive: a hold cancels every timer, so no
    // timer that calls this should fire while one is active
    if (
      enabledRef.current &&
      isModifiedRef.current &&
      !heldRef.current &&
      maxIntervalRef.current > 0
    ) {
      // Through the ref: a callback cannot name itself before it is declared
      maxIntervalTimerRef.current = setTimeout(() => triggerSaveRef.current(), maxIntervalRef.current)
    }
    const save = ++saveSeqRef.current
    const backOff = (): void => {
      if (save !== saveSeqRef.current) return
      clearMaxIntervalTimer()
      backedOffRef.current = true
    }
    Promise.resolve(onSaveRef.current()).then(
      (result) => {
        if (result === false) backOff()
      },
      // A rejection is a failed save too. The caller reports its own errors
      // (the panel's save toasts and answers `false`, it never rejects).
      backOff
    )
  }, [clearDebounceTimer, clearMaxIntervalTimer])
  useEffect(() => {
    triggerSaveRef.current = triggerSave
  }, [triggerSave])

  /**
   * Signal a content change to reset the debounce timer.
   *
   * Call this on each content change (keystroke) to get true debounce behavior.
   * The timer fires `delay` ms after the LAST call. The max interval timer
   * is not affected – it runs independently as a safety net – except after a
   * failed save, when this is what re-arms it.
   *
   * No-op when disabled or when the file is not yet marked as modified
   * (the useEffect handles the initial modified: false→true transition).
   */
  const signalChange = useCallback(() => {
    if (!enabledRef.current || !isModifiedRef.current || heldRef.current) return
    clearDebounceTimer()
    debounceTimerRef.current = setTimeout(() => {
      triggerSave()
    }, delayRef.current)
    if (backedOffRef.current && maxIntervalRef.current > 0) {
      backedOffRef.current = false
      clearMaxIntervalTimer()
      maxIntervalTimerRef.current = setTimeout(() => {
        triggerSave()
      }, maxIntervalRef.current)
    }
  }, [clearDebounceTimer, clearMaxIntervalTimer, triggerSave])

  // Manage timer lifecycle based on isModified transitions
  useEffect(() => {
    if (enabled && isModified && !heldRef.current) {
      // isModified just became true (or initial mount with modified content)
      // Start debounce timer (backward compat for consumers not calling signalChange)
      clearDebounceTimer()
      debounceTimerRef.current = setTimeout(() => {
        triggerSave()
      }, delay)

      // Start max interval timer if configured
      backedOffRef.current = false
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

  const holdAutoSave = useCallback((): (() => void) => {
    heldRef.current = true
    cancelAutoSave()
    let released = false
    return () => {
      if (released) return
      released = true
      heldRef.current = false
      if (!enabledRef.current || !isModifiedRef.current) return
      backedOffRef.current = false
      clearDebounceTimer()
      debounceTimerRef.current = setTimeout(() => {
        triggerSave()
      }, delayRef.current)
      if (maxIntervalRef.current > 0) {
        clearMaxIntervalTimer()
        maxIntervalTimerRef.current = setTimeout(() => {
          triggerSave()
        }, maxIntervalRef.current)
      }
    }
  }, [cancelAutoSave, clearDebounceTimer, clearMaxIntervalTimer, triggerSave])

  return {
    isAutoSaving,
    setIsAutoSaving,
    cancelAutoSave,
    signalChange,
    holdAutoSave
  }
}
