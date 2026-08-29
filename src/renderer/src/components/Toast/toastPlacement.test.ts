// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Toast placement against a live preview (issue #74 follow-up).
 *
 * Every case is a hand-built rect. jsdom performs no layout and returns zero
 * rects from `getBoundingClientRect`, so a test that renders a real toast and a
 * real panel measures `{0,0,0,0}` for both, finds no overlap, and passes without
 * the code under test doing anything — the same vacuity that let a preview ship
 * invisible at 0×0.
 *
 * The load-bearing case is `blocked`. Hiding the preview is the FALLBACK, not
 * the thing this change removes: an actionable toast never auto-dismisses, and
 * the one it matters most for grants a website network access, so "no room to
 * move" must never mean "leave it covered".
 */
import { describe, expect, it } from 'vitest'

import { TOAST_CLEARANCE_PX, placeToastContainer, type Box } from './toastPlacement'

const VIEWPORT = { width: 1400, height: 900 }

/** A toast stack at its CSS resting place: bottom-left, 16px in. */
const TOAST: Box = { left: 16, top: 760, width: 400, height: 110 }

/**
 * A preview filling the editor area with the project tree open, measured from a
 * real Erfana window: the tree is wider than the toast, so the two never meet.
 * This is the common case, and today it hides the preview for nothing.
 */
const PREVIEW_RIGHT_OF_TREE: Box = { left: 430, top: 40, width: 700, height: 820 }

/**
 * A narrower preview in a split that DOES sit over the toast's corner, leaving
 * room to its right.
 */
const PREVIEW_NARROW: Box = { left: 300, top: 700, width: 400, height: 200 }

/** A preview filling everything below the tab strip, tree collapsed. */
const PREVIEW_FULL_WIDTH: Box = { left: 0, top: 40, width: 1400, height: 830 }

