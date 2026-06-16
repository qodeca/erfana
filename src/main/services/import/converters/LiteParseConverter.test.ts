// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LiteParseConverter.test.ts
 *
 * Tests for the LiteParseConverter that converts PDF, Office, and image files
 * to spatial text using @llamaindex/liteparse.
 *
 * @see Issue #132 – LiteParse document import
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'

// --------------------------------------------------------------------------
// Mocks – must be hoisted before imports
// --------------------------------------------------------------------------

const mockParse = vi.fn()
const mockScreenshot = vi.fn()

vi.mock('@llamaindex/liteparse', () => ({
  LiteParse: vi.fn().mockImplementation(() => ({
    parse: mockParse,
    screenshot: mockScreenshot
  }))
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app/path'
  }
}))

// Mock validateFileForImport so validate() doesn't hit the filesystem
vi.mock('../../../utils/fileUtils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    validateFileForImport: vi.fn().mockResolvedValue({
      valid: true,
      sizeInMB: 1.5,
      fileName: 'test.pdf'
    })
  }
})

// Mock fs/promises for mkdtemp / writeFile / rm used during screenshots
vi.mock('fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/erfana-screenshots-abc123'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  constants: { X_OK: 1 }
}))

import { LiteParseConverter, getExtensionsForDependencies, createLiteParseConverter } from './LiteParseConverter'
import type { DependencyStatus } from '../types'

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const noDeps: DependencyStatus = { libreOffice: false, imageMagick: false }
const withLibreOffice: DependencyStatus = { libreOffice: true, imageMagick: false }
const withImageMagick: DependencyStatus = { libreOffice: false, imageMagick: true }
const withBoth: DependencyStatus = { libreOffice: true, imageMagick: true }

