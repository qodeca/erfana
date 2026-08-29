// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds hook (Issue #74, work item 71).
 *
 * Keeps the native `WebContentsView` aligned with the panel's DOM placeholder.
 * A `ResizeObserver` on the placeholder, a window-resize listener, an
 * animation-frame pump that runs while the tab is visible, and an imperative
 * {@link UsePreviewBoundsResult.pushBounds} feed the placeholder's
 * `getBoundingClientRect()` through `deriveBounds` and send it with
 * `window.api.preview.setBounds`.
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

/**
 * How many animation frames the first-rect pump waits for a laid-out
 * placeholder before giving up (≈2s at 60Hz).
 *
 * A budget rather than an unbounded retry: a panel whose tab is not active has
 * no box at all and would otherwise measure forever. Two seconds is far longer
 * than a dockview activation takes and still bounded if the panel never lands.
 */
const FIRST_RECT_FRAME_BUDGET = 120

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
   * Whether this panel is the visible tab. Only a visible tab has a laid-out
   * box, so this is one of the two things that arm the first-rect pump.
   */
  isVisible: boolean
  /**
   * Whether main has a live `WebContentsView` for this panel (the store's load
   * state has left `'idle'`). Main DROPS a `setBounds` for a panel it has no
   * view for, so the pump must run again once the view exists.
   */
  isLive: boolean
  /**
   * Whether the find bar is open. When `true` the native view is inset from the
   * top by {@link SEARCH_BAR_INSET_PX} so the bar is not occluded (UX-002).
   */
  searchOpen: boolean
}

/** Result of {@link usePreviewBounds}. */
export interface UsePreviewBoundsResult {
  /**
   * Recomputes and sends the placeholder rect immediately.
   *
   * @returns `true` when a rect was sent, `false` when the placeholder is
   * missing, disabled or still degenerate — which is what lets the first-rect
   * pump know whether to keep asking.
   */
  pushBounds: () => boolean
}

/**
 * Wires geometry updates from the placeholder to the native preview view.
 *
 * @param options - Placeholder ref, panel id, enablement, visibility, liveness and find-bar state.
 * @returns An imperative {@link UsePreviewBoundsResult.pushBounds}.
 *
 * @example
 * ```tsx
 * const placeholderRef = useRef<HTMLDivElement>(null)
 * const { pushBounds } = usePreviewBounds({
 *   placeholderRef, panelId, enabled: true, isVisible, isLive, searchOpen
 * })
 * ```
 */
export function usePreviewBounds(options: UsePreviewBoundsOptions): UsePreviewBoundsResult {
  const { placeholderRef, panelId, enabled, isVisible, isLive, searchOpen } = options

  // Monotonic sequence so main can drop out-of-order sends (design §4.3). A ref,
  // not state — bumping it must never trigger a render.
  const seqRef = useRef(0)

  // Keep `enabled`/`searchOpen` readable from the stable callback without
  // re-creating it.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const searchOpenRef = useRef(searchOpen)
  searchOpenRef.current = searchOpen

  const pushBounds = useCallback((): boolean => {
    if (!enabledRef.current) return false
    const el = placeholderRef.current
    if (!el) return false
    const topInset = searchOpenRef.current ? SEARCH_BAR_INSET_PX : 0
    const bounds = deriveBounds(el.getBoundingClientRect(), topInset)
    if (!bounds) return false
    window.api.preview.setBounds(panelId, bounds, seqRef.current++)
    return true
  }, [panelId, placeholderRef])

  // Track size changes on the placeholder and the viewport for the whole mount,
  // visible or not — a background tab must already be the right size when it is
  // activated.
  useEffect(() => {
    if (!enabled) return
    const el = placeholderRef.current
    if (!el) return

    const observer = new ResizeObserver(() => pushBounds())
    observer.observe(el)
    window.addEventListener('resize', pushBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', pushBounds)
    }
  }, [enabled, placeholderRef, pushBounds])

  // Push the FIRST real rect as soon as the panel has one.
  //
  // This is what makes a freshly opened preview appear immediately (#74 follow-up).
  // `openFileInPanel` calls `addPanel` and only then `setActive`, so this hook's
  // first run happens while the panel is still an inactive dockview tab — which
  // has a 0×0 box. `deriveBounds` correctly refuses that, so nothing is sent and
  // the native view keeps the 1×1 fallback rect `preview:open` was called with:
  // a view too small to see, over a brand-black placeholder, i.e. a black panel.
  //
  // The `ResizeObserver` above is not a dependable second chance here. Dockview
  // re-parents an `always`-rendered panel rather than resizing it in place, so
  // the 0×0 → laid-out transition need not produce a resize callback at all, and
  // the next push then waited on an unrelated event — a tab switch or a window
  // resize. That is exactly the "black until you click around the tabs" symptom.
  //
  // So while the tab is visible, ask on each animation frame until one real rect
  // goes out, then stand down and let the observer own the steady state.
  useEffect(() => {
    if (!enabled || !isVisible || !isLive) return

    let frame: number | null = null
    let attempts = 0

    const pump = (): void => {
      frame = null
      if (pushBounds()) return
      if (attempts >= FIRST_RECT_FRAME_BUDGET) return
      attempts += 1
      frame = requestAnimationFrame(pump)
    }
    pump()

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [enabled, isVisible, isLive, pushBounds])

  // Re-push when the find bar opens or closes so the top inset is applied or
  // released immediately (a toggle changes no element size, so the
  // `ResizeObserver` alone would not re-emit).
  //
  // Only on a real TOGGLE. The mount run is already covered by the pump above,
  // and firing here as well sent the same rect twice for every preview opened.
  const sawFirstSearchState = useRef(false)
  useEffect(() => {
    if (!sawFirstSearchState.current) {
      sawFirstSearchState.current = true
      return
    }
    pushBounds()
  }, [searchOpen, pushBounds])

  return { pushBounds }
}
