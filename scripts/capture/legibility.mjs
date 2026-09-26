// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The README demo's legibility check at the final encode (design § Loop for
 * #139; R138-3). A frame from each encoded file is scaled to the README's
 * display width, the terminal region is read back by OCR, and the terminal's
 * capital-letter height is measured from the OCR word boxes.
 *
 * Pass: the known line the scene sent is read back (hand-off frame), and the
 * capital height is at least 7 px at the display width (every frame).
 */

import { createRequire } from 'node:module'
import path from 'node:path'

/** #139's README display width. */
export const DISPLAY_WIDTH = 800
/** The bar: capital-letter height at the display width. */
export const MIN_CAP_PX = 7
/** OCR reads an upscaled crop; box heights are divided back by this. */
export const OCR_UPSCALE = 3

/** Letters that reach below the baseline: a word with one is not a capital-height sample. */
const DESCENDERS = /[gjpqy,;()[\]{}|_]/

export function resolveSharp(fromDir) {
  const require = createRequire(path.join(fromDir, 'noop.js'))
  try {
    return require('sharp')
  } catch {
    throw new Error('sharp is not installed (a devDependency for the capture pipeline). Run `npm ci`; WebP frames cannot be decoded without it.')
  }
}

/** Collapse whitespace and case, so OCR line breaks do not matter. */
export function normalise(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Capital-letter height (px at display width) from OCR words: words that
 * start with a capital, are at least three letters long and have no
 * descender, so their box is cap-height tall. The median of those.
 *
 * @param {Array<{ text: string, bbox: { y0: number, y1: number } }>} words - boxes in upscaled pixels
 * @returns {{ px: number | null, samples: number }}
 */
export function capitalHeight(words, upscale = OCR_UPSCALE) {
  const heights = words
    .filter((w) => /^[A-Z][A-Za-z]{2,}[.:]?$/.test(w.text) && !DESCENDERS.test(w.text))
    .map((w) => (w.bbox.y1 - w.bbox.y0) / upscale)
    .sort((a, b) => a - b)
  if (heights.length === 0) return { px: null, samples: 0 }
  const mid = Math.floor(heights.length / 2)
  const px = heights.length % 2 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2
  return { px: Math.round(px * 10) / 10, samples: heights.length }
}

/**
 * Judge one frame's OCR result.
 *
 * @param {{ text: string, words: Array<{ text: string, bbox: { y0: number, y1: number } }> }} ocr
 * @param {string | null} knownLine - text that must be read back, or null
 */
export function judgeFrame(ocr, knownLine) {
  const cap = capitalHeight(ocr.words)
  const readBack = knownLine === null ? null : normalise(ocr.text).includes(normalise(knownLine))
  const reasons = []
  if (cap.px === null) reasons.push('no capital-height sample read')
  else if (cap.px < MIN_CAP_PX) reasons.push(`capital height ${cap.px} px < ${MIN_CAP_PX} px`)
  if (readBack === false) reasons.push('the known line was not read back')
  return { ok: reasons.length === 0, capPx: cap.px, samples: cap.samples, readBack, reasons }
}

/**
 * The terminal region at display width, upscaled for OCR, as a PNG buffer.
 *
 * @param {object} sharp - the sharp module
 * @param {Buffer} framePng - the frame at its source width
 * @param {{ x: number, y: number, width: number, height: number }} rect - terminal, in source pixels
 * @param {number} sourceWidth
 */
export async function terminalCrop(sharp, framePng, rect, sourceWidth) {
  const k = DISPLAY_WIDTH / sourceWidth
  const display = await sharp(framePng).resize({ width: DISPLAY_WIDTH, kernel: 'lanczos3' }).png().toBuffer()
  const meta = await sharp(display).metadata()
  const left = Math.max(0, Math.floor(rect.x * k))
  const top = Math.max(0, Math.floor(rect.y * k))
  const width = Math.min(meta.width - left, Math.ceil(rect.width * k))
  const height = Math.min(meta.height - top, Math.ceil(rect.height * k))
  const crop = await sharp(display).extract({ left, top, width, height }).png().toBuffer()
  // The terminal is light text on dark; OCR reads dark on light best.
  const upscaled = await sharp(crop)
    .resize({ width: width * OCR_UPSCALE, kernel: 'lanczos3' })
    .greyscale()
    .negate({ alpha: false })
    .png()
    .toBuffer()
  return { display, crop, upscaled }
}
