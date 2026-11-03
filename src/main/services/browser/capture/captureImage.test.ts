// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  copyBitmap,
  cropBitmap,
  downscaleBitmap,
  drawCrosshair,
  drawOutline,
  isEmptyBitmap,
  type Bitmap
} from './captureImage'

const RED = { r: 255, g: 0, b: 0 }

function blank(width: number, height: number, alpha = 255): Bitmap {
  const data = new Uint8Array(width * height * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = alpha
  return { data, width, height }
}

/** Whether pixel (x, y) is `RED`, read in BGRA order. */
function isRed(img: Bitmap, x: number, y: number): boolean {
  const i = (y * img.width + x) * 4
  return img.data[i] === 0 && img.data[i + 1] === 0 && img.data[i + 2] === 255 && img.data[i + 3] === 255
}

describe('captureImage', () => {
  it('copies without sharing pixels', () => {
    const img = blank(2, 2)
    const copy = copyBitmap(img)
    copy.data[0] = 9
    expect(img.data[0]).toBe(0)
  })

  it('counts an image with no pixels, a short buffer or only transparent pixels as empty (the first macOS capture)', () => {
    expect(isEmptyBitmap(blank(0, 0))).toBe(true)
    expect(isEmptyBitmap({ data: new Uint8Array(4), width: 2, height: 2 })).toBe(true)
    expect(isEmptyBitmap(blank(3, 3, 0))).toBe(true)
    const one = blank(3, 3, 0)
    one.data[4 * 4 + 3] = 1
    expect(isEmptyBitmap(one)).toBe(false)
  })

  it('draws a 2-device-pixel outline just outside the box, in BGRA order, and leaves the box itself alone (025-FR-034)', () => {
    const img = blank(20, 20)
    drawOutline(img, { x: 5, y: 5, width: 6, height: 4 }, RED)
    // The ring: two pixels outside each edge.
    expect(isRed(img, 3, 3)).toBe(true)
    expect(isRed(img, 4, 7)).toBe(true)
    expect(isRed(img, 12, 7)).toBe(true)
    expect(isRed(img, 7, 10)).toBe(true)
    // Not three pixels out, not inside.
    expect(isRed(img, 2, 7)).toBe(false)
    expect(isRed(img, 13, 7)).toBe(false)
    expect(isRed(img, 5, 5)).toBe(false)
    expect(isRed(img, 10, 8)).toBe(false)
  })

  it('rounds a fractional box outward and clips the outline at the image edge (partly off-screen, 025-FR-035)', () => {
    const img = blank(10, 10)
    drawOutline(img, { x: 6.4, y: -5, width: 10, height: 8.2 }, RED)
    // The left edge sits at floor(6.4) = 6: columns 4 and 5.
    expect(isRed(img, 4, 1)).toBe(true)
    expect(isRed(img, 5, 1)).toBe(true)
    expect(isRed(img, 6, 1)).toBe(false)
    // The bottom edge sits at ceil(3.2) = 4: rows 4 and 5.
    expect(isRed(img, 7, 4)).toBe(true)
    expect(isRed(img, 7, 5)).toBe(true)
    expect(isRed(img, 7, 6)).toBe(false)
  })

  it('draws a crosshair centred on the pick point', () => {
    const img = blank(40, 40)
    drawCrosshair(img, { x: 20, y: 20 }, RED)
    expect(isRed(img, 8, 20)).toBe(true)
    expect(isRed(img, 32, 20)).toBe(true)
    expect(isRed(img, 20, 8)).toBe(true)
    expect(isRed(img, 20, 32)).toBe(true)
    expect(isRed(img, 7, 20)).toBe(false)
    expect(isRed(img, 25, 25)).toBe(false)
  })

  it('crops to the image, null when nothing is left', () => {
    const img = blank(4, 4)
    img.data[(1 * 4 + 2) * 4] = 77
    const crop = cropBitmap(img, { x: 2, y: 1, width: 10, height: 1 })!
    expect([crop.width, crop.height]).toEqual([2, 1])
    expect(crop.data[0]).toBe(77)
    expect(cropBitmap(img, { x: 5, y: 0, width: 2, height: 2 })).toBeNull()
  })

  it('scales the still image down within the cap, never up', () => {
    const img = blank(100, 50)
    expect(downscaleBitmap(img, 200, 200)).toBe(img)
    const small = downscaleBitmap(img, 10, 10)
    expect([small.width, small.height]).toEqual([10, 5])
    expect(small.data.length).toBe(10 * 5 * 4)
    const thin = downscaleBitmap(blank(10_000, 1), 100, 100)
    expect([thin.width, thin.height]).toEqual([100, 1])
  })
})
