// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a comment pin goes (docs/designs/comments/html-preview-comments.md
 * §10.5, §19 Rev 4 "pins at the right edge"; spec 024 C-17,
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md § 2).
 *
 * Shared overlay core: the preview-page preload runs it inside the untrusted
 * page, and the renderer's overlay host will run it too, so a pin steps and
 * stacks the same in every preview. It is pure – no imports, no globals, no
 * DOM, nothing runs on load – which is what lets the sealed preload import it
 * (docs/adrs/0006-overlay-core-in-the-sealed-preload.md); `contract.test.ts`
 * in this folder fails the moment that stops being true.
 *
 * Everything is in the viewport's CSS pixels.
 */

/** A rectangle in viewport CSS pixels. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The visible viewport's size: scrollbars excluded. */
export interface Viewport {
  readonly width: number
  readonly height: number
}

/** The pin's box: a 24 × 24 hit target (WCAG 2.5.8) whose tail tip is at (2, 22). */
export const PIN_BOX_PX = 24
/** Where the tail tip sits inside the pin's box. Frozen: the core keeps no state the page's world could change. */
export const PIN_TIP = Object.freeze({ x: 2, y: 22 } as const)
/** The tail tip's offset outward from the element's top-right corner (§10.5). */
export const PIN_TIP_OFFSET_PX = 4
/**
 * How far a pin clamped to an edge of the visible viewport stays inside it
 * (§19 Rev 4 "pins at the right edge"): the tip's own 4 px offset
 * (`--space-2`), so a pin pushed to an edge keeps clear of it – and of comment
 * mode's 2 px frame along it.
 */
export const PIN_EDGE_INSET_PX = PIN_TIP_OFFSET_PX
/** How far an overlapping pin moves left along the top edge (§10.5). */
export const PIN_STEP_PX = 22
/** Steps an overlapping pin may take before it stays put, overlapping (bounds the search). */
export const PIN_MAX_STEPS = 8

/** The part of `box` inside the viewport, or `null` when none is. */
export function clipToViewport(box: Box, viewport: Viewport): Box | null {
  const left = Math.max(box.left, 0)
  const top = Math.max(box.top, 0)
  const right = Math.min(box.left + box.width, viewport.width)
  const bottom = Math.min(box.top + box.height, viewport.height)
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
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

/** The drawn bubble inside a pin's hit box: the view box's 2–22 units. */
function bodyOf(box: Box, scale: number): Box {
  const inset = PIN_TIP.x * scale
  return { left: box.left + inset, top: box.top + inset, width: box.width - 2 * inset, height: box.height - 2 * inset }
}

/** `value` within `min`..`max`; `min` wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * The hit box of one pin, `size` CSS pixels square, for an element whose
 * border box is `element`; `null` when no part of the element is in
 * `viewport`.
 *
 * The tail tip goes {@link PIN_TIP_OFFSET_PX} outward from the top-right
 * corner of the element's visible part, and the box is clamped
 * {@link PIN_EDGE_INSET_PX} inside each viewport edge. A pin whose drawn
 * bubble would overlap one in `placed` (the pins already placed, in document
 * order, so an ancestor keeps the corner) moves left in
 * {@link PIN_STEP_PX} steps, never past the left inset. Only pins of its own
 * row count, and it takes at most {@link PIN_MAX_STEPS} steps – past that it
 * stays put, overlapping – so hundreds of pins in one row cost little.
 * `PIN_STEP_PX` and the tip scale with `size / PIN_BOX_PX`; the insets do not.
 */
export function placePin(
  element: Box,
  placed: readonly Box[],
  viewport: Viewport,
  size: number = PIN_BOX_PX
): Box | null {
  const visible = clipToViewport(element, viewport)
  if (visible === null) return null
  const scale = size / PIN_BOX_PX
  const inset = PIN_EDGE_INSET_PX
  const tipX = visible.left + visible.width + PIN_TIP_OFFSET_PX
  const tipY = visible.top - PIN_TIP_OFFSET_PX
  let left = clamp(tipX - PIN_TIP.x * scale, inset, viewport.width - size - inset)
  const top = clamp(tipY - PIN_TIP.y * scale, inset, viewport.height - size - inset)
  const at = (x: number): Box => ({ left: x, top, width: size, height: size })
  // Collisions are judged on the drawn bubble (20 px inside the 24 px hit
  // box), so pins 22 px apart sit side by side with a 2 px gap. They run
  // after the clamp: every full-width element's pin lands on the same
  // clamped spot, so one in the same row steps left like any other.
  const row = placed.filter(box => Math.abs(box.top - top) < size).map(box => bodyOf(box, scale))
  const step = PIN_STEP_PX * scale
  for (let moves = 0; moves < PIN_MAX_STEPS && left - step >= inset; moves += 1) {
    const body = bodyOf(at(left), scale)
    if (!row.some(other => overlaps(other, body))) break
    left -= step
  }
  return at(left)
}
