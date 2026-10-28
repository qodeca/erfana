// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PDF export with HTML Preview comments' overlay hidden around the print
 * (docs/designs/html-preview-comments.md §10.2; M-064).
 */
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { PreviewExportController, type PreviewAroundPrint } from './PreviewExportController'

function controller(canceled = false) {
  const order: string[] = []
  const writeFile = vi.fn(async () => {
    order.push('write')
  })
  const showSaveDialog = vi.fn(async () => {
    order.push('dialog')
    return canceled ? { canceled: true } : { canceled: false, filePath: '/out/page.pdf' }
  })
  return { exporter: new PreviewExportController({ showSaveDialog, writeFile }), order, writeFile }
}

describe('PreviewExportController aroundPrint', () => {
  it('M-064 wraps the print alone: the overlay hides after the dialog and shows again before the write', async () => {
    const { exporter, order } = controller()
    const wc = {
      printToPDF: vi.fn(async () => {
        order.push('print')
        return Buffer.from('%PDF')
      })
    }
    const aroundPrint: PreviewAroundPrint = async print => {
      order.push('hide')
      try {
        return await print()
      } finally {
        order.push('show')
      }
    }
    expect(await exporter.exportToPdf(wc, 'page', 1, aroundPrint)).toEqual({ ok: true, path: '/out/page.pdf' })
    expect(order).toEqual(['dialog', 'hide', 'print', 'show', 'write'])
  })

  it('M-064 a print that fails still shows the overlay again, and reads as a failed export', async () => {
    const { exporter } = controller()
    const shown = vi.fn()
    const result = await exporter.exportToPdf(
      { printToPDF: vi.fn(async () => Promise.reject(new Error('print failed'))) },
      'page',
      1,
      async print => {
        try {
          return await print()
        } finally {
          shown()
        }
      }
    )
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED })
    expect(shown).toHaveBeenCalledTimes(1)
  })

  it('M-064 a cancelled dialog never hides the overlay', async () => {
    const { exporter } = controller(true)
    const aroundPrint = vi.fn()
    const result = await exporter.exportToPdf({ printToPDF: vi.fn() }, 'page', 1, aroundPrint)
    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PDF_EXPORT_CANCELLED })
    expect(aroundPrint).not.toHaveBeenCalled()
  })
})
