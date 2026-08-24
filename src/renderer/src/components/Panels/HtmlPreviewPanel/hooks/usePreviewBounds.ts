// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds hook (Issue #74, work item 71).
 *
 * Keeps the native `WebContentsView` aligned with the panel's DOM placeholder.
 * A `ResizeObserver` on the placeholder, plus a window-resize listener and an
 * imperative {@link UsePreviewBoundsResult.pushBounds} the panel calls on a
 * visibility change, feed the placeholder's `getBoundingClientRect()` through
 * `deriveBounds` and send it with `window.api.preview.setBounds`.
 *
 * Throttling and the zoom→DIP conversion happen downstream (the preload bridge
 * and main coalesce per animation frame — design §4.3), so this hook just emits
 * a monotonically-increasing `seq` on every geometry change; main drops any
 * `seq` at or below the last it applied.
 *
 * @module usePreviewBounds
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useCallback, useEffect, useRef } from 'react'
import { deriveBounds } from '../htmlPreview.logic'

/**
 * CSS pixels reserved at the top of the native view while the find bar is open
 * (UX-002). Covers the floating search bar's top offset (`--space-4`, 8px) plus
 * its box (`--space-2` padding × 2 + `--input-height-sm`, ≈ 36px) with a small
 * margin, so the bar sits in a DOM strip the `WebContentsView` never paints over
 * while native `findInPage` highlights stay visible in the shorter view.
 */
export const SEARCH_BAR_INSET_PX = 48

/** Options for {@link usePreviewBounds}. */
export interface UsePreviewBoundsOptions {
  /** Ref to the sized placeholder element the native view tracks. */
  placeholderRef: React.RefObject<HTMLElement>
  /** The preview panel id (identifies the native view main-side). */
  panelId: string
  /**
   * Whether bounds should be pushed. `false` while the panel is refused
   * (limit-reached) or otherwise has no live view, so no stray rect is sent.
   */
  enabled: boolean
  /**
   * Whether the find bar is open. When `true` the native view is inset from the
   * top by {@link SEARCH_BAR_INSET_PX} so the bar is not occluded (UX-002).
   */
  searchOpen: boolean
}

/** Result of {@link usePreviewBounds}. */
export interface UsePreviewBoundsResult {
  /**
   * Recomputes and sends the placeholder rect immediately. The panel calls this
   * when it becomes visible again — a tab switch changes no size, so the
   * `ResizeObserver` alone would not re-emit and the view could stay stale.
   */
  pushBounds: () => void
}

/**
 * Wires geometry updates from the placeholder to the native preview view.
 *
 * @param options - Placeholder ref, panel id, and whether pushing is enabled.
 * @returns An imperative {@link UsePreviewBoundsResult.pushBounds}.
 *
 * @example
 * ```tsx
 * const placeholderRef = useRef<HTMLDivElement>(null)
 * const { pushBounds } = usePreviewBounds({ placeholderRef, panelId, enabled: true })
 * useEffect(() => { if (isVisible) pushBounds() }, [isVisible, pushBounds])
 * ```
 */
export function usePreviewBounds(options: UsePreviewBoundsOptions): UsePreviewBoundsResult {
  const { placeholderRef, panelId, enabled, searchOpen } = options

  // Monotonic sequence so main can drop out-of-order sends (design §4.3). A ref,
  // not state — bumping it must never trigger a render.
  const seqRef = useRef(0)

  // Keep `enabled`/`searchOpen` readable from the stable callback without
  // re-creating it.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const searchOpenRef = useRef(searchOpen)
  searchOpenRef.current = searchOpen

  const pushBounds = useCallback(() => {
    if (!enabledRef.current) return
    const el = placeholderRef.current
    if (!el) return
    const topInset = searchOpenRef.current ? SEARCH_BAR_INSET_PX : 0
    const bounds = deriveBounds(el.getBoundingClientRect(), topInset)
    if (!bounds) return
    window.api.preview.setBounds(panelId, bounds, seqRef.current++)
  }, [panelId, placeholderRef])

  useEffect(() => {
    if (!enabled) return
    const el = placeholderRef.current
    if (!el) return

    // Initial rect, then track size changes on the placeholder and viewport.
    pushBounds()

    const observer = new ResizeObserver(() => pushBounds())
    observer.observe(el)
    window.addEventListener('resize', pushBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', pushBounds)
    }
  }, [enabled, placeholderRef, pushBounds])

  // Re-push when the find bar opens or closes so the top inset is applied or
  // released immediately (a toggle changes no element size, so the
  // `ResizeObserver` alone would not re-emit).
  useEffect(() => {
    pushBounds()
  }, [searchOpen, pushBounds])

  return { pushBounds }
}
