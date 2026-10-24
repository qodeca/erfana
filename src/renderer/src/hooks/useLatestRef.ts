// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.

import { useLayoutEffect, useRef, type MutableRefObject } from 'react'

/**
 * Keeps a ref pointing at the latest value of a prop or callback, without
 * writing to the ref during render.
 *
 * The usual "latest ref" idiom (`ref.current = value` in the component body)
 * is a side effect during render, which `react-hooks/refs` flags because a
 * render React throws away would still have written the ref. This hook does
 * the same assignment in a layout effect instead, so the ref is current
 * before any `useEffect` of the same commit and before the browser can
 * deliver an event – the two places such a ref is read.
 *
 * Use it for a callback that an effect or a subscription must call without
 * re-running (re-subscribing IPC, restarting a listener) whenever the parent
 * passes a new function identity.
 *
 * Constraint: do not read `.current` during render, nor in a layout effect –
 * during render it holds the value from the previous commit, and a layout
 * effect declared before this hook's own (or in a child, whose layout effects
 * run first) sees the same stale value. Read it in passive effects, event
 * handlers and subscription callbacks only.
 *
 * @typeParam T - Type of the tracked value
 * @param value - The value to track; usually a callback prop
 * @returns A stable ref whose `.current` is the value from the latest commit
 *
 * @example
 * ```tsx
 * const onCloseRef = useLatestRef(onClose)
 * useEffect(() => {
 *   const onDown = () => onCloseRef.current()
 *   document.addEventListener('mousedown', onDown)
 *   return () => document.removeEventListener('mousedown', onDown)
 * }, [onCloseRef]) // subscribes once, always calls the newest onClose
 * ```
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  // No dependency array on purpose: re-assigning every commit is cheaper than
  // comparing, and it is what the render-time idiom did.
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
