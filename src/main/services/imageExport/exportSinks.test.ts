// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the three export sinks.
 *
 * The properties pinned here are the ones a reviewer cannot verify by reading:
 * a PDF that fails its geometry check is NEVER written, the clipboard path
 * writes an image and not text, and no log line carries an absolute path.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// `vi.hoisted` because the module under test is imported statically below:
// without it the `vi.mock` factories would run before these consts exist.
const { mockWriteFile, mockCreateFromBuffer, mockWriteImage, mockWriteText, mockLogger } =
  vi.hoisted(() => ({
    mockWriteFile: vi.fn(),
    mockCreateFromBuffer: vi.fn(),
    mockWriteImage: vi.fn(),
    mockWriteText: vi.fn(),
    mockLogger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn()
    }
  }))

vi.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args)
}))

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: (...args: unknown[]) => mockCreateFromBuffer(...args) },
  clipboard: {
    writeImage: (...args: unknown[]) => mockWriteImage(...args),
    writeText: (...args: unknown[]) => mockWriteText(...args)
  }
}))

vi.mock('../LoggingService', () => ({ logger: mockLogger }))

import { ErrorCode } from '../../../shared/errors'
import { IMAGE_EXPORT } from '../../../shared/ipc/image-export-schema'
import { PDF_POINTS_PER_CSS_PIXEL } from './pdfGeometry'
import { copyPngToClipboard, writePdfFile, writePngFile } from './exportSinks'

/** A one-page PDF buffer with the given MediaBox, in points. */
function onePagePdf(widthPt: number, heightPt: number): Buffer {
  return Buffer.from(
    `%PDF-1.7\n2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n` +
      `3 0 obj\n<< /Type /Page /MediaBox [0 0 ${widthPt} ${heightPt}] >>\nendobj\n%%EOF`,
    'latin1'
  )
}

const WIDTH_PX = 200
const HEIGHT_PX = 80
const GOOD_PDF = onePagePdf(WIDTH_PX * PDF_POINTS_PER_CSS_PIXEL, HEIGHT_PX * PDF_POINTS_PER_CSS_PIXEL)
const SECRET_PATH = '/Users/someone/Private Projects/quarterly/out.pdf'

/** Every string that reached the logger in this test. */
function loggedText(): string {
  return [...mockLogger.error.mock.calls, ...mockLogger.warn.mock.calls]
    .map((call) => JSON.stringify(call))
    .join('\n')
}

beforeEach(() => {
  vi.resetAllMocks()
  mockWriteFile.mockResolvedValue(undefined)
})

describe('writePngFile', () => {
  it('writes the bytes to the chosen path', async () => {
    const bytes = Uint8Array.from([1, 2, 3])
    expect(await writePngFile('/p/out.png', bytes)).toEqual({ ok: true })
    expect(mockWriteFile).toHaveBeenCalledWith('/p/out.png', bytes)
  })

  it('reports a write failure without leaking the path', async () => {
    mockWriteFile.mockRejectedValue(new Error(`EACCES: permission denied, open '${SECRET_PATH}'`))
    const outcome = await writePngFile(SECRET_PATH, Uint8Array.from([1]))
    expect(outcome).toEqual({ ok: false, code: ErrorCode.IMAGE_EXPORT_WRITE_FAILED })
    expect(loggedText()).toContain('[redacted]')
    expect(loggedText()).not.toContain('Private Projects')
  })
})

