// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Encoding a still frame within its size budget (`PreviewStillFrameCache`).
 *
 * A still stands in for the page behind a popup, a menu or a warning list, where
 * it is read, so it keeps the screen's pixels up to the sharp caps. A picture
 * too big for those falls back to the smaller caps, and past those there is no
 * frame at all – never a partial or blank one.
 */
import type { PreviewNativeImage } from './PreviewStillFrameCache'

/** Longest edge, in px, of a frame that keeps the screen's pixels. */
export const MAX_SHARP_FRAME_EDGE_PX = 4096
/** Data-URL chars of a frame that keeps the screen's pixels. */
export const MAX_SHARP_FRAME_DATAURL_CHARS = 12 * 1024 * 1024

/** One budget: a longest edge in px and a data-URL length. */
export interface StillFrameBudget {
  readonly edgePx: number
  readonly dataUrlChars: number
}

/** A frame's encoded picture. */
export interface EncodedStillFrame {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

/** Downscale so the longest edge is at most `maxEdgePx`, preserving aspect ratio. */
function downscale(image: PreviewNativeImage, maxEdgePx: number): PreviewNativeImage {
  const { width, height } = image.getSize()
  const longestEdge = Math.max(width, height)
  if (longestEdge <= maxEdgePx || longestEdge === 0) {
    return image
  }
  const scale = maxEdgePx / longestEdge
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good'
  })
}

/**
 * Encode `image` within the first budget it fits.
 *
 * @param image - The capture.
 * @param budgets - The budgets, largest first.
 * @returns The picture, or `null` when it fits none of them.
 */
export function encodeStillFrame(
  image: PreviewNativeImage,
  budgets: readonly StillFrameBudget[]
): EncodedStillFrame | null {
  for (const { edgePx, dataUrlChars } of budgets) {
    const fitted = downscale(image, edgePx)
    const dataUrl = fitted.toDataURL()
    if (dataUrl.length <= dataUrlChars) return { dataUrl, ...fitted.getSize() }
  }
  return null
}
