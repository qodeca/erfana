// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The README video's legibility check at the final encode (spec 023,
 * 023-NFR-004). A region of a frame – a step's label, the terminal – is
 * scaled to the width it is judged at, read back by OCR, and its
 * capital-letter height is measured from the OCR word boxes.
 *
 * Pass: the known text (a label) is read back, and the capital height is at
 * least 7 px at that width.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

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
 * The height (px) of the first letter in a crop of light text on a dark
 * ground: the first run of columns with a light pixel, then the rows those
 * columns light up (a column lit top to bottom, the box's edge, is skipped).
 * Every README video label starts with a capital that has
 * no descender, so this is the label's capital height, measured from the
 * pixels rather than from OCR's word boxes (which for a label like
 * "Capture window…" all reach down to the p).
 *
 * @param {{ data: Uint8Array | Buffer, width: number, height: number }} grey - one grey value per pixel
 */
export function firstLetterHeight({ data, width, height }, threshold = 128) {
  const lit = (x, y) => data[y * width + x] >= threshold
  const litRows = (x) => {
    let n = 0
    for (let y = 0; y < height; y++) if (lit(x, y)) n++
    return n
  }
  const litColumn = (x) => litRows(x) > 0
  // A column lit nearly top to bottom is the box's soft edge, not a letter.
  const edge = (x) => litRows(x) >= height - 1
  let x0 = 0
  while (x0 < width && (!litColumn(x0) || edge(x0))) x0++
  if (x0 === width) return null
  let x1 = x0
  while (x1 + 1 < width && litColumn(x1 + 1)) x1++
  let top = height
  let bottom = -1
  for (let x = x0; x <= x1; x++) {
    for (let y = 0; y < height; y++) {
      if (lit(x, y)) {
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  return bottom - top + 1
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
 * The caption box in one row of grey pixels from the top of the title bar:
 * the span from the first to the last dark pixel (the box is dark, the title
 * bar light), searched between `from` and `to` so the window buttons at the
 * left edge are left out. Null when the row has no dark pixel there.
 *
 * @param {Uint8Array | Buffer} row - one grey value per pixel
 */
export function darkSpan(row, from = 0, to = row.length, threshold = 128) {
  let first = -1
  let last = -1
  for (let x = from; x < to; x++) {
    if (row[x] < threshold) {
      if (first < 0) first = x
      last = x
    }
  }
  return first < 0 ? null : { x: first, width: last - first + 1 }
}

/**
 * A region of a frame as seen at `displayWidth`, upscaled and turned dark on
 * light for OCR (spec 023: the labels at the README's 880 px, the app's text
 * at full size). Light text on a dark ground is assumed, as in the terminal,
 * the title bar and the labels.
 *
 * @param {object} sharp - the sharp module
 * @param {Buffer} framePng - the frame at its source width
 * @param {{ x: number, y: number, width: number, height: number }} rect - in source pixels
 * @param {number} sourceWidth
 * @param {number} displayWidth
 */
export async function regionCrop(sharp, framePng, rect, sourceWidth, displayWidth) {
  const k = displayWidth / sourceWidth
  const display = await sharp(framePng).resize({ width: displayWidth, kernel: 'lanczos3' }).png().toBuffer()
  const meta = await sharp(display).metadata()
  const left = Math.max(0, Math.floor(rect.x * k))
  const top = Math.max(0, Math.floor(rect.y * k))
  const width = Math.min(meta.width - left, Math.ceil(rect.width * k))
  const height = Math.min(meta.height - top, Math.ceil(rect.height * k))
  const crop = await sharp(display).extract({ left, top, width, height }).png().toBuffer()
  // A dark margin, so text that fills a thin region (a label in the 32 px title
  // bar) does not touch the edge: OCR draws its word boxes short there.
  const margin = Math.max(4, Math.round(height / 2))
  const padded = await sharp(crop)
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer()
  // The terminal is light text on dark; OCR reads dark on light best.
  const upscaled = await sharp(padded)
    .resize({ width: (width + 2 * margin) * OCR_UPSCALE, kernel: 'lanczos3' })
    .greyscale()
    .negate({ alpha: false })
    .png()
    .toBuffer()
  return { display, crop, upscaled }
}
