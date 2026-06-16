// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import { ErrorCode } from '../../shared/errors'
import { PDF_EXPORT } from '../../shared/constants'

// Platform-safe test paths
const MOCK_TMP = os.tmpdir()
const MOCK_TMPDIR = path.join(MOCK_TMP, 'erfana-pdf-xyz123')
const MOCK_EXPORT_HTML = path.join(MOCK_TMPDIR, 'export.html')
const MOCK_PDF_PATH = path.join(MOCK_TMP, 'test.pdf')

// Mock electron
const mockPrintToPdf = vi.fn()
const mockLoadFile = vi.fn()
const mockClose = vi.fn()
const mockIsDestroyed = vi.fn(() => false)
const mockExecuteJavaScript = vi.fn()

const mockBrowserWindow = vi.fn(() => ({
  loadFile: mockLoadFile,
  close: mockClose,
  isDestroyed: mockIsDestroyed,
  webContents: {
    printToPDF: mockPrintToPdf,
    executeJavaScript: mockExecuteJavaScript
  }
}))

const mockShowSaveDialog = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: mockBrowserWindow,
  dialog: {
    showSaveDialog: mockShowSaveDialog
  }
}))

// Mock fs/promises
const mockWriteFile = vi.fn()
const mockUnlink = vi.fn()
const mockMkdtemp = vi.fn()
const mockRmdir = vi.fn()
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  unlink: mockUnlink,
  mkdtemp: mockMkdtemp,
  rmdir: mockRmdir
}))

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Setup mocks for a successful PDF export
 */
function setupSuccessfulExport(filePath = MOCK_PDF_PATH): void {
  mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath })
  mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
  mockWriteFile.mockResolvedValue(undefined)
  mockLoadFile.mockResolvedValue(undefined)
  mockExecuteJavaScript.mockResolvedValue(true) // Content ready
  mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
  mockUnlink.mockResolvedValue(undefined)
  mockRmdir.mockResolvedValue(undefined)
}

/**
 * Setup mocks for a cancelled export (user cancels save dialog)
 */
function setupCancelledExport(): void {
  mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
}

