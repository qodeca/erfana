// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HtmlToDocxConverter.test.ts
 *
 * Comprehensive tests for HtmlToDocxConverter
 *
 * Test coverage:
 * - wrapInHtmlDocument() - Full document detection, wrapper handling
 * - getDocxStylesheet() - CSS content verification
 * - convert() - Result type handling, timeout, library errors
 * - Integration tests - Full conversion workflow
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DOCX_EXPORT } from '../../shared/constants'

// ============================================================================
// Mocks
// ============================================================================

// Mock @turbodocx/html-to-docx
const mockHTMLtoDOCX = vi.fn()
vi.mock('@turbodocx/html-to-docx', () => ({
  default: mockHTMLtoDOCX
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
    vi.doMock('@turbodocx/html-to-docx', () => ({
      default: mockHTMLtoDOCX
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
  // convert() Result Type Handling Tests
  // ==========================================================================

  describe('convert() - result type handling', () => {
    it('should return Buffer when library returns Buffer', async () => {
      const expectedBuffer = Buffer.from('DOCX content')
      mockHTMLtoDOCX.mockResolvedValue(expectedBuffer)

      const result = await converter.convert('<p>Test</p>')

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result).toBe(expectedBuffer)
    })

    it('should convert ArrayBuffer to Buffer', async () => {
      const arrayBuffer = new ArrayBuffer(10)
      const view = new Uint8Array(arrayBuffer)
      view.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      mockHTMLtoDOCX.mockResolvedValue(arrayBuffer)

      const result = await converter.convert('<p>Test</p>')

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.length).toBe(10)
      expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })

    it('should convert Blob to Buffer', async () => {
      const blobContent = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      const blob = new Blob([blobContent])
      mockHTMLtoDOCX.mockResolvedValue(blob)

      const result = await converter.convert('<p>Test</p>')

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(Array.from(result)).toEqual([72, 101, 108, 108, 111])
    })

    it('should throw on unexpected string result', async () => {
      mockHTMLtoDOCX.mockResolvedValue('string result')

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Unexpected result type from HTMLtoDOCX'
      )
    })

    it('should throw on unexpected number result', async () => {
      mockHTMLtoDOCX.mockResolvedValue(12345)

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Unexpected result type from HTMLtoDOCX'
      )
    })

    it('should throw on unexpected null result', async () => {
      mockHTMLtoDOCX.mockResolvedValue(null)

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Unexpected result type from HTMLtoDOCX'
      )
    })

    it('should throw on unexpected undefined result', async () => {
      mockHTMLtoDOCX.mockResolvedValue(undefined)

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Unexpected result type from HTMLtoDOCX'
      )
    })

    it('should throw on unexpected object result', async () => {
      mockHTMLtoDOCX.mockResolvedValue({ data: 'test' })

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Unexpected result type from HTMLtoDOCX'
      )
    })

    it('should throw on unexpected array result', async () => {
      mockHTMLtoDOCX.mockResolvedValue([1, 2, 3])

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Unexpected result type from HTMLtoDOCX'
      )
    })
  })

  // ==========================================================================
  // convert() Timeout Tests
  // ==========================================================================

  describe('convert() - timeout handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should succeed if conversion completes within timeout', async () => {
      const expectedBuffer = Buffer.from('DOCX content')
      mockHTMLtoDOCX.mockResolvedValue(expectedBuffer)

      const promise = converter.convert('<p>Test</p>')
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result).toBe(expectedBuffer)
    })

    it('should reject with timeout error after 60 seconds', async () => {
      // Make conversion hang indefinitely
      mockHTMLtoDOCX.mockImplementation(() => new Promise(() => {}))

      const promise = converter.convert('<p>Test</p>')

      // Setup error expectation before advancing timers
      const errorPromise = promise.catch(error => error)

      // Advance time to timeout
      vi.advanceTimersByTime(DOCX_EXPORT.CONVERSION_TIMEOUT_MS)
      await vi.runAllTimersAsync()

      const error = await errorPromise
      expect(error.message).toBe('DOCX conversion timed out after 60 seconds')
    })

    it('should include timeout duration in error message', async () => {
      mockHTMLtoDOCX.mockImplementation(() => new Promise(() => {}))

      const promise = converter.convert('<p>Test</p>')

      // Setup error expectation before advancing timers
      const errorPromise = promise.catch(error => error)

      vi.advanceTimersByTime(DOCX_EXPORT.CONVERSION_TIMEOUT_MS)
      await vi.runAllTimersAsync()

      const error = await errorPromise
      expect(error.message).toMatch(/60 seconds/)
    })

    it('should clear timeout after successful conversion', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<p>Test</p>')
      await vi.runAllTimersAsync()

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('should clear timeout after library error', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      mockHTMLtoDOCX.mockRejectedValue(new Error('Library error'))

      try {
        await converter.convert('<p>Test</p>')
      } catch {
        // Expected error
      }
      await vi.runAllTimersAsync()

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('should clear timeout after type conversion error', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      mockHTMLtoDOCX.mockResolvedValue('invalid type')

      try {
        await converter.convert('<p>Test</p>')
      } catch {
        // Expected error
      }
      await vi.runAllTimersAsync()

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('should not timeout if conversion completes just before limit', async () => {
      let resolveConversion: (value: Buffer) => void
      const conversionPromise = new Promise<Buffer>(resolve => {
        resolveConversion = resolve
      })
      mockHTMLtoDOCX.mockReturnValue(conversionPromise)

      const promise = converter.convert('<p>Test</p>')

      // Complete conversion immediately (simulating fast conversion)
      resolveConversion!(Buffer.from('DOCX content'))
      await vi.runAllTimersAsync()

      const result = await promise
      expect(Buffer.isBuffer(result)).toBe(true)
    })
  })

  // ==========================================================================
  // convert() Library Error Tests
  // ==========================================================================

  describe('convert() - library error handling', () => {
    it('should propagate errors from HTMLtoDOCX library', async () => {
      const error = new Error('Library conversion failed')
      mockHTMLtoDOCX.mockRejectedValue(error)

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Library conversion failed'
      )
    })

    it('should include original error message', async () => {
      const error = new Error('Malformed HTML structure')
      mockHTMLtoDOCX.mockRejectedValue(error)

      await expect(converter.convert('<p>Test</p>')).rejects.toThrow(
        'Malformed HTML structure'
      )
    })

    it('should propagate library-specific errors', async () => {
      const error = new Error('Table parsing failed')
      mockHTMLtoDOCX.mockRejectedValue(error)

      await expect(converter.convert('<table><tr><td>Test</td></tr></table>')).rejects.toThrow(
        'Table parsing failed'
      )
    })
  })

  // ==========================================================================
  // convert() Integration Tests
  // ==========================================================================

  describe('convert() - integration', () => {
    it('should call HTMLtoDOCX with wrapped HTML', async () => {
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<p>Test</p>')

      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.stringContaining('<!DOCTYPE html>'),
        null,
        expect.any(Object),
        null
      )
      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.stringContaining('<p>Test</p>'),
        null,
        expect.any(Object),
        null
      )
    })

    it('should pass correct options to HTMLtoDOCX', async () => {
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<p>Test</p>')

      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.any(String),
        null,
        expect.objectContaining({
          orientation: 'portrait',
          font: 'Calibri',
          fontSize: 22,
          title: 'Exported Document',
          creator: 'Erfana'
        }),
        null
      )
    })

    it('should pass correct margin options', async () => {
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<p>Test</p>')

      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.any(String),
        null,
        expect.objectContaining({
          margins: {
            top: 1440,    // 1 inch
            right: 1080,  // 0.75 inch
            bottom: 1440, // 1 inch
            left: 1080    // 0.75 inch
          }
        }),
        null
      )
    })

    it('should pass correct heading options', async () => {
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<h1>Title</h1>')

      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.any(String),
        null,
        expect.objectContaining({
          heading: expect.objectContaining({
            heading1: expect.objectContaining({
              keepNext: true,
              keepLines: true,
              spacing: expect.objectContaining({
                before: expect.any(Number),
                after: expect.any(Number)
              })
            })
          })
        }),
        null
      )
    })

    it('should pass correct table options', async () => {
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<table><tr><td>Test</td></tr></table>')

      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.any(String),
        null,
        expect.objectContaining({
          table: expect.objectContaining({
            row: expect.objectContaining({
              cantSplit: true
            }),
            addSpacingAfter: false
          })
        }),
        null
      )
    })

    it('should pass null for header and footer', async () => {
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert('<p>Test</p>')

      // Verify arguments: (html, header, options, footer)
      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.any(String),
        null,  // header
        expect.any(Object),
        null   // footer
      )
    })

    it('should handle complex HTML with multiple elements', async () => {
      const complexHtml = `
        <h1>Title</h1>
        <p>Paragraph</p>
        <ul><li>List item</li></ul>
        <pre><code>code block</code></pre>
        <table><tr><td>Table cell</td></tr></table>
        <blockquote>Quote</blockquote>
      `
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      const result = await converter.convert(complexHtml)

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.stringContaining('<h1>Title</h1>'),
        null,
        expect.any(Object),
        null
      )
    })

    it('should handle Mermaid diagram images', async () => {
      const htmlWithDiagram = '<img data-mermaid-diagram="true" src="data:image/png;base64,..." />'
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      const result = await converter.convert(htmlWithDiagram)

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(mockHTMLtoDOCX).toHaveBeenCalledWith(
        expect.stringContaining('data-mermaid-diagram="true"'),
        null,
        expect.any(Object),
        null
      )
    })

    it('should not double-wrap full HTML documents', async () => {
      const fullHtml = '<!DOCTYPE html><html><head></head><body><p>Test</p></body></html>'
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert(fullHtml)

      const calledHtml = mockHTMLtoDOCX.mock.calls[0][0]
      // Count DOCTYPE occurrences - should be exactly 1
      const doctypeCount = (calledHtml.match(/<!DOCTYPE/gi) || []).length
      expect(doctypeCount).toBe(1)
      // Count <html> occurrences - should be exactly 1
      const htmlTagCount = (calledHtml.match(/<html/gi) || []).length
      expect(htmlTagCount).toBe(1)
    })

    it('should not add wrapper when HTML already has markdown-preview-content', async () => {
      const htmlWithWrapper = '<div class="markdown-preview-content"><p>Test</p></div>'
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX content'))

      await converter.convert(htmlWithWrapper)

      const calledHtml = mockHTMLtoDOCX.mock.calls[0][0]
      // Count markdown-preview-content occurrences - should be exactly 1
      const wrapperCount = (calledHtml.match(/markdown-preview-content/g) || []).length
      expect(wrapperCount).toBe(1)
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
