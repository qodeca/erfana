// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * EditorContentLayout - Renders the split layout for editor and preview panes.
 *
 * Handles all view modes: editor-only, preview-only, vertical split, and horizontal split.
 * Manages pane sizing based on divider position and integrates with search providers.
 *
 * @module components/Panels/EditorContentLayout
 */

import type { RefObject } from 'react'
import type * as monaco from 'monaco-editor'
import { MonacoMarkdownEditor, type MonacoEditorHandle } from '../Editor/MonacoMarkdownEditor'
import type { EditorContextMenuEvent } from '../Editor/MonacoMarkdownEditor'
import { MarkdownPreview, type MarkdownPreviewHandle } from '../Editor/MarkdownPreview'
import { ResizableDivider } from '../Editor/ResizableDivider'
import { SearchBar } from '../Search'
import type { MonacoSearchProvider } from '../../providers/search/MonacoSearchProvider'
import type { PreviewSearchProvider } from '../../providers/search/PreviewSearchProvider'
import type { ViewMode, EditorFile } from '../Editor/MarkdownEditorPanel/types'
import { TEST_IDS } from '../../constants/testids'
import './EditorContentLayout.css'

// Re-export types for consumers who import from this module
export type { ViewMode, EditorFile } from '../Editor/MarkdownEditorPanel/types'

/**
 * Props for the EditorContentLayout component.
 */
export interface EditorContentLayoutProps {
  /** Current view mode (split, split-horizontal, editor, preview) */
  viewMode: ViewMode
  /** Current file being edited */
  currentFile: EditorFile
  /** Vertical split divider position as percentage (0-100) */
  dividerPosition: number
  /** Horizontal split divider position as percentage (0-100) */
  dividerPositionHorizontal: number
  /** Currently active pane for search bar visibility */
  activePaneId: 'editor' | 'preview'

  // Refs
  /** Ref to Monaco editor handle for formatting and scroll operations */
  editorRef: RefObject<MonacoEditorHandle>
  /** Ref to MarkdownPreview handle for anchor scrolling */
  previewHandleRef: RefObject<MarkdownPreviewHandle>

  // Search providers
  /** Monaco editor search provider */
  monacoProvider: MonacoSearchProvider
  /** Preview pane search provider */
  previewProvider: PreviewSearchProvider

  // Callbacks
  /** Called when active pane changes */
  onActivePaneChange: (pane: 'editor' | 'preview') => void
  /** Called when editor content changes */
  onContentChange: (content: string) => void
  /** Called when Monaco editor is mounted and ready */
  onEditorMount: (editor: monaco.editor.IStandaloneCodeEditor) => void
  /** Called when user right-clicks in editor with selection */
  onEditorContextMenu: (event: EditorContextMenuEvent) => void
  /** Called when vertical divider is dragged */
  onDividerResize: (position: number) => void
  /** Called when horizontal divider is dragged */
  onDividerResizeHorizontal: (position: number) => void
  /** Called when divider drag ends */
  onDividerResizeEnd: () => void
  /** Called when user clicks a markdown link to open a file */
  onOpenFile: (path: string, anchor?: string) => Promise<void>
  /** Called when text selection changes in editor */
  onSelectionChange: (text: string) => void
}

/**
 * Renders the editor/preview split layout with configurable view modes.
 *
 * Supports four view modes:
 * - `editor`: Editor pane only
 * - `preview`: Preview pane only
 * - `split`: Vertical split (editor left, preview right)
 * - `split-horizontal`: Horizontal split (preview top, editor bottom)
 *
 * Features:
 * - Resizable divider between panes
 * - Search bar integration for active pane
 * - Scroll synchronization support via refs
 * - Context menu support for editor
 *
 * @param props - Component props
 * @returns Rendered editor layout
 *
 * @example Basic vertical split
 * ```tsx
 * <EditorContentLayout
 *   viewMode="split"
 *   currentFile={file}
 *   dividerPosition={50}
 *   dividerPositionHorizontal={50}
 *   activePaneId="editor"
 *   editorRef={editorRef}
 *   previewHandleRef={previewHandleRef}
 *   monacoProvider={monacoProvider}
 *   previewProvider={previewProvider}
 *   onActivePaneChange={setActivePaneId}
 *   onContentChange={handleContentChange}
 *   onEditorMount={handleEditorMount}
 *   onEditorContextMenu={handleContextMenu}
 *   onDividerResize={handleDividerResize}
 *   onDividerResizeHorizontal={handleDividerResizeHorizontal}
 *   onDividerResizeEnd={handleDividerResizeEnd}
 *   onOpenFile={handleOpenFile}
 *   onSelectionChange={setSelectedText}
 * />
 * ```
 */
