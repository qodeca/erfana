// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MarkdownToolbar component for the markdown editor panel.
 *
 * Provides view mode toggles, formatting buttons, export actions,
 * and file status indicators. This is a pure presentational component
 * that delegates all state changes to parent callbacks.
 *
 * @module MarkdownToolbar
 */

import {
  FileEdit,
  Columns2,
  Rows2,
  Eye,
  Bold,
  Italic,
  Code,
  Link,
  Image,
  Heading1,
  List,
  ListOrdered,
  Strikethrough,
  FileDown,
  FileText,
  Search
} from 'lucide-react'
import type { MonacoEditorHandle } from '../../MonacoMarkdownEditor'
import type { ViewMode, EditorFile } from '../types'
import { useSearchStore } from '../../../../stores/useSearchStore'
import { getSelectedText } from '../../../../utils/selectionHelpers'
import { TEST_IDS } from '../../../../constants/testids'
import './MarkdownToolbar.css'

// Re-export types for convenience
export type { ViewMode, EditorFile } from '../types'

/**
 * Props for the MarkdownToolbar component.
 */
export interface MarkdownToolbarProps {
  /** Current view mode (editor, split, split-horizontal, preview) */
  viewMode: ViewMode
  /** Currently open file, or null if no file is open */
  currentFile: EditorFile | null
  /** Reference to the Monaco editor for formatting actions */
  editorRef: React.RefObject<MonacoEditorHandle | null>
  /** Whether an auto-save operation is in progress */
  isAutoSaving: boolean
  /** Whether the file is being reloaded from disk */
  isReloading: boolean
  /** Whether PDF export is in progress */
  isExportingPdf: boolean
  /** Whether DOCX export is in progress */
  isExportingDocx: boolean
  /** Callback when view mode is changed */
  onViewModeChange: (mode: ViewMode) => void
  /** Callback to export the document as PDF */
  onExportPdf: () => void
  /** Callback to export the document as DOCX */
  onExportDocx: () => void
}

/**
 * Toolbar for the markdown editor panel.
 *
 * Provides controls for:
 * - View mode switching (editor only, split vertical/horizontal, preview only)
 * - Text formatting (bold, italic, strikethrough, code, link, image, heading, lists)
 * - Document export (PDF, DOCX)
 * - File status indicators (modified, auto-saving, reloading)
 * - Search activation
 *
 * @param props - Component props
 * @returns Rendered toolbar element
 *
 * @example Basic usage
 * ```tsx
 * <MarkdownToolbar
 *   viewMode="split"
 *   currentFile={currentFile}
 *   editorRef={editorRef}
 *   isAutoSaving={false}
 *   isReloading={false}
 *   isExportingPdf={false}
 *   isExportingDocx={false}
 *   onViewModeChange={setViewMode}
 *   onExportPdf={handleExportPdf}
 *   onExportDocx={handleExportDocx}
 * />
 * ```
 */
