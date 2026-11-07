// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  applyAffine,
  boxChanged,
  composeAffine,
  cropBox,
  distance,
  frameToParent,
  IDENTITY,
  intersect,
  invertAffine,
  mapBox,
  pointerCandidates,
  quadBounds,
  quadFrom,
  scaleBox,
  visibilityNote,
  type Quad
} from './pickGeometry'

const close = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-6)

/** The content quad of a `w` × `h` frame at `(x, y)`, rotated by `deg` about its top-left and scaled by `s`. */
function transformedQuad(x: number, y: number, w: number, h: number, deg: number, s: number): Quad {
  const r = (deg * Math.PI) / 180
  const at = (px: number, py: number) => ({ x: x + s * (px * Math.cos(r) - py * Math.sin(r)), y: y + s * (px * Math.sin(r) + py * Math.cos(r)) })
  return [at(0, 0), at(w, 0), at(w, h), at(0, h)]
}

describe('pickGeometry', () => {
  it('reads a CDP quad of 8 finite numbers and refuses anything else', () => {
    expect(quadFrom([0, 0, 10, 0, 10, 5, 0, 5])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 }
    ])
    expect(quadFrom([0, 0, 10, 0, 10, 5, 0])).toBeNull()
    expect(quadFrom([0, 0, 10, 0, 10, 5, 0, Number.NaN])).toBeNull()
    expect(quadFrom([0, 0, 10, 0, 10, 5, 0, '5'])).toBeNull()
    expect(quadFrom(null)).toBeNull()
  })

  it('bounds a rotated quad axis-aligned', () => {
    expect(quadBounds([{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }])).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('composes, applies and inverts affine maps; a degenerate map has no inverse', () => {
    const scale = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    const shift = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }
    // Scale first, then shift.
    expect(applyAffine(composeAffine(shift, scale), { x: 1, y: 1 })).toEqual({ x: 12, y: 22 })
    const inverse = invertAffine(composeAffine(shift, scale))!
    const back = applyAffine(inverse, { x: 12, y: 22 })
    close(back.x, 1)
    close(back.y, 1)
    expect(invertAffine({ a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 })).toBeNull()
    expect(invertAffine({ a: Number.NaN, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull()
    expect(applyAffine(IDENTITY, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 })
  })

  it('maps a frame point into its parent exactly through a rotated and scaled content quad (the commit-8 probe frame)', () => {
    const quad = transformedQuad(100, 50, 300, 200, 12, 0.8)
    const map = frameToParent(quad, 300, 200)!
    // The frame's corners land on the quad's corners.
    for (const [local, expected] of [
      [{ x: 0, y: 0 }, quad[0]],
      [{ x: 300, y: 0 }, quad[1]],
      [{ x: 300, y: 200 }, quad[2]],
      [{ x: 0, y: 200 }, quad[3]]
    ] as const) {
      const p = applyAffine(map, local)
      close(p.x, expected.x)
      close(p.y, expected.y)
    }
    // And the inverse takes a view point back to the frame-local one.
    const local = applyAffine(invertAffine(map)!, applyAffine(map, { x: 40, y: 30 }))
    close(local.x, 40)
    close(local.y, 30)
  })

  it('has no map into an empty frame', () => {
    const quad = transformedQuad(0, 0, 10, 10, 0, 1)
    expect(frameToParent(quad, 0, 10)).toBeNull()
    expect(frameToParent(quad, 10, Number.NaN)).toBeNull()
  })

  it('maps a box to its axis-aligned bounds', () => {
    const rotate90 = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }
    expect(mapBox(rotate90, { x: 0, y: 0, width: 10, height: 4 })).toEqual({ x: -4, y: 0, width: 4, height: 10 })
  })

  describe('pointerCandidates', () => {
    it('takes x and y as the view point when the globals are 0, 0 (main-side sendInputEvent)', () => {
      expect(pointerCandidates({ x: 12, y: 34, globalX: 0, globalY: 0 }, { x: 500, y: 300 })).toEqual({ kind: 'view', point: { x: 12, y: 34 } })
      expect(pointerCandidates({ x: 12, y: 34 }, { x: 500, y: 300 })).toEqual({ kind: 'view', point: { x: 12, y: 34 } })
    })

    it('takes the globals minus the view origin when x and y agree with them within 2 px', () => {
      expect(pointerCandidates({ x: 12, y: 34, globalX: 513, globalY: 335 }, { x: 500, y: 300 })).toEqual({ kind: 'view', point: { x: 13, y: 35 } })
    })

    it("derives a frame's bounding-box origin when x and y are frame-local (a transformed cross-site frame)", () => {
      const got = pointerCandidates({ x: 20, y: 10, globalX: 640, globalY: 380 }, { x: 500, y: 300 })
      expect(got).toEqual({ kind: 'frame', local: { x: 20, y: 10 }, frameOrigin: { x: 120, y: 70 }, fallback: { x: 140, y: 80 } })
    })
  })

  it('measures distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('counts a box as changed only beyond 1 px on some edge', () => {
    const a = { x: 10, y: 10, width: 100, height: 20 }
    expect(boxChanged(a, { x: 11, y: 9, width: 100, height: 20 })).toBe(false)
    expect(boxChanged(a, { x: 11.5, y: 10, width: 100, height: 20 })).toBe(true)
    expect(boxChanged(a, { x: 10, y: 10, width: 101.5, height: 20 })).toBe(true)
    expect(boxChanged(a, { x: 10, y: 10, width: 100, height: 22 })).toBe(true)
    expect(boxChanged(a, { x: 10, y: 12, width: 100, height: 20 })).toBe(true)
  })

  it('intersects boxes, null when they only touch or are apart', () => {
    expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({ x: 5, y: 5, width: 5, height: 5 })
    expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBeNull()
    expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 20, width: 5, height: 5 })).toBeNull()
  })

  it('notes zero size, off-screen and partly off-screen, and nothing for a wholly visible box (025-FR-035)', () => {
    const viewport = { x: 0, y: 0, width: 800, height: 600 }
    expect(visibilityNote({ x: 10, y: 10, width: 0, height: 10 }, viewport)).toBe('zeroSize')
    expect(visibilityNote({ x: 10, y: 10, width: 10, height: Number.NaN }, viewport)).toBe('zeroSize')
    expect(visibilityNote({ x: 10, y: -50, width: 10, height: 20 }, viewport)).toBe('offScreen')
    expect(visibilityNote({ x: 10, y: 590, width: 10, height: 20 }, viewport)).toBe('partlyOffScreen')
    expect(visibilityNote({ x: 10, y: 10, width: 10, height: 20 }, viewport)).toBeNull()
    // Sub-pixel rounding at the edge is still wholly visible.
    expect(visibilityNote({ x: 0, y: 0, width: 800.4, height: 20 }, viewport)).toBeNull()
  })

  it('scales a box and grows the crop by its margin, clipped to the viewport', () => {
    expect(scaleBox({ x: 1, y: 2, width: 3, height: 4 }, 2)).toEqual({ x: 2, y: 4, width: 6, height: 8 })
    expect(cropBox({ x: 10, y: 100, width: 50, height: 20 }, 24, { width: 800, height: 600 })).toEqual({ x: 0, y: 76, width: 84, height: 68 })
    expect(cropBox({ x: 900, y: 100, width: 50, height: 20 }, 24, { width: 800, height: 600 })).toBeNull()
  })
})
