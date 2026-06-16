// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MarkdownEditorPanel - Main orchestrator component for the markdown editor.
 *
 * This component coordinates all the sub-components and hooks needed for the
 * markdown editor functionality. It manages:
 * - File loading/saving with auto-save
 * - View mode switching (editor, preview, split views)
 * - Scroll synchronization between editor and preview
 * - Search integration
 * - Context menu handling
 * - Export functionality (PDF/DOCX)
 *
 * @module components/Panels/MarkdownEditorPanel
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { IDockviewPanelProps } from 'dockview'
import * as monaco from 'monaco-editor'
import { MonacoEditorHandle } from '../Editor/MonacoMarkdownEditor'
import { MarkdownPreviewHandle } from '../Editor/MarkdownPreview'
import { EditorContextMenu } from '../ContextMenu/EditorContextMenu'
import { FileConflictNotification } from '../FileConflictNotification/FileConflictNotification'
import { useDialog } from '../Dialog'
import { useToast } from '../Toast/ToastContext'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSearchStore } from '../../stores/useSearchStore'
import { sanitizeFilePath, getBasename } from '../../utils/fileUtils'
import { logger } from '../../utils/logger'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useFileWatcher, createFileSaveGuard } from '../../hooks/useFileWatcher'
import { useSearchKeyboard } from '../../hooks/useSearchKeyboard'
import { MonacoSearchProvider, PreviewSearchProvider } from '../../providers/search'

// Extracted hooks
import { useScrollSync } from '../Editor/MarkdownEditorPanel/hooks/useScrollSync'
import { useExportHandlers } from '../Editor/MarkdownEditorPanel/hooks/useExportHandlers'
import { useEditorContextMenu } from '../../hooks/useEditorContextMenu'
import { useDividerPosition } from '../../hooks/useDividerPosition'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'

// Extracted components
import { MarkdownToolbar, EditorErrorBoundary } from '../Editor/MarkdownEditorPanel/components'
import { EditorContentLayout } from './EditorContentLayout'
import { DocumentStatsBar } from './DocumentStatsBar'

// Types and pure functions
import type { ViewMode, EditorFile } from '../Editor/MarkdownEditorPanel/types'
import {
  calculateStats,
  extractFileName,
  formatTabTitle,
  getDefaultViewMode
} from './markdownEditorPanel.logic'

import './MarkdownEditorPanel.css'

/** Duration to show auto-save indicator in milliseconds */
const INDICATOR_DURATION_MS = 1000

/**
 * Props passed to the MarkdownEditorPanel via Dockview.
 */
interface MarkdownEditorPanelParams {
  /** Path to the file to open */
  filePath?: string
  /** Unique panel identifier */
  panelId?: string
  /** Initial line number for cursor positioning (from terminal links) */
  initialLine?: number
  /** Initial column number for cursor positioning (from terminal links) */
  initialColumn?: number
}

/**
 * Main component for editing markdown files.
 *
 * Orchestrates all the sub-components and hooks for a complete markdown
 * editing experience including:
 * - Monaco editor with syntax highlighting
 * - Live preview with Mermaid diagram support
 * - Bidirectional scroll synchronization
 * - Auto-save with debouncing
 * - File conflict detection and resolution
 * - PDF and DOCX export
 * - Search across editor and preview
 *
 * @param props - Dockview panel props including file path and panel ID
 * @returns Rendered markdown editor panel
 *
 * @example Usage via Dockview
 * ```tsx
 * dockviewApi.addPanel({
 *   id: 'editor-myfile',
 *   component: 'editor',
 *   title: 'myfile.md',
 *   params: { filePath: '/path/to/myfile.md', panelId: 'editor-myfile' }
 * })
 * ```
 */