describe('placeToastContainer', () => {
  it('leaves the toast alone when no preview is live', () => {
    expect(placeToastContainer(TOAST, [], VIEWPORT)).toEqual({
      kind: 'clear',
      offsetX: 0,
      offsetY: 0
    })
  })

  it('leaves the toast alone when the preview is nowhere near it', () => {
    const farAway: Box = { left: 900, top: 40, width: 400, height: 300 }
    expect(placeToastContainer(TOAST, [farAway], VIEWPORT)).toMatchObject({ kind: 'clear' })
  })

  it('leaves the toast where it is beside a normal editor-area preview', () => {
    // The common case, and the whole point: with the project tree open the
    // toast sits entirely over the tree and never touched the preview — yet
    // today the preview hides anyway, for nothing.
    expect(placeToastContainer(TOAST, [PREVIEW_RIGHT_OF_TREE], VIEWPORT)).toEqual({
      kind: 'clear',
      offsetX: 0,
      offsetY: 0
    })
  })

  it('moves the toast out from under a preview it does overlap', () => {
    const placement = placeToastContainer(TOAST, [PREVIEW_NARROW], VIEWPORT)
    expect(placement.kind).toBe('clear')
    if (placement.kind !== 'clear') return
    expect(placement.offsetX !== 0 || placement.offsetY !== 0).toBe(true)
  })

  it('puts the moved toast fully clear of the preview, with margin', () => {
    const overlapping: Box = { left: 250, top: 760, width: 300, height: 110 }
    const placement = placeToastContainer(overlapping, [PREVIEW_NARROW], VIEWPORT)
    if (placement.kind !== 'clear') throw new Error('expected a clear placement')

    const moved = {
      left: overlapping.left + placement.offsetX,
      top: overlapping.top + placement.offsetY,
      right: overlapping.left + placement.offsetX + overlapping.width,
      bottom: overlapping.top + placement.offsetY + overlapping.height
    }
    const p = PREVIEW_NARROW
    const clearHorizontally =
      moved.right <= p.left - TOAST_CLEARANCE_PX || moved.left >= p.left + p.width + TOAST_CLEARANCE_PX
    const clearVertically =
      moved.bottom <= p.top - TOAST_CLEARANCE_PX || moved.top >= p.top + p.height + TOAST_CLEARANCE_PX
    expect(clearHorizontally || clearVertically).toBe(true)
  })

  it('keeps the moved toast inside the window', () => {
    const overlapping: Box = { left: 250, top: 760, width: 300, height: 110 }
    const placement = placeToastContainer(overlapping, [PREVIEW_NARROW], VIEWPORT)
    if (placement.kind !== 'clear') throw new Error('expected a clear placement')

    expect(overlapping.left + placement.offsetX).toBeGreaterThanOrEqual(0)
    expect(overlapping.top + placement.offsetY).toBeGreaterThanOrEqual(0)
    expect(overlapping.left + placement.offsetX + overlapping.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(overlapping.top + placement.offsetY + overlapping.height).toBeLessThanOrEqual(VIEWPORT.height)
  })

  it('reports blocked when it overlaps and nowhere in the window fits', () => {
    // A wide toast under a preview that spans the window's whole lower half has
    // nowhere to go. Hiding the view is then correct — and is exactly what
    // happens today, so this case is no worse than before.
    const wideBlocker: Box = { left: 300, top: 40, width: 800, height: 820 }
    expect(placeToastContainer(TOAST, [wideBlocker], VIEWPORT)).toEqual({ kind: 'blocked' })
  })

  it('reports blocked when a preview fills the window', () => {
    // THE fallback case. The caller must then hide the view, which is exactly
    // what happened before this change — never worse than today.
    expect(placeToastContainer(TOAST, [PREVIEW_FULL_WIDTH], VIEWPORT)).toEqual({ kind: 'blocked' })
  })

  it('reports blocked when the stack is taller than anywhere it could go', () => {
    const tall: Box = { left: 16, top: 100, width: 400, height: 760 }
    expect(placeToastContainer(tall, [PREVIEW_FULL_WIDTH], VIEWPORT)).toEqual({ kind: 'blocked' })
  })

  it('treats an exactly-touching edge as needing clearance, not as clear', () => {
    // Touching is not enough: the shadow and focus ring bleed past the layout
    // box, and main rounds the view rect after zoom.
    const touching: Box = { left: 200, top: 760, width: 100, height: 110 }
    const placement = placeToastContainer(touching, [PREVIEW_NARROW], VIEWPORT)
    if (placement.kind !== 'clear') throw new Error('expected a clear placement')
    expect(placement.offsetX !== 0 || placement.offsetY !== 0).toBe(true)
  })

  it('stays put when a gap of exactly the clearance already exists', () => {
    const justClear: Box = {
      left: PREVIEW_NARROW.left - 100 - TOAST_CLEARANCE_PX,
      top: 760,
      width: 100,
      height: 110
    }
    expect(placeToastContainer(justClear, [PREVIEW_NARROW], VIEWPORT)).toMatchObject({
      kind: 'clear',
      offsetX: 0,
      offsetY: 0
    })
  })

  it('clears EVERY live preview, not just the first', () => {
    // Several previews are live at once (sd-074b D5); only the visible one has a
    // rect, but a split layout could publish two.
    const left: Box = { left: 0, top: 600, width: 500, height: 300 }
    const right: Box = { left: 520, top: 600, width: 500, height: 300 }
    const placement = placeToastContainer(TOAST, [left, right], VIEWPORT)
    if (placement.kind === 'blocked') return
    const moved = {
      left: TOAST.left + placement.offsetX,
      top: TOAST.top + placement.offsetY,
      width: TOAST.width,
      height: TOAST.height
    }
    for (const preview of [left, right]) {
      const clear =
        moved.left + moved.width <= preview.left - TOAST_CLEARANCE_PX ||
        moved.left >= preview.left + preview.width + TOAST_CLEARANCE_PX ||
        moved.top + moved.height <= preview.top - TOAST_CLEARANCE_PX ||
        moved.top >= preview.top + preview.height + TOAST_CLEARANCE_PX
      expect(clear).toBe(true)
    }
  })

  it('ignores a preview with no area', () => {
    // A suspended or not-yet-sized view publishes nothing meaningful; it must
    // not push the toast around, and must not report blocked.
    const empty: Box = { left: 0, top: 0, width: 0, height: 0 }
    expect(placeToastContainer(TOAST, [empty], VIEWPORT)).toMatchObject({
      kind: 'clear',
      offsetX: 0,
      offsetY: 0
    })
  })

  it('needs no move when there are no toasts to place', () => {
    // An empty container measures zero. It covers nothing, so reporting blocked
    // here would hide every preview for as long as no toast is shown.
    const empty: Box = { left: 16, top: 880, width: 0, height: 0 }
    expect(placeToastContainer(empty, [PREVIEW_FULL_WIDTH], VIEWPORT)).toEqual({
      kind: 'clear',
      offsetX: 0,
      offsetY: 0
    })
  })
})
