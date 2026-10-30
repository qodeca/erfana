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

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
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
import { getBasename } from '../../utils/fileUtils'
import { openFileInPanel } from '../../utils/openFileInPanel'
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
import { useEditorSaveRegistration } from '../../hooks/useEditorSaveRegistration'
import { useEditorReadOnlyHold } from '../../hooks/useEditorReadOnlyHold'
import { useLatestFileLoad } from '../../hooks/useLatestFileLoad'
import { DOCKVIEW_PANEL_ACTIVE, DOCKVIEW_PANEL_VISIBLE, useDockviewValue } from '../../hooks/useDockviewValue'

// Extracted components
import { MarkdownToolbar, EditorErrorBoundary } from '../Editor/MarkdownEditorPanel/components'
import { EditorContentLayout } from './EditorContentLayout'
import { DocumentStatsBar } from './DocumentStatsBar'
import { EditorLoadError } from './EditorLoadError'
import { useMarkdownComments } from '../Editor/markdownComments/useMarkdownComments'

// Types and pure functions
import type { ViewMode, EditorFile } from '../Editor/MarkdownEditorPanel/types'
import { calculateStats, extractFileName, getDefaultViewMode, settleSavedFile, shouldRecreateParentDirs, shouldToastSaveError, trackSaveInFlight, type SaveTrigger } from './markdownEditorPanel.logic'
import { formatSaveError, loggableError } from '../../utils/errorUtils'
import { formatTabTitle } from '../../utils/tabTitle'

// Shared constants
import { INDICATOR_DURATION_MS } from '../../constants/fileWatch'