describe('writePdfFile', () => {
  const pageSource = (buffer: Buffer | Error) => ({
    printToPdf: vi.fn(async () => {
      if (buffer instanceof Error) throw buffer
      return buffer
    })
  })

  it('writes a PDF whose geometry matches the request', async () => {
    const source = pageSource(GOOD_PDF)
    expect(await writePdfFile('/p/out.pdf', source, WIDTH_PX, HEIGHT_PX)).toEqual({ ok: true })
    expect(mockWriteFile).toHaveBeenCalledWith('/p/out.pdf', GOOD_PDF)
  })

  it('WRITES NOTHING when the produced page is the wrong size', async () => {
    const source = pageSource(onePagePdf(612, 792))
    const outcome = await writePdfFile('/p/out.pdf', source, WIDTH_PX, HEIGHT_PX)
    expect(outcome).toEqual({ ok: false, code: ErrorCode.IMAGE_EXPORT_PDF_GEOMETRY_FAILED })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('WRITES NOTHING when the produced document has two pages', async () => {
    const twoPages = Buffer.concat([GOOD_PDF, Buffer.from('4 0 obj\n<< /Type /Page >>\n', 'latin1')])
    const outcome = await writePdfFile('/p/out.pdf', pageSource(twoPages), WIDTH_PX, HEIGHT_PX)
    expect(outcome).toEqual({ ok: false, code: ErrorCode.IMAGE_EXPORT_PDF_GEOMETRY_FAILED })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('reports a buffer that is not a PDF at all as a plain failure', async () => {
    const notAPdf = Buffer.from('this is not a PDF, there is no page object here', 'latin1')
    const outcome = await writePdfFile('/p/out.pdf', pageSource(notAPdf), WIDTH_PX, HEIGHT_PX)

    // ZERO page objects means nothing was ever measured, so "the PDF page came
    // out the wrong size" would name a cause that was never established. The
    // geometry code stays for a document that WAS parsed and disagreed.
    expect(outcome).toEqual({ ok: false, code: ErrorCode.IMAGE_EXPORT_FAILED })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('WRITES NOTHING when printToPDF itself throws', async () => {
    const outcome = await writePdfFile(
      '/p/out.pdf',
      pageSource(new Error('render died')),
      WIDTH_PX,
      HEIGHT_PX
    )
    // A throw (or the 30 s render timeout) produced no document at all, so the
    // failure is a plain one — NOT the geometry verdict, which is reserved for
    // a PDF that exists and came out the wrong shape.
    expect(outcome).toEqual({ ok: false, code: ErrorCode.IMAGE_EXPORT_FAILED })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('refuses a page over the 200-inch limit without even printing', async () => {
    const source = pageSource(GOOD_PDF)
    const outcome = await writePdfFile(
      '/p/out.pdf',
      source,
      IMAGE_EXPORT.MAX_PDF_PAGE_PX + 1,
      HEIGHT_PX
    )
    expect(outcome).toEqual({ ok: false, code: ErrorCode.IMAGE_EXPORT_PDF_PAGE_TOO_LARGE })
    expect(source.printToPdf).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('accepts a page at exactly the limit', async () => {
    const limit = IMAGE_EXPORT.MAX_PDF_PAGE_PX
    const exact = onePagePdf(limit * PDF_POINTS_PER_CSS_PIXEL, HEIGHT_PX * PDF_POINTS_PER_CSS_PIXEL)
    expect(await writePdfFile('/p/out.pdf', pageSource(exact), limit, HEIGHT_PX)).toEqual({
      ok: true
    })
  })

  it('reports a write failure without leaking the path', async () => {
    mockWriteFile.mockRejectedValue(new Error(`ENOSPC: no space left, open '${SECRET_PATH}'`))
    const outcome = await writePdfFile(SECRET_PATH, pageSource(GOOD_PDF), WIDTH_PX, HEIGHT_PX)
    expect(outcome).toEqual({ ok: false, code: ErrorCode.IMAGE_EXPORT_WRITE_FAILED })
    expect(loggedText()).toContain('[redacted]')
    expect(loggedText()).not.toContain('Private Projects')
  })
})

describe('copyPngToClipboard', () => {
  it('writes an IMAGE, never text, and never a path', () => {
    mockCreateFromBuffer.mockReturnValue({ isEmpty: () => false })
    expect(copyPngToClipboard(Uint8Array.from([1, 2, 3]))).toEqual({ ok: true })
    expect(mockWriteImage).toHaveBeenCalledTimes(1)
    expect(mockWriteText).not.toHaveBeenCalled()
  })

  it('hands nativeImage the PNG bytes it was given', () => {
    mockCreateFromBuffer.mockReturnValue({ isEmpty: () => false })
    copyPngToClipboard(Uint8Array.from([9, 8, 7]))
    expect(Array.from(mockCreateFromBuffer.mock.calls[0][0] as Uint8Array)).toEqual([9, 8, 7])
  })

  it('fails when the decoded image is empty, and does not touch the clipboard', () => {
    mockCreateFromBuffer.mockReturnValue({ isEmpty: () => true })
    expect(copyPngToClipboard(Uint8Array.from([1]))).toEqual({
      ok: false,
      code: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED
    })
    expect(mockWriteImage).not.toHaveBeenCalled()
  })

  it('fails when the clipboard write throws', () => {
    mockCreateFromBuffer.mockReturnValue({ isEmpty: () => false })
    mockWriteImage.mockImplementation(() => {
      throw new Error('clipboard is busy')
    })
    expect(copyPngToClipboard(Uint8Array.from([1]))).toEqual({
      ok: false,
      code: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED
    })
  })
})
