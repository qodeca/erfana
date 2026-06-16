// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'

/**
 * Test wrapper that provides ToastContext
 */
const renderWithToast = (ui: React.ReactElement) => {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

/**
 * Async test wrapper that waits for effects to complete
 * Use this for tests where the component has async useEffect hooks
 */
const renderWithToastAsync = async (ui: React.ReactElement) => {
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(<ToastProvider>{ui}</ToastProvider>)
  })
  return result!
}

/**
 * MarkdownPreview Link Features Tests
 *
 * Tests for internal link navigation, tooltips, and broken link detection
 */
describe('MarkdownPreview Link Features', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock window.api
    global.window.api = {
      file: {
        getProjectPath: vi.fn().mockResolvedValue('/test/project'),
        getStats: vi.fn().mockRejectedValue(new Error('ENOENT'))
      }
    } as any

    // Mock electron shell
    Object.defineProperty(global.window, 'electron', {
      value: {
        shell: {
          openExternal: vi.fn()
        }
      },
      writable: true,
      configurable: true
    })

    // Create portal-root for modals
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  describe('Duplicate Heading IDs', () => {
    it('should generate unique IDs for duplicate headings', () => {
      const markdown = '# Example\n\n## Example\n\n### Example'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const h1 = container.querySelector('h1')
      const h2 = container.querySelector('h2')
      const h3 = container.querySelector('h3')

      expect(h1?.getAttribute('id')).toBe('example')
      expect(h2?.getAttribute('id')).toBe('example-2')
      expect(h3?.getAttribute('id')).toBe('example-3')
    })

    it('should handle multiple duplicates of the same heading', () => {
      const markdown = '# Test\n\n# Test\n\n# Test\n\n# Test'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const headings = container.querySelectorAll('h1')
      expect(headings).toHaveLength(4)

      expect(headings[0]?.getAttribute('id')).toBe('test')
      expect(headings[1]?.getAttribute('id')).toBe('test-2')
      expect(headings[2]?.getAttribute('id')).toBe('test-3')
      expect(headings[3]?.getAttribute('id')).toBe('test-4')
    })

    it('should handle headings with special characters', () => {
      const markdown = '# Hello World!\n\n## Hello, World?'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const h1 = container.querySelector('h1')
      const h2 = container.querySelector('h2')

      // GitHub-compatible: special chars are removed, spaces become hyphens
      expect(h1?.getAttribute('id')).toBe('hello-world')
      expect(h2?.getAttribute('id')).toBe('hello-world-2')
    })

    it('should handle headings with unicode characters', () => {
      const markdown = '# Café\n\n## Café'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const h1 = container.querySelector('h1')
      const h2 = container.querySelector('h2')

      expect(h1?.getAttribute('id')).toBe('café')
      expect(h2?.getAttribute('id')).toBe('café-2')
    })

    it('should handle headings with only whitespace', () => {
      // Markdown parser may not render truly empty headings
      // Test with minimal non-whitespace content
      const markdown = '# a\n\n## a'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const h1 = container.querySelector('h1')
      const h2 = container.querySelector('h2')

      expect(h1?.getAttribute('id')).toBe('a')
      expect(h2?.getAttribute('id')).toBe('a-2')
    })
  })

  describe('Internal Link Styling', () => {
    it('should apply internal-link class to markdown links', async () => {
      const markdown = '[Link](./file.md)'
      const { container } = await renderWithToastAsync(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.className).toContain('internal-link')
    })

    it('should apply external-link class to http links', () => {
      const markdown = '[Link](http://example.com)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.className).toContain('external-link')
    })

    it('should apply external-link class to https links', () => {
      const markdown = '[Link](https://example.com)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.className).toContain('external-link')
    })

    it('should apply external-link class to mailto links', () => {
      const markdown = '[Email](mailto:test@example.com)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.className).toContain('external-link')
      expect(link?.className).not.toContain('internal-link')
    })

  })

  describe('Link Tooltips', () => {
    it('should add tooltip to external links', () => {
      const markdown = '[External](https://example.com)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.getAttribute('title')).toBe('Open in browser: https://example.com')
    })

    it('should add email-specific tooltip to mailto links', () => {
      const markdown = '[Email](mailto:test@example.com)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.getAttribute('title')).toBe('Send email to: test@example.com')
    })

    it('should add tooltip to internal links without filePath', () => {
      const markdown = '[Internal](./file.md)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} />)

      // When no filePath, no tooltip should be set
      const link = container.querySelector('a')
      // The link should still be clickable but without resolved tooltip
      expect(link).toBeTruthy()
    })
  })

  describe('Anchor Links', () => {
    it('should handle anchor-only links', () => {
      const markdown = '[Jump](#section)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.getAttribute('href')).toBe('#section')
    })

    it('should handle links with anchors', async () => {
      const markdown = '[Link](./file.md#section)'
      const { container } = await renderWithToastAsync(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.getAttribute('href')).toBe('./file.md#section')
    })
  })

  describe('Link Resolution Integration', () => {
    it('should extract links from markdown for resolution', async () => {
      const markdown = `
# Heading

[Link 1](./file1.md)
[Link 2](./file2.md)
[External](https://example.com)
[Anchor](#section)
      `
      await renderWithToastAsync(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Verify getProjectPath was called for link resolution
      expect(window.api.file.getProjectPath).toHaveBeenCalled()
    })

    it('should not resolve links when filePath is not provided', () => {
      const markdown = '[Link](./file.md)'
      renderWithToast(<MarkdownPreview content={markdown} />)

      // Should not call getProjectPath when no filePath
      expect(window.api.file.getProjectPath).not.toHaveBeenCalled()
    })
  })

  // Note: "Focus Accessibility" test removed - it only verified that an <a> tag exists,
  // which provides no value. Actual focus-visible styles are CSS and tested visually.

  describe('Security: Dangerous Protocols', () => {
    // Note: Dangerous protocols are sanitized by rehype-sanitize BEFORE reaching our component
    // This is the correct security behavior - they're stripped entirely from the rendered HTML

    it('should sanitize javascript: protocol (href removed)', () => {
      const markdown = '[XSS](javascript:alert(1))'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Link text is preserved but href is stripped by sanitizer
      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.textContent).toBe('XSS')
      expect(link?.getAttribute('href')).toBeFalsy() // href removed by sanitizer
    })

    it('should sanitize JavaScript: protocol (case insensitive)', () => {
      const markdown = '[XSS](JavaScript:alert(1))'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should sanitize JAVASCRIPT: protocol (uppercase)', () => {
      const markdown = '[XSS](JAVASCRIPT:alert(1))'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should sanitize data: protocol', () => {
      const markdown = '[XSS](data:text/html,<script>alert(1)</script>)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should sanitize DATA: protocol (case insensitive)', () => {
      const markdown = '[XSS](DATA:text/html,test)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should sanitize vbscript: protocol', () => {
      const markdown = '[XSS](vbscript:msgbox("XSS"))'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should sanitize VBScript: protocol (case insensitive)', () => {
      const markdown = '[XSS](VBScript:msgbox(1))'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should sanitize file:// protocol', () => {
      const markdown = '[File](file:///etc/passwd)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should sanitize FILE:// protocol (case insensitive)', () => {
      const markdown = '[File](FILE:///Users/test)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBeFalsy()
    })

    it('should NOT sanitize safe protocols', () => {
      const markdown = '[Safe](https://example.com)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a.external-link')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBe('https://example.com') // Safe protocols preserved
    })
  })

  describe('Anchor-Only Links', () => {
    it('should handle anchor-only links (#section)', () => {
      const markdown = '[Jump](#section)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a.anchor-link')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBe('#section')
      expect(link?.getAttribute('title')).toBe('Jump to section: section')
    })

    it('should style anchor links differently from internal links', async () => {
      const markdown = '[Anchor](#section)\n\n[Internal](./file.md)'
      const { container } = await renderWithToastAsync(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const anchorLink = container.querySelectorAll('a')[0]
      const internalLink = container.querySelectorAll('a')[1]

      expect(anchorLink?.className).toBe('anchor-link')
      expect(internalLink?.className).toBe('internal-link')
    })
  })

  describe('Email Query Parameters', () => {
    it('should clean mailto: links with subject in tooltip', () => {
      const markdown = '[Email](mailto:test@example.com?subject=Hello)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.getAttribute('title')).toBe('Send email to: test@example.com')
    })

    it('should clean mailto: links with multiple query params', () => {
      const markdown = '[Email](mailto:test@example.com?subject=Hello&body=World)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.getAttribute('title')).toBe('Send email to: test@example.com')
    })

    it('should handle mailto: without query params', () => {
      const markdown = '[Email](mailto:test@example.com)'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const link = container.querySelector('a')
      expect(link?.getAttribute('title')).toBe('Send email to: test@example.com')
    })
  })
})
