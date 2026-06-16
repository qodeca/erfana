// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import { TEST_IDS } from '../../../../constants/testids'
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
      expect(screen.getByTestId(TEST_IDS.MARKDOWN_TOOLBAR)).toBeInTheDocument()
    })

    it('renders all view mode buttons', () => {
      render(<MarkdownToolbar {...createDefaultProps()} />)

      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_EDITOR)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_PREVIEW)).toBeInTheDocument()
    })

    it('renders export buttons', () => {
      render(<MarkdownToolbar {...createDefaultProps()} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).toBeInTheDocument()
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

      fireEvent.click(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_EDITOR))
      expect(onViewModeChange).toHaveBeenCalledWith('editor')
    })

    it('calls onViewModeChange when split button is clicked', () => {
      const onViewModeChange = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onViewModeChange })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT))
      expect(onViewModeChange).toHaveBeenCalledWith('split')
    })

    it('calls onViewModeChange when split-horizontal button is clicked', () => {
      const onViewModeChange = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onViewModeChange })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL))
      expect(onViewModeChange).toHaveBeenCalledWith('split-horizontal')
    })

    it('calls onViewModeChange when preview button is clicked', () => {
      const onViewModeChange = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onViewModeChange })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_PREVIEW))
      expect(onViewModeChange).toHaveBeenCalledWith('preview')
    })

    it('only one view mode button is active at a time', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      const buttons = [
        screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_EDITOR),
        screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT),
        screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL),
        screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_PREVIEW)
      ]

      const activeButtons = buttons.filter((btn) => btn.classList.contains('active'))
      expect(activeButtons).toHaveLength(1)
      expect(activeButtons[0]).toBe(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT))
    })
  })

  describe('formatting buttons', () => {
    it('shows formatting buttons in editor mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_BOLD)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_ITALIC)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_CODE)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_LINK)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_IMAGE)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_HEADING)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_LIST)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_LIST_ORDERED)).toBeInTheDocument()
    })

    it('shows formatting buttons in split mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_BOLD)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_ITALIC)).toBeInTheDocument()
    })

    it('hides formatting buttons in preview mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview' })} />)

      expect(screen.queryByTestId(TEST_IDS.TOOLBAR_BTN_BOLD)).not.toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.TOOLBAR_BTN_ITALIC)).not.toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH)).not.toBeInTheDocument()
    })

    it('hides formatting buttons in split-horizontal mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split-horizontal' })} />)

      expect(screen.queryByTestId(TEST_IDS.TOOLBAR_BTN_BOLD)).not.toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.TOOLBAR_BTN_ITALIC)).not.toBeInTheDocument()
    })

    it('calls formatBold when bold button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_BOLD))
      expect(editorRef.current?.formatBold).toHaveBeenCalled()
    })

    it('calls formatItalic when italic button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_ITALIC))
      expect(editorRef.current?.formatItalic).toHaveBeenCalled()
    })

    it('calls formatStrikethrough when strikethrough button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH))
      expect(editorRef.current?.formatStrikethrough).toHaveBeenCalled()
    })

    it('calls formatCode when code button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_CODE))
      expect(editorRef.current?.formatCode).toHaveBeenCalled()
    })

    it('calls insertLink when link button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_LINK))
      expect(editorRef.current?.insertLink).toHaveBeenCalled()
    })

    it('calls insertImage when image button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_IMAGE))
      expect(editorRef.current?.insertImage).toHaveBeenCalled()
    })

    it('calls insertHeading with level 1 when heading button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_HEADING))
      expect(editorRef.current?.insertHeading).toHaveBeenCalledWith(1)
    })

    it('calls insertList with false when bullet list button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_LIST))
      expect(editorRef.current?.insertList).toHaveBeenCalledWith(false)
    })

    it('calls insertList with true when numbered list button is clicked', () => {
      const editorRef = createMockEditorRef()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_LIST_ORDERED))
      expect(editorRef.current?.insertList).toHaveBeenCalledWith(true)
    })
  })

  describe('search button', () => {
    it('shows search button in editor mode (with formatting buttons)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_SEARCH)).toBeInTheDocument()
    })

    it('shows search button in split mode (with formatting buttons)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_SEARCH)).toBeInTheDocument()
    })

    it('shows search button in preview mode (standalone)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview' })} />)
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_SEARCH)).toBeInTheDocument()
    })

    it('shows search button in split-horizontal mode (standalone)', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split-horizontal' })} />)
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_SEARCH)).toBeInTheDocument()
    })

    it('calls openSearch when search button is clicked', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_SEARCH))
      expect(mockOpenSearch).toHaveBeenCalled()
    })
  })

  describe('export buttons', () => {
    it('calls onExportPdf when PDF button is clicked', () => {
      const onExportPdf = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split', onExportPdf })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF))
      expect(onExportPdf).toHaveBeenCalled()
    })

    it('calls onExportDocx when DOCX button is clicked', () => {
      const onExportDocx = vi.fn()
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split', onExportDocx })} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX))
      expect(onExportDocx).toHaveBeenCalled()
    })

    it('disables PDF button when isExportingPdf is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isExportingPdf: true })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).toBeDisabled()
    })

    it('disables DOCX button when isExportingDocx is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isExportingDocx: true })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).toBeDisabled()
    })

    it('disables export buttons when no file is open', () => {
      render(<MarkdownToolbar {...createDefaultProps({ currentFile: null })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).toBeDisabled()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).toBeDisabled()
    })

    it('disables export buttons in editor-only mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).toBeDisabled()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).toBeDisabled()
    })

    it('enables export buttons in split mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).not.toBeDisabled()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).not.toBeDisabled()
    })

    it('enables export buttons in preview mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).not.toBeDisabled()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).not.toBeDisabled()
    })

    it('enables export buttons in split-horizontal mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split-horizontal' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).not.toBeDisabled()
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).not.toBeDisabled()
    })

    it('shows correct title when export is disabled due to editor-only mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).toHaveAttribute(
        'title',
        'Export to PDF (switch to preview or split mode)'
      )
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).toHaveAttribute(
        'title',
        'Export to Word (switch to preview or split mode)'
      )
    })

    it('shows correct title when export is enabled', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)).toHaveAttribute('title', 'Export to PDF')
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX)).toHaveAttribute('title', 'Export to Word')
    })
  })

  describe('file status indicators', () => {
    it('shows modified indicator when file has unsaved changes', () => {
      const currentFile = createMockFile({ modified: true })
      render(<MarkdownToolbar {...createDefaultProps({ currentFile })} />)

      expect(screen.getByTestId(TEST_IDS.MODIFIED_INDICATOR)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.MODIFIED_INDICATOR)).toHaveTextContent('●')
    })

    it('hides modified indicator when file has no unsaved changes', () => {
      const currentFile = createMockFile({ modified: false })
      render(<MarkdownToolbar {...createDefaultProps({ currentFile })} />)

      expect(screen.queryByTestId(TEST_IDS.MODIFIED_INDICATOR)).not.toBeInTheDocument()
    })

    it('shows auto-saving indicator when isAutoSaving is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isAutoSaving: true })} />)

      expect(screen.getByTestId(TEST_IDS.AUTOSAVE_INDICATOR)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.AUTOSAVE_INDICATOR)).toHaveTextContent('Auto-saving...')
    })

    it('hides auto-saving indicator when isAutoSaving is false', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isAutoSaving: false })} />)

      expect(screen.queryByTestId(TEST_IDS.AUTOSAVE_INDICATOR)).not.toBeInTheDocument()
    })

    it('shows reload indicator when isReloading is true', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isReloading: true })} />)

      expect(screen.getByTestId(TEST_IDS.RELOAD_INDICATOR)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.RELOAD_INDICATOR)).toHaveTextContent('Reloaded from disk')
    })

    it('hides reload indicator when isReloading is false', () => {
      render(<MarkdownToolbar {...createDefaultProps({ isReloading: false })} />)

      expect(screen.queryByTestId(TEST_IDS.RELOAD_INDICATOR)).not.toBeInTheDocument()
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

      expect(screen.getByTestId(TEST_IDS.MODIFIED_INDICATOR)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.AUTOSAVE_INDICATOR)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.RELOAD_INDICATOR)).toBeInTheDocument()
    })
  })

  describe('button titles (accessibility)', () => {
    it('has accessible title on bold button', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_BOLD)).toHaveAttribute('title', 'Bold (Cmd/Ctrl+B)')
    })

    it('has accessible title on italic button', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_ITALIC)).toHaveAttribute('title', 'Italic (Cmd/Ctrl+I)')
    })

    it('has accessible title on search button', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)
      expect(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_SEARCH)).toHaveAttribute('title', 'Find (Cmd/Ctrl+F)')
    })

    it('has accessible titles on view mode buttons', () => {
      render(<MarkdownToolbar {...createDefaultProps()} />)

      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_EDITOR)).toHaveAttribute('title', 'Editor Only')
      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL)).toHaveAttribute(
        'title',
        'Split Horizontal (Preview Top)'
      )
      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_SPLIT)).toHaveAttribute(
        'title',
        'Split Vertical (Side by Side)'
      )
      expect(screen.getByTestId(TEST_IDS.VIEW_MODE_BTN_PREVIEW)).toHaveAttribute('title', 'Preview Only')
    })
  })

  describe('accessibility: icon-only buttons', () => {
    it('all icon-only buttons should have aria-label in editor mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor' })} />)

      const buttons = screen.getAllByRole('button')
      const iconOnlyButtons = buttons.filter(
        (button) => !button.textContent?.trim()
      )

      expect(iconOnlyButtons.length).toBeGreaterThan(0)
      for (const button of iconOnlyButtons) {
        expect(button).toHaveAttribute('aria-label')
      }
    })

    it('all icon-only buttons should have aria-label in split-horizontal mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split-horizontal' })} />)

      const buttons = screen.getAllByRole('button')
      const iconOnlyButtons = buttons.filter(
        (button) => !button.textContent?.trim()
      )

      expect(iconOnlyButtons.length).toBeGreaterThan(0)
      for (const button of iconOnlyButtons) {
        expect(button).toHaveAttribute('aria-label')
      }
    })

    it('all icon-only buttons should have aria-label in split mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'split' })} />)

      const buttons = screen.getAllByRole('button')
      const iconOnlyButtons = buttons.filter(
        (button) => !button.textContent?.trim()
      )

      expect(iconOnlyButtons.length).toBeGreaterThan(0)
      for (const button of iconOnlyButtons) {
        expect(button).toHaveAttribute('aria-label')
      }
    })

    it('all icon-only buttons should have aria-label in preview mode', () => {
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'preview' })} />)

      const buttons = screen.getAllByRole('button')
      const iconOnlyButtons = buttons.filter(
        (button) => !button.textContent?.trim()
      )

      expect(iconOnlyButtons.length).toBeGreaterThan(0)
      for (const button of iconOnlyButtons) {
        expect(button).toHaveAttribute('aria-label')
      }
    })
  })

  describe('edge cases', () => {
    it('handles null editorRef gracefully', () => {
      const editorRef = { current: null }
      render(<MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', editorRef })} />)

      // Should not throw when clicking formatting buttons
      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_BOLD))
      fireEvent.click(screen.getByTestId(TEST_IDS.TOOLBAR_BTN_ITALIC))
    })

    it('handles null currentFile gracefully', () => {
      render(<MarkdownToolbar {...createDefaultProps({ currentFile: null })} />)

      // Should not show modified indicator
      expect(screen.queryByTestId(TEST_IDS.MODIFIED_INDICATOR)).not.toBeInTheDocument()
    })

    it('does not call onExportPdf when button is disabled', () => {
      const onExportPdf = vi.fn()
      render(
        <MarkdownToolbar {...createDefaultProps({ viewMode: 'editor', onExportPdf })} />
      )

      const button = screen.getByTestId(TEST_IDS.TOOLBAR_BTN_EXPORT_PDF)
      expect(button).toBeDisabled()
      // Disabled buttons don't fire click events, but verify the state
      expect(onExportPdf).not.toHaveBeenCalled()
    })
  })
})
