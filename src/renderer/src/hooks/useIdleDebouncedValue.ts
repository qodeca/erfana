// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Hold back a fast-changing value until its changes pause.
 *
 * @module hooks/useIdleDebouncedValue
 */

import { useEffect, useRef, useState } from 'react'

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

/**
 * Return `value`, but release each change only once changes have paused for
 * `delayMs` (or `maxWaitMs` has passed since the first unreleased change).
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
 * @returns The most recently released value
 *
 * @example Preview that keeps up with typing in a large file
 * ```tsx
 * const shown = useIdleDebouncedValue(content, { delayMs: 150, maxWaitMs: 1000, enabled: isLarge })
 * return <MarkdownBody source={shown} />
 * ```
 */
export function useIdleDebouncedValue<T>(value: T, options: UseIdleDebouncedValueOptions): T {
  const { delayMs, maxWaitMs, enabled = true } = options
  const [released, setReleased] = useState(value)
  // When the oldest unreleased change arrived; null when nothing is pending.
  const pendingSinceRef = useRef<number | null>(null)

  useEffect(() => {
    if (Object.is(value, released)) {
      pendingSinceRef.current = null
      return
    }
    if (!enabled) {
      // Pass-through mode already returns `value`; catch the stored copy up so
      // turning the debounce back on starts from what is on screen.
      pendingSinceRef.current = null
      setReleased(value)
      return
    }

    const now = Date.now()
    if (pendingSinceRef.current === null) pendingSinceRef.current = now
    const waitedMs = now - pendingSinceRef.current
    const waitMs = maxWaitMs === undefined ? delayMs : Math.min(delayMs, Math.max(0, maxWaitMs - waitedMs))

    const timer = setTimeout(() => {
      pendingSinceRef.current = null
      setReleased(value)
    }, waitMs)
    // A newer change (or unmount) supersedes this release.
    return () => clearTimeout(timer)
  }, [value, released, enabled, delayMs, maxWaitMs])

  return enabled ? released : value
}