describe('LiteParseConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // supportedExtensions
  // ==========================================================================

  describe('supportedExtensions', () => {
    it('should return only pdf when no dependencies available', () => {
      const converter = new LiteParseConverter(noDeps)
      expect(converter.supportedExtensions).toEqual(['pdf'])
    })

    it('should include doc, docx, ppt, pptx, rtf with LibreOffice', () => {
      const converter = new LiteParseConverter(withLibreOffice)
      const exts = converter.supportedExtensions
      expect(exts).toContain('doc')
      expect(exts).toContain('docx')
      expect(exts).toContain('ppt')
      expect(exts).toContain('pptx')
      expect(exts).toContain('rtf')
    })

    it('should include jpg, jpeg, png, gif, bmp, tiff, webp with ImageMagick', () => {
      const converter = new LiteParseConverter(withImageMagick)
      const exts = converter.supportedExtensions
      expect(exts).toContain('jpg')
      expect(exts).toContain('jpeg')
      expect(exts).toContain('png')
      expect(exts).toContain('gif')
      expect(exts).toContain('bmp')
      expect(exts).toContain('tiff')
      expect(exts).toContain('webp')
    })

    it('should include all extensions with both dependencies', () => {
      const converter = new LiteParseConverter(withBoth)
      const exts = converter.supportedExtensions
      expect(exts).toContain('pdf')
      expect(exts).toContain('docx')
      expect(exts).toContain('jpg')
    })

    it('should always include pdf regardless of dependency state', () => {
      expect(new LiteParseConverter(noDeps).supportedExtensions).toContain('pdf')
      expect(new LiteParseConverter(withLibreOffice).supportedExtensions).toContain('pdf')
      expect(new LiteParseConverter(withImageMagick).supportedExtensions).toContain('pdf')
      expect(new LiteParseConverter(withBoth).supportedExtensions).toContain('pdf')
    })

    it('should NEVER include csv regardless of dependencies', () => {
      expect(new LiteParseConverter(noDeps).supportedExtensions).not.toContain('csv')
      expect(new LiteParseConverter(withLibreOffice).supportedExtensions).not.toContain('csv')
      expect(new LiteParseConverter(withImageMagick).supportedExtensions).not.toContain('csv')
      expect(new LiteParseConverter(withBoth).supportedExtensions).not.toContain('csv')
    })

    it('should NEVER include tsv regardless of dependencies', () => {
      expect(new LiteParseConverter(withBoth).supportedExtensions).not.toContain('tsv')
    })

    it('should NEVER include svg regardless of dependencies', () => {
      expect(new LiteParseConverter(withBoth).supportedExtensions).not.toContain('svg')
    })
  })

  // ==========================================================================
  // Static properties
  // ==========================================================================

  describe('static properties', () => {
    it('should have requiresConversion = true', () => {
      const converter = new LiteParseConverter(noDeps)
      expect(converter.requiresConversion).toBe(true)
    })

    it('should have category = document', () => {
      const converter = new LiteParseConverter(noDeps)
      expect(converter.category).toBe('document')
    })
  })

  // ==========================================================================
  // convert() – successful cases
  // ==========================================================================

  describe('convert() – success', () => {
    beforeEach(() => {
      mockParse.mockResolvedValue({
        pages: [
          { pageNum: 1, text: 'Page one content' },
          { pageNum: 2, text: 'Page two content' }
        ],
        text: 'Page one content\nPage two content'
      })
    })

    it('should return success with content', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.success).toBe(true)
      expect(result.content).toBeDefined()
      expect(result.content).toContain('Page one content')
    })

    it('should include YAML frontmatter in content', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.content).toContain('---')
      expect(result.content).toContain('source: "document.pdf"')
      expect(result.content).toContain('format: pdf')
    })

    it('should have pages in frontmatter matching parse result', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.content).toContain('pages: 2')
    })

    it('should have date in frontmatter', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/document.pdf')

      const today = new Date().toISOString().split('T')[0]
      expect(result.content).toContain(`date: ${today}`)
    })

    it('should have parser: liteparse in frontmatter', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.content).toContain('parser: liteparse')
    })

    it('should have ocr: true in frontmatter when OCR enabled (default)', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.content).toContain('ocr: true')
    })

    it('should have ocr: false in frontmatter when OCR explicitly disabled', async () => {
      const converter = new LiteParseConverter(noDeps, { ocr: false })
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.content).toContain('ocr: false')
    })
  })

  // ==========================================================================
  // convert() – error cases
  // ==========================================================================

  describe('convert() – errors', () => {
    it('should map password error to IMPORT_ENCRYPTED', async () => {
      mockParse.mockRejectedValue(new Error('Document is password protected'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/secret.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
    })

    it('should map encrypted error to IMPORT_ENCRYPTED', async () => {
      mockParse.mockRejectedValue(new Error('File is encrypted'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/secret.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
    })

    it('should map empty result to IMPORT_EMPTY', async () => {
      mockParse.mockResolvedValue({ pages: [], text: '' })

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/empty.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
    })

    it('should map whitespace-only result to IMPORT_EMPTY', async () => {
      mockParse.mockResolvedValue({ pages: [{ pageNum: 1, text: '   ' }], text: '   ' })

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/empty.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
    })

    it('should suggest enabling OCR in empty result message when OCR is disabled', async () => {
      mockParse.mockResolvedValue({ pages: [], text: '' })

      const converter = new LiteParseConverter(noDeps, { ocr: false })
      const result = await converter.convert('/path/to/empty.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      expect(result.error).toContain('OCR')
    })

    it('should NOT suggest enabling OCR when OCR is already enabled and result is empty', async () => {
      mockParse.mockResolvedValue({ pages: [], text: '' })

      const converter = new LiteParseConverter(noDeps, { ocr: true })
      const result = await converter.convert('/path/to/empty.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_EMPTY)
      // When OCR is already on, no hint about enabling it
      expect(result.error).not.toContain('Try enabling OCR')
    })

    it('should map timeout error to IMPORT_TIMEOUT', async () => {
      mockParse.mockRejectedValue(new Error('Conversion timed out after 30000ms'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/big.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_TIMEOUT)
    })

    it('should map timed out error to IMPORT_TIMEOUT', async () => {
      mockParse.mockRejectedValue(new Error('Process timed out'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/big.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_TIMEOUT)
    })

    it('should map generic error to IMPORT_CONVERSION_FAILED', async () => {
      mockParse.mockRejectedValue(new Error('Unexpected parsing failure'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/broken.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_CONVERSION_FAILED)
    })

    it('should not leak raw error details in generic failure result', async () => {
      mockParse.mockRejectedValue(new Error('Some internal parse error'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/broken.pdf')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Document conversion failed')
      expect(result.error).not.toContain('internal parse error')
    })
  })

  // ==========================================================================
  // convert() – additional error cases
  // ==========================================================================

  describe('convert() – additional error cases', () => {
    it('should map "page limit exceeded" error to IMPORT_PAGE_LIMIT_EXCEEDED', async () => {
      mockParse.mockRejectedValue(new Error('page limit exceeded for this document'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/big.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_PAGE_LIMIT_EXCEEDED)
    })

    it('should map "too many pages" error to IMPORT_PAGE_LIMIT_EXCEEDED', async () => {
      mockParse.mockRejectedValue(new Error('too many pages in document'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/big.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_PAGE_LIMIT_EXCEEDED)
    })

    it('should return IMPORT_CONVERSION_FAILED when a non-Error value is thrown', async () => {
      mockParse.mockRejectedValue('raw error string')

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/broken.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_CONVERSION_FAILED)
    })

    it('should map timeout from Promise.race to IMPORT_TIMEOUT', async () => {
      // Simulate the timeout error that Promise.race produces when parse hangs.
      // We test the error path directly since the 60s real timeout is not
      // testable with fake timers (dynamic import() conflicts with fake timers).
      mockParse.mockRejectedValue(new Error('Document conversion timed out'))

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/stuck.pdf')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_TIMEOUT)
    })
  })

  // ==========================================================================
  // convert() – frontmatter edge cases
  // ==========================================================================

  describe('convert() – frontmatter edge cases', () => {
    beforeEach(() => {
      mockParse.mockResolvedValue({
        pages: [{ pageNum: 1, text: 'content' }],
        text: 'content'
      })
    })

    it('should escape double quotes in the source filename', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/file"name.pdf')

      expect(result.success).toBe(true)
      expect(result.content).toContain('\\"')
      expect(result.content).not.toMatch(/source: "file"name/)
    })

    it('should replace newlines in the source filename with a space', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/file\nname.pdf')

      expect(result.success).toBe(true)
      // Newline replaced – must not appear literally inside the source field value
      expect(result.content).not.toContain('source: "file\nname.pdf"')
      expect(result.content).toContain('source: "file name.pdf"')
    })

    // Skipped on Windows: path.basename() treats `\` as a separator, so any
    // backslash in the input is removed before reaching the escape logic.
    // The escape logic still works – it just has no Windows-reachable input.
    it.skipIf(process.platform === 'win32')(
      'should escape backslashes in the source filename',
      async () => {
        const converter = new LiteParseConverter(noDeps)
        const result = await converter.convert('/path/to/file\\name.pdf')

        expect(result.success).toBe(true)
        expect(result.content).toContain('source: "file\\\\name.pdf"')
      }
    )
  })

  // ==========================================================================
  // convert() – truncation frontmatter
  // ==========================================================================

  describe('convert() – truncation frontmatter', () => {
    it('should include truncated: true in frontmatter when parse returns exactly 1000 pages', async () => {
      const pages = Array.from({ length: 1000 }, (_, i) => ({
        pageNum: i + 1,
        text: `Page ${i + 1}`
      }))
      mockParse.mockResolvedValue({ pages, text: pages.map((p) => p.text).join('\n') })

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/large.pdf')

      expect(result.success).toBe(true)
      expect(result.content).toContain('truncated: true')
    })

    it('should NOT include truncated in frontmatter for small documents', async () => {
      mockParse.mockResolvedValue({
        pages: [
          { pageNum: 1, text: 'Page 1' },
          { pageNum: 2, text: 'Page 2' },
          { pageNum: 3, text: 'Page 3' },
          { pageNum: 4, text: 'Page 4' },
          { pageNum: 5, text: 'Page 5' }
        ],
        text: 'Page 1\nPage 2\nPage 3\nPage 4\nPage 5'
      })

      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/small.pdf')

      expect(result.success).toBe(true)
      expect(result.content).not.toContain('truncated')
    })
  })

  // ==========================================================================
  // convert() – LiteParse constructor args
  // ==========================================================================

  describe('convert() – LiteParse constructor args', () => {
    beforeEach(() => {
      mockParse.mockResolvedValue({ pages: [{ pageNum: 1, text: 'content' }], text: 'content' })
    })

    it('should pass mapped ocrLanguage to LiteParse constructor', async () => {
      const converter = new LiteParseConverter(noDeps, { ocrLanguage: 'de' })
      await converter.convert('/path/to/doc.pdf')

      const { LiteParse } = await import('@llamaindex/liteparse')
      const ctorArgs = vi.mocked(LiteParse).mock.calls.at(-1)?.[0]
      expect(ctorArgs?.ocrLanguage).toBe('deu') // isoToTessLang('de') -> 'deu'
    })

    it('should pass custom DPI to LiteParse constructor', async () => {
      const converter = new LiteParseConverter(noDeps, { dpi: 300 })
      await converter.convert('/path/to/doc.pdf')

      const { LiteParse } = await import('@llamaindex/liteparse')
      const ctorArgs = vi.mocked(LiteParse).mock.calls.at(-1)?.[0]
      expect(ctorArgs?.dpi).toBe(300)
    })

    it('should default DPI to 150 when not specified', async () => {
      const converter = new LiteParseConverter(noDeps)
      await converter.convert('/path/to/doc.pdf')

      const { LiteParse } = await import('@llamaindex/liteparse')
      const ctorArgs = vi.mocked(LiteParse).mock.calls.at(-1)?.[0]
      expect(ctorArgs?.dpi).toBe(150)
    })
  })

  // ==========================================================================
  // resolveTessdataPath()
  // ==========================================================================

  describe('resolveTessdataPath()', () => {
    beforeEach(() => {
      mockParse.mockResolvedValue({ pages: [{ pageNum: 1, text: 'content' }], text: 'content' })
    })

    it('should use process.resourcesPath when app is packaged', async () => {
      const { app } = await import('electron')
      const origIsPackaged = app.isPackaged
      const origResourcesPath = process.resourcesPath

      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
      Object.defineProperty(process, 'resourcesPath', {
        value: '/mock/resources',
        configurable: true
      })

      try {
        const converter = new LiteParseConverter(noDeps)
        await converter.convert('/path/to/test.pdf')

        const { LiteParse } = await import('@llamaindex/liteparse')
        const ctorArgs = vi.mocked(LiteParse).mock.calls.at(-1)?.[0]
        // Use path.join so the expected value matches the host's native separator
        const path = await import('path')
        expect(ctorArgs?.tessdataPath).toBe(path.join('/mock/resources', 'tessdata'))
      } finally {
        Object.defineProperty(app, 'isPackaged', { value: origIsPackaged, configurable: true })
        Object.defineProperty(process, 'resourcesPath', {
          value: origResourcesPath,
          configurable: true
        })
      }
    })

    it('should use app.getAppPath() when app is not packaged', async () => {
      // Default mock has isPackaged: false and getAppPath() -> '/mock/app/path'
      const converter = new LiteParseConverter(noDeps)
      await converter.convert('/path/to/test.pdf')

      const { LiteParse } = await import('@llamaindex/liteparse')
      const ctorArgs = vi.mocked(LiteParse).mock.calls.at(-1)?.[0]
      expect(ctorArgs?.tessdataPath).toContain('tessdata')
      // On Windows, path.join converts to backslashes; check platform-normalized segment
      const path = await import('path')
      expect(ctorArgs?.tessdataPath).toContain(path.normalize('/mock/app/path'))
    })

    it('should not set tessdataPath when app throws', async () => {
      const { app } = await import('electron')
      const origDescriptor = Object.getOwnPropertyDescriptor(app, 'isPackaged')

      Object.defineProperty(app, 'isPackaged', {
        get: () => {
          throw new Error('no app')
        },
        configurable: true
      })

      try {
        const converter = new LiteParseConverter(noDeps)
        await converter.convert('/path/to/test.pdf')

        const { LiteParse } = await import('@llamaindex/liteparse')
        const ctorArgs = vi.mocked(LiteParse).mock.calls.at(-1)?.[0]
        expect(ctorArgs?.tessdataPath).toBeUndefined()
      } finally {
        if (origDescriptor) {
          Object.defineProperty(app, 'isPackaged', origDescriptor)
        } else {
          Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
        }
      }
    })
  })

  // ==========================================================================
  // createConfigured()
  // ==========================================================================

  describe('createConfigured()', () => {
    it('should return a new instance (not the same object)', () => {
      const base = new LiteParseConverter(noDeps)
      const configured = base.createConfigured({ ocr: true, ocrLanguage: 'de' })

      expect(configured).not.toBe(base)
    })

    it('should return a LiteParseConverter instance', () => {
      const base = new LiteParseConverter(noDeps)
      const configured = base.createConfigured({})

      expect(configured).toBeInstanceOf(LiteParseConverter)
    })

    it('should preserve the same dependency status', () => {
      const base = new LiteParseConverter(withBoth)
      const configured = base.createConfigured({})

      // Both should have same supportedExtensions since same deps
      expect(configured.supportedExtensions).toEqual(base.supportedExtensions)
    })

    it('should pass options to the new instance', async () => {
      mockParse.mockResolvedValue({
        pages: [{ pageNum: 1, text: 'content' }],
        text: 'content'
      })

      const base = new LiteParseConverter(noDeps)
      const configured = base.createConfigured({ ocr: false })
      const result = await configured.convert('/path/to/document.pdf')

      expect(result.content).toContain('ocr: false')
    })
  })

  // ==========================================================================
  // Screenshots
  // ==========================================================================

  describe('screenshots', () => {
    beforeEach(() => {
      mockParse.mockResolvedValue({
        pages: [
          { pageNum: 1, text: 'Page 1' },
          { pageNum: 2, text: 'Page 2' }
        ],
        text: 'Page 1\nPage 2'
      })
      mockScreenshot.mockResolvedValue([
        { pageNum: 1, imageBuffer: Buffer.from('fake-image-1') },
        { pageNum: 2, imageBuffer: Buffer.from('fake-image-2') }
      ])
    })

    it('should include screenshotDir in result when screenshots option is true', async () => {
      const converter = new LiteParseConverter(noDeps, { screenshots: true })
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.success).toBe(true)
      expect(result.screenshotDir).toBeDefined()
      expect(typeof result.screenshotDir).toBe('string')
    })

    it('should NOT include screenshotDir when screenshots option is false', async () => {
      const converter = new LiteParseConverter(noDeps, { screenshots: false })
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.success).toBe(true)
      expect(result.screenshotDir).toBeUndefined()
    })

    it('should NOT include screenshotDir when screenshots option is not set', async () => {
      const converter = new LiteParseConverter(noDeps)
      const result = await converter.convert('/path/to/document.pdf')

      expect(result.success).toBe(true)
      expect(result.screenshotDir).toBeUndefined()
    })

    it('should still succeed if screenshot generation fails (non-fatal)', async () => {
      mockScreenshot.mockRejectedValue(new Error('Screenshot failed'))

      const converter = new LiteParseConverter(noDeps, { screenshots: true })
      const result = await converter.convert('/path/to/document.pdf')

      // Conversion should succeed even though screenshots failed
      expect(result.success).toBe(true)
    })

    it('should cap screenshot pages at 100 for large documents', async () => {
      const pages = Array.from({ length: 150 }, (_, i) => ({ pageNum: i + 1, text: `p${i}` }))
      mockParse.mockResolvedValue({ pages, text: pages.map((p) => p.text).join('\n') })
      mockScreenshot.mockResolvedValue([])

      const converter = new LiteParseConverter(noDeps, { screenshots: true })
      await converter.convert('/path/to/large.pdf')

      expect(mockScreenshot).toHaveBeenCalledTimes(1)
      const [, pageNumbers] = mockScreenshot.mock.calls[0]
      expect(pageNumbers).toHaveLength(100)
      expect(pageNumbers[0]).toBe(1)
      expect(pageNumbers[99]).toBe(100)
    })

    it('should clean up temp dir when screenshot() throws internally', async () => {
      mockParse.mockResolvedValue({ pages: [{ pageNum: 1, text: 'content' }], text: 'content' })
      mockScreenshot.mockRejectedValue(new Error('screenshot internal error'))

      const { rm: mockedRm } = await import('fs/promises')

      const converter = new LiteParseConverter(noDeps, { screenshots: true })
      const result = await converter.convert('/path/to/document.pdf')

      // Conversion still succeeds (screenshot failure is non-fatal)
      expect(result.success).toBe(true)
      // But temp dir was cleaned up inside generateScreenshots catch block
      expect(vi.mocked(mockedRm)).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // convert() – frontmatter edge cases (non-PDF extension)
  // ==========================================================================

  describe('convert() – non-PDF extension frontmatter', () => {
    beforeEach(() => {
      mockParse.mockResolvedValue({
        pages: [{ pageNum: 1, text: 'document content' }],
        text: 'document content'
      })
    })

    it('should use the file extension as the format field', async () => {
      const converter = new LiteParseConverter({ libreOffice: true, imageMagick: false })
      const result = await converter.convert('/path/to/document.docx')
      expect(result.success).toBe(true)
      expect(result.content).toContain('format: docx')
    })
  })
})

// ==========================================================================
// getExtensionsForDependencies()
// ==========================================================================

describe('getExtensionsForDependencies()', () => {
  it('should return office extensions but no image extensions when only libreOffice is true', () => {
    const exts = getExtensionsForDependencies({ libreOffice: true, imageMagick: false })

    expect(exts).toContain('docx')
    expect(exts).toContain('doc')
    expect(exts).toContain('pptx')
    expect(exts).toContain('rtf')
    // No image extensions
    expect(exts).not.toContain('jpg')
    expect(exts).not.toContain('jpeg')
    expect(exts).not.toContain('png')
  })

  it('should return image extensions but no office extensions when only imageMagick is true', () => {
    const exts = getExtensionsForDependencies({ libreOffice: false, imageMagick: true })

    expect(exts).toContain('jpg')
    expect(exts).toContain('jpeg')
    expect(exts).toContain('png')
    expect(exts).toContain('tiff')
    // No office extensions
    expect(exts).not.toContain('docx')
    expect(exts).not.toContain('pptx')
    expect(exts).not.toContain('rtf')
  })

  it('should return both office and image extensions when both deps are true, never including csv, tsv, or svg', () => {
    const exts = getExtensionsForDependencies({ libreOffice: true, imageMagick: true })

    // Office extensions present
    expect(exts).toContain('docx')
    expect(exts).toContain('pptx')
    // Image extensions present
    expect(exts).toContain('jpg')
    expect(exts).toContain('png')
    // Excluded extensions never present
    expect(exts).not.toContain('csv')
    expect(exts).not.toContain('tsv')
    expect(exts).not.toContain('svg')
  })

  it('should return an empty array when both deps are false', () => {
    const exts = getExtensionsForDependencies({ libreOffice: false, imageMagick: false })

    expect(exts).toEqual([])
  })
})

// ==========================================================================
// createLiteParseConverter() factory
// ==========================================================================

describe('createLiteParseConverter()', () => {
  it('should create a LiteParseConverter instance with no args, supporting only pdf', () => {
    const converter = createLiteParseConverter()

    expect(converter).toBeInstanceOf(LiteParseConverter)
    expect(converter.supportedExtensions).toEqual(['pdf'])
  })

  it('should create an instance with correct extensions when deps are provided', () => {
    const converter = createLiteParseConverter({ libreOffice: true, imageMagick: false })

    expect(converter).toBeInstanceOf(LiteParseConverter)
    expect(converter.supportedExtensions).toContain('pdf')
    expect(converter.supportedExtensions).toContain('docx')
    expect(converter.supportedExtensions).not.toContain('jpg')
  })

  it('should pass options through to the converter instance', async () => {
    mockParse.mockResolvedValue({
      pages: [{ pageNum: 1, text: 'some text' }],
      text: 'some text'
    })

    const converter = createLiteParseConverter(
      { libreOffice: false, imageMagick: false },
      { ocr: false }
    )

    const result = await converter.convert('/path/to/document.pdf')

    expect(result.success).toBe(true)
    expect(result.content).toContain('ocr: false')
  })
})
