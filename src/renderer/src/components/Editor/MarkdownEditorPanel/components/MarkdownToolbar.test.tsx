/**
 * Tests for MarkdownToolbar component.
 *
 * Covers:
 * - View mode button clicks and active states
 * - Formatting button interactions
 * - Export button states (loading, disabled)
 * - File status indicators (modified, auto-saving, reloading)
 * - Search button integration
 *
 * @module MarkdownToolbar.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MarkdownToolbar, type MarkdownToolbarProps, type ViewMode, type EditorFile } from './MarkdownToolbar'
import type { MonacoEditorHandle } from '../../MonacoMarkdownEditor'

// Mock useSearchStore
const mockOpenSearch = vi.fn()
vi.mock('../../../../stores/useSearchStore', () => ({
  useSearchStore: {
    getState: () => ({
      openSearch: mockOpenSearch
    })
  }
}))

// Mock selectionHelpers
vi.mock('../../../../utils/selectionHelpers', () => ({
  getSelectedText: vi.fn(() => undefined)
}))

/**
 * Creates a mock EditorFile for testing.
 */
function createMockFile(overrides: Partial<EditorFile> = {}): EditorFile {
  return {
    path: '/test/file.md',
    content: '# Test content',
    modified: false,
    ...overrides
  }
}

/**
 * Creates a mock MonacoEditorHandle ref for testing.
 */
function createMockEditorRef(): React.RefObject<MonacoEditorHandle | null> {
  const mockHandle: MonacoEditorHandle = {
    formatBold: vi.fn(),
    formatItalic: vi.fn(),
    formatStrikethrough: vi.fn(),
    formatCode: vi.fn(),
    formatCodeBlock: vi.fn(),
    insertLink: vi.fn(),
    insertImage: vi.fn(),
    insertHeading: vi.fn(),
    insertList: vi.fn(),
    getEditor: vi.fn(),
    getScrollTop: vi.fn(),
    setScrollTop: vi.fn(),
    getTopForLineNumber: vi.fn(),
    setPositionAndReveal: vi.fn()
  }
  return { current: mockHandle }
}

/**
 * Creates default props for MarkdownToolbar.
 */
function createDefaultProps(overrides: Partial<MarkdownToolbarProps> = {}): MarkdownToolbarProps {
  return {
    viewMode: 'split',
    currentFile: createMockFile(),
    editorRef: createMockEditorRef(),
    isAutoSaving: false,
    isReloading: false,
    isExportingPdf: false,
    isExportingDocx: false,
    onViewModeChange: vi.fn(),
    onExportPdf: vi.fn(),
    onExportDocx: vi.fn(),
    ...overrides
  }
}