export function EditorContentLayout({
  viewMode,
  currentFile,
  dividerPosition,
  dividerPositionHorizontal,
  activePaneId,
  editorRef,
  previewHandleRef,
  monacoProvider,
  previewProvider,
  onActivePaneChange,
  onContentChange,
  onEditorMount,
  onEditorContextMenu,
  onDividerResize,
  onDividerResizeHorizontal,
  onDividerResizeEnd,
  onOpenFile,
  onSelectionChange
}: EditorContentLayoutProps): JSX.Element {
  return (
    <div className={`editor-content view-mode-${viewMode}`} role="region" aria-label="Editor" data-testid={TEST_IDS.EDITOR_CONTENT}>
      {/* HORIZONTAL SPLIT: Preview on top, Editor on bottom */}
      {viewMode === 'split-horizontal' && (
        <>
          <div
            className="preview-pane"
            style={{ height: `${dividerPositionHorizontal}%` }}
            onClick={() => onActivePaneChange('preview')}
            onFocus={() => onActivePaneChange('preview')}
            data-testid={TEST_IDS.PREVIEW_PANE}
          >
            <MarkdownPreview
              key={`preview-${viewMode}`}
              ref={previewHandleRef}
              content={currentFile.content}
              filePath={currentFile.path}
              onOpenFile={onOpenFile}
            />
            {activePaneId === 'preview' && (
              <SearchBar provider={previewProvider} />
            )}
          </div>
          <ResizableDivider
            orientation="horizontal"
            onResize={onDividerResizeHorizontal}
            onResizeEnd={onDividerResizeEnd}
          />
          <div
            className="editor-pane"
            style={{ height: `${100 - dividerPositionHorizontal}%` }}
            onClick={() => onActivePaneChange('editor')}
            onFocus={() => onActivePaneChange('editor')}
            data-testid={TEST_IDS.EDITOR_PANE}
          >
            <MonacoMarkdownEditor
              key={`editor-${viewMode}`}
              ref={editorRef}
              value={currentFile.content}
              onChange={onContentChange}
              filePath={currentFile.path}
              onSelectionChange={onSelectionChange}
              onEditorMount={onEditorMount}
              onContextMenu={onEditorContextMenu}
            />
            {activePaneId === 'editor' && (
              <SearchBar provider={monacoProvider} />
            )}
          </div>
        </>
      )}

      {/* VERTICAL SPLIT (side-by-side) and SINGLE PANES */}
      {viewMode !== 'split-horizontal' && (
        <>
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div
              className="editor-pane"
              style={viewMode === 'split' ? { width: `${dividerPosition}%` } : undefined}
              onClick={() => onActivePaneChange('editor')}
              onFocus={() => onActivePaneChange('editor')}
              data-testid={TEST_IDS.EDITOR_PANE}
            >
              <MonacoMarkdownEditor
                key={`editor-${viewMode}`}
                ref={editorRef}
                value={currentFile.content}
                onChange={onContentChange}
                filePath={currentFile.path}
                onSelectionChange={onSelectionChange}
                onEditorMount={onEditorMount}
                onContextMenu={onEditorContextMenu}
              />
              {(viewMode === 'editor' || activePaneId === 'editor') && (
                <SearchBar provider={monacoProvider} />
              )}
            </div>
          )}
          {viewMode === 'split' && (
            <ResizableDivider
              orientation="vertical"
              onResize={onDividerResize}
              onResizeEnd={onDividerResizeEnd}
            />
          )}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div
              className="preview-pane"
              style={viewMode === 'split' ? { width: `${100 - dividerPosition}%` } : undefined}
              onClick={() => onActivePaneChange('preview')}
              onFocus={() => onActivePaneChange('preview')}
              data-testid={TEST_IDS.PREVIEW_PANE}
            >
              <MarkdownPreview
                key={`preview-${viewMode}`}
                ref={previewHandleRef}
                content={currentFile.content}
                filePath={currentFile.path}
                onOpenFile={onOpenFile}
              />
              {(viewMode === 'preview' || activePaneId === 'preview') && (
                <SearchBar provider={previewProvider} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
