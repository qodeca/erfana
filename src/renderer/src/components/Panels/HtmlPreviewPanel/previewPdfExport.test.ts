// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared PDF-export action (issue #74, UX-003; #124 Q19).
 *
 * One test per outcome: success toasts, a cancelled dialog stays silent, a
 * refusal toasts, and a rejected invoke toasts the same refusal and resolves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../../shared/errors'
import { showGlobalToast } from '../../Toast/toastService'
import { exportPreviewPdf } from './previewPdfExport'

vi.mock('../../Toast/toastService', () => ({ showGlobalToast: vi.fn() }))

const exportPdf = vi.fn()

const FAILED_TOAST = {
  type: 'error',
  title: 'Export failed',
  message: 'The preview could not be exported to PDF.'
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = { preview: { exportPdf } }
})

describe('exportPreviewPdf', () => {
  it('toasts the saved file name on success', async () => {
    exportPdf.mockResolvedValue({ ok: true, path: '/proj/out/page.pdf' })

    await exportPreviewPdf('preview-1')

    expect(exportPdf).toHaveBeenCalledWith('preview-1')
    expect(showGlobalToast).toHaveBeenCalledWith({
      type: 'success',
      title: 'Preview exported',
      message: 'Saved page.pdf.'
    })
  })

  it('stays silent when the save dialog is cancelled', async () => {
    exportPdf.mockResolvedValue({ ok: false, errorCode: ErrorCode.PDF_EXPORT_CANCELLED })

    await exportPreviewPdf('preview-1')

    expect(showGlobalToast).not.toHaveBeenCalled()
  })

  it('toasts a failure main reports', async () => {
    exportPdf.mockResolvedValue({ ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED })

    await exportPreviewPdf('preview-1')

    expect(showGlobalToast).toHaveBeenCalledWith(FAILED_TOAST)
  })

  it('toasts the same failure, and resolves, when the invoke rejects', async () => {
    exportPdf.mockRejectedValue(new Error('No handler registered'))

    await expect(exportPreviewPdf('preview-1')).resolves.toBeUndefined()

    expect(showGlobalToast).toHaveBeenCalledWith(FAILED_TOAST)
  })
})
