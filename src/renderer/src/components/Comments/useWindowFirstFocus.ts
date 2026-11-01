// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the one first-focus rule of the comment window, in both previews
 * (spec 024 state table S-03 – S-05, W-11; differences D-59).
 *
 * A new comment lands in its text field. A thread lands on the control the
 * view put in `leadRef` – the leading Resolve, or Close when all is done – and
 * on the title when there is none: a Changed thread on a read-only or paused
 * file has no Resolve. Opening, a step and the end of a pause all ask here.
 *
 * The answer is read when focus moves, from what is really on screen, so the
 * rule cannot disagree with what the view drew. The ref object is stable: a
 * window that swapped refs re-ran its focus pass whenever a list changed what
 * leads.
 *
 * @module components/Comments/useWindowFirstFocus
 */
import { useMemo } from 'react'
import { useLatestRef } from '../../hooks/useLatestRef'

type WindowView = 'identity' | 'new' | 'threads'

/**
 * The window's first-focus target, as a stable ref.
 *
 * @param view - The view shown now.
 * @param leadRef - Holds the view's leading control, when it drew one.
 * @param titleRef - The window title, which always can take focus.
 * @param fieldRef - A new comment's text field.
 * @returns A ref whose `current` is the target at the moment it is read.
 */
export function useWindowFirstFocus(
  view: WindowView,
  leadRef: React.RefObject<HTMLElement | null>,
  titleRef: React.RefObject<HTMLElement | null>,
  fieldRef: React.RefObject<HTMLElement | null>
): React.RefObject<HTMLElement | null> {
  const viewRef = useLatestRef(view)
  return useMemo(
    () => ({
      get current(): HTMLElement | null {
        const preferred = viewRef.current === 'new' ? fieldRef.current : viewRef.current === 'threads' ? leadRef.current : null
        return preferred ?? titleRef.current
      }
    }),
    [viewRef, leadRef, titleRef, fieldRef]
  )
}