describe('PdfService', () => {
  let pdfService: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset module to get fresh instance
    vi.resetModules()

    // Re-mock after reset
    vi.doMock('electron', () => ({
      BrowserWindow: mockBrowserWindow,
      dialog: {
        showSaveDialog: mockShowSaveDialog
      }
    }))

    vi.doMock('fs/promises', () => ({
      writeFile: mockWriteFile,
      unlink: mockUnlink,
      mkdtemp: mockMkdtemp,
      rmdir: mockRmdir
    }))

    // Import fresh instance
    const module = await import('./PdfService')
    pdfService = module.pdfService
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('exportToPdf', () => {
    it('should return error when HTML content is empty', async () => {
      const result = await pdfService.exportToPdf('', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_NO_CONTENT)
      expect(result.error).toBe('No content to export')
    })

    it('should return error when HTML content is whitespace only', async () => {
      const result = await pdfService.exportToPdf('   \n\t  ', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_NO_CONTENT)
    })

    it('should return cancelled when user cancels save dialog', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_CANCELLED)
      expect(result.error).toBeUndefined()
    })

    it('should return cancelled when no file path is selected', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '' })

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_CANCELLED)
    })

    it('should create hidden BrowserWindow with correct configuration', async () => {
      setupSuccessfulExport()

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockBrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          show: false,
          width: PDF_EXPORT.WINDOW_WIDTH,
          height: PDF_EXPORT.WINDOW_HEIGHT,
          webPreferences: expect.objectContaining({
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          })
        })
      )
    })

    it('should load HTML content via temp file', async () => {
      setupSuccessfulExport()

      await pdfService.exportToPdf('<p>Hello World</p>', 'test')

      // Should create temp directory and write HTML file
      expect(mockMkdtemp).toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith(
        MOCK_EXPORT_HTML,
        expect.stringContaining('<p>Hello World</p>'),
        'utf-8'
      )
      // Should load from temp file (not data URL)
      expect(mockLoadFile).toHaveBeenCalledWith(MOCK_EXPORT_HTML)
    })

    it('should call printToPDF with A4 page size', async () => {
      setupSuccessfulExport()

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockPrintToPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          pageSize: 'A4',
          printBackground: true
        })
      )
    })

    it('should write PDF buffer to file', async () => {
      const pdfBuffer = Buffer.from('PDF content')
      setupSuccessfulExport()
      mockPrintToPdf.mockResolvedValue(pdfBuffer)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockWriteFile).toHaveBeenCalledWith(MOCK_PDF_PATH, pdfBuffer)
    })

    it('should return success with file path on successful export', async () => {
      setupSuccessfulExport(path.join(MOCK_TMP, 'exported.pdf'))

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(result.filePath).toBe(path.join(MOCK_TMP, 'exported.pdf'))
    })

    it('should close hidden window after successful export', async () => {
      setupSuccessfulExport()

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockClose).toHaveBeenCalled()
    })

    it('should close hidden window on error', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: MOCK_PDF_PATH })
      mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
      mockWriteFile.mockResolvedValue(undefined)
      mockLoadFile.mockRejectedValue(new Error('Load failed'))
      mockIsDestroyed.mockReturnValue(false)
      mockUnlink.mockResolvedValue(undefined)
      mockRmdir.mockResolvedValue(undefined)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockClose).toHaveBeenCalled()
    })

    it('should not close window if already destroyed', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: MOCK_PDF_PATH })
      mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
      mockWriteFile.mockResolvedValue(undefined)
      mockLoadFile.mockRejectedValue(new Error('Load failed'))
      mockIsDestroyed.mockReturnValue(true)
      mockUnlink.mockResolvedValue(undefined)
      mockRmdir.mockResolvedValue(undefined)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockClose).not.toHaveBeenCalled()
    })

    it('should return error on printToPDF failure', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: MOCK_PDF_PATH })
      mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
      mockWriteFile.mockResolvedValue(undefined)
      mockLoadFile.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockRejectedValue(new Error('Print failed'))
      mockUnlink.mockResolvedValue(undefined)
      mockRmdir.mockResolvedValue(undefined)

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_FAILED)
      expect(result.error).toBe('Print failed')
    })

    it('should return error on file write failure', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: MOCK_PDF_PATH })
      mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
      // First writeFile call for temp HTML succeeds, second for PDF fails
      mockWriteFile.mockResolvedValueOnce(undefined)
      mockLoadFile.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockRejectedValue(new Error('Permission denied'))
      mockUnlink.mockResolvedValue(undefined)
      mockRmdir.mockResolvedValue(undefined)

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_FAILED)
      expect(result.error).toBe('Permission denied')
    })

    it('should append .pdf extension if not present', async () => {
      setupSuccessfulExport(path.join(MOCK_TMP, 'document'))

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(result.filePath).toBe(path.join(MOCK_TMP, 'document.pdf'))
      expect(mockWriteFile).toHaveBeenCalledWith(path.join(MOCK_TMP, 'document.pdf'), expect.any(Buffer))
    })

    it('should not duplicate .pdf extension', async () => {
      setupSuccessfulExport(path.join(MOCK_TMP, 'document.pdf'))

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.filePath).toBe(path.join(MOCK_TMP, 'document.pdf'))
    })

    it('should suggest correct filename in save dialog', async () => {
      setupCancelledExport()

      await pdfService.exportToPdf('<p>Test</p>', 'my-document')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'my-document.pdf',
          filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
        })
      )
    })

    it('should wait for content ready before generating PDF', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: MOCK_PDF_PATH })
      mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
      mockWriteFile.mockResolvedValue(undefined)
      mockLoadFile.mockResolvedValue(undefined)

      // First call returns false, second returns true (simulating async content ready)
      mockExecuteJavaScript
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockUnlink.mockResolvedValue(undefined)
      mockRmdir.mockResolvedValue(undefined)

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(mockExecuteJavaScript).toHaveBeenCalled()
    })
  })

  describe('save dialog configuration', () => {
    it('should use correct dialog title', async () => {
      setupCancelledExport()

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Export to PDF',
          buttonLabel: 'Export'
        })
      )
    })
  })

  describe('edge cases - issue #58', () => {
    describe('concurrent export prevention', () => {
      it('should reject second export while first is in progress', async () => {
        // Setup first export to be slow (wait for save dialog)
        let resolveDialog: (value: any) => void
        const dialogPromise = new Promise(resolve => {
          resolveDialog = resolve
        })
        mockShowSaveDialog.mockReturnValue(dialogPromise)

        // Start first export (will wait at dialog)
        const firstExport = pdfService.exportToPdf('<p>First</p>', 'first')

        // Try second export while first is pending
        const secondResult = await pdfService.exportToPdf('<p>Second</p>', 'second')

        // Second export should fail immediately
        expect(secondResult.success).toBe(false)
        expect(secondResult.error).toBe('Export already in progress')

        // Complete first export
        resolveDialog!({ canceled: true })
        await firstExport
      })

      it('should allow new export after previous completes', async () => {
        setupCancelledExport()

        // First export
        await pdfService.exportToPdf('<p>First</p>', 'first')

        // Second export should work
        setupCancelledExport()
        const result = await pdfService.exportToPdf('<p>Second</p>', 'second')
        expect(result.errorCode).toBe('PDF_EXPORT_CANCELLED')
      })

      it('should allow new export after previous fails', async () => {
        // First export fails
        mockShowSaveDialog.mockRejectedValueOnce(new Error('Dialog error'))
        await pdfService.exportToPdf('<p>First</p>', 'first')

        // Second export should work
        setupCancelledExport()
        const result = await pdfService.exportToPdf('<p>Second</p>', 'second')
        expect(result.errorCode).toBe('PDF_EXPORT_CANCELLED')
      })
    })

    describe('empty PDF buffer validation', () => {
      it('should reject empty PDF buffer', async () => {
        mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: MOCK_PDF_PATH })
        mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
        mockWriteFile.mockResolvedValue(undefined)
        mockLoadFile.mockResolvedValue(undefined)
        mockExecuteJavaScript.mockResolvedValue(true)
        mockPrintToPdf.mockResolvedValue(Buffer.from('')) // Empty buffer
        mockUnlink.mockResolvedValue(undefined)
        mockRmdir.mockResolvedValue(undefined)

        const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

        expect(result.success).toBe(false)
        expect(result.error).toBe('PDF generation produced empty file')
      })
    })

    describe('filename sanitization', () => {
      it('should truncate very long filenames', async () => {
        setupCancelledExport()

        const longName = 'a'.repeat(300)
        await pdfService.exportToPdf('<p>Test</p>', longName)

        // Dialog should receive truncated filename
        expect(mockShowSaveDialog).toHaveBeenCalledWith(
          expect.objectContaining({
            defaultPath: expect.stringMatching(/^a{200}\.pdf$/)
          })
        )
      })
    })

    describe('temp file cleanup', () => {
      it('should clean up temp files after successful export', async () => {
        setupSuccessfulExport()

        await pdfService.exportToPdf('<p>Test</p>', 'test')

        // Temp file and directory should be cleaned up
        expect(mockUnlink).toHaveBeenCalledWith(MOCK_EXPORT_HTML)
        expect(mockRmdir).toHaveBeenCalledWith(MOCK_TMPDIR)
      })

      it('should clean up temp files even on error', async () => {
        mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: MOCK_PDF_PATH })
        mockMkdtemp.mockResolvedValue(MOCK_TMPDIR)
        mockWriteFile.mockResolvedValue(undefined)
        mockLoadFile.mockRejectedValue(new Error('Load failed'))
        mockUnlink.mockResolvedValue(undefined)
        mockRmdir.mockResolvedValue(undefined)

        await pdfService.exportToPdf('<p>Test</p>', 'test')

        // Temp file and directory should be cleaned up even on error
        expect(mockUnlink).toHaveBeenCalledWith(MOCK_EXPORT_HTML)
        expect(mockRmdir).toHaveBeenCalledWith(MOCK_TMPDIR)
      })
    })
  })
})
