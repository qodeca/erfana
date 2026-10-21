// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import { ErrorCode } from '../../shared/errors'
import { createHash } from 'crypto'
import { pathToFileURL } from 'url'
import { PDF_EXPORT } from '../../shared/constants'

// Literal, not imported: importing the module would run its electron import
// before the mocks below are initialised
const PDF_EXPORT_PARTITION = 'pdf-export'

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
const mockDestroy = vi.fn()
const mockForcefullyCrashRenderer = vi.fn()
const mockSetWindowOpenHandler = vi.fn()
const mockWebContentsOn = vi.fn()

const mockBrowserWindow = vi.fn(() => ({
  loadFile: mockLoadFile,
  close: mockClose,
  destroy: mockDestroy,
  isDestroyed: mockIsDestroyed,
  webContents: {
    printToPDF: mockPrintToPdf,
    executeJavaScript: mockExecuteJavaScript,
    forcefullyCrashRenderer: mockForcefullyCrashRenderer,
    setWindowOpenHandler: mockSetWindowOpenHandler,
    on: mockWebContentsOn
  }
}))

// The partition's session: records the controls installed on it
const mockOnBeforeRequest = vi.fn()
const mockSetPermissionRequestHandler = vi.fn()
const mockSetPermissionCheckHandler = vi.fn()
const mockFromPartition = vi.fn(() => ({
  webRequest: { onBeforeRequest: mockOnBeforeRequest },
  setPermissionRequestHandler: mockSetPermissionRequestHandler,
  setPermissionCheckHandler: mockSetPermissionCheckHandler
}))

const mockShowSaveDialog = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: mockBrowserWindow,
  dialog: {
    showSaveDialog: mockShowSaveDialog
  },
  session: { fromPartition: mockFromPartition }
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
      },
      session: { fromPartition: mockFromPartition }
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

  describe('export window isolation', () => {
    it('should render in its own in-memory partition', async () => {
      setupSuccessfulExport()

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockFromPartition).toHaveBeenCalledWith(PDF_EXPORT_PARTITION)
      expect(PDF_EXPORT_PARTITION.startsWith('persist:')).toBe(false)
      expect(mockBrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            partition: PDF_EXPORT_PARTITION,
            webSecurity: true,
            webviewTag: false
          })
        })
      )
    })

    it('should install the request filter and permission denials before the window exists', async () => {
      setupSuccessfulExport()

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockOnBeforeRequest).toHaveBeenCalledTimes(1)
      expect(mockSetPermissionRequestHandler).toHaveBeenCalledTimes(1)
      expect(mockSetPermissionCheckHandler).toHaveBeenCalledTimes(1)
      expect(mockOnBeforeRequest.mock.invocationCallOrder[0]).toBeLessThan(
        mockBrowserWindow.mock.invocationCallOrder[0]
      )
    })

    it('should let only the temp page and images through the request filter', async () => {
      setupSuccessfulExport()
      await pdfService.exportToPdf('<p>Test</p>', 'test')
      const filter = mockOnBeforeRequest.mock.calls[0][1] as (
        details: { url: string; resourceType: string },
        callback: (r: { cancel: boolean }) => void
      ) => void
      const isCancelled = (url: string, resourceType: string): boolean => {
        let cancel = false
        filter({ url, resourceType }, (r) => {
          cancel = r.cancel
        })
        return cancel
      }

      expect(isCancelled(pathToFileURL(MOCK_EXPORT_HTML).href, 'mainFrame')).toBe(false)
      expect(isCancelled(pathToFileURL(path.join(MOCK_TMPDIR, 'other.html')).href, 'subFrame')).toBe(true)
      expect(isCancelled('https://example.com/a.js', 'script')).toBe(true)
      expect(isCancelled('https://example.com/', 'xhr')).toBe(true)
      expect(isCancelled('https://example.com/a.png', 'image')).toBe(false)
    })

    it('should deny permissions', async () => {
      setupSuccessfulExport()
      await pdfService.exportToPdf('<p>Test</p>', 'test')

      const callback = vi.fn()
      mockSetPermissionRequestHandler.mock.calls[0][0]({}, 'media', callback)
      expect(callback).toHaveBeenCalledWith(false)
      expect(mockSetPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    })

    it('should deny popups and block navigation on the window', async () => {
      setupSuccessfulExport()
      await pdfService.exportToPdf('<p>Test</p>', 'test')

      expect(mockSetWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
      const navCall = mockWebContentsOn.mock.calls.find(([name]) => name === 'will-navigate')
      expect(navCall).toBeDefined()
      const event = { preventDefault: vi.fn() }
      navCall![1](event, 'https://example.com/')
      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('should write a CSP that allows only the hashed readiness script', async () => {
      setupSuccessfulExport()

      await pdfService.exportToPdf('<p>Test</p>', 'test')

      const html = mockWriteFile.mock.calls[0][1] as string
      const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
      expect(meta).not.toBeNull()
      const csp = meta![1]
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("base-uri 'none'")

      const script = html.match(/<script>([\s\S]*?)<\/script>/)
      expect(script).not.toBeNull()
      const hash = createHash('sha256').update(script![1], 'utf8').digest('base64')
      expect(csp).toContain(`script-src 'sha256-${hash}'`)
      // the policy must be parsed before any exported content
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<p>Test</p>'))
    })
  })

  describe('step timeouts', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      mockIsDestroyed.mockReturnValue(false)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function expectTimedOutAndRecovered(
      exportPromise: Promise<any>,
      advanceMs: number
    ): Promise<void> {
      await vi.advanceTimersByTimeAsync(advanceMs)
      const result = await exportPromise
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PDF_EXPORT_FAILED)
      expect(mockForcefullyCrashRenderer).toHaveBeenCalled()
      expect(mockDestroy).toHaveBeenCalled()

      // The lock is released: the next export is not rejected as in progress
      setupSuccessfulExport()
      const next = await pdfService.exportToPdf('<p>Test</p>', 'test')
      expect(next.success).toBe(true)
    }

    it('should time out a hung loadFile, destroy the window and release the lock', async () => {
      setupSuccessfulExport()
      mockLoadFile.mockReturnValue(new Promise(() => {}))

      await expectTimedOutAndRecovered(
        pdfService.exportToPdf('<p>Test</p>', 'test'),
        PDF_EXPORT.LOAD_TIMEOUT
      )
    })

    it('should time out a hung readiness probe', async () => {
      setupSuccessfulExport()
      mockExecuteJavaScript.mockReturnValue(new Promise(() => {}))

      await expectTimedOutAndRecovered(
        pdfService.exportToPdf('<p>Test</p>', 'test'),
        PDF_EXPORT.READY_PROBE_TIMEOUT
      )
    })

    it('should time out a hung printToPDF', async () => {
      setupSuccessfulExport()
      mockPrintToPdf.mockReturnValue(new Promise(() => {}))

      await expectTimedOutAndRecovered(
        pdfService.exportToPdf('<p>Test</p>', 'test'),
        PDF_EXPORT.PRINT_TIMEOUT
      )
    })
  })
})
