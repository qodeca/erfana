// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { ANCHOR_GAP_PX, EDGE_PX, placeCommentWindow } from './commentPlacement'

const AREA = { left: 100, top: 50, width: 1000, height: 700 }
const SIZE = { width: 360, height: 300 }
const VIEWPORT = 800

describe('placeCommentWindow', () => {
  it('opens to the right of the point when it fits', () => {
    const placed = placeCommentWindow({ x: 300, y: 200 }, SIZE, AREA, VIEWPORT)
    expect(placed).toMatchObject({
      kind: 'float',
      side: 'right',
      left: 300 + ANCHOR_GAP_PX,
      top: 200 - ANCHOR_GAP_PX
    })
  })

  it('falls back to the left near the right edge', () => {
    const placed = placeCommentWindow({ x: 1000, y: 200 }, SIZE, AREA, VIEWPORT)
    expect(placed).toMatchObject({ kind: 'float', side: 'left', left: 1000 - ANCHOR_GAP_PX - 360 })
  })

  it('goes below when neither side fits', () => {
    const narrow = { left: 0, top: 0, width: 500, height: 700 }
    const placed = placeCommentWindow({ x: 250, y: 100 }, SIZE, narrow, VIEWPORT)
    expect(placed).toMatchObject({ kind: 'float', side: 'below', top: 100 + ANCHOR_GAP_PX })
    // Centred on the point, clamped inside the edge.
    if (placed.kind === 'float') {
      expect(placed.left).toBeGreaterThanOrEqual(EDGE_PX)
      expect(placed.left + 360).toBeLessThanOrEqual(500 - EDGE_PX)
    }
  })

  it('goes above when below does not fit either', () => {
    const narrow = { left: 0, top: 0, width: 500, height: 700 }
    const placed = placeCommentWindow({ x: 250, y: 600 }, SIZE, narrow, VIEWPORT)
    expect(placed).toMatchObject({ kind: 'float', side: 'above', top: 600 - ANCHOR_GAP_PX - 300 })
  })

  it('clamps the top so the window stays inside the area', () => {
    const placed = placeCommentWindow({ x: 300, y: 740 }, SIZE, AREA, VIEWPORT)
    expect(placed.kind).toBe('float')
    if (placed.kind === 'float') expect(placed.top).toBe(50 + 700 - EDGE_PX - 300)
  })

  it('caps width at 480 and height at 560', () => {
    const big = { left: 0, top: 0, width: 2000, height: 2000 }
    const placed = placeCommentWindow({ x: 10, y: 10 }, { width: 900, height: 900 }, big, 2000)
    expect(placed).toMatchObject({ maxWidth: 480, maxHeight: 560 })
  })

  it('becomes a bottom sheet under 400px wide', () => {
    const area = { left: 20, top: 40, width: 399, height: 500 }
    expect(placeCommentWindow({ x: 50, y: 50 }, SIZE, area, VIEWPORT)).toEqual({
      kind: 'sheet',
      left: 20,
      width: 399,
      bottom: VIEWPORT - 540,
      maxHeight: 500 - 2 * EDGE_PX
    })
  })

  it('never returns a negative size for a degenerate area', () => {
    const placed = placeCommentWindow(
      { x: 0, y: 0 },
      SIZE,
      { left: 0, top: 0, width: 0, height: 0 },
      0
    )
    expect(placed).toMatchObject({ kind: 'sheet', maxHeight: 0, bottom: 0 })
  })
})
