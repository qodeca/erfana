// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Hold back a fast-changing value until its changes pause.
 *
 * @module hooks/useIdleDebouncedValue
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Options for {@link useIdleDebouncedValue}. */
export interface UseIdleDebouncedValueOptions {
  /** Quiet period, in ms, after the last change before the value is released. */
  delayMs: number
  /**
   * Longest a change may wait, in ms, while changes keep coming. Without it a
   * value that changes more often than `delayMs` would never be released.
   * Omit for a pure trailing debounce.
   */
  maxWaitMs?: number
  /**
   * When `false` the hook is a pass-through: every change is returned at once.
   * Switching it on later never returns a value older than the one already
   * shown. Default: `true`.
   */
  enabled?: boolean
}

/** What {@link useIdleDebouncedValue} returns. */
export interface IdleDebouncedValue<T> {
  /** The most recently released value (the live value in pass-through mode). */
  value: T
  /**
   * `true` when `value` was released because it could not wait any longer –
   * the max wait ran out, or {@link IdleDebouncedValue.flush} was called. A
   * caller that renders at low priority should render such a value at normal
   * priority, or the max wait is not a bound. `false` for a release after a
   * pause and in pass-through mode.
   */
  urgent: boolean
  /** A newer value is waiting to be released. */
  isPending: boolean
  /** Release the latest value now (as `urgent`). Stable across renders. */
  flush: () => void
}

interface Released<T> {
  value: T
  urgent: boolean
}

/**
 * Release each change of `value` only once changes have paused for `delayMs`
 * (or `maxWaitMs` has passed since the first unreleased change).
 *
 * The first render returns `value` immediately – the debounce applies to
 * changes only, so a component never mounts showing nothing. Equal values
 * (`Object.is`) are never re-released, and a pending release is cancelled on
 * unmount.
 *
 * Used by the Markdown preview so a large document is re-parsed once per pause
 * in typing rather than once per keystroke, and by Mermaid diagrams so a
 * half-typed diagram is not redrawn (and reported broken) on every key.
 *
 * @typeParam T - Type of the value being debounced
 * @param value - The live value
 * @param options - Delay, optional max wait, and an on/off switch
 * @returns The released value, whether it was released urgently, whether a
 *   newer one is pending, and a stable `flush`
 *
 * @example Preview that keeps up with typing in a large file
 * ```tsx
 * const { value: shown, urgent } = useIdleDebouncedValue(content, {
 *   delayMs: 150,
 *   maxWaitMs: 1000,
 *   enabled: isLarge
 * })
 * const deferred = useDeferredValue(shown)
 * return <MarkdownBody source={urgent ? shown : deferred} />
 * ```
 */
export function useIdleDebouncedValue<T>(value: T, options: UseIdleDebouncedValueOptions): IdleDebouncedValue<T> {
  const { delayMs, maxWaitMs, enabled = true } = options
  const [released, setReleased] = useState<Released<T>>({ value, urgent: false })
  // When the oldest unreleased change arrived; null when nothing is pending.
  const pendingSinceRef = useRef<number | null>(null)
  // The live value as of the last commit, for `flush` (called from events).
  const latestRef = useRef(value)

  useEffect(() => {
    latestRef.current = value
    if (Object.is(value, released.value)) {
      pendingSinceRef.current = null
      return
    }
    if (!enabled) {
      // Pass-through mode already returns `value`; catch the stored copy up so
      // turning the debounce back on starts from what is on screen.
      pendingSinceRef.current = null
      // eslint-disable-next-line react-hooks/set-state-in-effect -- catch-up only: render already returns `value` while disabled, so this paints nothing new; it keeps the stored copy in step for when the debounce turns back on
      setReleased({ value, urgent: false })
      return
    }

    const now = Date.now()
    if (pendingSinceRef.current === null) pendingSinceRef.current = now
    const waitedMs = now - pendingSinceRef.current
    const budgetMs = maxWaitMs === undefined ? Infinity : Math.max(0, maxWaitMs - waitedMs)
    // The max wait, not a pause, decides this release – so it is urgent.
    const urgent = budgetMs <= delayMs

    const timer = setTimeout(() => {
      pendingSinceRef.current = null
      setReleased({ value, urgent })
    }, Math.min(delayMs, budgetMs))
    // A newer change (or unmount) supersedes this release.
    return () => clearTimeout(timer)
  }, [value, released.value, enabled, delayMs, maxWaitMs])

  const flush = useCallback(() => {
    pendingSinceRef.current = null
    const latest = latestRef.current
    setReleased((prev) => (Object.is(prev.value, latest) ? prev : { value: latest, urgent: true }))
  }, [])

  if (!enabled) return { value, urgent: false, isPending: false, flush }
  return {
    value: released.value,
    urgent: released.urgent,
    isPending: !Object.is(value, released.value),
    flush
  }
}
