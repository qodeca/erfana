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
/**
 * How far an overlapping pin moves left along the top edge (§10.5; C-17): the
 * 24 px hit box plus a 2 px gap (`--btn-height-sm` + `--space-1`), so
 * neighbouring hit areas never overlap (v0.23.1 stepped 22 px, overlapping by 2).
 */
export const PIN_STEP_PX = 26
/** Steps an overlapping pin may take in {@link placePin} before it stays put, overlapping (bounds the search). */
export const PIN_MAX_STEPS = 8
/** C-17: pins per crowded spot in {@link layoutPins}; the rest merge into one stack pin after them. */
export const PIN_ROW_CAP = 3

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

/** `value` within `min`..`max`; `min` wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Where a pin for `element` goes with nothing in its way: the tail tip
 * {@link PIN_TIP_OFFSET_PX} outward from the top-right corner of the
 * element's visible part, the box clamped {@link PIN_EDGE_INSET_PX} inside
 * each viewport edge; `null` when no part of the element is in `viewport`.
 * The tip scales with `size / PIN_BOX_PX`; the insets do not.
 */
function startOf(element: Box, viewport: Viewport, size: number): Box | null {
  const visible = clipToViewport(element, viewport)
  if (visible === null) return null
  const scale = size / PIN_BOX_PX
  const inset = PIN_EDGE_INSET_PX
  const left = clamp(visible.left + visible.width + PIN_TIP_OFFSET_PX - PIN_TIP.x * scale, inset, viewport.width - size - inset)
  const top = clamp(visible.top - PIN_TIP_OFFSET_PX - PIN_TIP.y * scale, inset, viewport.height - size - inset)
  return { left, top, width: size, height: size }
}

/** `box` moved `steps` pin steps left (scaled with its size); `null` when that crosses the left inset. */
function stepped(box: Box, steps: number): Box | null {
  const left = box.left - steps * PIN_STEP_PX * (box.width / PIN_BOX_PX)
  return left < PIN_EDGE_INSET_PX ? null : { left, top: box.top, width: box.width, height: box.height }
}

/** The boxes in the row of `box`: only those can be in its way. */
function rowOf(boxes: readonly Box[], box: Box): Box[] {
  return boxes.filter(other => Math.abs(other.top - box.top) < box.height)
}

/**
 * The hit box of one pin, `size` CSS pixels square, for an element whose
 * border box is `element`; `null` when no part of the element is in
 * `viewport`.
 *
 * The pin starts where {@link startOf} puts it. One whose hit box would
 * overlap one in `placed` (the pins already placed, in document order, so an
 * ancestor keeps the corner) moves left in {@link PIN_STEP_PX} steps, never
 * past the left inset. Only pins of its own row count, and it takes at most
 * {@link PIN_MAX_STEPS} steps – past that it stays put, overlapping – so
 * hundreds of pins in one row cost little. Collisions run after the clamp:
 * every full-width element's pin lands on the same clamped spot, so one in the
 * same row steps left like any other.
 */
export function placePin(
  element: Box,
  placed: readonly Box[],
  viewport: Viewport,
  size: number = PIN_BOX_PX
): Box | null {
  const start = startOf(element, viewport, size)
  if (start === null) return null
  const row = rowOf(placed, start)
  let box = start
  for (let moves = 1; moves <= PIN_MAX_STEPS && row.some(other => overlaps(other, box)); moves += 1) {
    const next = stepped(start, moves)
    if (next === null) break
    box = next
  }
  return box
}

/** One slot of {@link layoutPins}: a pin, or the stack pin of a crowded row. */
export interface PinSlot {
  readonly box: Box
  /** Indexes into the elements given: one for a pin; every merged one for a stack, in document order. */
  readonly members: readonly number[]
  readonly stack: boolean
}

/**
 * The pins of `elements` (border boxes, in document order) with C-17's row
 * cap. A pin steps left as {@link placePin}'s does, but at most
 * {@link PIN_ROW_CAP} pins share one crowded spot: an element that finds no
 * free spot among them merges into a stack pin one step further left ("+3"),
 * which a later element joins when its own stack spot overlaps it. Pins never
 * overlap each other; a stack pressed against the left inset may sit over a
 * pin. Elements wholly off screen get no slot.
 */
export function layoutPins(elements: readonly Box[], viewport: Viewport, size: number = PIN_BOX_PX): PinSlot[] {
  const slots: { box: Box; members: number[]; stack: boolean }[] = []
  elements.forEach((element, index) => {
    const start = startOf(element, viewport, size)
    if (start === null) return
    const row = slots.filter(slot => Math.abs(slot.box.top - start.top) < size)
    for (let steps = 0; steps < PIN_ROW_CAP; steps += 1) {
      const box = steps === 0 ? start : stepped(start, steps)
      if (box === null) break
      if (!row.some(slot => overlaps(slot.box, box))) {
        slots.push({ box, members: [index], stack: false })
        return
      }
    }
    const spot = stepped(start, PIN_ROW_CAP) ?? { left: PIN_EDGE_INSET_PX, top: start.top, width: size, height: size }
    const stack = row.find(slot => slot.stack && overlaps(slot.box, spot))
    // No `undefined` here: the core names no global (contract test).
    if (stack) stack.members.push(index)
    else slots.push({ box: spot, members: [index], stack: true })
  })
  return slots
}
