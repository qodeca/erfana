// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the PDF geometry gate.
 *
 * Requirement 6 promises a single page of exactly the image's pixel size. This
 * is the runtime proof of that promise, so the negative cases are the point: a
 * two-page buffer, a MediaBox one point out and a buffer that is not a PDF at
 * all must all be refused.
 *
 * Fixtures are minimal PDF byte strings — text, no binary, no third-party
 * bytes in the repository.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect } from 'vitest'
import { IMAGE_EXPORT } from '../../../shared/ipc/image-export-schema'
import { PDF_POINTS_PER_CSS_PIXEL, verifyPdfGeometry } from './pdfGeometry'

/** A minimal PDF carrying `pages` page objects and one MediaBox. */
function pdf(pages: number, widthPt: number, heightPt: number): Uint8Array {
  const pageObjects = Array.from(
    { length: pages },
    (_value, index) =>
      `${index + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] >>\nendobj\n`
  ).join('')
  return Buffer.from(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
      `2 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n` +
      `${pageObjects}%%EOF\n`,
    'latin1'
  )
}

/** 200 x 80 CSS px is 150 x 60 pt. */
const WIDTH_PX = 200
const HEIGHT_PX = 80
const WIDTH_PT = WIDTH_PX * PDF_POINTS_PER_CSS_PIXEL
const HEIGHT_PT = HEIGHT_PX * PDF_POINTS_PER_CSS_PIXEL

describe('verifyPdfGeometry', () => {
  it('accepts one page whose MediaBox is exactly the requested size', () => {
    const result = verifyPdfGeometry(pdf(1, WIDTH_PT, HEIGHT_PT), WIDTH_PX, HEIGHT_PX)
    expect(result).toEqual({ ok: true, pageCount: 1, widthPt: WIDTH_PT, heightPt: HEIGHT_PT })
  })

  it('converts CSS pixels to points at 0.75, the CSS definition', () => {
    expect(PDF_POINTS_PER_CSS_PIXEL).toBe(72 / 96)
  })

  it('accepts a MediaBox inside the tolerance', () => {
    const nudged = WIDTH_PT + IMAGE_EXPORT.PDF_MEDIABOX_TOLERANCE_PT
    expect(verifyPdfGeometry(pdf(1, nudged, HEIGHT_PT), WIDTH_PX, HEIGHT_PX).ok).toBe(true)
  })

  it('rejects a MediaBox one point too wide', () => {
    const result = verifyPdfGeometry(pdf(1, WIDTH_PT + 1, HEIGHT_PT), WIDTH_PX, HEIGHT_PX)
    expect(result).toMatchObject({ ok: false, reason: 'size-mismatch' })
  })

  it('rejects a MediaBox one point too tall', () => {
    const result = verifyPdfGeometry(pdf(1, WIDTH_PT, HEIGHT_PT + 1), WIDTH_PX, HEIGHT_PX)
    expect(result).toMatchObject({ ok: false, reason: 'size-mismatch' })
  })

  it('rejects a two-page document', () => {
    const result = verifyPdfGeometry(pdf(2, WIDTH_PT, HEIGHT_PT), WIDTH_PX, HEIGHT_PX)
    expect(result).toMatchObject({ ok: false, reason: 'page-count', pageCount: 2 })
  })

  it('does not count the /Pages tree root as a page', () => {
    const result = verifyPdfGeometry(pdf(1, WIDTH_PT, HEIGHT_PT), WIDTH_PX, HEIGHT_PX)
    expect(result).toMatchObject({ ok: true, pageCount: 1 })
  })

  it('rejects a document with no page object at all', () => {
    const empty = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'latin1')
    expect(verifyPdfGeometry(empty, WIDTH_PX, HEIGHT_PX)).toMatchObject({
      ok: false,
      reason: 'page-count',
      pageCount: 0
    })
  })

  it('rejects a page with no MediaBox', () => {
    const noBox = Buffer.from(
      '%PDF-1.7\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n%%EOF',
      'latin1'
    )
    expect(verifyPdfGeometry(noBox, WIDTH_PX, HEIGHT_PX)).toMatchObject({
      ok: false,
      reason: 'no-media-box'
    })
  })

  it('rejects a buffer that is not a PDF, without throwing', () => {
    const junk = Uint8Array.from({ length: 128 }, (_value, index) => index)
    expect(() => verifyPdfGeometry(junk, WIDTH_PX, HEIGHT_PX)).not.toThrow()
    expect(verifyPdfGeometry(junk, WIDTH_PX, HEIGHT_PX).ok).toBe(false)
  })

  it('tolerates whitespace variants in the page dictionary', () => {
    const spaced = Buffer.from(
      '%PDF-1.7\n3 0 obj\n<< /Type  /Page /MediaBox [ 0 0 150 60 ] >>\nendobj\n%%EOF',
      'latin1'
    )
    expect(verifyPdfGeometry(spaced, WIDTH_PX, HEIGHT_PX).ok).toBe(true)
  })

  it('measures a MediaBox with a non-zero origin', () => {
    const offset = Buffer.from(
      '%PDF-1.7\n3 0 obj\n<< /Type /Page /MediaBox [10 20 160 80] >>\nendobj\n%%EOF',
      'latin1'
    )
    expect(verifyPdfGeometry(offset, WIDTH_PX, HEIGHT_PX).ok).toBe(true)
  })

  it('keeps the tolerance in one shared constant', () => {
    expect(IMAGE_EXPORT.PDF_MEDIABOX_TOLERANCE_PT).toBe(0.75)
  })
})

