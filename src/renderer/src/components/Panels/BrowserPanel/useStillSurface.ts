// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One Erfana surface of a browser tab that draws over the page area – More,
 * the address suggestions, the target menu – opened over the page's still
 * image (spec 025, 025-FR-054; ADR 0011 decision 3; design § Layout rules
 * "Popups that would cross into the page area"; commit 19).
 *
 * `open(show)` asks `browserStill` for the picture and calls `show` once it is
 * on screen – or at once when there is no live page or no picture (the
 * surface then opens over Erfana's background, as the native-view guard
 * hides the page for any app overlay). `close()` lets the picture go; an
 * unmount does too. A `close()` before the picture arrived cancels the
 * `show`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { browserStill } from '../../../services/browser/browserStill'
import { useLatestRef } from '../../../hooks/useLatestRef'

/** Open and close one surface over the page's picture. */
export interface StillSurface {
  readonly open: (show: () => void) => void
  readonly close: () => void
}

/**
 * Wires one surface to the tab's still image.
 *
 * @param tabId - Main's tab, or `null` while it opens (the surface then opens at once)
 * @param holder - The surface's name, unique within the tab
 * @returns {@link StillSurface}
 *
 * @example
 * ```tsx
 * const still = useStillSurface(tabId, 'more')
 * <button onClick={() => still.open(() => setOpen(true))} />
 * ```
 */
export function useStillSurface(tabId: string | null, holder: string): StillSurface {
  const tabRef = useLatestRef(tabId)
  /** Bumped by every open and close: a picture that arrives for an older open shows nothing. */
  const attemptRef = useRef(0)

  const close = useCallback(() => {
    attemptRef.current++
    const tab = tabRef.current
    if (tab !== null) browserStill.release(tab, holder)
  }, [tabRef, holder])

  const open = useCallback(
    (show: () => void) => {
      const tab = tabRef.current
      const attempt = ++attemptRef.current
      if (tab === null) {
        show()
        return
      }
      void browserStill.hold(tab, holder).then(() => {
        if (attemptRef.current === attempt) show()
      })
    },
    [tabRef, holder]
  )

  // A tab change or unmount lets the picture go.
  useEffect(
    () => () => {
      attemptRef.current++
      if (tabId !== null) browserStill.release(tabId, holder)
    },
    [tabId, holder]
  )

  return useMemo(() => ({ open, close }), [open, close])
}
