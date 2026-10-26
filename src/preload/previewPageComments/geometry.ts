// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Rectangles and visibility for the overlay
 * (docs/designs/html-preview-comments.md §6 status, §10.2, §10.5, §19 R3-7).
 *
 * Everything is in the frame's CSS pixels, relative to its viewport – the
 * coordinate space of `getBoundingClientRect` and of `position: fixed` in the
 * overlay's top layer.
 */
import { TINY_ELEMENT_PX, TINY_RING_OUTSET_PX } from './constants'

/** A rectangle in viewport CSS pixels. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The frame's viewport size. */
export interface Viewport {
  readonly width: number
  readonly height: number
}

/** A point in viewport CSS pixels. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** The viewport of `win`. */
export function viewportOf(win: Window): Viewport {
  return { width: win.innerWidth, height: win.innerHeight }
}

/** `element`'s border box. */
export function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** The part of `box` inside the viewport, or `null` when none is. */
export function clipToViewport(box: Box, viewport: Viewport): Box | null {
  const left = Math.max(box.left, 0)
  const top = Math.max(box.top, 0)
  const right = Math.min(box.left + box.width, viewport.width)
  const bottom = Math.min(box.top + box.height, viewport.height)
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

/** Whether `point` lies inside `box`. */
export function contains(box: Box, point: Point): boolean {
  return (
    point.x >= box.left &&
    point.x < box.left + box.width &&
    point.y >= box.top &&
    point.y < box.top + box.height
  )
}

/** Whether two boxes overlap. */
export function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** `value` snapped to the device pixel grid (§10.2). */
export function snap(value: number, dpr: number): number {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  return Math.round(value * ratio) / ratio
}

/**
 * The outline's box for an element (§10.2): a tiny element gets its ring
 * pushed out, a huge one is clipped to the viewport. `null` when the element
 * is entirely off screen.
 */
export function outlineBox(box: Box, viewport: Viewport, dpr: number): Box | null {
  let grown = box
  if (box.width < TINY_ELEMENT_PX || box.height < TINY_ELEMENT_PX) {
    grown = {
      left: box.left - TINY_RING_OUTSET_PX,
      top: box.top - TINY_RING_OUTSET_PX,
      width: box.width + 2 * TINY_RING_OUTSET_PX,
      height: box.height + 2 * TINY_RING_OUTSET_PX
    }
  }
  const visible = clipToViewport(grown, viewport)
  if (visible === null) return null
  return {
    left: snap(visible.left, dpr),
    top: snap(visible.top, dpr),
    width: snap(visible.width, dpr),
    height: snap(visible.height, dpr)
  }
}

/** Whether `element` has at least one client rectangle with an area. */
function hasArea(element: Element): boolean {
  for (const rect of element.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) return true
  }
  return false
}

/**
 * Whether `element` is rendered right now (§6 status, R3-7): connected, with
 * an area, and passing `checkVisibility` with the opacity and visibility
 * checks. Not `contentVisibilityAuto`: that would mark off-screen content of
 * an ordinary long page as hidden. A 0×0 element passes `checkVisibility`,
 * hence the area check.
 */
export function isRendered(element: Element): boolean {
  if (!element.isConnected || !hasArea(element)) return false
  return element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
}
