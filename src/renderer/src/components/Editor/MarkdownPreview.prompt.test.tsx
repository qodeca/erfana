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
    vi.spyOn(panelUtils, 'executePromptTemplate').mockResolvedValue()

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
