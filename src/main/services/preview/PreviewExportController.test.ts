// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for PreviewExportController (Issue #74, work item 37).
 *
 * Covers design §1.7: printToPDF with printBackground:true, its own save
 * dialog + writeFile, `deriveSafeFilename` applied to the suggested name, and
 * a cancelled dialog writing nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import {
  createPreviewExportController,
  type PreviewExportControllerDeps,
  type PreviewPrintContents,
  type PreviewSaveDialogResult
} from './PreviewExportController'

interface WcMock extends PreviewPrintContents {
  printToPDF: ReturnType<typeof vi.fn>
}

function makeWc(): WcMock {
  return { printToPDF: vi.fn(async () => Buffer.from('%PDF-1.7 fake')) }
}

function makeController(overrides: {
  dialogResult?: PreviewSaveDialogResult
  showSaveDialog?: PreviewExportControllerDeps['showSaveDialog']
  writeFile?: ReturnType<typeof vi.fn>
}): {
  controller: ReturnType<typeof createPreviewExportController>
  showSaveDialog: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
} {
  const showSaveDialog =
    (overrides.showSaveDialog as ReturnType<typeof vi.fn>) ??
    vi.fn(async () => overrides.dialogResult ?? { canceled: false, filePath: '/out/file.pdf' })
  const writeFile = overrides.writeFile ?? vi.fn(async () => undefined)
  const controller = createPreviewExportController({ showSaveDialog, writeFile })
  return { controller, showSaveDialog, writeFile }
}

describe('PreviewExportController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prints the live webContents with printBackground:true and writes the file', async () => {
    const wc = makeWc()
    const { controller, writeFile } = makeController({
      dialogResult: { canceled: false, filePath: '/out/report.pdf' }
    })

    const result = await controller.exportToPdf(wc, 'report')

    expect(wc.printToPDF).toHaveBeenCalledWith({ printBackground: true })
    expect(writeFile).toHaveBeenCalledWith('/out/report.pdf', expect.any(Buffer))
    expect(result).toEqual({ ok: true, path: '/out/report.pdf' })
  })

  it('does NOT write when the save dialog is cancelled', async () => {
    const wc = makeWc()
    const { controller, writeFile } = makeController({
      dialogResult: { canceled: true }
    })

    const result = await controller.exportToPdf(wc, 'report')

    expect(writeFile).not.toHaveBeenCalled()
    expect(wc.printToPDF).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PDF_EXPORT_CANCELLED })
  })

  it('treats a missing filePath as a cancellation', async () => {
    const wc = makeWc()
    const { controller, writeFile } = makeController({
      dialogResult: { canceled: false, filePath: undefined }
    })

    const result = await controller.exportToPdf(wc, 'report')

    expect(writeFile).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PDF_EXPORT_CANCELLED })
  })

  it('sanitises the suggested name via deriveSafeFilename for the default path', async () => {
    const wc = makeWc()
    const { controller, showSaveDialog } = makeController({
      dialogResult: { canceled: false, filePath: '/out/clean.pdf' }
    })

    await controller.exportToPdf(wc, 'my<>report')

    const options = showSaveDialog.mock.calls[0][0] as { defaultPath: string }
    // '<' and '>' → '-' via the shared helper; #161 handling is not duplicated.
    expect(options.defaultPath).toBe('my--report.pdf')
  })

  it('appends .pdf when the chosen path lacks the extension', async () => {
    const wc = makeWc()
    const { controller, writeFile } = makeController({
      dialogResult: { canceled: false, filePath: '/out/noext' }
    })

    const result = await controller.exportToPdf(wc, 'report')

    expect(writeFile).toHaveBeenCalledWith('/out/noext.pdf', expect.any(Buffer))
    expect(result).toEqual({ ok: true, path: '/out/noext.pdf' })
  })

  it('returns a failed result (never throws) when printToPDF rejects', async () => {
    const wc: WcMock = { printToPDF: vi.fn(async () => Promise.reject(new Error('print failed'))) }
    const { controller, writeFile } = makeController({
      dialogResult: { canceled: false, filePath: '/out/report.pdf' }
    })

    const result = await controller.exportToPdf(wc, 'report')

    expect(writeFile).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED })
  })
})
