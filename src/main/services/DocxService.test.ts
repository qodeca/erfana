// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DocxService.test.ts
 *
 * Comprehensive tests for DocxService
 *
 * Test coverage:
 * - ExportLock value object (acquire, release, isLocked)
 * - validateContent() - Empty, whitespace, size limits
 * - sanitizeFilename() - Invalid chars, reserved names, length
 * - showSaveDialog() - User interactions, extension handling
 * - exportToDocx() - Full workflow with all error conditions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../shared/errors'
import { DOCX_EXPORT } from '../../shared/constants'

// ============================================================================
// Mocks
// ============================================================================

// Mock electron
const mockShowSaveDialog = vi.fn()
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: mockShowSaveDialog
  }
}))

// Mock fs/promises
const mockWriteFile = vi.fn()
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile
}))

// Mock HtmlToDocxConverter
const mockConvert = vi.fn()
vi.mock('./HtmlToDocxConverter', () => ({
  htmlToDocxConverter: {
    convert: mockConvert
  }
}))

// Mock LoggingService
const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}
vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Setup mocks for a successful DOCX export workflow
 *
 * Configures all mocks to simulate a successful export:
 * - Save dialog returns selected file path
 * - Converter returns DOCX buffer
 * - File write succeeds
 *
 * @param filePath - Path returned by save dialog (default: '/tmp/test.docx')
 */
function setupSuccessfulExport(filePath = '/tmp/test.docx'): void {
  mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath })
  mockConvert.mockResolvedValue(Buffer.from('DOCX content'))
  mockWriteFile.mockResolvedValue(undefined)
}

/**
 * Setup mocks for a cancelled export (user cancels save dialog)
 *
 * Configures save dialog to return cancelled state.
 * Used to test validation logic without completing the full export.
 */
function setupCancelledExport(): void {
  mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
}

// ============================================================================
// Tests
// ============================================================================

