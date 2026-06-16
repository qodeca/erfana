// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../shared/errors'

// Track registered handlers
const handlers: Record<string, (...args: any[]) => Promise<any>> = {}

// Mock ipcMain
const mockIpcMain = {
  handle: vi.fn((channel: string, handler: any) => {
    handlers[channel] = handler
  })
}

// Mock pdfService
const mockExportToPdf = vi.fn()

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

vi.mock('../services/PdfService', () => ({
  pdfService: {
    exportToPdf: mockExportToPdf
  }
}))

describe('PDF IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Clear registered handlers
    Object.keys(handlers).forEach((key) => delete handlers[key])

    // Register handlers
    const { registerPdfHandlers } = await import('./pdf-handlers')
    registerPdfHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('registerPdfHandlers', () => {
    it('should register pdf:exportToPdf handler', () => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        'pdf:exportToPdf',
        expect.any(Function)
      )
    })
  })

  describe('pdf:exportToPdf handler', () => {
    it('should validate request schema - reject missing html', async () => {
      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, { fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_INVALID_REQUEST)
    })

    it('should validate request schema - reject missing fileName', async () => {
      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, { html: '<p>Test</p>' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_INVALID_REQUEST)
    })

    it('should validate request schema - reject empty html', async () => {
      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, { html: '', fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_INVALID_REQUEST)
    })

    it('should validate request schema - reject empty fileName', async () => {
      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, { html: '<p>Test</p>', fileName: '' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_INVALID_REQUEST)
    })

    it('should call pdfService.exportToPdf with valid request', async () => {
      mockExportToPdf.mockResolvedValue({ success: true, filePath: '/tmp/test.pdf' })

      const handler = handlers['pdf:exportToPdf']
      await handler({}, { html: '<p>Test content</p>', fileName: 'my-document' })

      expect(mockExportToPdf).toHaveBeenCalledWith('<p>Test content</p>', 'my-document')
    })

    it('should return success result from pdfService', async () => {
      mockExportToPdf.mockResolvedValue({
        success: true,
        filePath: '/path/to/document.pdf'
      })

      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/path/to/document.pdf')
    })

    it('should return error result from pdfService', async () => {
      mockExportToPdf.mockResolvedValue({
        success: false,
        error: 'Export failed',
        errorCode: ErrorCode.PDF_EXPORT_FAILED
      })

      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Export failed')
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_FAILED)
    })

    it('should return cancelled result from pdfService', async () => {
      mockExportToPdf.mockResolvedValue({
        success: false,
        errorCode: ErrorCode.PDF_EXPORT_CANCELLED
      })

      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_CANCELLED)
      expect(result.error).toBeUndefined()
    })

    it('should handle pdfService exceptions', async () => {
      mockExportToPdf.mockRejectedValue(new Error('Unexpected error'))

      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unexpected error')
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_FAILED)
    })

    it('should handle non-Error exceptions', async () => {
      mockExportToPdf.mockRejectedValue('String error')

      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      // Non-Error exceptions are converted to 'Unknown error' for safety
      expect(result.error).toBe('Unknown error')
    })

    it('should reject non-object request', async () => {
      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, 'invalid')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_INVALID_REQUEST)
    })

    it('should reject null request', async () => {
      const handler = handlers['pdf:exportToPdf']
      const result = await handler({}, null)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_INVALID_REQUEST)
    })
  })
})