import './MarkdownEditorPanel.css'
import { fileGateway } from '../../services/fileGateway'
import { getLastSeenProjectGeneration } from '../../services/projectGeneration'

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
  // The project session generation the file was loaded under (undefined until a project event was seen)
  const openedGenerationRef = useRef<number | undefined>(undefined)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [selectedText, setSelectedText] = useState<string>('')
  const [activePaneId, setActivePaneId] = useState<'editor' | 'preview'>('editor')
  /**
   * Whether this panel is the tab the user is looking at.
   *
   * Dockview keeps every opened panel mounted, so background editors are live
   * React trees with live `window` listeners. This flag is what stops them
   * acting on keystrokes aimed at the foreground tab.
   *
   * Followed through useSyncExternalStore (`useDockviewValue`), which re-reads
   * `isActive` after subscribing: a panel can become active between render and
   * subscribe, and the event would never fire for that transition.
   */
  const isActivePanel = useDockviewValue(props.api, DOCKVIEW_PANEL_ACTIVE)
  /**
   * Whether dockview is drawing this panel. A hidden preview holds its link
   * re-checks until it is shown again (see `linkTargetCache`).
   */
  const isPanelVisible = useDockviewValue(props.api, DOCKVIEW_PANEL_VISIBLE)

  // =========================================================================
  // Refs
  // =========================================================================
  // The id the tab was opened with, read once: nothing re-points a live editor
  // panel at another id. State rather than a ref so render may read it.
  const [panelId] = useState<string | undefined>(() => props.params?.panelId)
  const editorRef = useRef<MonacoEditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewHandleRef = useRef<MarkdownPreviewHandle>(null)
  const saveGuardRef = useRef<ReturnType<typeof createFileSaveGuard> | null>(null)
  /**
   * The last save-failure toast for the CURRENT file, so a failing autosave
   * does not repeat it every few seconds. Reset when the file changes (below).
   */
  const lastSaveErrorRef = useRef<string | null>(null)
  /** The pending "auto-saved" indicator reset, cleared on unmount and by the next autosave */
  const autoSaveIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    // The buffer now matches the disk ("Reload from Disk" or a clean file
    // taking an external change), so the tab's dirty dot goes too. It reads
    // the store, not `modified`, and used to stay on after a Reload.
    if (panelId) {
      useProjectStore.getState().setEditorDirty(panelId, false)
    }
  }, [panelId])
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

  // A save-failure reason shown for one file must not mute the same reason for
  // the next file this panel shows
  useEffect(() => {
    lastSaveErrorRef.current = null
  }, [currentFile?.path])

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

  // =========================================================================
  // Auto-Save Hook
  // =========================================================================

  // handleSave needs setIsAutoSaving from useAutoSave, and useAutoSave needs a
  // save callback: the hook is called first and reaches handleSave through
  // this ref, which a layout effect below points at the latest handleSave.
  const handleSaveRef = useRef<(trigger?: SaveTrigger) => Promise<boolean>>(async () => false)
  const { isAutoSaving, setIsAutoSaving, holdAutoSave, signalChange } = useAutoSave(
    currentFile?.modified ?? false,
    async () => {
      // A file that changed on disk while the tab holds unsaved edits waits for
      // the user's choice in the conflict bar; an autosave would overwrite the
      // newer file and dismiss the bar.
      if (externalChangeDetected) return
      // `false` (a failed write) makes autosave back off until the next edit
      return handleSaveRef.current('autosave')
    },
    { delay: 2000, enabled: true, maxInterval: 30000 }
  )

  // The running save, so a project switch can wait for it (see trackSaveInFlight)
  const saveInFlightRef = useRef<Promise<void> | null>(null)

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
   * @param trigger - Who asked: the tab's own Cmd+S (`user`), `autosave`, or a
   *   save by id (`registry`); it decides folder restore and the failure toast
   * @returns `true` when the write succeeded (issue #124: a save by id reads it)
   */
  const handleSave = useCallback(async (trigger: SaveTrigger = 'user'): Promise<boolean> => {
    if (!currentFile) return false
    const isAutoSave = trigger === 'autosave'

    const finishInFlight = trackSaveInFlight(saveInFlightRef)

    // Step 1: Mark saving via hook to prevent race conditions with file watcher
    markSaving()

    try {
      if (isAutoSave) {
        // A reset still pending from the last autosave must not hide this one's indicator
        if (autoSaveIndicatorTimerRef.current) {
          clearTimeout(autoSaveIndicatorTimerRef.current)
          autoSaveIndicatorTimerRef.current = null
        }
        setIsAutoSaving(true)
      }

      // Step 2: Pause file watching during save to prevent race condition
      await saveGuardRef.current?.pauseWatch()

      // Step 3: Read content from Monaco model – always reflects latest keystrokes,
      // unlike currentFile.content which may be stale from the useCallback closure
      const contentToSave =
        editorRef.current?.getEditor()?.getValue() ?? currentFile.content

      // Step 4: Write to disk. Only the tab's own Cmd+S in the deleted state is
      // the banner's "Save to restore it", so only it may recreate the folder
      // the file lived in. An autosave or a save by id never does: it would
      // silently resurrect a folder someone just renamed.
      // The write names the project the file was opened under: after a project
      // switch the main process refuses it, so a stale tab never lands in the next project.
      const generation = openedGenerationRef.current
      if (shouldRecreateParentDirs(trigger, isFileDeleted)) {
        await fileGateway.writeFile({
          filePath: currentFile.path,
          content: contentToSave,
          createParentDirs: true,
          generation
        })
      } else {
        await fileGateway.writeFile({
          filePath: currentFile.path,
          content: contentToSave,
          generation
        })
      }
      lastSaveErrorRef.current = null

      // Step 5: Record saved content for self-save echo detection (#124)
      notifySaveComplete(contentToSave)

      // Steps 6+7: settle the file state in one update. If the user typed
      // during the async write, the buffer is ahead of what was written: keep
      // the buffer's text and stay modified. One update, so React never
      // renders the written (older) text as current (functional updater to
      // avoid a stale-closure overwrite).
      const bufferNow = editorRef.current?.getEditor()?.getValue()
      setCurrentFile((prev) => settleSavedFile(prev, contentToSave, bufferNow))
      if (panelId) {
        useProjectStore.getState().setEditorDirty(
          panelId,
          bufferNow !== undefined && bufferNow !== contentToSave
        )
      }

      // Clear any external change detection since we just saved
      dismissConflict()
      clearDeletedState()

      if (isAutoSave) {
        // Show auto-save indicator briefly (the reset is cleared on unmount)
        autoSaveIndicatorTimerRef.current = setTimeout(() => {
          autoSaveIndicatorTimerRef.current = null
          setIsAutoSaving(false)
        }, INDICATOR_DURATION_MS)
      }
      return true
    } catch (error) {
      logger.error('Error saving file', loggableError(error))
      setIsAutoSaving(false)
      // Never fail silently: the tab stays dirty and the buffer keeps the edit,
      // so say why. Cmd+S always shows it; an autosave repeats only a reason not
      // yet shown; a save by id shows none, because its caller toasts on
      // `false` (editorSaveRegistry contract) and one failure is one toast.
      if (trigger !== 'registry') {
        const message = formatSaveError(error, extractFileName(currentFile.path))
        if (shouldToastSaveError(trigger, message, lastSaveErrorRef.current)) {
          showToast({ title: 'Save failed', message, type: 'error', duration: 8000 })
        }
        lastSaveErrorRef.current = message
      }
      return false
    } finally {
      // Step 8: Resume file watching after save completes
      await saveGuardRef.current?.resumeWatch()
      unmarkSaving()
      finishInFlight()
    }
  }, [currentFile, isFileDeleted, dismissConflict, clearDeletedState, markSaving, unmarkSaving, notifySaveComplete, showToast, setIsAutoSaving, panelId])
  useLayoutEffect(() => {
    handleSaveRef.current = handleSave
  }, [handleSave])

  // When the conflict bar goes away with edits still unsaved ("Keep My
  // Version", Dismiss), autosave resumes without waiting for another keystroke.
  useEffect(() => {
    if (!externalChangeDetected) signalChange()
  }, [externalChangeDetected, signalChange])

  // Read-only during an autosave hold, including an editor that remounts
  // (view-mode switch) while the hold is active – see handleEditorMount
  const readOnlyHold = useEditorReadOnlyHold(() => editorRef.current?.getEditor())

  useEditorSaveRegistration(panelId, () => handleSave('registry'), externalChangeDetected, () => {
    // A hold stops autosave for real (no re-arming by typing or the modified
    // effect) and makes the editor read-only, so nothing new can be typed
    // between a flush and the end of the hold.
    const releaseAutoSave = holdAutoSave()
    const releaseReadOnly = readOnlyHold.hold()
    return () => {
      releaseReadOnly()
      releaseAutoSave()
    }
  }, () => saveInFlightRef.current ?? Promise.resolve())

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
    rebuildScrollMap,
    handlePreviewRendered
  } = useScrollSync({
    editorRef,
    previewRef,
    viewMode,
    currentFilePath: currentFile?.path ?? null
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
  // `isActivePanel` (declared with the state above) gates every shortcut.
  useKeyboardShortcuts({
    onSave: () => handleSave('user'),
    onClose: () => props.api.close(),
    // Read the store the tab's dirty dot and close button read, at keypress
    // time. `currentFile.modified` is React state and can lag the edit, so a
    // quick ⌘W after typing saw a clean file and discarded the change.
    isModified: () =>
      panelId !== undefined
        ? useProjectStore.getState().dirtyPanelIds.has(panelId)
        : (currentFile?.modified ?? false),
    showConfirm,
    fileName: currentFile?.path ? getBasename(currentFile.path) : null,
    // Without this, one ⌘W closed every open tab and one ⌘S wrote every open
    // buffer — each mounted panel handled the same keypress.
    enabled: isActivePanel
  })

  // Markdown Preview comments (spec 024): toolbar tools, paused band, pane overlay – preview-only view.
  const comments = useMarkdownComments({ panelId, filePath: currentFile?.path, content: currentFile?.content ?? '', viewMode, setViewMode, editorRef, isActivePanel, isVisible: isPanelVisible })
  // =========================================================================
  // Document Statistics
  // =========================================================================
  // Keyed on the text alone, so a save that only flips `modified` does not recount
  const currentContent = currentFile?.content
  const documentStats = useMemo(() => {
    if (currentContent === undefined) return null
    return calculateStats(currentContent)
  }, [currentContent])

  // =========================================================================
  // File Operations
  // =========================================================================

  /**
   * Loads the tab's file into the editor; only the latest read applies (see
   * useLatestFileLoad). Nothing changes `params.filePath` on a live editor
   * panel – the openers reuse a tab without touching its params, and only
   * preview panels call `updateParameters` – so a load runs on mount (and on
   * "Try again"), never over a buffer holding unsaved edits.
   */
  const { loadError, retry: retryLoad } = useLatestFileLoad(props.params?.filePath, {
    read: async (filePath) => {
      // The project this file is opened under; saves name it
      const generation = getLastSeenProjectGeneration()
      const content = await fileGateway.readFile({ filePath })
      return { content, generation }
    },
    onStart: () => setIsEditorReady(false), // Reset editor ready state when loading new file
    onLoaded: (filePath, { content, generation }) => {
      openedGenerationRef.current = generation
      comments.prefetch(filePath, getDefaultViewMode(filePath)) // 024-NFR-001: main reads comments while the preview renders
      setCurrentFile({ path: filePath, content, modified: false })
      setViewMode(getDefaultViewMode(filePath)) // by file type
    },
    // Never fail silently: without this the tab read "No file open"
    onFailed: (message) =>
      showToast({ title: 'Could not open file', message, type: 'error', duration: 8000 })
  })

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
    if (panelId) {
      useProjectStore.getState().setEditorDirty(panelId, true)
    }
    // Reset autosave debounce timer – save fires after user stops typing
    signalChange()
  }, [signalChange, panelId])

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

    // A markdown link is a "show me the source" gesture, so this call site
    // pins `kind: 'editor'`: `[x](diagram.svg)` or `[x](page.html)` opens in
    // Monaco, never the image viewer or a running preview. Routing through
    // `openFileInPanel` retires the renderer's last hand-built panel id (and its
    // `eslint-disable`) now that #74 ships an explicit "Open as source" path.
    const editorPanel = openFileInPanel(dockviewApi, targetFilePath, { kind: 'editor' })

    // Scroll to anchor if provided
    if (anchor && editorPanel) {
      previewHandleRef.current?.scrollToAnchor(anchor)
    }
  }, [showToast])

  /**
   * Handles editor mount event from Monaco.
   * Signals that the editor is ready for scroll synchronization, and keeps a
   * remounted editor read-only while an autosave hold is active.
   *
   * @param editor - The Monaco editor that just mounted
   */
  const handleEditorMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    logger.info('Editor mounted and ready', { viewMode })
    readOnlyHold.applyToMountedEditor(editor)
    setIsEditorReady(true)
  }, [viewMode, setIsEditorReady, readOnlyHold])

  // =========================================================================
  // Effects
  // =========================================================================

  // Handle initial line/column positioning from terminal file links
  const initialLine = props.params?.initialLine
  const initialColumn = props.params?.initialColumn
  useEffect(() => {
    if (!isEditorReady || !initialLine || !editorRef.current) return

    editorRef.current.setPositionAndReveal(initialLine, initialColumn)
    logger.info(`Positioned editor at line ${initialLine}${initialColumn ? `:${initialColumn}` : ''}`)
  }, [isEditorReady, initialLine, initialColumn])

  // Update tab title when modified state changes
  // Keyed on path and flag only, so typing (a content change) does not re-set it
  const titlePath = currentFile?.path
  const titleModified = currentFile?.modified ?? false
  useEffect(() => {
    if (titlePath === undefined) return
    const fileName = extractFileName(titlePath)
    const title = formatTabTitle(fileName, titleModified, isFileDeleted)
    props.api.setTitle(title)
  }, [titleModified, titlePath, isFileDeleted, props.api])

  // Cleanup: ensure panel is not marked dirty on unmount, and drop a pending
  // indicator reset
  useEffect(() => {
    return () => {
      if (panelId) {
        useProjectStore.getState().setEditorDirty(panelId, false)
      }
      if (autoSaveIndicatorTimerRef.current) {
        clearTimeout(autoSaveIndicatorTimerRef.current)
        autoSaveIndicatorTimerRef.current = null
      }
    }
  }, [panelId]) // panelId never changes, so this still runs on unmount only

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
              commentTools={comments.tools}
            />
          </EditorErrorBoundary>
          {comments.band}

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
            onPreviewRendered={handlePreviewRendered}
            onSelectionChange={setSelectedText}
            isVisible={isPanelVisible}
            previewOverlay={comments.overlay}
          />
        </EditorErrorBoundary>
      ) : loadError ? (
        <EditorLoadError message={loadError} onRetry={retryLoad} />
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
