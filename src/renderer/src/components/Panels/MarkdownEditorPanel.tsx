import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { FileEdit, Columns2, Rows2, Eye, Bold, Italic, Code, Link, Image, Heading1, List, ListOrdered, Strikethrough, FileDown, FileText } from 'lucide-react'
import { IDockviewPanelProps } from 'dockview'
import * as monaco from 'monaco-editor'
import { MonacoMarkdownEditor, MonacoEditorHandle } from '../Editor/MonacoMarkdownEditor'
import { MarkdownPreview, MarkdownPreviewHandle } from '../Editor/MarkdownPreview'
import { ResizableDivider } from '../Editor/ResizableDivider'
import { useDialog } from '../Dialog'
import { useToast } from '../Toast/ToastContext'
import { FileConflictNotification } from '../FileConflictNotification/FileConflictNotification'
import { useProjectStore } from '../../stores/useProjectStore'
import { sanitizeFilePath } from '../../utils/fileUtils'
import { convertMermaidDiagramsToImages } from '../../utils/svgToImage'
import { logger } from '../../utils/logger'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useFileWatcher, createFileSaveGuard } from '../../hooks/useFileWatcher'
import {
  type ScrollMapEntry,
  calculateStats,
  processElementForScrollMap,
  aggregateLineOffsets,
  buildScrollMapEntries,
  enforceMonotonicPreviewOffsets,
  interpolateScrollPosition,
  isSplitMode,
  extractFileName,
  extractBaseFileName,
  formatTabTitle,
  getDefaultViewMode
} from './markdownEditorPanel.logic'
import './MarkdownEditorPanel.css'

/** Duration to show auto-save indicator in milliseconds */
const INDICATOR_DURATION_MS = 1000

interface EditorFile {
  path: string
  content: string
  modified: boolean
}