/**
 * Why the tolerance is one CSS pixel and not the half point it started as.
 *
 * Chromium's `printToPDF` quantizes the CSS `@page` size onto a 1/300 in grid.
 * For any dimension where `px % 8 === 6` the produced MediaBox comes back
 * 0.54 pt LARGER than asked for — measured by sweeping heights 8-64 px: 14, 22,
 * 30, 38, 46, 54 and 62 all overshoot, every other height is exact. A 0.5 pt
 * tolerance is tighter than that grid can express, so the gate refused roughly
 * one pixel size in eight, per axis, in every format, and the user saw "the PDF
 * page came out the wrong size" for an ordinary image (issue #73).
 *
 * The cases below are the whole argument: the rounding artefact must pass, and
 * the failures the gate actually exists to catch — letterboxing onto a fixed
 * paper size, and a scaled page — must still fail, because both are off by
 * whole page fractions rather than by a fraction of a pixel.
 */
describe('verifyPdfGeometry tolerance – one CSS pixel, not half a point', () => {
  /** The overshoot Chromium produces on the refused grid, in points. */
  const CHROMIUM_GRID_OVERSHOOT_PT = 0.54

  /** 60 x 22 px: a height on the refused grid (22 % 8 === 6). */
  const QUANTIZED_WIDTH_PX = 60
  const QUANTIZED_HEIGHT_PX = 22

  it("accepts Chromium's 0.54 pt grid overshoot, which 0.5 pt refused", () => {
    const result = verifyPdfGeometry(
      pdf(
        1,
        QUANTIZED_WIDTH_PX * PDF_POINTS_PER_CSS_PIXEL,
        QUANTIZED_HEIGHT_PX * PDF_POINTS_PER_CSS_PIXEL + CHROMIUM_GRID_OVERSHOOT_PT
      ),
      QUANTIZED_WIDTH_PX,
      QUANTIZED_HEIGHT_PX
    )
    expect(result).toMatchObject({ ok: true, pageCount: 1 })
  })

  it('accepts the overshoot on both axes at once', () => {
    const result = verifyPdfGeometry(
      pdf(
        1,
        WIDTH_PX * PDF_POINTS_PER_CSS_PIXEL + CHROMIUM_GRID_OVERSHOOT_PT,
        HEIGHT_PX * PDF_POINTS_PER_CSS_PIXEL + CHROMIUM_GRID_OVERSHOOT_PT
      ),
      WIDTH_PX,
      HEIGHT_PX
    )
    expect(result).toMatchObject({ ok: true, pageCount: 1 })
  })

  it('still refuses a letterboxed A4 page', () => {
    const result = verifyPdfGeometry(pdf(1, 595.276, 841.89), WIDTH_PX, HEIGHT_PX)
    expect(result).toMatchObject({ ok: false, reason: 'size-mismatch' })
  })

  it('still refuses a page rendered at 2x scale', () => {
    const result = verifyPdfGeometry(pdf(1, WIDTH_PT * 2, HEIGHT_PT * 2), WIDTH_PX, HEIGHT_PX)
    expect(result).toMatchObject({ ok: false, reason: 'size-mismatch' })
  })

  it('still refuses a page one full CSS pixel over on a single axis', () => {
    const overByMoreThanAPixel = HEIGHT_PT + PDF_POINTS_PER_CSS_PIXEL * 2
    const result = verifyPdfGeometry(pdf(1, WIDTH_PT, overByMoreThanAPixel), WIDTH_PX, HEIGHT_PX)
    expect(result).toMatchObject({ ok: false, reason: 'size-mismatch' })
  })
})
