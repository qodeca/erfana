import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../shared/errors'

// Mock electron
const mockPrintToPdf = vi.fn()
const mockLoadUrl = vi.fn()
const mockClose = vi.fn()
const mockIsDestroyed = vi.fn(() => false)
const mockExecuteJavaScript = vi.fn()

const mockBrowserWindow = vi.fn(() => ({
  loadURL: mockLoadUrl,
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
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile
}))

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
      writeFile: mockWriteFile
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
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true) // Content ready
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockBrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          show: false,
          width: 794,
          height: 1123,
          webPreferences: expect.objectContaining({
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          })
        })
      )
    })

    it('should load HTML content via data URL', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

      await pdfService.exportToPdf('<p>Hello World</p>', 'test')

      expect(mockLoadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^data:text\/html;charset=utf-8,/)
      )
    })

    it('should call printToPDF with A4 page size', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

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
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(pdfBuffer)
      mockWriteFile.mockResolvedValue(undefined)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/test.pdf', pdfBuffer)
    })

    it('should return success with file path on successful export', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/exported.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/tmp/exported.pdf')
    })

    it('should close hidden window after successful export', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockClose).toHaveBeenCalled()
    })

    it('should close hidden window on error', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockRejectedValue(new Error('Load failed'))
      mockIsDestroyed.mockReturnValue(false)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockClose).toHaveBeenCalled()
    })

    it('should not close window if already destroyed', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockRejectedValue(new Error('Load failed'))
      mockIsDestroyed.mockReturnValue(true)

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockClose).not.toHaveBeenCalled()
    })

    it('should return error on printToPDF failure', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockRejectedValue(new Error('Print failed'))

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_FAILED)
      expect(result.error).toBe('Print failed')
    })

    it('should return error on file write failure', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockRejectedValue(new Error('Permission denied'))

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_FAILED)
      expect(result.error).toBe('Permission denied')
    })

    it('should append .pdf extension if not present', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/document' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/tmp/document.pdf')
      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/document.pdf', expect.any(Buffer))
    })

    it('should not duplicate .pdf extension', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/document.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)
      mockExecuteJavaScript.mockResolvedValue(true)
      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.filePath).toBe('/tmp/document.pdf')
    })

    it('should suggest correct filename in save dialog', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true })

      await pdfService.exportToPdf('<p>Test</p>', 'my-document')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'my-document.pdf',
          filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
        })
      )
    })

    it('should wait for content ready before generating PDF', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
      mockLoadUrl.mockResolvedValue(undefined)

      // First call returns false, second returns true (simulating async content ready)
      mockExecuteJavaScript
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      mockPrintToPdf.mockResolvedValue(Buffer.from('PDF content'))
      mockWriteFile.mockResolvedValue(undefined)

      const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(mockExecuteJavaScript).toHaveBeenCalled()
    })
  })

  describe('save dialog configuration', () => {
    it('should use correct dialog title', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true })

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
        mockShowSaveDialog.mockResolvedValue({ canceled: true })

        // First export
        await pdfService.exportToPdf('<p>First</p>', 'first')

        // Second export should work
        const result = await pdfService.exportToPdf('<p>Second</p>', 'second')
        expect(result.errorCode).toBe('PDF_EXPORT_CANCELLED')
      })

      it('should allow new export after previous fails', async () => {
        // First export fails
        mockShowSaveDialog.mockRejectedValueOnce(new Error('Dialog error'))
        await pdfService.exportToPdf('<p>First</p>', 'first')

        // Second export should work
        mockShowSaveDialog.mockResolvedValue({ canceled: true })
        const result = await pdfService.exportToPdf('<p>Second</p>', 'second')
        expect(result.errorCode).toBe('PDF_EXPORT_CANCELLED')
      })
    })

    describe('data URL size limit', () => {
      it('should reject content that would exceed data URL limit', async () => {
        // Mock save dialog to return a path (size check happens after dialog)
        mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/large.pdf' })

        // Create very large HTML (>30MB when encoded)
        const largeHtml = '<p>' + 'x'.repeat(35_000_000) + '</p>'

        const result = await pdfService.exportToPdf(largeHtml, 'large')

        expect(result.success).toBe(false)
        expect(result.error).toContain('too large')
      })
    })

    describe('empty PDF buffer validation', () => {
      it('should reject empty PDF buffer', async () => {
        mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.pdf' })
        mockLoadUrl.mockResolvedValue(undefined)
        mockExecuteJavaScript.mockResolvedValue(true)
        mockPrintToPdf.mockResolvedValue(Buffer.from('')) // Empty buffer

        const result = await pdfService.exportToPdf('<p>Test</p>', 'test')

        expect(result.success).toBe(false)
        expect(result.error).toBe('PDF generation produced empty file')
      })
    })

    describe('filename sanitization', () => {
      it('should truncate very long filenames', async () => {
        mockShowSaveDialog.mockResolvedValue({ canceled: true })

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
  })
})
