// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  PIN_BOX_PX,
  PIN_EDGE_INSET_PX,
  PIN_MAX_STEPS,
  PIN_ROW_CAP,
  PIN_STEP_PX,
  PIN_TIP,
  PIN_TIP_OFFSET_PX,
  clipToViewport,
  overlaps,
  layoutPins,
  placePin,
  type Box
} from './pinLayout'

const VIEWPORT = { width: 1000, height: 800 }

/** Place one pin per element in order, as the preload's `placePins` does. */
function stack(elements: readonly Box[], size: number = PIN_BOX_PX): Array<Box | null> {
  const placed: Box[] = []
  return elements.map(element => {
    const box = placePin(element, placed, VIEWPORT, size)
    if (box !== null) placed.push(box)
    return box
  })
}

describe('pinLayout (shared overlay core)', () => {
  it('024-AC-001 C-17 pinLayout keeps the v0.23.1 pin constants, but steps 24 + 2 px and caps a crowded spot at 3', () => {
    expect({ PIN_BOX_PX, PIN_TIP, PIN_TIP_OFFSET_PX, PIN_EDGE_INSET_PX, PIN_STEP_PX, PIN_MAX_STEPS, PIN_ROW_CAP }).toEqual({
      PIN_BOX_PX: 24,
      PIN_TIP: { x: 2, y: 22 },
      PIN_TIP_OFFSET_PX: 4,
      PIN_EDGE_INSET_PX: 4,
      PIN_STEP_PX: 26,
      PIN_MAX_STEPS: 8,
      PIN_ROW_CAP: 3
    })
  })

  it('024-AC-001 pinLayout puts the tail tip 4 px outward from the top-right corner', () => {
    // Tip at (300 + 4, 100 - 4); the tip sits at (2, 22) inside the 24 px box.
    expect(placePin({ left: 100, top: 100, width: 200, height: 50 }, [], VIEWPORT)).toEqual({
      left: 302,
      top: 74,
      width: 24,
      height: 24
    })
  })

  it('024-AC-001 pinLayout draws nothing for an element wholly off screen', () => {
    expect(placePin({ left: 100, top: 900, width: 50, height: 50 }, [], VIEWPORT)).toBeNull()
    expect(placePin({ left: -60, top: 10, width: 50, height: 50 }, [], VIEWPORT)).toBeNull()
    expect(placePin({ left: 10, top: 10, width: 0, height: 50 }, [], VIEWPORT)).toBeNull()
  })

  it('024-AC-001 pinLayout clamps a pin inside each viewport edge by the inset', () => {
    // Full width: the tip would sit past the right edge.
    expect(placePin({ left: 0, top: 100, width: 1000, height: 50 }, [], VIEWPORT)?.left).toBe(1000 - 24 - PIN_EDGE_INSET_PX)
    // At the top: the pin would sit above the viewport.
    expect(placePin({ left: 100, top: 0, width: 100, height: 50 }, [], VIEWPORT)?.top).toBe(PIN_EDGE_INSET_PX)
    // Scrolled partly off the top: the visible part's corner counts, then the clamp.
    expect(placePin({ left: 100, top: -500, width: 100, height: 600 }, [], VIEWPORT)?.top).toBe(PIN_EDGE_INSET_PX)
    // A viewport too small for a pin: the inset wins.
    expect(placePin({ left: 0, top: 0, width: 10, height: 10 }, [], { width: 20, height: 20 })).toEqual({
      left: PIN_EDGE_INSET_PX,
      top: PIN_EDGE_INSET_PX,
      width: 24,
      height: 24
    })
  })

  it('024-AC-001 pinLayout steps and caps a stack like the preload', () => {
    const element = { left: 100, top: 100, width: 200, height: 50 }
    const lefts = stack(Array.from({ length: PIN_MAX_STEPS + 3 }, () => element)).map(box => box?.left)
    const steps = Array.from({ length: PIN_MAX_STEPS + 1 }, (_, i) => 302 - i * PIN_STEP_PX)
    // Each pin moves one more 22 px step; past the cap the rest stay put, overlapping.
    expect(lefts).toEqual([...steps, 302 - PIN_MAX_STEPS * PIN_STEP_PX, 302 - PIN_MAX_STEPS * PIN_STEP_PX])
  })

  it('C-17 pinLayout sets stepped pins side by side with a 2 px gap between hit boxes', () => {
    const [first, second] = stack([
      { left: 100, top: 100, width: 200, height: 50 },
      { left: 100, top: 100, width: 200, height: 50 }
    ]) as Box[]
    expect(first.left - second.left).toBe(PIN_STEP_PX)
    // C-17: the hit boxes never overlap (v0.23.1's overlapped by 2 px).
    expect(overlaps(first, second)).toBe(false)
    expect(first.left - (second.left + second.width)).toBe(2)
  })

  it('024-AC-001 pinLayout never steps past the left inset', () => {
    const element = { left: 0, top: 100, width: 20, height: 50 }
    expect(stack([element, element]).map(box => box?.left)).toEqual([22, 22])
  })

  it('024-AC-001 C-17 pinLayout steps only for pins of its own row, judged on hit boxes', () => {
    const below = { left: 100, top: 200, width: 200, height: 50 }
    const above = { left: 100, top: 100, width: 200, height: 50 }
    // 100 px apart: different rows, so both keep their corner.
    expect(stack([above, below]).map(box => box?.left)).toEqual([302, 302])
    // A pin 10 px lower is within one pin's height, and its bubble overlaps: same row.
    expect(stack([above, { ...above, top: 110 }]).map(box => box?.left)).toEqual([302, 276])
    // 23 px lower is still the same row, and the 24 px hit boxes overlap by 1 px.
    expect(stack([above, { ...above, top: 123 }]).map(box => box?.left)).toEqual([302, 276])
    // 24 px lower: another row.
    expect(stack([above, { ...above, top: 124 }]).map(box => box?.left)).toEqual([302, 302])
  })

  it('024-AC-001 pinLayout scales the tip and the step with the pin size, not the inset', () => {
    const element = { left: 100, top: 100, width: 200, height: 50 }
    const [first, second] = stack([element, element], 48) as Box[]
    // Tip at (304, 96); the tip sits at (4, 44) inside a 48 px box.
    expect(first).toEqual({ left: 300, top: 52, width: 48, height: 48 })
    expect(second.left).toBe(300 - 2 * PIN_STEP_PX)
    expect(placePin({ left: 0, top: 0, width: 1000, height: 10 }, [], VIEWPORT, 48)).toEqual({
      left: 1000 - 48 - PIN_EDGE_INSET_PX,
      top: PIN_EDGE_INSET_PX,
      width: 48,
      height: 48
    })
  })

  it('024-AC-001 pinLayout clips a box to the viewport, or to nothing', () => {
    expect(clipToViewport({ left: -10, top: 500, width: 100, height: 400 }, VIEWPORT)).toEqual({
      left: 0,
      top: 500,
      width: 90,
      height: 300
    })
    expect(clipToViewport({ left: 1000, top: 0, width: 10, height: 10 }, VIEWPORT)).toBeNull()
    expect(clipToViewport({ left: 0, top: 800, width: 10, height: 10 }, VIEWPORT)).toBeNull()
  })

  it('C-17 stack: past three pins on one spot, the rest of the row merges into one stack pin, a step further left', () => {
    const element = { left: 100, top: 100, width: 200, height: 50 }
    const slots = layoutPins(Array.from({ length: 7 }, () => element), VIEWPORT)
    expect(slots.map(slot => [slot.box.left, slot.members, slot.stack])).toEqual([
      [302, [0], false],
      [276, [1], false],
      [250, [2], false],
      [224, [3, 4, 5, 6], true]
    ])
    // No two slots' hit boxes overlap.
    for (const [i, a] of slots.entries()) for (const b of slots.slice(i + 1)) expect(overlaps(a.box, b.box)).toBe(false)
  })

  it('C-17 stack: another row, an element off screen, and a spot against the left inset', () => {
    const element = { left: 100, top: 100, width: 200, height: 50 }
    const slots = layoutPins([element, { ...element, top: 400 }, { ...element, top: 900 }], VIEWPORT)
    expect(slots.map(slot => slot.members)).toEqual([[0], [1]])
    // Near the left edge no step fits: the second pin stacks at the inset, over the first.
    const edge = { left: 0, top: 100, width: 20, height: 50 }
    expect(layoutPins([edge, edge, edge], VIEWPORT).map(slot => [slot.box.left, slot.members, slot.stack])).toEqual([
      [22, [0], false],
      [PIN_EDGE_INSET_PX, [1, 2], true]
    ])
    expect(layoutPins([], VIEWPORT)).toEqual([])
  })

  it('024-AC-001 pinLayout counts touching boxes as apart', () => {
    const box = { left: 0, top: 0, width: 10, height: 10 }
    expect(overlaps(box, { left: 9, top: 9, width: 5, height: 5 })).toBe(true)
    expect(overlaps(box, { left: 10, top: 0, width: 5, height: 5 })).toBe(false)
    expect(overlaps(box, { left: 0, top: 10, width: 5, height: 5 })).toBe(false)
  })
})