export function MarkdownEditorPanel(
  props: IDockviewPanelProps<MarkdownEditorPanelParams>
): JSX.Element {
  // =========================================================================
  // Core State
  // =========================================================================
  const [currentFile, setCurrentFile] = useState<EditorFile | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [selectedText, setSelectedText] = useState<string>('')
  const [activePaneId, setActivePaneId] = useState<'editor' | 'preview'>('editor')

  // =========================================================================
  // Refs
  // =========================================================================
  const panelIdRef = useRef<string | undefined>(props.params?.panelId)
  const editorRef = useRef<MonacoEditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewHandleRef = useRef<MarkdownPreviewHandle>(null)
  const saveGuardRef = useRef<ReturnType<typeof createFileSaveGuard> | null>(null)

  // =========================================================================
  // Dialog and Toast
  // =========================================================================
  const { showConfirm } = useDialog()
  const { showToast } = useToast()

  // =========================================================================
  // Search Integration
  // =========================================================================

  // Create search provider instances (memoized to avoid recreation)
  const monacoProvider = useMemo(() => new MonacoSearchProvider(editorRef), [])
  const previewProvider = useMemo(() => new PreviewSearchProvider(previewRef), [])

  // Global keyboard shortcuts for search (Cmd/Ctrl+F)
  useSearchKeyboard({ editorRef })

  // Reset search when file changes (FR-013)
  useEffect(() => {
    useSearchStore.getState().resetSearch()
    monacoProvider.clearHighlights()
    previewProvider.clearHighlights()
  }, [currentFile?.path, monacoProvider, previewProvider])

  // Cleanup providers on unmount
  useEffect(() => {
    return () => {
      monacoProvider.dispose()
      previewProvider.dispose()
    }
  }, [monacoProvider, previewProvider])

  // =========================================================================
  // File Watcher Hook
  // =========================================================================

  // Stable callback for watcher content updates – uses functional updater to avoid
  // closing over currentFile, which would cause watcher re-subscription on every keystroke.
  const handleContentUpdateFromWatcher = useCallback((content: string) => {
    setCurrentFile((prev) => prev ? { ...prev, content, modified: false } : prev)
  }, [])
  const {
    externalChangeDetected,
    isFileDeleted,
    isReloading,
    reloadFromDisk: handleReloadFromDisk,
    keepLocal: handleKeepLocal,
    dismissConflict,
    clearDeletedState,
    markSaving,
    unmarkSaving,
    notifySaveComplete
  } = useFileWatcher({
    filePath: currentFile?.path ?? null,
    hasLocalChanges: currentFile?.modified ?? false,
    onContentUpdate: handleContentUpdateFromWatcher
  })

  // Create file save guard for pausing/resuming file watching during save
  useEffect(() => {
    if (currentFile?.path) {
      saveGuardRef.current = createFileSaveGuard(currentFile.path)
    } else {
      saveGuardRef.current = null
    }
  }, [currentFile?.path])

  // =========================================================================
  // Save Handler (defined early so hooks can reference it)
  // =========================================================================

  /**
   * Saves the current file to disk.
   *
   * Step ordering contract (do not reorder):
   * 1. markSaving – guard against watcher events during save
   * 2. pauseWatch – pause chokidar (first defense layer)
   * 3. Read content from Monaco model (authoritative source, not React state)
   * 4. writeFile – write to disk
   * 5. notifySaveComplete – store content for self-save echo detection
   * 6. setCurrentFile modified: false – mark clean
   * 7. Post-save dirty check – if editor diverged during async write, re-mark dirty
   * 8. finally: resumeWatch + unmarkSaving
   *
   * @param isAutoSave - Whether this is an auto-save (shows indicator) or manual save
   */
  const handleSave = useCallback(async (isAutoSave: boolean = false) => {
    if (!currentFile) return

    // Step 1: Mark saving via hook to prevent race conditions with file watcher
    markSaving()

    try {
      if (isAutoSave) {
        setIsAutoSaving(true)
      }

      // Step 2: Pause file watching during save to prevent race condition
      await saveGuardRef.current?.pauseWatch()

      // Step 3: Read content from Monaco model – always reflects latest keystrokes,
      // unlike currentFile.content which may be stale from the useCallback closure
      const contentToSave =
        editorRef.current?.getEditor()?.getValue() ?? currentFile.content

      // Step 4: Write to disk
      await window.api.file.writeFile(currentFile.path, contentToSave)

      // Step 5: Record saved content for self-save echo detection (#124)
      notifySaveComplete(contentToSave)

      // Step 6: Mark file as clean (functional updater to avoid stale closure overwrite)
      setCurrentFile((prev) =>
        prev ? { ...prev, content: contentToSave, modified: false } : prev
      )
      if (panelIdRef.current) {
        useProjectStore.getState().setEditorDirty(panelIdRef.current, false)
      }

      // Step 7: Post-save dirty detection – if user typed during the async write,
      // the Monaco model has diverged from what we saved. Re-mark as modified.
      const currentEditorContent = editorRef.current?.getEditor()?.getValue()
      if (currentEditorContent !== undefined && currentEditorContent !== contentToSave) {
        setCurrentFile((prev) =>
          prev ? { ...prev, content: currentEditorContent, modified: true } : prev
        )
        if (panelIdRef.current) {
          useProjectStore.getState().setEditorDirty(panelIdRef.current, true)
        }
      }

      // Clear any external change detection since we just saved
      dismissConflict()
      clearDeletedState()

      if (isAutoSave) {
        // Show auto-save indicator briefly
        setTimeout(() => setIsAutoSaving(false), INDICATOR_DURATION_MS)
      }
    } catch (error) {
      logger.error('Error saving file', error instanceof Error ? error : undefined)
      setIsAutoSaving(false)
    } finally {
      // Step 8: Resume file watching after save completes
      await saveGuardRef.current?.resumeWatch()
      unmarkSaving()
    }
  }, [currentFile, dismissConflict, clearDeletedState, markSaving, unmarkSaving, notifySaveComplete])

  // =========================================================================
  // Auto-Save Hook
  // =========================================================================
  const { isAutoSaving, setIsAutoSaving, signalChange } = useAutoSave(
    currentFile?.modified ?? false,
    () => handleSave(true),
    { delay: 2000, enabled: true, maxInterval: 30000 }
  )

  // =========================================================================
  // Scroll Sync Hook
  // =========================================================================

  // Sync previewRef with previewHandleRef.element for DOM operations
  useEffect(() => {
    if (previewHandleRef.current?.element) {
      (previewRef as React.MutableRefObject<HTMLDivElement | null>).current = previewHandleRef.current.element
    }
  }, [viewMode, currentFile])

  const {
    isEditorReady,
    setIsEditorReady,
    rebuildScrollMap
  } = useScrollSync({
    editorRef,
    previewRef,
    viewMode,
    currentFilePath: currentFile?.path ?? null,
    currentContent: currentFile?.content ?? null
  })

  // =========================================================================
  // Divider Position Hook
  // =========================================================================
  const {
    dividerPosition,
    dividerPositionHorizontal,
    handleDividerResize,
    handleDividerResizeHorizontal,
    handleDividerResizeEnd: baseDividerResizeEnd
  } = useDividerPosition({
    onResizeEnd: () => {
      // Rebuild scroll map after layout settles post divider drag
      requestAnimationFrame(() => rebuildScrollMap())
    }
  })

  // =========================================================================
  // Export Handlers Hook
  // =========================================================================
  const {
    isExportingPdf,
    isExportingDocx,
    handleExportPdf,
    handleExportDocx
  } = useExportHandlers({
    currentFile,
    previewHandleRef,
    showToast
  })

  // =========================================================================
  // Editor Context Menu Hook
  // =========================================================================
  const {
    editorContextMenu,
    handleEditorContextMenu,
    handleCloseEditorContextMenu,
    handleEditorCopy,
    handleEditorCut,
    handleEditorPaste
  } = useEditorContextMenu({ editorRef })

  // =========================================================================
  // Keyboard Shortcuts Hook
  // =========================================================================
  useKeyboardShortcuts({
    onSave: () => handleSave(false),
    onClose: () => props.api.close(),
    isModified: currentFile?.modified ?? false,
    showConfirm,
    fileName: currentFile?.path ? getBasename(currentFile.path) : null
  })

  // =========================================================================
  // Document Statistics
  // =========================================================================
  const documentStats = useMemo(() => {
    if (!currentFile) return null
    return calculateStats(currentFile.content)
  }, [currentFile?.content])

  // =========================================================================
  // File Operations
  // =========================================================================

  /**
   * Loads a file from disk into the editor.
   *
   * @param filePath - Absolute path to the file to load
   */
  const loadFile = useCallback(async (filePath: string) => {
    logger.info('Loading file', { filePath })
    setIsEditorReady(false) // Reset editor ready state when loading new file
    try {
      const content = await window.api.file.readFile(filePath)
      logger.info('File loaded successfully', {
        filePath,
        contentLength: content.length,
        contentPreview: content.substring(0, 100)
      })
      setCurrentFile({
        path: filePath,
        content,
        modified: false
      })

      // Set view mode based on file type using extracted logic
      setViewMode(getDefaultViewMode(filePath))
    } catch (error) {
      logger.error('Error loading file', error instanceof Error ? error : undefined)
    }
  }, [setIsEditorReady])

  /**
   * Handles content changes from the Monaco editor.
   *
   * @param newContent - New content from the editor
   */
  const handleContentChange = useCallback((newContent: string) => {
    setCurrentFile((prev) => {
      if (!prev) return prev
      return { ...prev, content: newContent, modified: true }
    })
    // Mark panel as dirty in global store
    if (panelIdRef.current) {
      useProjectStore.getState().setEditorDirty(panelIdRef.current, true)
    }
    // Reset autosave debounce timer – save fires after user stops typing
    signalChange()
  }, [signalChange])

  /**
   * Opens a markdown file from an internal link.
   * Switches to existing tab or creates new tab, then scrolls to anchor if provided.
   *
   * @param targetFilePath - Path to the file to open
   * @param anchor - Optional anchor to scroll to
   */
  const handleOpenFile = useCallback(async (targetFilePath: string, anchor?: string) => {
    const dockviewApi = useProjectStore.getState().dockviewApi
    if (!dockviewApi) {
      showToast({
        title: 'Error',
        message: 'Editor not ready',
        type: 'error',
        duration: 3000
      })
      return
    }

    const fileName = extractFileName(targetFilePath)
    const panelId = `editor-${sanitizeFilePath(targetFilePath)}`

    // Check if already open
    let editorPanel = dockviewApi.getPanel(panelId)

    if (!editorPanel) {
      // Create new panel
      editorPanel = dockviewApi.addPanel({
        id: panelId,
        component: 'editor',
        title: fileName,
        tabComponent: 'editorTab',
        params: { filePath: targetFilePath, panelId }
      })
      useProjectStore.getState().registerEditorPanel(panelId)
    }

    // Switch to panel
    editorPanel.api.setActive()
    editorPanel.group.focus()

    // Scroll to anchor if provided
    if (anchor) {
      previewHandleRef.current?.scrollToAnchor(anchor)
    }
  }, [showToast])

  /**
   * Handles editor mount event from Monaco.
   * Signals that the editor is ready for scroll synchronization.
   *
   * @param _editor - Monaco editor instance (unused, accessed via ref)
   */
  const handleEditorMount = useCallback((_editor: monaco.editor.IStandaloneCodeEditor) => {
    logger.info('Editor mounted and ready', { viewMode })
    setIsEditorReady(true)
  }, [viewMode, setIsEditorReady])

  // =========================================================================
  // Effects
  // =========================================================================

  // Load file when panel receives a file path
  useEffect(() => {
    const filePath = props.params?.filePath
    if (filePath) {
      loadFile(filePath)
    }
  }, [props.params?.filePath, loadFile])

  // Handle initial line/column positioning from terminal file links
  useEffect(() => {
    const { initialLine, initialColumn } = props.params || {}
    if (!isEditorReady || !initialLine || !editorRef.current) return

    editorRef.current.setPositionAndReveal(initialLine, initialColumn)
    logger.info(`Positioned editor at line ${initialLine}${initialColumn ? `:${initialColumn}` : ''}`)
  }, [isEditorReady, props.params?.initialLine, props.params?.initialColumn])

  // Update tab title when modified state changes
  useEffect(() => {
    if (!currentFile) return
    const fileName = extractFileName(currentFile.path)
    const title = formatTabTitle(fileName, currentFile.modified, isFileDeleted)
    props.api.setTitle(title)
  }, [currentFile?.modified, currentFile?.path, isFileDeleted, props.api])

  // Cleanup: ensure panel is not marked dirty on unmount
  useEffect(() => {
    return () => {
      if (panelIdRef.current) {
        useProjectStore.getState().setEditorDirty(panelIdRef.current, false)
      }
    }
  }, [])

  // Debug logging
  logger.debug('MarkdownEditorPanel render', {
    hasCurrentFile: !!currentFile,
    filePath: currentFile?.path,
    contentLength: currentFile?.content?.length,
    viewMode
  })

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div className="markdown-editor-panel" tabIndex={0}>
      {currentFile && (
        <>
          <EditorErrorBoundary componentName="MarkdownToolbar" fallback={null}>
            <MarkdownToolbar
              viewMode={viewMode}
              currentFile={currentFile}
              editorRef={editorRef}
              isAutoSaving={isAutoSaving}
              isReloading={isReloading}
              isExportingPdf={isExportingPdf}
              isExportingDocx={isExportingDocx}
              onViewModeChange={setViewMode}
              onExportPdf={handleExportPdf}
              onExportDocx={handleExportDocx}
            />
          </EditorErrorBoundary>

          {/* File conflict notification */}
          {externalChangeDetected && (
            <FileConflictNotification
              fileName={getBasename(currentFile.path) || 'File'}
              onReload={handleReloadFromDisk}
              onKeepLocal={handleKeepLocal}
              onDismiss={dismissConflict}
            />
          )}

          {/* File deleted warning */}
          {isFileDeleted && (
            <div className="file-deleted-warning">
              <span>This file was deleted on disk. Save to restore it.</span>
            </div>
          )}
        </>
      )}

      {currentFile ? (
        <EditorErrorBoundary componentName="EditorContentLayout">
          <EditorContentLayout
            viewMode={viewMode}
            currentFile={currentFile}
            dividerPosition={dividerPosition}
            dividerPositionHorizontal={dividerPositionHorizontal}
            activePaneId={activePaneId}
            editorRef={editorRef}
            previewHandleRef={previewHandleRef}
            monacoProvider={monacoProvider}
            previewProvider={previewProvider}
            onActivePaneChange={setActivePaneId}
            onContentChange={handleContentChange}
            onEditorMount={handleEditorMount}
            onEditorContextMenu={handleEditorContextMenu}
            onDividerResize={handleDividerResize}
            onDividerResizeHorizontal={handleDividerResizeHorizontal}
            onDividerResizeEnd={baseDividerResizeEnd}
            onOpenFile={handleOpenFile}
            onSelectionChange={setSelectedText}
          />
        </EditorErrorBoundary>
      ) : (
        <div className="editor-empty">
          <p>No file open</p>
          <p className="hint">Select a markdown file from the project panel to start editing</p>
        </div>
      )}

      <EditorErrorBoundary componentName="DocumentStatsBar" fallback={null}>
        <DocumentStatsBar stats={documentStats} selectedText={selectedText} />
      </EditorErrorBoundary>

      {/* Editor context menu */}
      {editorContextMenu && currentFile?.path && (
        <EditorContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          selectedText={editorContextMenu.selectedText}
          filePath={currentFile.path}
          fullDocument={currentFile.content}
          startLine={editorContextMenu.startLine}
          endLine={editorContextMenu.endLine}
          onClose={handleCloseEditorContextMenu}
          onCopy={handleEditorCopy}
          onCut={handleEditorCut}
          onPaste={handleEditorPaste}
        />
      )}
    </div>
  )
}
