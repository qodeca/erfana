// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How long a toast stays on screen, and the timer that removes it.
 *
 * A toast that vanishes before it is read fails WCAG 2.2.1 (Timing Adjustable):
 * an error that closed after 3 s took its only explanation with it, and a toast
 * holding keyboard focus could be pulled out from under the user. Two rules fix
 * that, and both live here so no caller can opt out of them:
 *
 * 1. **Dwell by severity.** An error, or a toast with an action, stays until it
 *    is dismissed. A warning stays at least {@link WARNING_MIN_DWELL_MS}.
 *    Info and success keep the caller's duration, so "Saved" still clears itself.
 * 2. **Pause while attended.** The countdown stops while the pointer is over a
 *    toast or focus is inside it, and resumes with the time that was left.
 *
 * @see https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
 * @see docs/design-system/system/components/feedback/index.html — "Toast, or banner?"
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from 'react'
import type { Toast } from './ToastContext'

/** Duration used when an info or success caller names none. */
export const DEFAULT_DWELL_MS = 3000

/**
 * The shortest time a warning is shown, and its default.
 *
 * A warning usually asks the reader to notice something about the screen
 * ("This link points outside the project"), which takes longer to read than a
 * confirmation. Callers that passed 3000 ms for a warning get this instead.
 */
export const WARNING_MIN_DWELL_MS = 8000

/** `0` means "stay until dismissed" throughout the toast module. */
export const PERSIST = 0

/**
 * Resolve the dwell time a toast is actually shown for.
 *
 * The caller's `duration` is a request, not a command: it can lengthen a
 * warning but never shorten one below the floor, and it cannot make an error
 * or an actionable toast time out at all.
 *
 * @param toast - The toast as the caller raised it (only `type`, `duration` and `action` are read)
 * @returns Milliseconds before auto-dismiss, or {@link PERSIST} (`0`) for "until dismissed"
 *
 * @example
 * ```ts
 * resolveToastDuration({ type: 'error', duration: 5000 })   // 0 – errors persist
 * resolveToastDuration({ type: 'warning', duration: 3000 }) // 8000 – floored
 * resolveToastDuration({ type: 'success' })                 // 3000
 * ```
 */
export function resolveToastDuration(
  toast: Pick<Toast, 'type' | 'duration' | 'action'>
): number {
  // Both carry something the reader must act on or recover from; a timer that
  // removes them is the defect this module exists to prevent.
  if (toast.action !== undefined || toast.type === 'error') {
    return PERSIST
  }
  const requested = toast.duration
  // A non-finite or negative request is treated as "not given" rather than
  // trusted: `setTimeout(fn, NaN)` fires immediately.
  const valid = requested !== undefined && Number.isFinite(requested) && requested >= 0
  if (toast.type === 'warning') {
    if (valid && requested === PERSIST) {
      return PERSIST
    }
    return Math.max(valid ? requested : WARNING_MIN_DWELL_MS, WARNING_MIN_DWELL_MS)
  }
  return valid ? requested : DEFAULT_DWELL_MS
}

/** What {@link useToastDwellTimer} hands back to the toast element. */
export interface ToastDwellHandlers {
  /** Spread onto the toast's root element. */
  onMouseEnter: () => void
  /** Spread onto the toast's root element. */
  onMouseLeave: () => void
  /** Spread onto the toast's root element. */
  onFocus: () => void
  /** Spread onto the toast's root element. */
  onBlur: (event: FocusEvent<HTMLElement>) => void
  /** True while the countdown is stopped because the toast is attended. */
  paused: boolean
}

/**
 * Count a toast down, pausing while the pointer or focus is on it.
 *
 * React's `onFocus` / `onBlur` bubble (they are `focusin` / `focusout`), so a
 * handler on the root sees focus enter its Close or action button. A blur whose
 * `relatedTarget` is still inside the toast is focus moving between its own
 * buttons and keeps the pause.
 *
 * As a last guard the expiry re-checks `document.activeElement`: if focus is
 * somehow inside the toast without a focus event having been seen (focus moved
 * programmatically before mount), the toast is kept and the timer re-armed.
 *
 * @param durationMs - Resolved dwell from {@link resolveToastDuration}; `0` never expires
 * @param onExpire - Called once when the countdown reaches zero
 * @param elementRef - The toast's root element, for the focus-containment guard
 * @returns Event handlers for the toast root and the current paused state
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null)
 * const { paused, ...handlers } = useToastDwellTimer(8000, onClose, ref)
 * return <div ref={ref} {...handlers} data-paused={paused} />
 * ```
 */
export function useToastDwellTimer(
  durationMs: number,
  onExpire: () => void,
  elementRef: RefObject<HTMLElement | null>
): ToastDwellHandlers {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused

  // Time still owed to the countdown. Survives pause/resume cycles; a resume
  // grants what was left, not a fresh full duration, so hovering repeatedly
  // cannot be mistaken for "keep forever" — the reader ends that by leaving.
  const remainingRef = useRef(durationMs)
  const startedAtRef = useRef<number | null>(null)

  // Held in a ref so a new `onClose` closure on every parent render does not
  // restart the countdown.
  const onExpireRef = useRef(onExpire)
  useLayoutEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    if (durationMs <= 0 || paused) {
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (ms: number): void => {
      startedAtRef.current = Date.now()
      timer = setTimeout(() => {
        const el = elementRef.current
        if (el !== null && el.contains(document.activeElement)) {
          // Never remove a toast under the keyboard user. Give it the full
          // dwell again rather than polling: the blur handler will take over.
          remainingRef.current = durationMs
          arm(durationMs)
          return
        }
        startedAtRef.current = null
        onExpireRef.current()
      }, ms)
    }
    arm(remainingRef.current)
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      if (startedAtRef.current !== null) {
        const elapsed = Date.now() - startedAtRef.current
        remainingRef.current = Math.max(0, remainingRef.current - elapsed)
        startedAtRef.current = null
      }
    }
  }, [durationMs, paused, elementRef])

  const onMouseEnter = useCallback(() => setHovered(true), [])
  const onMouseLeave = useCallback(() => setHovered(false), [])
  const onFocus = useCallback(() => setFocused(true), [])
  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return
    }
    setFocused(false)
  }, [])

  return { onMouseEnter, onMouseLeave, onFocus, onBlur, paused }
}
