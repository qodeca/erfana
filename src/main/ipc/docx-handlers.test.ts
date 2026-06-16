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

// Mock docxService
const mockExportToDocx = vi.fn()

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

vi.mock('../services/DocxService', () => ({
  docxService: {
    exportToDocx: mockExportToDocx
  }
}))

describe('DOCX IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Clear registered handlers
    Object.keys(handlers).forEach((key) => delete handlers[key])

    // Register handlers
    const { registerDocxHandlers } = await import('./docx-handlers')
    registerDocxHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('registerDocxHandlers', () => {
    it('should register docx:exportToDocx handler', () => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        'docx:exportToDocx',
        expect.any(Function)
      )
    })

    it('should register handler with ipcMain.handle', () => {
      expect(mockIpcMain.handle).toHaveBeenCalledTimes(1)
      expect(handlers['docx:exportToDocx']).toBeDefined()
    })

    it('should be idempotent - multiple calls register same handler', async () => {
      // First call happened in beforeEach, call again
      const { registerDocxHandlers } = await import('./docx-handlers')
      registerDocxHandlers()

      // Should have been called twice total
      expect(mockIpcMain.handle).toHaveBeenCalledTimes(2)
      // Handler should still work
      mockExportToDocx.mockResolvedValue({ success: true, filePath: '/tmp/test.docx' })
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: '<p>Test</p>', fileName: 'test' })
      expect(result.success).toBe(true)
    })
  })

  describe('docx:exportToDocx handler - validation errors', () => {
    it('should reject request with missing html', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject request with missing fileName', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: '<p>Test</p>' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject request with empty html string', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: '', fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('HTML content required')
    })

    it('should reject request with empty fileName string', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: '<p>Test</p>', fileName: '' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Filename required')
    })

    it('should reject request with null html', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: null, fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject request with null fileName', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: '<p>Test</p>', fileName: null })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject request with non-string html (number)', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: 123, fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject request with non-string html (object)', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: { content: 'test' }, fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject request with non-string html (array)', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: ['<p>Test</p>'], fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject request with non-string fileName (number)', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: '<p>Test</p>', fileName: 123 })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject non-object request', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, 'invalid')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should reject null request', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, null)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_INVALID_REQUEST)
      expect(result.error).toContain('Invalid request')
    })

    it('should return error message from schema validation', async () => {
      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, { html: '', fileName: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/HTML content required/)
    })
  })

  describe('docx:exportToDocx handler - valid requests', () => {
    it('should accept valid request with html and fileName', async () => {
      mockExportToDocx.mockResolvedValue({ success: true, filePath: '/tmp/test.docx' })

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test content</p>',
        fileName: 'my-document'
      })

      expect(result.success).toBe(true)
      expect(mockExportToDocx).toHaveBeenCalledWith('<p>Test content</p>', 'my-document')
    })

    it('should pass html and fileName to docxService.exportToDocx', async () => {
      mockExportToDocx.mockResolvedValue({ success: true })

      const handler = handlers['docx:exportToDocx']
      await handler({}, {
        html: '<h1>Title</h1><p>Paragraph</p>',
        fileName: 'document'
      })

      expect(mockExportToDocx).toHaveBeenCalledWith(
        '<h1>Title</h1><p>Paragraph</p>',
        'document'
      )
      expect(mockExportToDocx).toHaveBeenCalledTimes(1)
    })
  })

  describe('docx:exportToDocx handler - service delegation', () => {
    it('should return service response unchanged on success', async () => {
      mockExportToDocx.mockResolvedValue({
        success: true,
        filePath: '/path/to/document.docx'
      })

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/path/to/document.docx')
    })

    it('should return service response unchanged on service failure', async () => {
      mockExportToDocx.mockResolvedValue({
        success: false,
        error: 'Export failed',
        errorCode: ErrorCode.DOCX_EXPORT_FAILED
      })

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Export failed')
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
    })

    it('should return cancelled result from docxService', async () => {
      mockExportToDocx.mockResolvedValue({
        success: false,
        errorCode: ErrorCode.DOCX_EXPORT_CANCELLED
      })

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
      expect(result.error).toBeUndefined()
    })
  })

  describe('docx:exportToDocx handler - error handling', () => {
    it('should catch service errors and return DOCX_EXPORT_FAILED', async () => {
      mockExportToDocx.mockRejectedValue(new Error('Unexpected error'))

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unexpected error')
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
    })

    it('should handle Error objects and extract message', async () => {
      mockExportToDocx.mockRejectedValue(new Error('File system error'))

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('File system error')
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
    })

    it('should handle non-Error throws and convert to string', async () => {
      mockExportToDocx.mockRejectedValue('String error')

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      // Non-Error exceptions are converted to 'Unknown error' for safety
      expect(result.error).toBe('Unknown error')
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
    })

    it('should include "Unknown error" for non-Error throws', async () => {
      mockExportToDocx.mockRejectedValue({ some: 'object' })

      const handler = handlers['docx:exportToDocx']
      const result = await handler({}, {
        html: '<p>Test</p>',
        fileName: 'document'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unknown error')
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
    })
  })
})
