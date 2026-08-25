// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The banner's Reload action, with feedback for the case that fails.
 *
 * `recover()` returning `false` leaves every other piece of state exactly as it
 * was – same banner, same image, same status – so without this hook a user who
 * presses Reload on a file that is still missing cannot tell whether the click
 * registered at all (QG-11a H4).
 *
 * The failure flag is transient and self-clearing on the same `INDICATOR_DURATION_MS`
 * budget as the "Reloaded from disk" confirmation, so the two read as one
 * mechanism: press the button, get an answer, the answer goes away.
 *
 * @module useReloadAction
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { INDICATOR_DURATION_MS } from '../../../../constants/fileWatch'

/** Options for {@link useReloadAction}. */
export interface UseReloadActionOptions {
  /**
   * Re-checks the file and restarts the watch.
   *
   * Resolves `true` only when auto-refresh is live again; `false` covers both
   * "still not on disk" and "the watch would not restart".
   */
  recover: () => Promise<boolean>
  /** Re-reads the bytes. Called only after a successful recovery. */
  refresh: () => void
}

/** State and actions returned by {@link useReloadAction}. */
export interface UseReloadActionResult {
  /** An attempt is in flight; the button is disabled for its duration. */
  isReloadPending: boolean
  /**
   * The last attempt failed, within the last `INDICATOR_DURATION_MS`.
   *
   * Deliberately not "why it failed": the caller knows the current watch state
   * and can say whether the file is missing or the watch is dead, and reading
   * that at render time avoids racing the state updates `recover` itself makes.
   */
  hasReloadFailed: boolean
  /** Runs one recovery attempt. Re-entrant calls while pending are ignored. */
  reload: () => void
}

/**
 * Wires the Reload button to a recovery attempt and reports the outcome.
 *
 * @param options - The recovery and re-read callbacks
 * @returns Pending state, transient failure flag and the click handler
 *
 * @example
 * ```tsx
 * const { isReloadPending, hasReloadFailed, reload } = useReloadAction({
 *   recover: watch.recover,
 *   refresh
 * })
 *
 * // The caller turns the flag into copy, using the state it already has:
 * const reloadFailure = hasReloadFailed
 *   ? (watch.isFileDeleted ? 'missing' : 'watch')
 *   : null
 * ```
 */
export function useReloadAction(options: UseReloadActionOptions): UseReloadActionResult {
  const { recover, refresh } = options

  const [isReloadPending, setIsReloadPending] = useState(false)
  const [hasReloadFailed, setHasReloadFailed] = useState(false)

  const isMountedRef = useRef(true)
  const failureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPendingRef = useRef(false)

  // Callbacks live in refs so `reload` keeps a stable identity: it is handed to
  // a button that re-renders on every status change.
  const recoverRef = useRef(recover)
  const refreshRef = useRef(refresh)
  useEffect(() => {
    recoverRef.current = recover
    refreshRef.current = refresh
  }, [recover, refresh])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (failureTimerRef.current) {
        clearTimeout(failureTimerRef.current)
        failureTimerRef.current = null
      }
    }
  }, [])

  const reload = useCallback(() => {
    // The button is disabled while pending, but a keyboard repeat or a test can
    // still land a second call before React re-renders.
    if (isPendingRef.current) return
    isPendingRef.current = true

    setIsReloadPending(true)
    // A new attempt supersedes the previous verdict, so the old message goes
    // away immediately rather than lingering over a fresh attempt.
    setHasReloadFailed(false)
    if (failureTimerRef.current) {
      clearTimeout(failureTimerRef.current)
      failureTimerRef.current = null
    }

    void (async () => {
      let recovered = false
      try {
        recovered = await recoverRef.current()
        if (recovered) refreshRef.current()
      } finally {
        isPendingRef.current = false
        if (isMountedRef.current) {
          setIsReloadPending(false)
          if (!recovered) {
            setHasReloadFailed(true)
            failureTimerRef.current = setTimeout(() => {
              failureTimerRef.current = null
              if (isMountedRef.current) setHasReloadFailed(false)
            }, INDICATOR_DURATION_MS)
          }
        }
      }
    })()
  }, [])

  return { isReloadPending, hasReloadFailed, reload }
}
