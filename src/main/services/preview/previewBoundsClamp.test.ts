// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { clampAndZoomBounds } from './previewBoundsClamp'

const CONTENT = { width: 1000, height: 800 }

describe('clampAndZoomBounds', () => {
  it('passes a fully-visible rect through unchanged at zoom 1.0', () => {
    const result = clampAndZoomBounds({ x: 10, y: 20, width: 100, height: 50 }, CONTENT, 1)
    expect(result).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('MULTIPLIES CSS pixels by the zoom factor (300 % = 3.0)', () => {
    // A 100-CSS-px placeholder at 300 % occupies 300 DIPs (design §4.3).
    const result = clampAndZoomBounds({ x: 10, y: 20, width: 100, height: 50 }, CONTENT, 3)
    expect(result).toEqual({ x: 30, y: 60, width: 300, height: 150 })
  })

  it('multiplies (never divides) at fractional zoom', () => {
    const result = clampAndZoomBounds({ x: 0, y: 0, width: 100, height: 100 }, CONTENT, 2)
    expect(result).toEqual({ x: 0, y: 0, width: 200, height: 200 })
  })

  it('clamps a rect that overflows the content rect to the content edges', () => {
    const result = clampAndZoomBounds({ x: 900, y: 700, width: 400, height: 400 }, CONTENT, 1)
    expect(result).toEqual({ x: 900, y: 700, width: 100, height: 100 })
  })

  it('drops a zero-width rect', () => {
    expect(clampAndZoomBounds({ x: 10, y: 10, width: 0, height: 50 }, CONTENT, 1)).toBeNull()
  })

  it('drops a negative-height rect', () => {
    expect(clampAndZoomBounds({ x: 10, y: 10, width: 50, height: -5 }, CONTENT, 1)).toBeNull()
  })

  it('drops a rect that clamps entirely offscreen', () => {
    // Entirely to the right of the content rect after clamping ⇒ zero width.
    expect(clampAndZoomBounds({ x: 1000, y: 10, width: 50, height: 50 }, CONTENT, 1)).toBeNull()
  })

  it('falls back to zoom 1.0 for a non-finite or non-positive zoom factor', () => {
    expect(clampAndZoomBounds({ x: 5, y: 5, width: 10, height: 10 }, CONTENT, 0)).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 10
    })
    expect(clampAndZoomBounds({ x: 5, y: 5, width: 10, height: 10 }, CONTENT, Number.NaN)).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 10
    })
  })
})
