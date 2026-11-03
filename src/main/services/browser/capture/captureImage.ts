// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The screenshot's pixels, pure (spec 025, 025-FR-034, 025-FR-035; solution
 * design § 6.1 still image, § 6.2 send).
 *
 * A {@link Bitmap} is the raw image `NativeImage.toBitmap()` gives: 4 bytes a
 * pixel in BGRA order (Chromium's native 32-bit layout on every platform
 * Erfana ships), rows top to bottom, no padding. The screenshot is taken once
 * at the pick and never PNG-encoded at confirm; at send the outline is drawn
 * on a copy and encoded once.
 *
 * - {@link drawOutline}: a solid outline `thickness` device pixels wide just
 *   outside the element's box, clipped at the image edge (a partly
 *   off-screen element's outline stops at the edge, 025-FR-035).
 * - {@link drawCrosshair}: the crosshair at the pick point (a canvas or a
 *   closed shadow root, 025-FR-034).
 * - {@link cropBitmap}: the element crop.
 * - {@link downscaleBitmap}: the still image the renderer draws, within an
 *   edge cap.
 */

export interface Bitmap {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export interface PixelRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The outline width of 025-FR-034, in device pixels. */
export const OUTLINE_DEVICE_PX = 2
/** Half the length of a crosshair arm, in device pixels. */
export const CROSSHAIR_ARM_DEVICE_PX = 12

/** A fresh copy (drawing never changes the held capture). */
export function copyBitmap(img: Bitmap): Bitmap {
  return { data: new Uint8Array(img.data), width: img.width, height: img.height }
}

/** Whether every pixel is fully transparent or the image has no pixels (the empty first capture on macOS). */
export function isEmptyBitmap(img: Bitmap): boolean {
  if (img.width <= 0 || img.height <= 0 || img.data.length < img.width * img.height * 4) return true
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 0) return false
  return true
}

function fillRect(img: Bitmap, rect: PixelRect, colour: Rgb): void {
  const x0 = Math.max(0, Math.round(rect.x))
  const y0 = Math.max(0, Math.round(rect.y))
  const x1 = Math.min(img.width, Math.round(rect.x + rect.width))
  const y1 = Math.min(img.height, Math.round(rect.y + rect.height))
  for (let y = y0; y < y1; y++) {
    let i = (y * img.width + x0) * 4
    for (let x = x0; x < x1; x++, i += 4) {
      img.data[i] = colour.b
      img.data[i + 1] = colour.g
      img.data[i + 2] = colour.r
      img.data[i + 3] = 255
    }
  }
}

/**
 * Draw a solid outline `thickness` px wide just outside `box` (device px,
 * edges rounded outward to whole pixels). Parts outside the image are left
 * out.
 */
export function drawOutline(img: Bitmap, box: PixelRect, colour: Rgb, thickness = OUTLINE_DEVICE_PX): void {
  const left = Math.floor(box.x)
  const top = Math.floor(box.y)
  const right = Math.ceil(box.x + box.width)
  const bottom = Math.ceil(box.y + box.height)
  const t = thickness
  fillRect(img, { x: left - t, y: top - t, width: right - left + 2 * t, height: t }, colour)
  fillRect(img, { x: left - t, y: bottom, width: right - left + 2 * t, height: t }, colour)
  fillRect(img, { x: left - t, y: top, width: t, height: bottom - top }, colour)
  fillRect(img, { x: right, y: top, width: t, height: bottom - top }, colour)
}

/** Draw a crosshair centred on `point` (device px). */
export function drawCrosshair(img: Bitmap, point: { x: number; y: number }, colour: Rgb, arm = CROSSHAIR_ARM_DEVICE_PX, thickness = OUTLINE_DEVICE_PX): void {
  const cx = Math.round(point.x)
  const cy = Math.round(point.y)
  const half = Math.floor(thickness / 2)
  fillRect(img, { x: cx - arm, y: cy - half, width: 2 * arm + 1, height: thickness }, colour)
  fillRect(img, { x: cx - half, y: cy - arm, width: thickness, height: 2 * arm + 1 }, colour)
}

/** The pixels of `rect` (device px, clipped to the image), or null when nothing is left. */
export function cropBitmap(img: Bitmap, rect: PixelRect): Bitmap | null {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height))
  if (x1 <= x0 || y1 <= y0) return null
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * img.width + x0) * 4
    data.set(img.data.subarray(from, from + width * 4), y * width * 4)
  }
  return { data, width, height }
}

/**
 * The image scaled down so neither side exceeds `maxWidth` × `maxHeight`
 * (never up), nearest-neighbour: the still image only stands in for the
 * page while the menu is open.
 */
export function downscaleBitmap(img: Bitmap, maxWidth: number, maxHeight: number): Bitmap {
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height)
  if (!(scale < 1)) return img
  const width = Math.max(1, Math.floor(img.width * scale))
  const height = Math.max(1, Math.floor(img.height * scale))
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale))
      const from = (sy * img.width + sx) * 4
      data.set(img.data.subarray(from, from + 4), (y * width + x) * 4)
    }
  }
  return { data, width, height }
}