export function MarkdownToolbar({
  viewMode,
  currentFile,
  editorRef,
  isAutoSaving,
  isReloading,
  isExportingPdf,
  isExportingDocx,
  onViewModeChange,
  onExportPdf,
  onExportDocx
}: MarkdownToolbarProps): JSX.Element {
  /**
   * Opens the search overlay with any currently selected text.
   * Uses getSelectedText to check Monaco editor first, then DOM selection.
   */
  const handleOpenSearch = (): void => {
    const selectedText = getSelectedText(editorRef)
    useSearchStore.getState().openSearch(selectedText)
  }

  // Determine if formatting buttons should be shown
  // Only visible in editor or vertical split modes
  const showFormattingButtons = viewMode === 'editor' || viewMode === 'split'

  // Determine if search button should be shown in the left section
  // (when formatting buttons are not visible)
  const showSearchInLeftSection = viewMode === 'preview' || viewMode === 'split-horizontal'

  // Export buttons are disabled in editor-only mode (no preview available)
  const exportDisabled = viewMode === 'editor'

  return (
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting" data-testid={TEST_IDS.MARKDOWN_TOOLBAR}>
      {/* Formatting buttons - only shown when editor is visible */}
      {showFormattingButtons && (
        <>
          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.formatBold()}
            title="Bold (Cmd/Ctrl+B)"
            aria-label="Bold"
            data-testid={TEST_IDS.TOOLBAR_BTN_BOLD}
          >
            <Bold size={16} strokeWidth={2} />
          </button>
          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.formatItalic()}
            title="Italic (Cmd/Ctrl+I)"
            aria-label="Italic"
            data-testid={TEST_IDS.TOOLBAR_BTN_ITALIC}
          >
            <Italic size={16} strokeWidth={2} />
          </button>
          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.formatStrikethrough()}
            title="Strikethrough"
            aria-label="Strikethrough"
            data-testid={TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH}
          >
            <Strikethrough size={16} strokeWidth={2} />
          </button>

          <div className="toolbar-separator" />

          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.formatCode()}
            title="Inline Code"
            aria-label="Inline code"
            data-testid={TEST_IDS.TOOLBAR_BTN_CODE}
          >
            <Code size={16} strokeWidth={2} />
          </button>
          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.insertLink()}
            title="Insert Link (Cmd/Ctrl+K)"
            aria-label="Insert link"
            data-testid={TEST_IDS.TOOLBAR_BTN_LINK}
          >
            <Link size={16} strokeWidth={2} />
          </button>
          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.insertImage()}
            title="Insert Image"
            aria-label="Insert image"
            data-testid={TEST_IDS.TOOLBAR_BTN_IMAGE}
          >
            <Image size={16} strokeWidth={2} />
          </button>

          <div className="toolbar-separator" />

          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.insertHeading(1)}
            title="Heading 1"
            aria-label="Heading 1"
            data-testid={TEST_IDS.TOOLBAR_BTN_HEADING}
          >
            <Heading1 size={16} strokeWidth={2} />
          </button>
          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.insertList(false)}
            title="Bullet List"
            aria-label="Bullet list"
            data-testid={TEST_IDS.TOOLBAR_BTN_LIST}
          >
            <List size={16} strokeWidth={2} />
          </button>
          <button
            className="toolbar-btn"
            onClick={() => editorRef.current?.insertList(true)}
            title="Numbered List"
            aria-label="Numbered list"
            data-testid={TEST_IDS.TOOLBAR_BTN_LIST_ORDERED}
          >
            <ListOrdered size={16} strokeWidth={2} />
          </button>

          <div className="toolbar-separator" />

          <button
            className="toolbar-btn"
            onClick={handleOpenSearch}
            title="Find (Cmd/Ctrl+F)"
            aria-label="Find"
            data-testid={TEST_IDS.TOOLBAR_BTN_SEARCH}
          >
            <Search size={16} strokeWidth={2} />
          </button>
        </>
      )}

      {/* Search button - shown in preview/split-horizontal modes (no formatting toolbar) */}
      {showSearchInLeftSection && (
        <button
          className="toolbar-btn"
          onClick={handleOpenSearch}
          title="Find (Cmd/Ctrl+F)"
          aria-label="Find"
          data-testid={TEST_IDS.TOOLBAR_BTN_SEARCH}
        >
          <Search size={16} strokeWidth={2} />
        </button>
      )}

      <div className="toolbar-spacer" />

      {/* File status indicators */}
      {currentFile?.modified && (
        <span className="modified-indicator" data-testid={TEST_IDS.MODIFIED_INDICATOR}>
          ●
        </span>
      )}
      {isAutoSaving && (
        <span className="file-status-indicator" data-testid={TEST_IDS.AUTOSAVE_INDICATOR}>
          Auto-saving...
        </span>
      )}
      {isReloading && (
        <span className="file-status-indicator" data-testid={TEST_IDS.RELOAD_INDICATOR}>
          Reloaded from disk
        </span>
      )}

      {/* View mode buttons */}
      <button
        className={`view-mode-btn ${viewMode === 'editor' ? 'active' : ''}`}
        onClick={() => onViewModeChange('editor')}
        title="Editor Only"
        aria-label="Editor only"
        data-testid={TEST_IDS.VIEW_MODE_BTN_EDITOR}
      >
        <FileEdit size={16} strokeWidth={2} />
      </button>
      <button
        className={`view-mode-btn ${viewMode === 'split-horizontal' ? 'active' : ''}`}
        onClick={() => onViewModeChange('split-horizontal')}
        title="Split Horizontal (Preview Top)"
        aria-label="Split horizontal"
        data-testid={TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL}
      >
        <Rows2 size={16} strokeWidth={2} />
      </button>
      <button
        className={`view-mode-btn ${viewMode === 'split' ? 'active' : ''}`}
        onClick={() => onViewModeChange('split')}
        title="Split Vertical (Side by Side)"
        aria-label="Split vertical"
        data-testid={TEST_IDS.VIEW_MODE_BTN_SPLIT}
      >
        <Columns2 size={16} strokeWidth={2} />
      </button>
      <button
        className={`view-mode-btn ${viewMode === 'preview' ? 'active' : ''}`}
        onClick={() => onViewModeChange('preview')}
        title="Preview Only"
        aria-label="Preview only"
        data-testid={TEST_IDS.VIEW_MODE_BTN_PREVIEW}
      >
        <Eye size={16} strokeWidth={2} />
      </button>

      <div className="toolbar-separator" />

      {/* Export buttons */}
      <button
        className="toolbar-btn"
        onClick={onExportPdf}
        disabled={!currentFile || isExportingPdf || exportDisabled}
        title={
          exportDisabled
            ? 'Export to PDF (switch to preview or split mode)'
            : 'Export to PDF'
        }
        aria-label="Export to PDF"
        data-testid={TEST_IDS.TOOLBAR_BTN_EXPORT_PDF}
      >
        <FileDown size={16} strokeWidth={2} />
      </button>
      <button
        className="toolbar-btn"
        onClick={onExportDocx}
        disabled={!currentFile || isExportingDocx || exportDisabled}
        title={
          exportDisabled
            ? 'Export to Word (switch to preview or split mode)'
            : 'Export to Word'
        }
        aria-label="Export to Word"
        data-testid={TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX}
      >
        <FileText size={16} strokeWidth={2} />
      </button>
    </div>
  )
}
