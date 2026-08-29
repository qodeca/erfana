// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the toast stack sits when a live HTML preview is on screen
 * (issue #74 follow-up).
 *
 * THE PROBLEM. A previewed page runs in a native `WebContentsView`, which the
 * OS composites ABOVE all sibling DOM regardless of z-index. So a toast that
 * overlaps the preview is not merely hard to read — it is invisible, and clicks
 * on it are delivered to the previewed page instead. Erfana's answer until now
 * was to hide the whole preview whenever any toast appeared. That is safe but
 * expensive: the preview a user is reading blanks to a still frame for the
 * toast's lifetime, and an ACTIONABLE toast never auto-dismisses, so a page that
 * reaches a blocked host hid every preview indefinitely — via a toast the
 * preview itself raised.
 *
 * THE ANSWER. Move the toast, not the page. The toast is small, it is Erfana's
 * own chrome, and moving it reflows nothing. Shrinking the preview instead would
 * resize what the reader is looking at twice per toast — a change of context
 * under WCAG 2.2 SC 3.2.5 — and would fail OPEN when the space could not be
 * found, leaving the page covering the consent prompt with no hide to fall back
 * on.
 *
 * FAILING SAFE. When no clear position exists — a preview filling the window,
 * a very short window, a tall stack — this returns `blocked` and the caller
 * registers the occluder, restoring the old hide-everything behaviour. Hiding is
 * the fallback, never the default, so the outcome is never worse than today.
 *
 * Pure and rect-based so every case is a table entry: jsdom performs no layout
 * and returns zero rects, so a test that renders a real toast measures nothing.
 */

/** The subset of a `DOMRect` this module reads. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Clearance kept between the toast and a native view, in CSS pixels.
 *
 * `getBoundingClientRect()` measures the layout box only: it excludes the
 * container's `--shadow-md` drop shadow (roughly 8-16 px of visible bleed) and
 * excludes an action button's 2 px focus ring at 2 px offset. Main then rounds
 * the view rect after multiplying by the zoom factor, costing up to another DIP.
 * Any pixel of the toast left under the view takes the click, so the gap is
 * explicit rather than implied — the same reasoning as `SEARCH_BAR_INSET_PX`.
 */
export const TOAST_CLEARANCE_PX = 20

/**
 * How close the toast may sit to a native view before it counts as blocked, in
 * CSS pixels.
 *
 * Smaller than {@link TOAST_CLEARANCE_PX} on purpose, and the two are different
 * questions. "Is it covered?" needs only enough margin for the parts that can be
 * clicked or focused but sit outside the layout box — a 2 px focus ring at 2 px
 * offset, plus a DIP of rounding in main's zoom conversion. "How far do I move
 * it?" wants the fuller gap, so the drop shadow does not bleed over the page
 * either. Using the larger number for both would nudge the toast sideways for a
 * near-miss it was never actually covered by, which is visible jitter for no
 * gain.
 */
export const TOAST_MIN_GAP_PX = 6

/** Where the toast container should sit, or that nowhere works. */
export type ToastPlacement =
  | {
      readonly kind: 'clear'
      /** Extra offset from the container's CSS anchor, in CSS pixels. */
      readonly offsetX: number
      readonly offsetY: number
    }
  | { readonly kind: 'blocked' }

/** The container's resting position needs no offset. */
const AT_REST: ToastPlacement = { kind: 'clear', offsetX: 0, offsetY: 0 }

/** `true` when two boxes share any area, once `pad` is added around `b`. */
function overlaps(a: Box, b: Box, pad: number): boolean {
  return (
    a.left < b.left + b.width + pad &&
    a.left + a.width > b.left - pad &&
    a.top < b.top + b.height + pad &&
    a.top + a.height > b.top - pad
  )
}

/** Move a box by an offset. */
function shift(box: Box, offsetX: number, offsetY: number): Box {
  return { ...box, left: box.left + offsetX, top: box.top + offsetY }
}

/** `true` when the box sits fully inside the viewport. */
function withinViewport(box: Box, viewport: { width: number; height: number }): boolean {
  return (
    box.left >= 0 &&
    box.top >= 0 &&
    box.left + box.width <= viewport.width &&
    box.top + box.height <= viewport.height
  )
}

/**
 * Find a position for the toast container that clears every live preview.
 *
 * Candidates are tried in order of least surprise: stay put, then slide right
 * along the bottom edge (past a preview that starts mid-window, the common case
 * with the project tree open), then rise above the preview's top edge.
 *
 * @param toast - The container's current rect, as measured.
 * @param previews - Rects of every VISIBLE native preview view.
 * @param viewport - The window's inner size.
 * @returns A `clear` placement with an offset to apply, or `blocked`.
 *
 * @example
 * ```ts
 * const placement = placeToastContainer(toastRect, previewRects, {
 *   width: window.innerWidth,
 *   height: window.innerHeight
 * })
 * if (placement.kind === 'blocked') hideThePreview()
 * ```
 */
export function placeToastContainer(
  toast: Box,
  previews: readonly Box[],
  viewport: { width: number; height: number }
): ToastPlacement {
  // A degenerate toast box (no toasts, or measured before layout) covers
  // nothing, so it needs no move and must not be reported as blocked.
  if (toast.width <= 0 || toast.height <= 0) {
    return AT_REST
  }

  const blocking = previews.filter(
    (preview) => preview.width > 0 && preview.height > 0 && overlaps(toast, preview, TOAST_MIN_GAP_PX)
  )
  if (blocking.length === 0) {
    return AT_REST
  }

  const candidates: Array<{ offsetX: number; offsetY: number }> = []

  // Slide right, to just past the right edge of the rightmost blocker.
  const rightmost = Math.max(...blocking.map((p) => p.left + p.width))
  candidates.push({ offsetX: rightmost + TOAST_CLEARANCE_PX - toast.left, offsetY: 0 })

  // Slide left, to just before the left edge of the leftmost blocker.
  const leftmost = Math.min(...blocking.map((p) => p.left))
  candidates.push({ offsetX: leftmost - TOAST_CLEARANCE_PX - (toast.left + toast.width), offsetY: 0 })

  // Rise above the highest blocker.
  const highest = Math.min(...blocking.map((p) => p.top))
  candidates.push({ offsetX: 0, offsetY: highest - TOAST_CLEARANCE_PX - (toast.top + toast.height) })

  for (const candidate of candidates) {
    const moved = shift(toast, candidate.offsetX, candidate.offsetY)
    if (!withinViewport(moved, viewport)) {
      continue
    }
    if (
      previews.some(
        (preview) => preview.width > 0 && preview.height > 0 && overlaps(moved, preview, TOAST_CLEARANCE_PX)
      )
    ) {
      continue
    }
    return { kind: 'clear', offsetX: candidate.offsetX, offsetY: candidate.offsetY }
  }

  // Nowhere fits. Fall back to the behaviour this replaces: hide the view.
  return { kind: 'blocked' }
}
