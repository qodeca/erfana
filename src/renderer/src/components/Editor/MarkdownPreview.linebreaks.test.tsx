// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

/**
 * Test wrapper that provides ToastContext
 */
const renderWithToast = (ui: React.ReactElement) => {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

/**
 * MarkdownPreview Line Breaks Feature Tests
 *
 * Tests for the preserveLineBreaks setting that controls whether
 * single newlines in markdown are converted to <br> tags in HTML.
 *
 * @see Issue #69 - Preserve line breaks setting
 */
describe('MarkdownPreview Line Breaks Feature', () => {
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

    // Reset global settings store to default state
    useGlobalSettingsStore.setState({
      settings: {
        logging: { level: 'info' },
        editor: { preserveLineBreaks: false }
      },
      isLoading: false,
      error: null,
      isInitialized: true,
      wasCorruptionRecovered: false
    })
  })

  describe('When preserveLineBreaks is false', () => {
    it('should NOT create <br> tags for single newlines', () => {
      // Set preserveLineBreaks to false
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two\nLine three'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Single newlines should be collapsed into a single paragraph
      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(1)

      // Should NOT contain <br> tags
      const brTags = container.querySelectorAll('br')
      expect(brTags).toHaveLength(0)

      // Text should be joined with spaces (markdown default behavior)
      const text = paragraphs[0]?.textContent
      expect(text).toContain('Line one')
      expect(text).toContain('Line two')
      expect(text).toContain('Line three')
    })

    it('should still create separate paragraphs for double newlines', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false }
        },
        isInitialized: true
      })

      const markdown = 'Paragraph one\n\nParagraph two\n\nParagraph three'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Double newlines should create separate paragraphs
      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(3)

      expect(paragraphs[0]?.textContent).toBe('Paragraph one')
      expect(paragraphs[1]?.textContent).toBe('Paragraph two')
      expect(paragraphs[2]?.textContent).toBe('Paragraph three')
    })

    it('should handle mixed single and double newlines correctly', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two\n\nParagraph two'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(2)

      // First paragraph contains both lines (single newline collapsed)
      const firstParagraph = paragraphs[0]?.textContent
      expect(firstParagraph).toContain('Line one')
      expect(firstParagraph).toContain('Line two')

      // Second paragraph is separate (double newline)
      expect(paragraphs[1]?.textContent).toBe('Paragraph two')

      // No <br> tags should exist
      const brTags = container.querySelectorAll('br')
      expect(brTags).toHaveLength(0)
    })
  })

  describe('When preserveLineBreaks is true', () => {
    it('should create <br> tags for single newlines', () => {
      // Set preserveLineBreaks to true
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two\nLine three'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // All lines should be in a single paragraph
      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(1)

      // Should contain <br> tags for line breaks
      const brTags = container.querySelectorAll('br')
      expect(brTags.length).toBeGreaterThan(0)

      // Verify all three lines are present in the paragraph
      const text = paragraphs[0]?.textContent
      expect(text).toContain('Line one')
      expect(text).toContain('Line two')
      expect(text).toContain('Line three')
    })

    it('should still create separate paragraphs for double newlines', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = 'Paragraph one\n\nParagraph two\n\nParagraph three'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Double newlines should still create separate paragraphs
      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(3)

      expect(paragraphs[0]?.textContent).toBe('Paragraph one')
      expect(paragraphs[1]?.textContent).toBe('Paragraph two')
      expect(paragraphs[2]?.textContent).toBe('Paragraph three')
    })

    it('should handle mixed single and double newlines with <br> tags', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two\n\nParagraph two'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(2)

      // First paragraph should contain both lines with <br> in between
      const firstParagraph = paragraphs[0]
      expect(firstParagraph?.textContent).toContain('Line one')
      expect(firstParagraph?.textContent).toContain('Line two')

      // Verify <br> tags exist in first paragraph
      const firstParagraphBrTags = firstParagraph?.querySelectorAll('br')
      expect(firstParagraphBrTags?.length).toBeGreaterThan(0)

      // Second paragraph is separate
      expect(paragraphs[1]?.textContent).toBe('Paragraph two')
    })

    it('should handle trailing newlines correctly', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two\n'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      const paragraphs = container.querySelectorAll('p')
      expect(paragraphs).toHaveLength(1)

      // Should have at least one <br> tag for the newline
      const brTags = container.querySelectorAll('br')
      expect(brTags.length).toBeGreaterThan(0)
    })
  })

  describe('Default behavior (settings not loaded)', () => {
    it('should default to false when settings are null', () => {
      // Simulate settings not loaded yet
      useGlobalSettingsStore.setState({
        settings: null,
        isInitialized: false
      })

      const markdown = 'Line one\nLine two'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Should behave as if preserveLineBreaks is false (default)
      const brTags = container.querySelectorAll('br')
      expect(brTags).toHaveLength(0)
    })

    it('should default to false when preserveLineBreaks is undefined', () => {
      // Simulate settings with editor object but preserveLineBreaks explicitly undefined
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: undefined as any }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Should default to false
      const brTags = container.querySelectorAll('br')
      expect(brTags).toHaveLength(0)
    })
  })

  describe('Reactivity to setting changes', () => {
    it('should update rendering when preserveLineBreaks changes from false to true', () => {
      // Start with false
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two'
      const { container, rerender } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Initially no <br> tags
      let brTags = container.querySelectorAll('br')
      expect(brTags).toHaveLength(0)

      // Change setting to true wrapped in act()
      act(() => {
        useGlobalSettingsStore.setState({
          settings: {
            logging: { level: 'info' },
            editor: { preserveLineBreaks: true }
          }
        })
      })

      // Re-render with same props (React should re-render due to store change)
      rerender(
        <ToastProvider>
          <MarkdownPreview content={markdown} filePath="/test/file.md" />
        </ToastProvider>
      )

      // Now should have <br> tags
      brTags = container.querySelectorAll('br')
      expect(brTags.length).toBeGreaterThan(0)
    })

    it('should update rendering when preserveLineBreaks changes from true to false', () => {
      // Start with true
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = 'Line one\nLine two'
      const { container, rerender } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Initially has <br> tags
      let brTags = container.querySelectorAll('br')
      expect(brTags.length).toBeGreaterThan(0)

      // Change setting to false wrapped in act()
      act(() => {
        useGlobalSettingsStore.setState({
          settings: {
            logging: { level: 'info' },
            editor: { preserveLineBreaks: false }
          }
        })
      })

      // Re-render with same props
      rerender(
        <ToastProvider>
          <MarkdownPreview content={markdown} filePath="/test/file.md" />
        </ToastProvider>
      )

      // Now should NOT have <br> tags
      brTags = container.querySelectorAll('br')
      expect(brTags).toHaveLength(0)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const { container } = renderWithToast(<MarkdownPreview content="" filePath="/test/file.md" />)

      // Should render without errors
      expect(container.querySelector('.markdown-preview')).toBeTruthy()
    })

    it('should handle content with only newlines', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = '\n\n\n'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Should render without errors
      expect(container.querySelector('.markdown-preview')).toBeTruthy()
    })

    it('should work correctly with other markdown features', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = '**Bold text**\nNew line\n_Italic text_'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Should have bold and italic elements
      expect(container.querySelector('strong')).toBeTruthy()
      expect(container.querySelector('em')).toBeTruthy()

      // Should have <br> tags for newlines
      const brTags = container.querySelectorAll('br')
      expect(brTags.length).toBeGreaterThan(0)
    })

    it('should work correctly with lists', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = '- Item one\n- Item two\n- Item three'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Should render as a list
      const listItems = container.querySelectorAll('li')
      expect(listItems).toHaveLength(3)

      // List items themselves should not have <br> tags (different context)
      const firstItem = listItems[0]
      expect(firstItem?.textContent).toBe('Item one')
    })

    it('should work correctly with code blocks', () => {
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: true }
        },
        isInitialized: true
      })

      const markdown = '```\ncode line one\ncode line two\n```'
      const { container } = renderWithToast(<MarkdownPreview content={markdown} filePath="/test/file.md" />)

      // Should have a code block
      const codeBlock = container.querySelector('pre code')
      expect(codeBlock).toBeTruthy()

      // Code blocks preserve their own formatting, <br> tags shouldn't affect them
      const text = codeBlock?.textContent
      expect(text).toContain('code line one')
      expect(text).toContain('code line two')
    })
  })
})