describe('DocxService', () => {
  let docxService: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset module to get fresh instance
    vi.resetModules()

    // Re-mock after reset
    vi.doMock('electron', () => ({
      dialog: {
        showSaveDialog: mockShowSaveDialog
      }
    }))

    vi.doMock('fs/promises', () => ({
      writeFile: mockWriteFile
    }))

    vi.doMock('./HtmlToDocxConverter', () => ({
      htmlToDocxConverter: {
        convert: mockConvert
      }
    }))

    // Import fresh instance
    const module = await import('./DocxService')
    docxService = module.docxService
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // ExportLock Tests
  // ==========================================================================

  describe('ExportLock', () => {
    it('should acquire lock on first call', async () => {
      setupSuccessfulExport()

      // First export should succeed
      const result = await docxService.exportToDocx('<p>Test</p>', 'test')
      expect(result.success).toBe(true)
    })

    it('should prevent concurrent exports', async () => {
      // Setup first export to be slow (wait for dialog)
      let resolveDialog: (value: any) => void
      const dialogPromise = new Promise(resolve => {
        resolveDialog = resolve
      })
      mockShowSaveDialog.mockReturnValue(dialogPromise)

      // Start first export (will wait at dialog)
      const firstExport = docxService.exportToDocx('<p>First</p>', 'first')

      // Try second export while first is pending
      const secondResult = await docxService.exportToDocx('<p>Second</p>', 'second')

      // Second export should fail immediately
      expect(secondResult.success).toBe(false)
      expect(secondResult.error).toBe('Export already in progress')
      expect(secondResult.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)

      // Complete first export
      resolveDialog!({ canceled: true })
      await firstExport
    })

    it('should release lock after successful export', async () => {
      setupSuccessfulExport()

      // First export
      await docxService.exportToDocx('<p>First</p>', 'first')

      // Second export should work
      setupSuccessfulExport()
      const result = await docxService.exportToDocx('<p>Second</p>', 'second')
      expect(result.success).toBe(true)
    })

    it('should release lock after cancelled export', async () => {
      setupCancelledExport()

      // First export (cancelled)
      await docxService.exportToDocx('<p>First</p>', 'first')

      // Second export should work
      setupCancelledExport()
      const result = await docxService.exportToDocx('<p>Second</p>', 'second')
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
    })

    it('should release lock after failed export', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockRejectedValue(new Error('Conversion failed'))

      // First export fails
      await docxService.exportToDocx('<p>First</p>', 'first')

      // Second export should work
      setupCancelledExport()
      const result = await docxService.exportToDocx('<p>Second</p>', 'second')
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
    })
  })

  // ==========================================================================
  // validateContent Tests
  // ==========================================================================

  describe('validateContent', () => {
    it('should reject empty string', async () => {
      const result = await docxService.exportToDocx('', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_NO_CONTENT)
      expect(result.error).toBe('No content to export')
    })

    it('should reject whitespace only', async () => {
      const result = await docxService.exportToDocx('   \n\t  ', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_NO_CONTENT)
      expect(result.error).toBe('No content to export')
    })

    it('should accept valid HTML content', async () => {
      setupCancelledExport()

      const result = await docxService.exportToDocx('<p>Valid content</p>', 'test')

      // Should pass validation and reach dialog (then be cancelled)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
      expect(mockShowSaveDialog).toHaveBeenCalled()
    })

    it('should accept content under 10MB', async () => {
      setupCancelledExport()

      // Create content just under 10MB
      const largeContent = '<p>' + 'x'.repeat(10 * 1024 * 1024 - 20) + '</p>'
      const result = await docxService.exportToDocx(largeContent, 'test')

      // Should pass validation
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
      expect(mockShowSaveDialog).toHaveBeenCalled()
    })

    it('should accept content exactly at 10MB boundary', async () => {
      setupCancelledExport()

      // Create content exactly 10MB (accounting for <p></p> tags)
      const exactContent = '<p>' + 'x'.repeat(DOCX_EXPORT.MAX_HTML_SIZE - 7) + '</p>'
      const result = await docxService.exportToDocx(exactContent, 'test')

      // Should pass validation
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
      expect(mockShowSaveDialog).toHaveBeenCalled()
    })

    it('should reject content over 10MB', async () => {
      // Create content over 10MB
      const oversizedContent = '<p>' + 'x'.repeat(11 * 1024 * 1024) + '</p>'
      const result = await docxService.exportToDocx(oversizedContent, 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
      expect(result.error).toMatch(/Content too large/)
      expect(result.error).toMatch(/Maximum allowed is 10MB/)
      expect(mockShowSaveDialog).not.toHaveBeenCalled()
    })

    it('should include size in error message for oversized content', async () => {
      // Create content that's approximately 15MB
      const oversizedContent = 'x'.repeat(15 * 1024 * 1024)
      const result = await docxService.exportToDocx(oversizedContent, 'test')

      expect(result.error).toMatch(/\d+MB/)
    })
  })

  // ==========================================================================
  // sanitizeFilename Tests
  // ==========================================================================

  describe('sanitizeFilename', () => {
    // Test all invalid Windows filename characters using it.each
    it.each([
      ['<', 'file<name', 'file-name.docx'],
      ['>', 'file>name', 'file-name.docx'],
      [':', 'file:name', 'file-name.docx'],
      ['"', 'file"name', 'file-name.docx'],
      ['/', 'file/name', 'file-name.docx'],
      ['\\', 'file\\name', 'file-name.docx'],
      ['|', 'file|name', 'file-name.docx'],
      ['?', 'file?name', 'file-name.docx'],
      ['*', 'file*name', 'file-name.docx']
    ])('should replace %s with hyphen', async (char, input, expected) => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', input)

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: expected
        })
      )
    })

    it('should remove control characters', async () => {
      setupCancelledExport()

      // Test various control characters (0x00-0x1F)
      const filename = 'file\x00\x01\x0A\x1Fname'
      await docxService.exportToDocx('<p>Test</p>', filename)

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'filename.docx'
        })
      )
    })

    it('should remove leading dots', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', '...filename')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'filename.docx'
        })
      )
    })

    it('should remove trailing dots', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'filename...')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'filename.docx'
        })
      )
    })

    it('should remove trailing spaces', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'filename   ')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'filename.docx'
        })
      )
    })

    it('should trim whitespace', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', '  filename  ')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'filename.docx'
        })
      )
    })

    // Test all Windows reserved names using it.each
    it.each([
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ])('should prefix %s with underscore', async (reservedName) => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', reservedName)

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: `_${reservedName}.docx`
        })
      )
    })

    it('should handle reserved names case-insensitively (lowercase)', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'con')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: '_con.docx'
        })
      )
    })

    it('should handle reserved names case-insensitively (mixed case)', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'Con')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: '_Con.docx'
        })
      )
    })

    it('should handle reserved names with extensions', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'CON.txt')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: '_CON.txt.docx'
        })
      )
    })

    it('should truncate to 200 characters', async () => {
      setupCancelledExport()

      const longName = 'a'.repeat(250)
      await docxService.exportToDocx('<p>Test</p>', longName)

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: expect.stringMatching(/^a{200}\.docx$/)
        })
      )
    })

    it('should handle empty string', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', '')

      // Should fall back to default filename
      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'document.docx'
        })
      )
    })

    it('should handle string of only control characters', async () => {
      setupCancelledExport()

      // Pass filename that is only control characters (0x00-0x1F)
      // These get removed entirely, resulting in empty string → default filename
      await docxService.exportToDocx('<p>Test</p>', '\x00\x01\x02\x03\x1F')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'document.docx'
        })
      )
    })

    it('should handle string of only invalid characters', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', '<>:"/\\|?*')

      // After sanitization, should be all hyphens (9 chars)
      // Invalid chars get replaced with hyphens, not removed
      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: '---------.docx'
        })
      )
    })

    it('should combine multiple sanitization rules', async () => {
      setupCancelledExport()

      // Test complex case: reserved name + invalid chars + dots
      // Leading/trailing dots are removed AFTER char replacement
      // So '...CON<file>name...' -> '...CON-file-name...' -> 'CON-file-name' -> no reserved prefix needed
      // because baseName is 'CON-file-name', not 'CON'
      await docxService.exportToDocx('<p>Test</p>', '...CON<file>name...')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'CON-file-name.docx'
        })
      )
    })
  })

  // ==========================================================================
  // showSaveDialog Tests
  // ==========================================================================

  describe('showSaveDialog', () => {
    it('should return file path when user saves', async () => {
      setupSuccessfulExport('/tmp/mydoc.docx')

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/tmp/mydoc.docx')
    })

    it('should return undefined when user cancels', async () => {
      setupCancelledExport()

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
      expect(result.error).toBeUndefined()
    })

    it('should append .docx if missing', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/document' })
      mockConvert.mockResolvedValue(Buffer.from('DOCX content'))
      mockWriteFile.mockResolvedValue(undefined)

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/tmp/document.docx')
      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/document.docx', expect.any(Buffer))
    })

    it('should not duplicate .docx extension', async () => {
      setupSuccessfulExport('/tmp/document.docx')

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.filePath).toBe('/tmp/document.docx')
      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/document.docx', expect.any(Buffer))
    })

    it('should handle .DOCX (case-insensitive)', async () => {
      setupSuccessfulExport('/tmp/document.DOCX')

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.filePath).toBe('/tmp/document.DOCX')
      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/document.DOCX', expect.any(Buffer))
    })

    it('should use sanitized filename as default', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'my-document')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'my-document.docx'
        })
      )
    })

    it('should use DEFAULT_FILENAME for empty sanitized name', async () => {
      setupCancelledExport()

      // Pass filename that sanitizes to truly empty (only dots and spaces)
      await docxService.exportToDocx('<p>Test</p>', '... \t  ...')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'document.docx'
        })
      )
    })

    it('should show correct dialog title', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Export to Word Document'
        })
      )
    })

    it('should show correct file filters', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [{ name: 'Word Document', extensions: ['docx'] }]
        })
      )
    })

    it('should enable overwrite confirmation', async () => {
      setupCancelledExport()

      await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ['showOverwriteConfirmation']
        })
      )
    })
  })

  // ==========================================================================
  // exportToDocx Tests
  // ==========================================================================

  describe('exportToDocx', () => {
    it('should return success with filePath on successful export', async () => {
      setupSuccessfulExport('/tmp/exported.docx')

      const result = await docxService.exportToDocx('<p>Test content</p>', 'test')

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/tmp/exported.docx')
      expect(result.error).toBeUndefined()
    })

    it('should return NO_CONTENT for empty HTML', async () => {
      const result = await docxService.exportToDocx('', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_NO_CONTENT)
      expect(result.error).toBe('No content to export')
    })

    it('should return FAILED for oversized HTML', async () => {
      const oversizedContent = 'x'.repeat(11 * 1024 * 1024)
      const result = await docxService.exportToDocx(oversizedContent, 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
      expect(result.error).toMatch(/Content too large/)
    })

    it('should return CANCELLED when dialog cancelled (no error message)', async () => {
      setupCancelledExport()

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_CANCELLED)
      expect(result.error).toBeUndefined()
    })

    it('should call converter with HTML content', async () => {
      setupSuccessfulExport()

      await docxService.exportToDocx('<p>Hello World</p>', 'test')

      expect(mockConvert).toHaveBeenCalledWith('<p>Hello World</p>')
    })

    it('should write converted buffer to file', async () => {
      const docxBuffer = Buffer.from('DOCX binary content')
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockResolvedValue(docxBuffer)
      mockWriteFile.mockResolvedValue(undefined)

      await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(mockWriteFile).toHaveBeenCalledWith('/tmp/test.docx', docxBuffer)
    })

    it('should return FAILED when converter throws', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockRejectedValue(new Error('Conversion error'))

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
      expect(result.error).toBe('Conversion error')
    })

    it('should return FAILED on file write EACCES (permission denied)', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockResolvedValue(Buffer.from('DOCX content'))
      const accessError = new Error('Permission denied') as NodeJS.ErrnoException
      accessError.code = 'EACCES'
      mockWriteFile.mockRejectedValue(accessError)

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
      expect(result.error).toBe('Permission denied')
    })

    it('should return FAILED on file write ENOSPC (no space)', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockResolvedValue(Buffer.from('DOCX content'))
      const spaceError = new Error('No space left on device') as NodeJS.ErrnoException
      spaceError.code = 'ENOSPC'
      mockWriteFile.mockRejectedValue(spaceError)

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
      expect(result.error).toBe('No space left on device')
    })

    it('should return FAILED on generic write errors', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockResolvedValue(Buffer.from('DOCX content'))
      mockWriteFile.mockRejectedValue(new Error('Generic write error'))

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
      expect(result.error).toBe('Generic write error')
    })

    it('should handle unknown error types', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockRejectedValue('String error')

      const result = await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.DOCX_EXPORT_FAILED)
      expect(result.error).toBe('Unknown error')
    })

    it('should log errors to logger', async () => {
      mockLogger.error.mockClear()
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/test.docx' })
      mockConvert.mockRejectedValue(new Error('Test error'))

      await docxService.exportToDocx('<p>Test</p>', 'test')

      expect(mockLogger.error).toHaveBeenCalledWith(
        'DOCX export failed',
        expect.any(Error)
      )
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('full workflow integration', () => {
    it('should complete full export workflow', async () => {
      const filePath = '/tmp/integration-test.docx'
      const htmlContent = '<h1>Test Document</h1><p>With content</p>'
      const docxBuffer = Buffer.from('DOCX binary data')

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath })
      mockConvert.mockResolvedValue(docxBuffer)
      mockWriteFile.mockResolvedValue(undefined)

      const result = await docxService.exportToDocx(htmlContent, 'integration-test')

      // Verify workflow
      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Export to Word Document',
          defaultPath: 'integration-test.docx',
          filters: [{ name: 'Word Document', extensions: ['docx'] }]
        })
      )
      expect(mockConvert).toHaveBeenCalledWith(htmlContent)
      expect(mockWriteFile).toHaveBeenCalledWith(filePath, docxBuffer)
      expect(result.success).toBe(true)
      expect(result.filePath).toBe(filePath)
    })

    it('should handle complex filename sanitization', async () => {
      setupCancelledExport()

      const complexFilename = '  ...CON:file<name>with*invalid|chars...  '
      await docxService.exportToDocx('<p>Test</p>', complexFilename)

      // Expected:
      // 1. Replace invalid chars: '  ...CON-file-name-with-invalid-chars...  '
      // 2. Remove control chars: (none)
      // 3. Remove leading dots: doesn't match (spaces before dots)
      // 4. Remove trailing dots: doesn't match (spaces after dots)
      // 5. Remove trailing spaces: '  ...CON-file-name-with-invalid-chars...'
      // 6. Trim: '...CON-file-name-with-invalid-chars...'
      // 7. Check reserved: baseName = '...CON-file-name-with-invalid-chars', not in reserved list
      // Note: Dots remain because removal happens before trim (when spaces prevent match)
      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: '...CON-file-name-with-invalid-chars....docx'
        })
      )
    })

    it('should call functions in correct order (dialog → convert → write)', async () => {
      const filePath = '/tmp/order-test.docx'
      const docxBuffer = Buffer.from('DOCX data')

      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath })
      mockConvert.mockResolvedValue(docxBuffer)
      mockWriteFile.mockResolvedValue(undefined)

      await docxService.exportToDocx('<p>Test</p>', 'test')

      // Verify order using mock invocation order
      const dialogOrder = mockShowSaveDialog.mock.invocationCallOrder[0]
      const convertOrder = mockConvert.mock.invocationCallOrder[0]
      const writeOrder = mockWriteFile.mock.invocationCallOrder[0]

      expect(dialogOrder).toBeLessThan(convertOrder)
      expect(convertOrder).toBeLessThan(writeOrder)
    })
  })

  // ==========================================================================
  // Constants Verification
  // ==========================================================================

  describe('constants', () => {
    it('should use correct MAX_HTML_SIZE from constants', () => {
      expect(DOCX_EXPORT.MAX_HTML_SIZE).toBe(10 * 1024 * 1024)
    })

    it('should use correct DEFAULT_FILENAME from constants', () => {
      expect(DOCX_EXPORT.DEFAULT_FILENAME).toBe('document')
    })
  })
})
