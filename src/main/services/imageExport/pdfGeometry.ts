// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Proving that a produced PDF really is one page of the requested size.
 *
 * Requirement 6 says the PDF page equals the image's pixel size, with no
 * margins, no scaling and exactly one page. The mechanism is a CSS
 * `@page { size: <w>px <h>px }` rule plus `preferCSSPageSize: true`, and CSS
 * px is unambiguous (1 px = 1/96 in = 0.75 pt). What is NOT verifiable from
 * outside a real Chromium is whether `printToPDF` honours that rule in every
 * Electron build on every platform.
 *
 * So this is a runtime GATE, not documentation. The produced buffer is parsed
 * before anything is written, and a PDF whose geometry does not match is
 * refused with `IMAGE_EXPORT_PDF_GEOMETRY_FAILED` and never reaches the disk.
 * Silently shipping a letter-sized page with the image in one corner would be
 * worse than an honest failure.
 *
 * The tolerance lives in one constant, shared with the e2e assertion, so the
 * gate and the test cannot drift apart. It is one CSS pixel wide because
 * Chromium rounds the page box onto a 1/300 in grid — see
 * `IMAGE_EXPORT.PDF_MEDIABOX_TOLERANCE_PT` for the measurement.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { IMAGE_EXPORT } from '../../../shared/ipc/image-export-schema'

/** PDF user-space units per CSS pixel: 72 pt/in ÷ 96 px/in. */
export const PDF_POINTS_PER_CSS_PIXEL = 0.75

/**
 * `/Type /Page` — with a negative lookahead so `/Type /Pages` (the page-tree
 * root, always present exactly once) is not counted as a page.
 */
const PAGE_OBJECT = /\/Type\s*\/Page(?![a-zA-Z])/g

/** `/MediaBox [ llx lly urx ury ]`, the first occurrence. */
const MEDIA_BOX = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/

/** Why a produced PDF was rejected. */
export type PdfGeometryFailure =
  /** The buffer did not contain exactly one page object. */
  | 'page-count'
  /** No `/MediaBox` array could be found. */
  | 'no-media-box'
  /** The MediaBox is outside the tolerance for the requested size. */
  | 'size-mismatch'

/** The verdict on a produced PDF. */
export type PdfGeometryResult =
  | { ok: true; pageCount: number; widthPt: number; heightPt: number }
  | { ok: false; reason: PdfGeometryFailure; pageCount: number }

/**
 * Verify a produced PDF is a single page of exactly the requested pixel size.
 *
 * @param buffer - The bytes `printToPDF` returned.
 * @param widthPx - Requested page width in CSS pixels.
 * @param heightPx - Requested page height in CSS pixels.
 * @returns `{ ok: true }` with the measured geometry, or `{ ok: false }` with
 *          the reason. Never throws — a buffer that is not a PDF at all simply
 *          fails the page count.
 *
 * @example
 * ```ts
 * verifyPdfGeometry(buf, 200, 80) // { ok: true, widthPt: 150, heightPt: 60 }
 * ```
 */
export function verifyPdfGeometry(
  buffer: Uint8Array,
  widthPx: number,
  heightPx: number
): PdfGeometryResult {
  // latin1: PDF dictionaries are ASCII, and a 1:1 byte→char decode keeps the
  // compressed content streams from producing decoder errors or shifting
  // offsets the way a UTF-8 decode would.
  const text = Buffer.from(buffer).toString('latin1')

  const pageCount = text.match(PAGE_OBJECT)?.length ?? 0
  if (pageCount !== 1) {
    return { ok: false, reason: 'page-count', pageCount }
  }

  const box = MEDIA_BOX.exec(text)
  if (!box) {
    return { ok: false, reason: 'no-media-box', pageCount }
  }

  const widthPt = Math.abs(Number.parseFloat(box[3]) - Number.parseFloat(box[1]))
  const heightPt = Math.abs(Number.parseFloat(box[4]) - Number.parseFloat(box[2]))
  const expectedWidthPt = widthPx * PDF_POINTS_PER_CSS_PIXEL
  const expectedHeightPt = heightPx * PDF_POINTS_PER_CSS_PIXEL
  const tolerance = IMAGE_EXPORT.PDF_MEDIABOX_TOLERANCE_PT

  if (
    !Number.isFinite(widthPt) ||
    !Number.isFinite(heightPt) ||
    Math.abs(widthPt - expectedWidthPt) > tolerance ||
    Math.abs(heightPt - expectedHeightPt) > tolerance
  ) {
    return { ok: false, reason: 'size-mismatch', pageCount }
  }

  return { ok: true, pageCount, widthPt, heightPt }
}