describe('MarkdownToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('rendering', () => {
    it('renders the toolbar container', () => {
      render(<MarkdownToolbar {...createDefaultProps()} />)
      expect(screen.getByTestId('markdown-toolbar')).toBeInTheDocument()
    })

    it('renders all view mode buttons', () => {
      render(<MarkdownToolbar {...createDefaultProps()} />)

      expect(screen.getByTestId('view-mode-btn-editor')).toBeInTheDocument()
      expect(screen.getByTestId('view-mode-btn-split-horizontal')).toBeInTheDocument()
      expect(screen.getByTestId('view-mode-btn-split')).toBeInTheDocument()
      expect(screen.getByTestId('view-mode-btn-preview')).toBeInTheDocument()
    })

    it('renders export buttons', () => {
      render(<MarkdownToolbar {...createDefaultProps()} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-export-docx')).toBeInTheDocument()
    })
  })

  describe('view mode buttons', () => {
    it.each<ViewMode>(['editor', 'split', 'split-horizontal', 'preview'])(
      'shows %s button as active when viewMode is %s',
      (mode) => {
        render(<MarkdownToolbar {...createDefaultProps({ viewMode: mode })} />)

        const buttonId = `view-mode-btn-${mode}`
        const button = screen.getByTestId(buttonId)
        expect(button).toHaveClass('active')
      }
    )

    it('calls onViewModeChange when editor button is clicked', () => {
      const onViewModeChange = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview', onViewModeChange })} />)

      fireEvent.click(screen.getByTestId('view-mode-btn-editor'))
      expect(onViewModeChange).toHaveBeenCalledWith('editor')
    })

    it('calls onViewModeChange when split button is clicked', () => {
      const onViewModeChange = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onViewModeChange })} />)

      fireEvent.click(screen.getByTestId('view-mode-btn-split'))
      expect(onViewModeChange).toHaveBeenCalledWith('split')
    })

    it('calls onViewModeChange when split-horizontal button is clicked', () => {
      const onViewModeChange = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onViewModeChange })} />)

      fireEvent.click(screen.getByTestId('view-mode-btn-split-horizontal'))
      expect(onViewModeChange).toHaveBeenCalledWith('split-horizontal')
    })

    it('calls onViewModeChange when preview button is clicked', () => {
      const onViewModeChange = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onViewModeChange })} />)

      fireEvent.click(screen.getByTestId('view-mode-btn-preview'))
      expect(onViewModeChange).toHaveBeenCalledWith('preview')
    })

    it('only one view mode button is active at a time', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      const buttons = [
        screen.getByTestId('view-mode-btn-editor'),
        screen.getByTestId('view-mode-btn-split'),
        screen.getByTestId('view-mode-btn-split-horizontal'),
        screen.getByTestId('view-mode-btn-preview')
      ]

      const activeButtons = buttons.filter((btn) => btn.classList.contains('active'))
      expect(activeButtons).toHaveLength(1)
      expect(activeButtons[0]).toBe(screen.getByTestId('view-mode-btn-split'))
    })
  })

  describe('formatting buttons', () => {
    it('shows formatting buttons in editor mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      expect(screen.getByTestId('toolbar-btn-bold')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-italic')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-strikethrough')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-code')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-link')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-image')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-heading')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-list')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-list-ordered')).toBeInTheDocument()
    })

    it('shows formatting buttons in split mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      expect(screen.getByTestId('toolbar-btn-bold')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-btn-italic')).toBeInTheDocument()
    })

    it('hides formatting buttons in preview mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview' })} />)

      expect(screen.queryByTestId('toolbar-btn-bold')).not.toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-btn-italic')).not.toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-btn-strikethrough')).not.toBeInTheDocument()
    })

    it('hides formatting buttons in split-horizontal mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split-horizontal' })} />)

      expect(screen.queryByTestId('toolbar-btn-bold')).not.toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-btn-italic')).not.toBeInTheDocument()
    })

    it('calls formatBold when bold button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-bold'))
      expect(editorRef.current?.formatBold).toHaveBeenCalled()
    })

    it('calls formatItalic when italic button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-italic'))
      expect(editorRef.current?.formatItalic).toHaveBeenCalled()
    })

    it('calls formatStrikethrough when strikethrough button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-strikethrough'))
      expect(editorRef.current?.formatStrikethrough).toHaveBeenCalled()
    })

    it('calls formatCode when code button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-code'))
      expect(editorRef.current?.formatCode).toHaveBeenCalled()
    })

    it('calls insertLink when link button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-link'))
      expect(editorRef.current?.insertLink).toHaveBeenCalled()
    })

    it('calls insertImage when image button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-image'))
      expect(editorRef.current?.insertImage).toHaveBeenCalled()
    })

    it('calls insertHeading with level 1 when heading button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-heading'))
      expect(editorRef.current?.insertHeading).toHaveBeenCalledWith(1)
    })

    it('calls insertList with false when bullet list button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-list'))
      expect(editorRef.current?.insertList).toHaveBeenCalledWith(false)
    })

    it('calls insertList with true when numbered list button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-list-ordered'))
      expect(editorRef.current?.insertList).toHaveBeenCalledWith(true)
    })
  })

  describe('search button', () => {
    it('shows search button in editor mode (with formatting buttons)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId('toolbar-btn-search')).toBeInTheDocument()
    })

    it('shows search button in split mode (with formatting buttons)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)
      expect(screen.getByTestId('toolbar-btn-search')).toBeInTheDocument()
    })

    it('shows search button in preview mode (standalone)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview' })} />)
      expect(screen.getByTestId('toolbar-btn-search')).toBeInTheDocument()
    })

    it('shows search button in split-horizontal mode (standalone)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split-horizontal' })} />)
      expect(screen.getByTestId('toolbar-btn-search')).toBeInTheDocument()
    })

    it('calls openSearch when search button is clicked', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-search'))
      expect(mockOpenSearch).toHaveBeenCalled()
    })
  })

  describe('export buttons', () => {
    it('calls onExportPdf when PDF button is clicked', () => {
      const onExportPdf = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split', onExportPdf })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-export-pdf'))
      expect(onExportPdf).toHaveBeenCalled()
    })

    it('calls onExportDocx when DOCX button is clicked', () => {
      const onExportDocx = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split', onExportDocx })} />)

      fireEvent.click(screen.getByTestId('toolbar-btn-export-docx'))
      expect(onExportDocx).toHaveBeenCalled()
    })

    it('disables PDF button when isExportingPdf is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isExportingPdf: true })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).toBeDisabled()
    })

    it('disables DOCX button when isExportingDocx is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isExportingDocx: true })} />)

      expect(screen.getByTestId('toolbar-btn-export-docx')).toBeDisabled()
    })

    it('disables export buttons when no file is open', () => {
      render(<MarkdownToolbar {...createDefaultProps({ currentFile: null })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).toBeDisabled()
      expect(screen.getByTestId('toolbar-btn-export-docx')).toBeDisabled()
    })

    it('disables export buttons in editor-only mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).toBeDisabled()
      expect(screen.getByTestId('toolbar-btn-export-docx')).toBeDisabled()
    })

    it('enables export buttons in split mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).not.toBeDisabled()
      expect(screen.getByTestId('toolbar-btn-export-docx')).not.toBeDisabled()
    })

    it('enables export buttons in preview mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview' })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).not.toBeDisabled()
      expect(screen.getByTestId('toolbar-btn-export-docx')).not.toBeDisabled()
    })

    it('enables export buttons in split-horizontal mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split-horizontal' })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).not.toBeDisabled()
      expect(screen.getByTestId('toolbar-btn-export-docx')).not.toBeDisabled()
    })

    it('shows correct title when export is disabled due to editor-only mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).toHaveAttribute(
        'title',
        'Export to PDF (switch to preview or split mode)'
      )
      expect(screen.getByTestId('toolbar-btn-export-docx')).toHaveAttribute(
        'title',
        'Export to Word (switch to preview or split mode)'
      )
    })

    it('shows correct title when export is enabled', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      expect(screen.getByTestId('toolbar-btn-export-pdf')).toHaveAttribute('title', 'Export to PDF')
      expect(screen.getByTestId('toolbar-btn-export-docx')).toHaveAttribute('title', 'Export to Word')
    })
  })

  describe('file status indicators', () => {
    it('shows modified indicator when file has unsaved changes', () => {
      const currentFile = createMockFile({ modified: true })
      render(<MarkdownToolbar {...createDefaultProps({ currentFile })} />)

      expect(screen.getByTestId('modified-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('modified-indicator')).toHaveTextContent('●')
    })

    it('hides modified indicator when file has no unsaved changes', () => {
      const currentFile = createMockFile({ modified: false })
      render(<MarkdownToolbar {...createDefaultProps({ currentFile })} />)

      expect(screen.queryByTestId('modified-indicator')).not.toBeInTheDocument()
    })

    it('shows auto-saving indicator when isAutoSaving is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isAutoSaving: true })} />)

      expect(screen.getByTestId('autosave-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('autosave-indicator')).toHaveTextContent('Auto-saving...')
    })

    it('hides auto-saving indicator when isAutoSaving is false', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isAutoSaving: false })} />)

      expect(screen.queryByTestId('autosave-indicator')).not.toBeInTheDocument()
    })

    it('shows reload indicator when isReloading is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isReloading: true })} />)

      expect(screen.getByTestId('reload-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('reload-indicator')).toHaveTextContent('Reloaded from disk')
    })

    it('hides reload indicator when isReloading is false', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isReloading: false })} />)

      expect(screen.queryByTestId('reload-indicator')).not.toBeInTheDocument()
    })

    it('can show multiple indicators simultaneously', () => {
      const currentFile = createMockFile({ modified: true })
      render(
        <MarkdownToolbar
          {...createDefaultProps({
            currentFile,
            isAutoSaving: true,
            isReloading: true
          })}
        />
      )

      expect(screen.getByTestId('modified-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('autosave-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('reload-indicator')).toBeInTheDocument()
    })
  })

  describe('button titles (accessibility)', () => {
    it('has accessible title on bold button', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId('toolbar-btn-bold')).toHaveAttribute('title', 'Bold (Cmd/Ctrl+B)')
    })

    it('has accessible title on italic button', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId('toolbar-btn-italic')).toHaveAttribute('title', 'Italic (Cmd/Ctrl+I)')
    })

    it('has accessible title on search button', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId('toolbar-btn-search')).toHaveAttribute('title', 'Find (Cmd/Ctrl+F)')
    })

    it('has accessible titles on view mode buttons', () => {
      render(<MarkdownToolbar {...createDefaultProps()} />)

      expect(screen.getByTestId('view-mode-btn-editor')).toHaveAttribute('title', 'Editor Only')
      expect(screen.getByTestId('view-mode-btn-split-horizontal')).toHaveAttribute(
        'title',
        'Split Horizontal (Preview Top)'
      )
      expect(screen.getByTestId('view-mode-btn-split')).toHaveAttribute(
        'title',
        'Split Vertical (Side by Side)'
      )
      expect(screen.getByTestId('view-mode-btn-preview')).toHaveAttribute('title', 'Preview Only')
    })
  })

  describe('edge cases', () => {
    it('handles null editorRef gracefully', () => {
      const editorRef = { current: null }
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      // Should not throw when clicking formatting buttons
      fireEvent.click(screen.getByTestId('toolbar-btn-bold'))
      fireEvent.click(screen.getByTestId('toolbar-btn-italic'))
    })

    it('handles null currentFile gracefully', () => {
      render(<MarkdownToolbar {...createDefaultProps({ currentFile: null })} />)

      // Should not show modified indicator
      expect(screen.queryByTestId('modified-indicator')).not.toBeInTheDocument()
    })

    it('does not call onExportPdf when button is disabled', () => {
      const onExportPdf = vi.fn()
      render(
        <MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onExportPdf })} />
      )

      const button = screen.getByTestId('toolbar-btn-export-pdf')
      expect(button).toBeDisabled()
      // Disabled buttons don't fire click events, but verify the state
      expect(onExportPdf).not.toHaveBeenCalled()
    })
  })
})
