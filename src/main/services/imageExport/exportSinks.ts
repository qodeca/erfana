// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The three places exported pixels can end up: a PNG file, a PDF file, or the
 * OS clipboard.
 *
 * Each sink is the last step of the pipeline and each returns a verdict rather
 * than throwing, so `ImageExportService` keeps a single error-mapping point.
 * None of them decides anything about the pixels — by the time a sink runs,
 * the size, the background and the frame have already been chosen.
 *
 * Two rules the sinks enforce that are easy to lose:
 *
 * - **Nothing is written until the output has been verified.** The PDF sink
 *   parses the buffer `printToPDF` produced and refuses a wrong-sized or
 *   multi-page result. A wrong PDF that exists on disk is worse than an error.
 * - **Paths never reach the log verbatim.** The destination is outside the
 *   project and describes the user's own folder layout, so it is the more
 *   sensitive of the two paths, not the less.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { clipboard, nativeImage } from 'electron'
import { writeFile } from 'fs/promises'
import { ErrorCode } from '../../../shared/errors'
import { IMAGE_EXPORT, type ImageExportErrorCode } from '../../../shared/ipc/image-export-schema'
import { logger } from '../LoggingService'
import { redactPath, redactedLogError } from '../../utils/redactUserInput'
import { verifyPdfGeometry } from './pdfGeometry'
import type { PdfPageSource } from './ImageRasterizeWindow'

/** What a sink concluded. `ok: false` carries the code the user will see. */
export type SinkOutcome = { ok: true } | { ok: false; code: ImageExportErrorCode }

/** Write the harness's PNG bytes to the path the user chose. */
export async function writePngFile(
  destinationPath: string,
  pngBytes: Uint8Array
): Promise<SinkOutcome> {
  try {
    await writeFile(destinationPath, pngBytes)
    return { ok: true }
  } catch (error) {
    logger.error('Image export: failed to write the PNG file', redactedLogError(error), {
      destination: redactPath(destinationPath)
    })
    return { ok: false, code: ErrorCode.IMAGE_EXPORT_WRITE_FAILED }
  }
}

/**
 * Print the loaded harness page to a single-page PDF, verify its geometry, and
 * only then write it.
 *
 * @param destinationPath - Where the user asked to save.
 * @param pageSource - The loaded harness page.
 * @param width - Expected page width in CSS pixels.
 * @param height - Expected page height in CSS pixels.
 */
export async function writePdfFile(
  destinationPath: string,
  pageSource: PdfPageSource,
  width: number,
  height: number
): Promise<SinkOutcome> {
  // Requirement 3 forbids downscaling, so an image that cannot fit a legal PDF
  // page has to fail loudly rather than shrink to fit.
  if (width > IMAGE_EXPORT.MAX_PDF_PAGE_PX || height > IMAGE_EXPORT.MAX_PDF_PAGE_PX) {
    return { ok: false, code: ErrorCode.IMAGE_EXPORT_PDF_PAGE_TOO_LARGE }
  }

  let buffer: Buffer
  try {
    buffer = await pageSource.printToPdf()
  } catch (error) {
    // A throw or a render timeout produced NO pdf, so nothing about its
    // geometry is known. `IMAGE_EXPORT_PDF_GEOMETRY_FAILED` is reserved for the
    // check below, which has a buffer to judge — telling the user the page came
    // out the wrong size after a hung render would simply be false.
    logger.error('Image export: printToPDF failed', redactedLogError(error))
    return { ok: false, code: ErrorCode.IMAGE_EXPORT_FAILED }
  }

  const geometry = verifyPdfGeometry(buffer, width, height)
  if (!geometry.ok) {
    logger.error('Image export: produced PDF failed its geometry check', undefined, {
      reason: geometry.reason,
      pageCount: geometry.pageCount
    })
    // ZERO page objects means the buffer is not a parseable PDF at all, so no
    // geometry was ever read from it. `IMAGE_EXPORT_PDF_GEOMETRY_FAILED` says
    // "the page came out the wrong size", which points the user at a cause
    // that was never measured - the same reason a failed render above maps to
    // the generic code. The geometry code is kept for a PDF that WAS parsed
    // and disagreed.
    return {
      ok: false,
      code:
        geometry.pageCount === 0
          ? ErrorCode.IMAGE_EXPORT_FAILED
          : ErrorCode.IMAGE_EXPORT_PDF_GEOMETRY_FAILED
    }
  }

  try {
    await writeFile(destinationPath, buffer)
    return { ok: true }
  } catch (error) {
    logger.error('Image export: failed to write the PDF file', redactedLogError(error), {
      destination: redactPath(destinationPath)
    })
    return { ok: false, code: ErrorCode.IMAGE_EXPORT_WRITE_FAILED }
  }
}

/**
 * Put the exported pixels on the OS clipboard as a real image.
 *
 * A PNG buffer is exactly the input `nativeImage` is reliable for, and
 * `writeImage` (never `writeText`, never a file reference) is what makes the
 * paste land as pixels in Preview and Paint alike. The white flattening
 * happened upstream, which is what makes the Windows CF_DIB path — which has
 * no alpha channel — come out correct instead of black.
 */
export function copyPngToClipboard(pngBytes: Uint8Array): SinkOutcome {
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(pngBytes))
    if (image.isEmpty()) {
      logger.error('Image export: the decoded clipboard image was empty')
      return { ok: false, code: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED }
    }
    clipboard.writeImage(image)
    return { ok: true }
  } catch (error) {
    logger.error('Image export: the clipboard rejected the image', redactedLogError(error))
    return { ok: false, code: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED }
  }
}
