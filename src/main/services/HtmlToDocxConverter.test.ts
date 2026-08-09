// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HtmlToDocxConverter.test.ts
 *
 * Tests for HtmlToDocxConverter's own logic:
 * - wrapInHtmlDocument() - Full document detection, wrapper handling
 * - getDocxStylesheet() - CSS content verification
 * - convert() - strips remote images, wraps, and delegates to the isolated
 *   conversion process (the adapter is mocked here; the strip is covered by
 *   docxImageStrip.test.ts and the process by docx-convert.process.test.ts)
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DOCX_EXPORT } from '../../shared/constants'

// ============================================================================
// Mocks
// ============================================================================

// The real conversion is delegated to a killable utilityProcess adapter; mock it
// so these tests exercise HtmlToDocxConverter's own strip/wrap/delegate logic
// without forking a process. The remote-image strip runs for real (pure parse5).
const mockAdapterConvert = vi.fn()
vi.mock('./docx/DocxConvertProcessAdapter', () => ({
  docxConvertProcessAdapter: { convert: mockAdapterConvert },
  DocxConvertProcessAdapter: class {}
}))

// Mock the logger to avoid pulling in electron-log during tests.
const mockLoggerWarn = vi.fn()
vi.mock('./LoggingService', () => ({
  logger: { warn: mockLoggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// ============================================================================
// Tests
// ============================================================================

describe('HtmlToDocxConverter', () => {
  let converter: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset module to get fresh instance
    vi.resetModules()

    // Re-mock after reset
    vi.doMock('./docx/DocxConvertProcessAdapter', () => ({
      docxConvertProcessAdapter: { convert: mockAdapterConvert },
      DocxConvertProcessAdapter: class {}
    }))
    vi.doMock('./LoggingService', () => ({
      logger: { warn: mockLoggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
    }))

    // Import fresh instance
    const module = await import('./HtmlToDocxConverter')
    converter = new module.HtmlToDocxConverter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // wrapInHtmlDocument Tests
  // ==========================================================================

  describe('wrapInHtmlDocument', () => {
    describe('full document detection', () => {
      it('should return as-is if has <!DOCTYPE (uppercase)', () => {
        const html = '<!DOCTYPE html><html><body>test</body></html>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toBe(html)
      })

      it('should return as-is if has <!doctype (lowercase)', () => {
        const html = '<!doctype html><html><body>test</body></html>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toBe(html)
      })

      it('should return as-is if has <!DoCTyPe (mixed case)', () => {
        const html = '<!DoCTyPe html><html><body>test</body></html>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toBe(html)
      })

      it('should return as-is if has <html> tag', () => {
        const html = '<html><body>test</body></html>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toBe(html)
      })

      it('should return as-is if has <HTML> (uppercase)', () => {
        const html = '<HTML><body>test</body></HTML>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toBe(html)
      })

      it('should return as-is if has <html with attributes', () => {
        const html = '<html lang="en"><body>test</body></html>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toBe(html)
      })
    })

    describe('plain HTML fragment wrapping', () => {
      it('should wrap plain paragraph in full document', () => {
        const html = '<p>Hello World</p>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toContain('<!DOCTYPE html>')
        expect(result).toContain('<html>')
        expect(result).toContain('<head>')
        expect(result).toContain('<meta charset="UTF-8">')
        expect(result).toContain('<style>')
        expect(result).toContain('</style>')
        expect(result).toContain('</head>')
        expect(result).toContain('<body>')
        expect(result).toContain('<div class="markdown-preview-content">')
        expect(result).toContain('<p>Hello World</p>')
        expect(result).toContain('</div>')
        expect(result).toContain('</body>')
        expect(result).toContain('</html>')
      })

      it('should add markdown-preview-content wrapper to fragment', () => {
        const html = '<h1>Title</h1><p>Content</p>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toContain('<div class="markdown-preview-content">')
        expect(result).toContain('<h1>Title</h1><p>Content</p>')
        expect(result).toContain('</div>')
      })

      it('should include CSS stylesheet in fragment wrapper', () => {
        const html = '<p>Test</p>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toContain('<style>')
        expect(result).toContain('font-family: Calibri')
        expect(result).toContain('orphans: 3')
        expect(result).toContain('</style>')
      })
    })

    describe('existing markdown-preview-content handling', () => {
      it('should not add duplicate wrapper if already has markdown-preview-content', () => {
        const html = '<div class="markdown-preview-content"><p>Test</p></div>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toContain('<!DOCTYPE html>')
        expect(result).toContain('<body>')
        expect(result).toContain('<div class="markdown-preview-content"><p>Test</p></div>')
        expect(result).toContain('</body>')

        // Should NOT have nested markdown-preview-content
        const wrapperCount = (result.match(/markdown-preview-content/g) || []).length
        expect(wrapperCount).toBe(1)
      })

      it('should add HTML structure to existing wrapper', () => {
        const html = '<div class="markdown-preview-content"><h1>Title</h1></div>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toContain('<!DOCTYPE html>')
        expect(result).toContain('<html>')
        expect(result).toContain('<head>')
        expect(result).toContain('<style>')
        expect(result).toContain('</head>')
        expect(result).toContain('<body>')
        expect(result).toContain('<div class="markdown-preview-content"><h1>Title</h1></div>')
        expect(result).toContain('</body>')
        expect(result).toContain('</html>')
      })

      it('should include stylesheet when existing wrapper present', () => {
        const html = '<div class="markdown-preview-content"><p>Test</p></div>'
        const result = converter.wrapInHtmlDocument(html)

        expect(result).toContain('<style>')
        expect(result).toContain('font-family: Calibri')
        expect(result).toContain('</style>')
      })
    })
  })

  // ==========================================================================
  // getDocxStylesheet Tests
  // ==========================================================================

  describe('getDocxStylesheet', () => {
    let stylesheet: string

    beforeEach(() => {
      stylesheet = converter.getDocxStylesheet()
    })

    describe('body typography', () => {
      it('should include Calibri font family', () => {
        expect(stylesheet).toContain('font-family: Calibri')
      })

      it('should include Arial fallback', () => {
        expect(stylesheet).toContain('Arial')
      })

      it('should include line-height', () => {
        expect(stylesheet).toContain('line-height: 1.4')
      })
    })

    describe('paragraph spacing', () => {
      it('should include paragraph orphan prevention', () => {
        expect(stylesheet).toMatch(/p\s*{[^}]*orphans:\s*3/)
      })

      it('should include paragraph widow prevention', () => {
        expect(stylesheet).toMatch(/p\s*{[^}]*widows:\s*3/)
      })

      it('should include paragraph margin', () => {
        expect(stylesheet).toMatch(/p\s*{[^}]*margin:\s*0\s+0\s+0\.5em\s+0/)
      })
    })

    describe('heading styling', () => {
      it('should include heading orphan prevention', () => {
        expect(stylesheet).toMatch(/h[1-6][^{]*{[^}]*orphans:\s*3/)
      })

      it('should include heading widow prevention', () => {
        expect(stylesheet).toMatch(/h[1-6][^{]*{[^}]*widows:\s*3/)
      })

      it('should include heading margin-top', () => {
        expect(stylesheet).toMatch(/h[1-6][^{]*{[^}]*margin-top:\s*0\.75em/)
      })

      it('should include heading margin-bottom', () => {
        expect(stylesheet).toMatch(/h[1-6][^{]*{[^}]*margin-bottom:\s*0\.25em/)
      })
    })

    describe('list styling', () => {
      it('should include list margin', () => {
        expect(stylesheet).toMatch(/ul,\s*ol\s*{[^}]*margin:\s*0\.25em\s+0/)
      })

      it('should include list padding-left', () => {
        expect(stylesheet).toMatch(/ul,\s*ol\s*{[^}]*padding-left:\s*1\.5em/)
      })

      it('should include list item margin', () => {
        expect(stylesheet).toMatch(/li\s*{[^}]*margin:\s*0\.1em\s+0/)
      })

      it('should include list item orphan prevention', () => {
        expect(stylesheet).toMatch(/li\s*{[^}]*orphans:\s*2/)
      })

      it('should include list item widow prevention', () => {
        expect(stylesheet).toMatch(/li\s*{[^}]*widows:\s*2/)
      })
    })

    describe('code block styling', () => {
      it('should include Courier New font for code', () => {
        expect(stylesheet).toMatch(/pre,\s*code\s*{[^}]*font-family:\s*'Courier New'/)
      })

      it('should include Courier fallback', () => {
        expect(stylesheet).toContain('Courier, monospace')
      })

      it('should include code background color', () => {
        expect(stylesheet).toMatch(/pre,\s*code\s*{[^}]*background-color:\s*#f5f5f5/)
      })

      it('should include pre padding', () => {
        expect(stylesheet).toMatch(/pre\s*{[^}]*padding:\s*8px/)
      })

      it('should include pre white-space wrap', () => {
        expect(stylesheet).toMatch(/pre\s*{[^}]*white-space:\s*pre-wrap/)
      })

      it('should include pre page-break-inside avoid', () => {
        expect(stylesheet).toMatch(/pre\s*{[^}]*page-break-inside:\s*avoid/)
      })

      it('should include pre margin', () => {
        expect(stylesheet).toMatch(/pre\s*{[^}]*margin:\s*0\.5em\s+0/)
      })
    })

    describe('blockquote styling', () => {
      it('should include border-left', () => {
        expect(stylesheet).toMatch(/blockquote\s*{[^}]*border-left:\s*3px\s+solid\s+#ccc/)
      })

      it('should include margin', () => {
        expect(stylesheet).toMatch(/blockquote\s*{[^}]*margin:\s*0\.5em\s+0/)
      })

      it('should include padding-left', () => {
        expect(stylesheet).toMatch(/blockquote\s*{[^}]*padding-left:\s*12px/)
      })

      it('should include color', () => {
        expect(stylesheet).toMatch(/blockquote\s*{[^}]*color:\s*#555/)
      })

      it('should include page-break-inside avoid', () => {
        expect(stylesheet).toMatch(/blockquote\s*{[^}]*page-break-inside:\s*avoid/)
      })
    })

    describe('table styling', () => {
      it('should include border-collapse', () => {
        expect(stylesheet).toMatch(/table\s*{[^}]*border-collapse:\s*collapse/)
      })

      it('should include table width', () => {
        expect(stylesheet).toMatch(/table\s*{[^}]*width:\s*100%/)
      })

      it('should include table margin', () => {
        expect(stylesheet).toMatch(/table\s*{[^}]*margin:\s*0\.5em\s+0/)
      })

      it('should include table page-break-inside avoid', () => {
        expect(stylesheet).toMatch(/table\s*{[^}]*page-break-inside:\s*avoid/)
      })

      it('should include cell borders', () => {
        expect(stylesheet).toMatch(/th,\s*td\s*{[^}]*border:\s*1px\s+solid\s+#ddd/)
      })

      it('should include cell padding', () => {
        expect(stylesheet).toMatch(/th,\s*td\s*{[^}]*padding:\s*6px\s+8px/)
      })

      it('should include cell text-align', () => {
        expect(stylesheet).toMatch(/th,\s*td\s*{[^}]*text-align:\s*left/)
      })

      it('should include th background color', () => {
        expect(stylesheet).toMatch(/th\s*{[^}]*background-color:\s*#f0f0f0/)
      })

      it('should include th font-weight', () => {
        expect(stylesheet).toMatch(/th\s*{[^}]*font-weight:\s*bold/)
      })
    })

    describe('image styling', () => {
      it('should include page-break-inside avoid', () => {
        expect(stylesheet).toMatch(/img\s*{[^}]*page-break-inside:\s*avoid/)
      })
    })
  })

  // ==========================================================================
  // convert() - strip + wrap + delegate to the isolated conversion process
  // ==========================================================================

  describe('convert()', () => {
    it('strips remote images, wraps the content, and delegates to the adapter', async () => {
      mockAdapterConvert.mockResolvedValue(Buffer.from('DOCX content'))

      const result = await converter.convert(
        '<p>Doc</p><img src="http://127.0.0.1:8080/x.png"><img src="data:image/png;base64,AAAA">'
      )

      expect(result.buffer).toEqual(Buffer.from('DOCX content'))
      expect(result.removedRemoteImages).toBe(1)

      // The adapter receives the wrapped, stripped HTML: no remote src, data: kept.
      const passedHtml = mockAdapterConvert.mock.calls[0][0] as string
      expect(passedHtml).toContain('<!DOCTYPE html>')
      expect(passedHtml).toContain('markdown-preview-content')
      expect(passedHtml).not.toContain('127.0.0.1')
      expect(passedHtml).toContain('data:image/png;base64,AAAA')
    })

    it('reports zero removed and does not warn when there are no remote images', async () => {
      mockAdapterConvert.mockResolvedValue(Buffer.from('DOCX content'))

      const result = await converter.convert('<p>Local only</p>')

      expect(result.removedRemoteImages).toBe(0)
      expect(mockLoggerWarn).not.toHaveBeenCalled()
    })

    it('warns once with the removed count when remote images are stripped', async () => {
      mockAdapterConvert.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<img src="http://a/x"><img src="https://b/y">')

      expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
      expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('2 remote image'))
    })

    it('propagates a conversion failure from the adapter', async () => {
      mockAdapterConvert.mockRejectedValue(
        new Error('DOCX conversion timed out after 60 seconds')
      )

      await expect(converter.convert('<p>x</p>')).rejects.toThrow('timed out')
    })
  })

  // ==========================================================================
  // Singleton Export Tests
  // ==========================================================================

  describe('singleton export', () => {
    it('should export singleton instance', async () => {
      const module = await import('./HtmlToDocxConverter')

      expect(module.htmlToDocxConverter).toBeDefined()
      expect(module.htmlToDocxConverter.convert).toBeInstanceOf(Function)
    })

    it('should use HtmlToDocxConverter class instance', async () => {
      const module = await import('./HtmlToDocxConverter')

      expect(module.htmlToDocxConverter.constructor.name).toBe('HtmlToDocxConverter')
    })
  })

  // ==========================================================================
  // Constants Verification
  // ==========================================================================

  describe('constants', () => {
    it('should use correct CONVERSION_TIMEOUT_MS from constants', () => {
      expect(DOCX_EXPORT.CONVERSION_TIMEOUT_MS).toBe(60_000)
    })

    it('should timeout in seconds (not milliseconds)', () => {
      const seconds = DOCX_EXPORT.CONVERSION_TIMEOUT_MS / 1000
      expect(seconds).toBe(60)
    })
  })
})