export function MarkdownEditorPanel(
  props: IDockviewPanelProps<{ filePath?: string; panelId?: string; initialLine?: number; initialColumn?: number }>
) {
  const [currentFile, setCurrentFile] = useState<EditorFile | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'split-horizontal' | 'editor' | 'preview'>('preview')
  const [selectedText, setSelectedText] = useState<string>('')

  // New unified dialog system
  const { showConfirm } = useDialog()
  const { showToast } = useToast()

  /**
   * Handle opening markdown files from internal links
   * Switches to existing tab or creates new tab, then scrolls to anchor if provided
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
    // scrollToAnchor now has built-in retry logic with MutationObserver
    if (anchor) {
      previewHandleRef.current?.scrollToAnchor(anchor)
    }
  }, [showToast])

  // Vertical split divider position (side-by-side)
  const [dividerPosition, setDividerPosition] = useState<number>(() => {
    // Load from localStorage, default to 50%
    const saved = localStorage.getItem('markdown-editor-divider-position')
    return saved ? parseFloat(saved) : 50
  })

  // Horizontal split divider position (preview top, editor bottom)
  const [dividerPositionHorizontal, setDividerPositionHorizontal] = useState<number>(() => {
    const saved = localStorage.getItem('markdown-editor-divider-position-horizontal')
    return saved ? parseFloat(saved) : 50
  })

  const panelIdRef = useRef<string | undefined>(props.params?.panelId)

  const editorRef = useRef<MonacoEditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewHandleRef = useRef<MarkdownPreviewHandle>(null)

  // Scroll synchronization state
  const scrollMapRef = useRef<ScrollMapEntry[]>([])
  const isSyncingRef = useRef(false)
  const [isEditorReady, setIsEditorReady] = useState(false)

  // PDF export state (issue #58 edge case: prevent rapid clicks)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  // DOCX export state (issue #65: prevent rapid clicks)
  const [isExportingDocx, setIsExportingDocx] = useState(false)

  // Unified helper: detect any split mode (vertical or horizontal)
  // Uses extracted pure function for consistency
  const isAnySplitMode = isSplitMode(viewMode)

  // =========================================================================
  // File Watcher Hook Integration
  // Handles external file changes, deletions, and conflict resolution
  // =========================================================================
  const {
    externalChangeDetected,
    isFileDeleted,
    isReloading,
    reloadFromDisk: handleReloadFromDisk,
    keepLocal: handleKeepLocal,
    dismissConflict,
    clearDeletedState,
    markSaving,
    unmarkSaving
  } = useFileWatcher({
    filePath: currentFile?.path ?? null,
    hasLocalChanges: currentFile?.modified ?? false,
    onContentUpdate: (content) => {
      if (currentFile) {
        setCurrentFile({
          ...currentFile,
          content,
          modified: false
        })
      }
    }
  })

  // Create file save guard for pausing/resuming file watching during save
  const saveGuardRef = useRef<ReturnType<typeof createFileSaveGuard> | null>(null)
  useEffect(() => {
    if (currentFile?.path) {
      saveGuardRef.current = createFileSaveGuard(currentFile.path)
    } else {
      saveGuardRef.current = null
    }
  }, [currentFile?.path])

  // =========================================================================
  // Auto-Save Hook Integration
  // Debounced auto-save after 2 seconds of inactivity
  // =========================================================================
  const { isAutoSaving, setIsAutoSaving } = useAutoSave(
    currentFile?.modified ?? false,
    () => handleSave(true),
    { delay: 2000, enabled: true }
  )

  // Sync previewRef with previewHandleRef.element for DOM operations
  useEffect(() => {
    if (previewHandleRef.current?.element) {
      (previewRef as React.MutableRefObject<HTMLDivElement | null>).current = previewHandleRef.current.element
    }
  }, [viewMode, currentFile])

  // Debug logging
  logger.debug('MarkdownEditorPanel render', {
    hasCurrentFile: !!currentFile,
    filePath: currentFile?.path,
    contentLength: currentFile?.content?.length,
    contentPreview: currentFile?.content?.substring(0, 50),
    viewMode
  })

  // Calculate document statistics
  const documentStats = useMemo(() => {
    if (!currentFile) return null
    return calculateStats(currentFile.content)
  }, [currentFile?.content])

  // Load file when panel receives a file path
  useEffect(() => {
    const filePath = props.params?.filePath
    if (filePath) {
      loadFile(filePath)
    }
  }, [props.params?.filePath])

  // Handle initial line/column positioning from terminal file links (issue #26)
  useEffect(() => {
    const { initialLine, initialColumn } = props.params || {}
    if (!isEditorReady || !initialLine || !editorRef.current) return

    // Use setPositionAndReveal to jump to the specified location
    editorRef.current.setPositionAndReveal(initialLine, initialColumn)
    logger.info(`Positioned editor at line ${initialLine}${initialColumn ? `:${initialColumn}` : ''}`)
  }, [isEditorReady, props.params?.initialLine, props.params?.initialColumn])

  // Update tab title when modified state changes
  useEffect(() => {
    if (!currentFile) return
    const fileName = extractFileName(currentFile.path)
    const title = formatTabTitle(fileName, currentFile.modified, isFileDeleted)
    props.api.setTitle(title)
  }, [currentFile?.modified, currentFile?.path, isFileDeleted])

  // NOTE: File watching is now handled by useFileWatcher hook
  // See "File Watcher Hook Integration" section above

  // Reset editor state when view mode changes - force rebuild on next effect
  useEffect(() => {
    setIsEditorReady(false) // Trigger rebuild cycle
    logger.debug('Resetting editor state due to view mode change', { viewMode })
  }, [viewMode])

  // Notify Monaco of layout changes (no state coordination needed)
  useEffect(() => {
    if (!isAnySplitMode) return

    const editor = editorRef.current?.getEditor()
    if (editor) {
      requestAnimationFrame(() => {
        logger.debug('Notifying Monaco Editor of layout change')
        editor.layout()
      })
    }
  }, [isAnySplitMode, viewMode])

  // Resize observers: rebuild mapping when preview/editor containers resize
  useEffect(() => {
    if (!isAnySplitMode) return
    const previewEl = previewRef.current
    const editorEl = editorRef.current?.getEditor()?.getDomNode() || null
    if (!previewEl || !editorEl) return

    let debounceTimer: number | null = null
    const debouncedRebuild = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        rebuildScrollMap()
      }, 150)
    }

    const ro = new ResizeObserver(() => debouncedRebuild())
    ro.observe(previewEl)
    ro.observe(editorEl)

    const onWindowResize = () => debouncedRebuild()
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      ro.disconnect()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [isAnySplitMode, currentFile?.path, isEditorReady])

  // Rebuild scroll map when content or view changes (imperative, no state coordination)
  const rebuildScrollMap = useCallback(() => {
    logger.debug('rebuildScrollMap called, checking conditions', {
      hasEditor: !!editorRef.current,
      hasPreview: !!previewRef.current,
      isAnySplitMode
    })

    if (!editorRef.current || !previewRef.current || !isAnySplitMode) {
      logger.debug('Skipping scroll map rebuild: preconditions not met')
      return
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          logger.debug('Building scroll map')
          const map = buildScrollMap()
          scrollMapRef.current = map
          logger.debug(`Scroll map rebuilt: ${map.length} entries`)
          if (map.length > 0) {
            logger.debug('First few entries', { entries: map.slice(0, 3) })
          }
        } catch (error) {
          logger.error('Error rebuilding scroll map', error instanceof Error ? error : undefined)
          scrollMapRef.current = []
        }
      })
    })
  }, [isAnySplitMode])

  // Trigger scroll map rebuild when content or file changes
  useEffect(() => {
    logger.debug('Rebuild trigger effect fired', {
      isAnySplitMode,
      isEditorReady,
      hasContent: !!currentFile?.content,
      viewMode
    })

    if (!isAnySplitMode || !isEditorReady) {
      logger.debug('Skipping rebuild trigger: preconditions not met')
      return
    }

    // Helper: wait for images to load and mermaid to signal
    const waitForPreviewReady = async (): Promise<void> => {
      if (!previewRef.current) return
      const root = previewRef.current

      // Track pending image loads
      const imgs = Array.from(root.querySelectorAll('img'))
      const loadingPromises = imgs
        .filter((img) => !(img as HTMLImageElement).complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true })
              img.addEventListener('error', () => resolve(), { once: true })
            })
        )

      // Track a single mermaid event cycle (if any diagrams exist)
      const hasMermaid = root.querySelector('.mermaid-wrapper') !== null
      const mermaidPromise = hasMermaid
        ? new Promise<void>((resolve) => {
            const handler = () => {
              root.removeEventListener('mermaid:rendered', handler)
              resolve()
            }
            root.addEventListener('mermaid:rendered', handler, { once: true })
            // Fallback after 800ms in case nothing fires
            setTimeout(() => {
              root.removeEventListener('mermaid:rendered', handler)
              resolve()
            }, 800)
          })
        : Promise.resolve()

      // Fallback timeout so we don't wait forever
      const fallback = new Promise<void>((resolve) => setTimeout(resolve, 600))

      await Promise.race([
        Promise.all([Promise.all(loadingPromises), mermaidPromise]).then(() => undefined),
        fallback
      ])
    }

    let cancelled = false

    ;(async () => {
      logger.debug('Waiting for preview content readiness')
      await waitForPreviewReady()
      if (cancelled) return
      logger.debug('Content ready. Rebuilding scroll map')
      rebuildScrollMap()
    })()

    return () => {
      cancelled = true
    }
  }, [currentFile?.content, viewMode, isEditorReady, rebuildScrollMap])

  // Listen for subsequent Mermaid render events to keep mapping accurate
  useEffect(() => {
    if (!isAnySplitMode || !previewRef.current) return
    const root = previewRef.current
    let timer: number | null = null
    const handler = () => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(() => rebuildScrollMap(), 120)
    }
    root.addEventListener('mermaid:rendered', handler)
    return () => {
      root.removeEventListener('mermaid:rendered', handler)
      if (timer) clearTimeout(timer)
    }
  }, [isAnySplitMode, currentFile?.path, rebuildScrollMap])

  // Attach image load listeners after content changes to handle lazy-loading
  useEffect(() => {
    if (!isAnySplitMode || !previewRef.current) return
    const root = previewRef.current
    const imgs = Array.from(root.querySelectorAll('img'))
    let timer: number | null = null
    const handler = () => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(() => rebuildScrollMap(), 120)
    }
    imgs.forEach((img) => {
      if (!(img as HTMLImageElement).complete) {
        img.addEventListener('load', handler, { once: true })
        img.addEventListener('error', handler, { once: true })
      }
    })
    return () => {
      if (timer) clearTimeout(timer)
      imgs.forEach((img) => {
        img.removeEventListener('load', handler)
        img.removeEventListener('error', handler)
      })
    }
  }, [isAnySplitMode, currentFile?.content, rebuildScrollMap])

  // STABLE handlers using useCallback - prevents stale closures
  const handleEditorScroll = useCallback(() => {
    if (isSyncingRef.current || !previewRef.current) return

    try {
      // Defensive: verify previewRef is still attached to DOM
      if (!previewRef.current.offsetParent) return

      const editor = editorRef.current?.getEditor()
      if (!editor || scrollMapRef.current.length === 0) return

      const scrollTop = editor.getScrollTop()
      const targetOffset = interpolateScrollPosition(scrollTop, scrollMapRef.current, 'editor')

      isSyncingRef.current = true
      previewRef.current.scrollTop = targetOffset

      // Use RAF instead of setTimeout (more reliable)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isSyncingRef.current = false
        })
      })
    } catch (error) {
      logger.error('Error in handleEditorScroll', error instanceof Error ? error : undefined)
      isSyncingRef.current = false
    }
  }, [])

  const handlePreviewScroll = useCallback(() => {
    if (isSyncingRef.current || !previewRef.current) return

    try {
      // Defensive: verify previewRef is still attached to DOM
      if (!previewRef.current.offsetParent) return

      const editor = editorRef.current?.getEditor()
      if (!editor || scrollMapRef.current.length === 0) return

      const scrollTop = previewRef.current.scrollTop
      const targetOffset = interpolateScrollPosition(scrollTop, scrollMapRef.current, 'preview')

      isSyncingRef.current = true
      editor.setScrollTop(targetOffset)

      // Use RAF instead of setTimeout (more reliable)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isSyncingRef.current = false
        })
      })
    } catch (error) {
      logger.error('Error in handlePreviewScroll', error instanceof Error ? error : undefined)
      isSyncingRef.current = false
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Cmd/Ctrl+S - Save
      if (modKey && e.key === 's' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleSave(false) // Manual save
      }

      // Cmd/Ctrl+W - Close tab
      if (modKey && e.key === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (currentFile?.modified) {
          // Show confirmation dialog if unsaved changes
          const confirmed = await showConfirm({
            title: 'Unsaved Changes',
            message: `File "${currentFile.path.split('/').pop()}" has unsaved changes. Close anyway?`,
            confirmLabel: 'Close Without Saving',
            danger: true
          })
          if (confirmed) {
            props.api.close()
          }
        } else {
          props.api.close()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentFile])

  // NOTE: Auto-save is now handled by useAutoSave hook
  // See "Auto-Save Hook Integration" section above

  // Attach scroll listeners - simplified approach without polling
  useEffect(() => {
    if (!isAnySplitMode || !isEditorReady || !previewRef.current) {
      logger.debug('Skipping listener attachment', {
        isAnySplitMode,
        isEditorReady,
        hasPreviewRef: !!previewRef.current
      })
      return
    }

    const editor = editorRef.current?.getEditor()
    if (!editor) {
      logger.debug('Skipping listener attachment: no editor')
      return
    }

    logger.debug('Attaching scroll listeners directly')

    // Attach listeners immediately - scroll map should be built by now
    try {
      const editorDisposable = editor.onDidScrollChange(handleEditorScroll)
      const previewElement = previewRef.current!
      previewElement.addEventListener('scroll', handlePreviewScroll)

      logger.debug('Scroll listeners attached successfully', { scrollMapSize: scrollMapRef.current.length })

      return () => {
        logger.debug('Removing scroll listeners')
        editorDisposable.dispose()
        previewElement.removeEventListener('scroll', handlePreviewScroll)
      }
    } catch (error) {
      logger.error('Error attaching scroll listeners', error instanceof Error ? error : undefined)
      return undefined
    }
  }, [viewMode, currentFile?.path, isEditorReady, handleEditorScroll, handlePreviewScroll])

  const handleEditorMount = (_editor: monaco.editor.IStandaloneCodeEditor) => {
    logger.info('Editor mounted and ready', { viewMode })

    // Immediately build scroll map if in split mode
    if (viewMode === 'split' || viewMode === 'split-horizontal') {
      logger.debug('Triggering immediate scroll map build after editor mount', { viewMode })
      // Schedule it for next frame to ensure Monaco is fully ready
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            const map = buildScrollMap()
            scrollMapRef.current = map
            logger.debug(`Scroll map built immediately after mount: ${map.length} entries`)
          } catch (error) {
            logger.error('Error building scroll map immediately after mount', error instanceof Error ? error : undefined)
          }
        })
      })
    }

    setIsEditorReady(true)
  }

  const loadFile = async (filePath: string) => {
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
  }

  const handleContentChange = (newContent: string) => {
    if (!currentFile) return

    setCurrentFile({
      ...currentFile,
      content: newContent,
      modified: true
    })
    // Mark panel as dirty in global store (if panel id known)
    if (panelIdRef.current) {
      // Use already-imported store directly (no dynamic import needed)
      useProjectStore.getState().setEditorDirty(panelIdRef.current, true)
    }
  }

  const handleSave = async (isAutoSave: boolean = false) => {
    if (!currentFile) return

    // Mark saving via hook to prevent race conditions with file watcher
    markSaving()

    try {
      if (isAutoSave) {
        setIsAutoSaving(true)
      }

      // Pause file watching during save to prevent race condition
      await saveGuardRef.current?.pauseWatch()

      await window.api.file.writeFile(currentFile.path, currentFile.content)
      setCurrentFile({
        ...currentFile,
        modified: false
      })
      if (panelIdRef.current) {
        // Use already-imported store directly (no dynamic import needed)
        useProjectStore.getState().setEditorDirty(panelIdRef.current, false)
      }

      // Clear any external change detection since we just saved (via hook)
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
      // Resume file watching after save completes
      await saveGuardRef.current?.resumeWatch()
      unmarkSaving()
    }
  }

  // Cleanup: ensure panel is not marked dirty on unmount
  useEffect(() => {
    return () => {
      if (panelIdRef.current) {
        // Use already-imported store directly (no dynamic import needed)
        useProjectStore.getState().setEditorDirty(panelIdRef.current, false)
      }
    }
  }, [])

  // NOTE: handleExternalChange, reloadFromDisk, handleFileDeleted, and handleKeepLocal
  // are now provided by the useFileWatcher hook. See "File Watcher Hook Integration" section.
  // - handleReloadFromDisk (renamed from reloadFromDisk)
  // - handleKeepLocal
  // - dismissConflict
  // - clearDeletedState

  const handleDividerResize = (newPosition: number) => {
    setDividerPosition(newPosition)
    localStorage.setItem('markdown-editor-divider-position', newPosition.toString())
  }

  const handleDividerResizeHorizontal = (newPosition: number) => {
    setDividerPositionHorizontal(newPosition)
    localStorage.setItem('markdown-editor-divider-position-horizontal', newPosition.toString())
  }

  const handleDividerResizeEnd = () => {
    // Rebuild map after layout settles post divider drag
    if (isAnySplitMode) {
      requestAnimationFrame(() => rebuildScrollMap())
    }
  }

  /**
   * Export markdown preview to PDF
   *
   * Gets rendered HTML from preview and sends to main process for PDF generation.
   * Shows success/error toast notification.
   *
   * @see Issue #58 - markdown-to-PDF export
   */
  const handleExportPdf = async () => {
    // HIGH: Prevent rapid clicks (edge case from issue #58)
    if (isExportingPdf) {
      return
    }

    // Check if we have preview element and current file
    const previewElement = previewHandleRef.current?.element
    if (!previewElement || !currentFile) {
      showToast({
        title: 'Export failed',
        message: 'No content to export',
        type: 'error',
        duration: 3000
      })
      return
    }

    // Get the inner content (the rendered markdown)
    const contentElement = previewElement.querySelector('.markdown-preview-content')
    const html = contentElement?.innerHTML || previewElement.innerHTML

    // Get filename from current file path (without .md extension)
    const fileName = extractBaseFileName(currentFile.path)

    setIsExportingPdf(true)
    try {
      const result = await window.api.pdf.exportToPdf({ html, fileName })

      if (result.success && result.filePath) {
        // Show success with just the filename
        const savedFileName = extractFileName(result.filePath)
        showToast({
          title: 'PDF exported',
          message: `Saved as ${savedFileName}`,
          type: 'success',
          duration: 3000
        })
      } else if (result.errorCode !== 'PDF_EXPORT_CANCELLED') {
        // Show error (but not for cancelled exports)
        showToast({
          title: 'Export failed',
          message: result.error || 'Unknown error',
          type: 'error',
          duration: 5000
        })
      }
    } catch (error) {
      showToast({
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
        duration: 5000
      })
    } finally {
      setIsExportingPdf(false)
    }
  }

  /**
   * Export to DOCX handler
   *
   * Extracts HTML from preview, calls DOCX export API.
   * Shows success/error toast notification.
   *
   * @see Issue #65 - DOCX export with Mermaid diagram support
   */
  const handleExportDocx = async () => {
    // Prevent rapid clicks (edge case from issue #65)
    if (isExportingDocx) {
      return
    }

    // Check if we have preview element and current file
    const previewElement = previewHandleRef.current?.element
    if (!previewElement || !currentFile) {
      showToast({
        title: 'Export failed',
        message: 'No content to export',
        type: 'error',
        duration: 3000
      })
      return
    }

    // Get the inner content (the rendered markdown)
    const contentElement = previewElement.querySelector('.markdown-preview-content')
    if (!contentElement) {
      showToast({
        title: 'Export failed',
        message: 'No preview content available',
        type: 'error',
        duration: 3000
      })
      return
    }

    // Get filename from current file path (without .md extension)
    const fileName = extractBaseFileName(currentFile.path)

    setIsExportingDocx(true)
    try {
      // Convert Mermaid diagrams to PNG images before sending to main process
      // This avoids jsdom/canvas dependency issues in the main process
      const conversionResult = await convertMermaidDiagramsToImages(contentElement)

      // Warn user if some diagrams failed to convert
      if (conversionResult.failedDiagrams > 0) {
        showToast({
          title: 'Diagram conversion warning',
          message: `${conversionResult.failedDiagrams} of ${conversionResult.totalDiagrams} diagram(s) could not be converted`,
          type: 'warning',
          duration: 5000
        })
      }

      const result = await window.api.docx.exportToDocx({
        html: conversionResult.html,
        fileName
      })

      if (result.success && result.filePath) {
        // Show success with just the filename
        const savedFileName = extractFileName(result.filePath)
        showToast({
          title: 'DOCX exported',
          message: `Saved as ${savedFileName}`,
          type: 'success',
          duration: 3000
        })
      } else if (result.errorCode !== 'DOCX_EXPORT_CANCELLED') {
        // Show error (but not for cancelled exports)
        showToast({
          title: 'Export failed',
          message: result.error || 'Unknown error',
          type: 'error',
          duration: 5000
        })
      }
    } catch (error) {
      showToast({
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
        duration: 5000
      })
    } finally {
      setIsExportingDocx(false)
    }
  }

  /**
   * Build scroll map: line -> pixel positions
   * Maps editor line numbers to preview element positions
   *
   * Uses extracted pure functions for scroll map building:
   * - processElementForScrollMap: Processes DOM elements
   * - aggregateLineOffsets: Deduplicates line entries
   * - buildScrollMapEntries: Creates scroll map entries
   * - enforceMonotonicPreviewOffsets: Ensures smooth scrolling
   */
  const buildScrollMap = (): ScrollMapEntry[] => {
    logger.debug('buildScrollMap() called')

    if (!editorRef.current || !previewRef.current) {
      logger.debug('Skipping buildScrollMap: missing refs')
      return []
    }

    const editor = editorRef.current.getEditor()
    if (!editor) {
      logger.debug('Skipping buildScrollMap: no editor')
      return []
    }

    const container = previewRef.current
    const containerRect = container.getBoundingClientRect()
    const containerScrollTop = container.scrollTop

    // Collect candidates using start/end ranges
    const nodeList = container.querySelectorAll('[data-line-start]')
    logger.debug(`Found ${nodeList.length} elements with data-line-start attribute`)

    // Process each element using extracted logic
    const config = { containerRect, containerScrollTop }
    const elementsData = Array.from(nodeList)
      .map((el) => processElementForScrollMap(el, config))
      .filter((data): data is NonNullable<typeof data> => data !== null)

    // Aggregate and build map using extracted functions
    const lineToOffset = aggregateLineOffsets(elementsData)
    const getEditorOffset = (line: number) => editor.getTopForLineNumber(line)
    const entries = buildScrollMapEntries(lineToOffset, getEditorOffset)
    const map = enforceMonotonicPreviewOffsets(entries)

    logger.debug(`buildScrollMap completed: ${map.length} entries`)
    return map
  }

  // Note: interpolateScrollPosition is now imported from markdownEditorPanel.logic.ts
  // and used directly in handleEditorScroll and handlePreviewScroll

  return (
    <div className="markdown-editor-panel" tabIndex={0}>
      {currentFile && (
        <>
          <div className="markdown-toolbar">
          {(viewMode === 'editor' || viewMode === 'split') && (
            <>
              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.formatBold()}
                title="Bold (Cmd/Ctrl+B)"
              >
                <Bold size={16} strokeWidth={2} />
              </button>
              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.formatItalic()}
                title="Italic (Cmd/Ctrl+I)"
              >
                <Italic size={16} strokeWidth={2} />
              </button>
              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.formatStrikethrough()}
                title="Strikethrough"
              >
                <Strikethrough size={16} strokeWidth={2} />
              </button>

              <div className="toolbar-separator" />

              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.formatCode()}
                title="Inline Code"
              >
                <Code size={16} strokeWidth={2} />
              </button>
              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.insertLink()}
                title="Insert Link (Cmd/Ctrl+K)"
              >
                <Link size={16} strokeWidth={2} />
              </button>
              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.insertImage()}
                title="Insert Image"
              >
                <Image size={16} strokeWidth={2} />
              </button>

              <div className="toolbar-separator" />

              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.insertHeading(1)}
                title="Heading 1"
              >
                <Heading1 size={16} strokeWidth={2} />
              </button>
              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.insertList(false)}
                title="Bullet List"
              >
                <List size={16} strokeWidth={2} />
              </button>
              <button
                className="toolbar-btn"
                onClick={() => editorRef.current?.insertList(true)}
                title="Numbered List"
              >
                <ListOrdered size={16} strokeWidth={2} />
              </button>
            </>
          )}

          <div className="toolbar-spacer" />

          {currentFile?.modified && <span className="modified-indicator">●</span>}
          {isAutoSaving && <span className="file-status-indicator">Auto-saving...</span>}
          {isReloading && <span className="file-status-indicator">Reloaded from disk</span>}

          <button
            className={`view-mode-btn ${viewMode === 'editor' ? 'active' : ''}`}
            onClick={() => setViewMode('editor')}
            title="Editor Only"
          >
            <FileEdit size={16} strokeWidth={2} />
          </button>
          <button
            className={`view-mode-btn ${viewMode === 'split-horizontal' ? 'active' : ''}`}
            onClick={() => setViewMode('split-horizontal')}
            title="Split Horizontal (Preview Top)"
          >
            <Rows2 size={16} strokeWidth={2} />
          </button>
          <button
            className={`view-mode-btn ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => setViewMode('split')}
            title="Split Vertical (Side by Side)"
          >
            <Columns2 size={16} strokeWidth={2} />
          </button>
          <button
            className={`view-mode-btn ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => setViewMode('preview')}
            title="Preview Only"
          >
            <Eye size={16} strokeWidth={2} />
          </button>

          <div className="toolbar-separator" />

          <button
            className="toolbar-btn"
            onClick={handleExportPdf}
            disabled={!currentFile || isExportingPdf || viewMode === 'editor'}
            title={viewMode === 'editor' ? 'Export to PDF (switch to preview or split mode)' : 'Export to PDF'}
          >
            <FileDown size={16} strokeWidth={2} />
          </button>
          <button
            className="toolbar-btn"
            onClick={handleExportDocx}
            disabled={!currentFile || isExportingDocx || viewMode === 'editor'}
            title={viewMode === 'editor' ? 'Export to Word (switch to preview or split mode)' : 'Export to Word'}
          >
            <FileText size={16} strokeWidth={2} />
          </button>
        </div>

        {/* File conflict notification */}
        {externalChangeDetected && currentFile && (
          <FileConflictNotification
            fileName={currentFile.path.split('/').pop() || 'File'}
            onReload={handleReloadFromDisk}
            onKeepLocal={handleKeepLocal}
            onDismiss={dismissConflict}
          />
        )}

        {/* File deleted warning */}
        {isFileDeleted && (
          <div className="file-deleted-warning">
            <span>⚠️ This file was deleted on disk. Save to restore it.</span>
          </div>
        )}
      </>
      )}

      {currentFile ? (
        <div className={`editor-content view-mode-${viewMode}`}>
          {/* HORIZONTAL SPLIT: Preview on top, Editor on bottom */}
          {viewMode === 'split-horizontal' && (
            <>
              <div
                className="preview-pane"
                style={{ height: `${dividerPositionHorizontal}%` }}
              >
                <MarkdownPreview key={`preview-${viewMode}`} ref={previewHandleRef} content={currentFile.content} filePath={currentFile.path} onOpenFile={handleOpenFile} />
              </div>
              <ResizableDivider orientation="horizontal" onResize={handleDividerResizeHorizontal} onResizeEnd={handleDividerResizeEnd} />
              <div
                className="editor-pane"
                style={{ height: `${100 - dividerPositionHorizontal}%` }}
              >
                <MonacoMarkdownEditor
                  key={`editor-${viewMode}`}
                  ref={editorRef}
                  value={currentFile.content}
                  onChange={handleContentChange}
                  filePath={currentFile.path}
                  onSelectionChange={setSelectedText}
                  onEditorMount={handleEditorMount}
                />
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
                >
                  <MonacoMarkdownEditor
                    key={`editor-${viewMode}`}
                    ref={editorRef}
                    value={currentFile.content}
                    onChange={handleContentChange}
                    filePath={currentFile.path}
                    onSelectionChange={setSelectedText}
                    onEditorMount={handleEditorMount}
                  />
                </div>
              )}
              {viewMode === 'split' && (
                <ResizableDivider orientation="vertical" onResize={handleDividerResize} onResizeEnd={handleDividerResizeEnd} />
              )}
              {(viewMode === 'preview' || viewMode === 'split') && (
                <div
                  className="preview-pane"
                  style={viewMode === 'split' ? { width: `${100 - dividerPosition}%` } : undefined}
                >
                  <MarkdownPreview key={`preview-${viewMode}`} ref={previewHandleRef} content={currentFile.content} filePath={currentFile.path} onOpenFile={handleOpenFile} />
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="editor-empty">
          <p>No file open</p>
          <p className="hint">Select a markdown file from the project panel to start editing</p>
        </div>
      )}

      {documentStats && (
        <div className="document-stats">
          <div className="stats-group">
            <span className="stat-item">
              <span className="stat-label">Words:</span>
              <span className="stat-value">{documentStats.words.toLocaleString()}</span>
            </span>
            <span className="stat-separator">•</span>
            <span className="stat-item">
              <span className="stat-label">Characters:</span>
              <span className="stat-value">{documentStats.characters.toLocaleString()}</span>
            </span>
            <span className="stat-separator">•</span>
            <span className="stat-item">
              <span className="stat-label">Lines:</span>
              <span className="stat-value">{documentStats.lines.toLocaleString()}</span>
            </span>
            <span className="stat-separator">•</span>
            <span className="stat-item">
              <span className="stat-label">Reading time:</span>
              <span className="stat-value">
                {documentStats.readingTimeMinutes} min
              </span>
            </span>
          </div>
          {selectedText && (
            <div className="stats-group selection-stats">
              <span className="stat-separator">|</span>
              <span className="stat-item">
                <span className="stat-label">Selected:</span>
                <span className="stat-value">{selectedText.length} chars</span>
              </span>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
