// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How much of the preview's placeholder its ancestors let paint (issue #124,
 * part 1 §1.4, cause C2).
 *
 * With the terminal expanded over the editor, dockview keeps the editor group at
 * its 100 px floor inside a 0-wide area, so the placeholder measures a valid box
 * that paints nowhere. Its own rect cannot tell; only its clipping ancestors can.
 * `usePreviewBounds` asks {@link visibleArea} every frame and never sends a rect
 * whose visible area is empty.
 *
 * An `IntersectionObserver` was rejected: it reports after the frame's layout,
 * so the strip would already have been sent and drawn (part 1 §1.4 options).
 *
 * @module previewClip
 */
import type { RectLike } from './htmlPreview.logic'

/**
 * Computed `overflow` values that clip an element's descendants. `visible` does
 * not, and neither does the empty string jsdom returns for a property it does
 * not compute – a positive list keeps an unknown value from reading as a clip.
 */
const CLIPPING_OVERFLOW: ReadonlySet<string> = new Set(['hidden', 'clip', 'scroll', 'auto', 'overlay'])

/** `contain` keywords that include paint containment (`strict` and `content` both do). */
const PAINT_CONTAINMENT = /\b(paint|strict|content)\b/

/**
 * Whether an element with this computed style clips what its descendants paint.
 *
 * Covers the two mechanisms this layout uses: non-visible overflow (dockview's
 * splitview views and containers) and paint containment (`.dv-render-overlay`
 * has `contain: layout paint`). `clip-path` and transforms are not modelled
 * (part 1 §1.7).
 *
 * @param style - The element's computed style; only the three fields are read
 * @returns `true` when the element clips its descendants
 *
 * @example
 * ```ts
 * clipsDescendants({ overflowX: 'hidden', overflowY: 'visible', contain: '' }) // → true
 * clipsDescendants({ overflowX: 'visible', overflowY: 'visible', contain: 'layout paint' }) // → true
 * ```
 */
export function clipsDescendants(style: Pick<CSSStyleDeclaration, 'overflowX' | 'overflowY' | 'contain'>): boolean {
  if (CLIPPING_OVERFLOW.has(style.overflowX) || CLIPPING_OVERFLOW.has(style.overflowY)) return true
  // Not every engine computes `contain` (jsdom leaves it undefined).
  const contain: string | undefined = style.contain
  return contain !== undefined && PAINT_CONTAINMENT.test(contain)
}

/**
 * Intersects a rectangle with each clip rectangle in turn.
 *
 * @param rect - The rectangle to clip, in CSS pixels
 * @param clips - The clip rectangles, in the same coordinate space
 * @returns The part of `rect` inside every clip, or `null` when nothing is left
 * (a 0×0 input included)
 *
 * @example
 * ```ts
 * intersectRects({ left: 48, top: 82, width: 100, height: 786 }, [])
 * // → the same rect
 * intersectRects({ left: 48, top: 82, width: 100, height: 786 }, [{ left: 477, top: 41, width: 0, height: 827 }])
 * // → null (clipped away)
 * ```
 */
export function intersectRects(rect: RectLike, clips: readonly RectLike[]): RectLike | null {
  let left = rect.left
  let top = rect.top
  let right = rect.left + rect.width
  let bottom = rect.top + rect.height
  for (const clip of clips) {
    left = Math.max(left, clip.left)
    top = Math.max(top, clip.top)
    right = Math.min(right, clip.left + clip.width)
    bottom = Math.min(bottom, clip.top + clip.height)
  }
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * The part of `rect` that the ancestors of `el` let paint: `rect` clipped by
 * every ancestor up to `<html>` that clips its descendants.
 *
 * NOTE: every clipping ancestor counts, including one between an absolutely
 * positioned element and its containing block, which CSS would not let clip it.
 * In this layout each ancestor geometrically contains the placeholder, so such an
 * ancestor can only empty the area when the panel really is collapsed.
 *
 * PERF: one computed-style read per ancestor, plus one rect per clipping
 * ancestor. The bounds hook calls this once per frame, only while the preview is
 * the visible tab and its view is live.
 *
 * @param el - The element whose ancestors clip (the preview's placeholder)
 * @param rect - The area to clip, viewport-relative CSS pixels
 * @returns The visible part, or `null` when an ancestor leaves none of it
 *
 * @example
 * ```ts
 * // The terminal expanded over the editor: a 0-wide ancestor clips the strip.
 * visibleArea(placeholder, { left: 48, top: 82, width: 100, height: 786 }) // → null
 * ```
 */
export function visibleArea(el: HTMLElement, rect: RectLike): RectLike | null {
  const clips: RectLike[] = []
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    // `window.` on purpose: the renderer's only window, and the global tests stub.
    if (clipsDescendants(window.getComputedStyle(node))) clips.push(node.getBoundingClientRect())
  }
  return intersectRects(rect, clips)
}
