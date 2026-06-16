// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import * as panelUtils from '../../utils/panelUtils'

/**
 * Test wrapper that provides ToastContext
 */
const renderWithToast = (ui: React.ReactElement) => {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

/**
 * MarkdownPreview Prompt Integration Tests
 *
 * Focused integration tests for rendering and configuration.
 * Note: Full DOM selection/context menu testing is complex in jsdom.
 * These tests verify component integration at a structural level.
 */
describe('MarkdownPreview Prompt Integration', () => {
  const mockWriteText = vi.fn()
  const mockReadFile = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock file reads
    mockReadFile.mockResolvedValue('Line 1\nLine 2\nLine 3')
    mockWriteText.mockResolvedValue(undefined)

    // Mock window.api
    global.window.api = {
      file: {
        readFile: mockReadFile,
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

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockWriteText
      },
      writable: true,
      configurable: true
    })

    // Mock executePromptTemplate
    vi.spyOn(panelUtils, 'executePromptTemplate').mockResolvedValue({ success: true })

    // Create portal-root for modals
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    vi.restoreAllMocks()

    const portalRoot = document.getElementById('portal-root')
    if (portalRoot) {
      document.body.removeChild(portalRoot)
    }
  })

  describe('Component Rendering', () => {
    it('should render markdown content', () => {
      const markdown = '# Heading\n\nParagraph text'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const heading = container.querySelector('h1')
      expect(heading).toBeTruthy()
      expect(heading?.textContent).toBe('Heading')

      const paragraph = container.querySelector('p')
      expect(paragraph).toBeTruthy()
      expect(paragraph?.textContent).toBe('Paragraph text')
    })

    it('should render without filePath', () => {
      const markdown = 'Test content'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} />)

      const paragraph = container.querySelector('p')
      expect(paragraph?.textContent).toBe('Test content')
    })

    it('should apply custom className', () => {
      const { container } = renderWithToast(
        <MarkdownPreview content="Test" filePath="/test.md" className="custom-class" />
      )

      const preview = container.querySelector('.markdown-preview')
      expect(preview).toBeTruthy()
      expect(preview?.className).toContain('custom-class')
    })
  })

  describe('Line Tracking Attributes', () => {
    it('should add line tracking to headings', () => {
      const markdown = '# Heading 1\n\n## Heading 2'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const h1 = container.querySelector('h1')
      expect(h1).toHaveAttribute('data-line-start')
      expect(h1).toHaveAttribute('data-line-end')
      expect(h1?.getAttribute('data-line-start')).toBe('1')

      const h2 = container.querySelector('h2')
      expect(h2).toHaveAttribute('data-line-start')
      expect(h2?.getAttribute('data-line-start')).toBe('3')
    })

    it('should add line tracking to paragraphs', () => {
      const markdown = 'Line 1\n\nLine 3'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(2)

      expect(paragraphs[0]).toHaveAttribute('data-line-start', '1')
      expect(paragraphs[1]).toHaveAttribute('data-line-start', '3')
    })

    it('should add line tracking to lists', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const ul = container.querySelector('ul')
      expect(ul).toHaveAttribute('data-line-start')

      const listItems = container.querySelectorAll('li')
      expect(listItems).toHaveLength(3)
      listItems.forEach((li) => {
        expect(li).toHaveAttribute('data-line-start')
      })
    })

    it('should add line tracking to blockquotes', () => {
      const markdown = '> Quote text\n> Second line'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const blockquote = container.querySelector('blockquote')
      expect(blockquote).toHaveAttribute('data-line-start')
    })

    it('should add line tracking to code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Code blocks have line tracking on the pre.code-block element
      const codeBlock = container.querySelector('pre.code-block')
      expect(codeBlock).toHaveAttribute('data-line-start')
    })

    it('should add line tracking to tables', () => {
      const markdown = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const tableWrapper = container.querySelector('.table-wrapper')
      expect(tableWrapper).toHaveAttribute('data-line-start')

      const rows = container.querySelectorAll('tr')
      rows.forEach((row) => {
        expect(row).toHaveAttribute('data-line-start')
      })
    })
  })

  // Regression guard for the frontmatter line-offset bug: body elements are rendered
  // from the frontmatter-stripped string, so their react-markdown positions are
  // body-relative. They must be shifted by frontmatterLineCount to become real file
  // lines, otherwise context-menu Modify/Ask reads the wrong source lines (the bug)
  // and scroll-sync drifts. See docs plan: preview-frontmatter-line-offset.
  describe('Line Tracking Attributes – frontmatter offset', () => {
    it('offsets body heading/paragraph line numbers by frontmatterLineCount', () => {
      // Lines: 1 ---, 2 title, 3 author, 4 ---, 5 # Heading, 6 blank, 7 Paragraph
      // frontmatterLineCount = 2 yaml + 2 delimiters = 4
      const markdown = '---\ntitle: T\nauthor: Me\n---\n# Heading\n\nParagraph text'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const h1 = container.querySelector('h1')
      expect(h1?.getAttribute('data-line-start')).toBe('5')
      expect(h1?.getAttribute('data-line-end')).toBe('5')
      expect(h1?.getAttribute('data-line')).toBe('5')

      const p = container.querySelector('p')
      expect(p?.getAttribute('data-line-start')).toBe('7')
    })

    it('applies the offset to every producer path (heading, code block, link, table cell), not just <p>', () => {
      // Asserts the offset reaches both the HOC-based and the direct-extractRange renderers.
      const body =
        '# Heading\n\n```js\nconst x = 1\n```\n\n[link](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |'
      const FRONT = '---\nk: v\n---\n' // frontmatterLineCount = 3

      const plain = renderWithToast(<MarkdownPreview content={body} filePath="/f.md" />).container
      const withFm = renderWithToast(<MarkdownPreview content={FRONT + body} filePath="/f.md" />).container

      const startOf = (root: Element, sel: string) =>
        Number(root.querySelector(sel)?.getAttribute('data-line-start'))

      // Scope the table cell to the body table (.table-wrapper); the frontmatter
      // table also renders <td>s but those intentionally carry no data-line-start.
      for (const sel of ['h1', 'pre.code-block', 'a', '.table-wrapper td']) {
        const before = startOf(plain, sel)
        const after = startOf(withFm, sel)
        expect(after).toBe(before + 3)
      }
    })

    it('offsets both start and end for multi-line elements (code block spans real file lines)', () => {
      // Lines: 1 ---, 2 k:v, 3 ---, 4 Lead, 5 blank, 6 ```js, 7 const x, 8 const y, 9 ```
      const markdown = '---\nk: v\n---\nLead\n\n```js\nconst x = 1\nconst y = 2\n```'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const code = container.querySelector('pre.code-block')
      expect(code?.getAttribute('data-line-start')).toBe('6')
      expect(code?.getAttribute('data-line-end')).toBe('9')
    })

    it('keeps the frontmatter table on real file lines so the two coordinate systems are contiguous', () => {
      const markdown = '---\ntitle: T\nauthor: Me\n---\n# Heading'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const wrapper = container.querySelector('.frontmatter-wrapper')
      expect(wrapper?.getAttribute('data-line-start')).toBe('1')
      expect(wrapper?.getAttribute('data-line-end')).toBe('4') // frontmatter occupies lines 1-4
      // Body heading begins on the very next file line, 5 – no gap, no overlap.
      expect(container.querySelector('h1')?.getAttribute('data-line-start')).toBe('5')
    })

    it('still offsets the body when the frontmatter YAML is invalid (FrontmatterCodeBlock path)', () => {
      // `foo: [bar` is an unclosed flow sequence – parses with an error but the --- block matches.
      const markdown = '---\nfoo: [bar\n---\n# Body'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const errorWrapper = container.querySelector('.frontmatter-error-wrapper')
      expect(errorWrapper).toBeTruthy()
      expect(errorWrapper?.getAttribute('data-line-start')).toBe('1')
      expect(errorWrapper?.getAttribute('data-line-end')).toBe('3')

      // body is still stripped and offset by frontmatterLineCount (3)
      expect(container.querySelector('h1')?.getAttribute('data-line-start')).toBe('4')
    })

    it('applies no offset when there is no frontmatter (offset 0, unchanged behavior)', () => {
      const markdown = '# Heading\n\nParagraph'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      expect(container.querySelector('h1')?.getAttribute('data-line-start')).toBe('1')
      expect(container.querySelector('p')?.getAttribute('data-line-start')).toBe('3')
    })
  })

  describe('Markdown Features', () => {
    it('should render GFM tables', () => {
      const markdown = '| A | B |\n|---|---|\n| 1 | 2 |'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const table = container.querySelector('table')
      expect(table).toBeTruthy()
    })

    it('should render GFM task lists', () => {
      const markdown = '- [x] Done\n- [ ] Todo'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const checkboxes = container.querySelectorAll('input[type="checkbox"]')
      expect(checkboxes).toHaveLength(2)
      expect(checkboxes[0]).toBeChecked()
      expect(checkboxes[1]).not.toBeChecked()
    })

    it('should render inline code', () => {
      const markdown = 'Use `code` here'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const code = container.querySelector('code.inline-code')
      expect(code?.textContent).toBe('code')
    })

    it('should render code blocks with language class', () => {
      const markdown = '```javascript\nconst x = 1;\n```'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const code = container.querySelector('code')
      expect(code?.className).toContain('language-javascript')
    })

    it('should generate IDs for headings', () => {
      const markdown = '# My Heading Title'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const heading = container.querySelector('h1')
      expect(heading?.getAttribute('id')).toBe('my-heading-title')
    })
  })

  describe('HTML Sanitization', () => {
    it('should allow safe HTML elements', () => {
      const markdown = '<div>Safe content</div>'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const div = container.querySelector('div.markdown-preview-content div')
      expect(div).toBeTruthy()
    })

    it('should strip script tags', () => {
      const markdown = '<script>alert("xss")</script>Safe text'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const script = container.querySelector('script')
      expect(script).toBeNull()
    })

    it('should strip event handlers', () => {
      const markdown = '<div onclick="alert(1)">Click</div>'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const div = container.querySelector('div.markdown-preview-content div')
      expect(div?.hasAttribute('onclick')).toBe(false)
    })
  })

  describe('Component Integration', () => {
    it('should initialize without context menu or dialog', () => {
      renderWithToast(
        <MarkdownPreview content="Test" filePath="/test/file.md" />
      )

      // Context menu should not be visible initially
      const contextMenu = document.querySelector('.context-menu')
      expect(contextMenu).toBeNull()

      // Dialog should not be visible initially
      const dialog = document.querySelector('.user-input-dialog')
      expect(dialog).toBeNull()
    })

    it('should handle empty content', () => {
      const { container } = renderWithToast(<MarkdownPreview content="" filePath="/test/file.md" />)

      const content = container.querySelector('.markdown-preview-content')
      expect(content).toBeTruthy()
      expect(content?.textContent?.trim()).toBe('')
    })

    it('should handle very long content', () => {
      const longContent = Array(1000).fill('Line of text').join('\n\n')
      const { container } = renderWithToast(<MarkdownPreview content={longContent} filePath="/test/file.md" />)

      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs.length).toBe(1000)
    })

    it('should re-render when content changes', () => {
      const { container, rerender } = renderWithToast(
        <MarkdownPreview content="# Original" filePath="/test/file.md" />
      )

      let heading = container.querySelector('h1')
      expect(heading?.textContent).toBe('Original')

      rerender(
        <ToastProvider>
          <MarkdownPreview content="# Updated" filePath="/test/file.md" />
        </ToastProvider>
      )

      heading = container.querySelector('h1')
      expect(heading?.textContent).toBe('Updated')
    })

    it('should maintain ref when provided', () => {
      const ref = { current: null as any }
      renderWithToast(<MarkdownPreview content="Test" filePath="/test/file.md" ref={ref} />)

      expect(ref.current).toBeTruthy()
      expect(ref.current.element).toBeTruthy()
      expect(ref.current.element.className).toContain('markdown-preview')
    })
  })

  describe('Mermaid Diagram Support', () => {
    it('should render Mermaid code blocks with MermaidDiagram component', () => {
      const markdown = '```mermaid\ngraph TD\n  A-->B\n```'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const mermaidWrapper = container.querySelector('.mermaid-wrapper')
      expect(mermaidWrapper).toBeTruthy()
      expect(mermaidWrapper).toHaveAttribute('data-line-start')
    })

    it('should pass filePath to MermaidDiagram for error reporting', () => {
      const markdown = '```mermaid\ngraph TD\n  A-->B\n```'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/doc.md" />)

      // MermaidDiagram component should be rendered
      const mermaidWrapper = container.querySelector('.mermaid-wrapper')
      expect(mermaidWrapper).toBeTruthy()
    })
  })
})
