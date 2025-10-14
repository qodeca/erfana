import { useState, useEffect, useRef, useMemo } from 'react'
import { FileEdit, Columns2, Eye, Bold, Italic, Code, Link, Image, Heading1, List, ListOrdered, Strikethrough } from 'lucide-react'
import { IDockviewPanelProps } from 'dockview'
import * as monaco from 'monaco-editor'
import { MonacoMarkdownEditor, MonacoEditorHandle } from '../Editor/MonacoMarkdownEditor'
import { MarkdownPreview } from '../Editor/MarkdownPreview'
import { ResizableDivider } from '../Editor/ResizableDivider'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import { FileConflictNotification } from '../FileConflictNotification/FileConflictNotification'
import { useToast } from '../Toast/ToastContext'
import './MarkdownEditorPanel.css'

interface EditorFile {
  path: string
  content: string
  modified: boolean
}

interface DocumentStats {
  words: number
  characters: number
  charactersNoSpaces: number
  lines: number
  readingTimeMinutes: number
}

interface ScrollMapEntry {
  line: number
  editorOffset: number
  previewOffset: number
}

// Calculate document statistics
const calculateStats = (content: string): DocumentStats => {
  const lines = content.split('\n').length
  const characters = content.length
  const charactersNoSpaces = content.replace(/\s/g, '').length

  // Count words (split by whitespace and filter empty strings)
  const words = content
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0).length

  // Estimate reading time (average 200 words per minute)
  const readingTimeMinutes = Math.ceil(words / 200)

  return {
    words,
    characters,
    charactersNoSpaces,
    lines,
    readingTimeMinutes
  }
}

export function MarkdownEditorPanel(props: IDockviewPanelProps<{ filePath?: string }>) {
  const [currentFile, setCurrentFile] = useState<EditorFile | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('preview')
  const [selectedText, setSelectedText] = useState<string>('')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const [dividerPosition, setDividerPosition] = useState<number>(() => {
    // Load from localStorage, default to 50%
    const saved = localStorage.getItem('markdown-editor-divider-position')
    return saved ? parseFloat(saved) : 50
  })

  // File watching state
  const [externalChangeDetected, setExternalChangeDetected] = useState(false)
  const [isFileDeleted, setIsFileDeleted] = useState(false)
  const [isReloading, setIsReloading] = useState(false)

  const editorRef = useRef<MonacoEditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isSavingRef = useRef(false) // Track save operations to prevent race conditions
  const { showToast } = useToast()

  // Scroll synchronization state
  const scrollMapRef = useRef<ScrollMapEntry[]>([])
  const isSyncingRef = useRef(false)
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [isScrollMapReady, setIsScrollMapReady] = useState(false)

  // Debug logging
  console.log('MarkdownEditorPanel render:', {
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

  // Update tab title when modified state changes
  useEffect(() => {
    if (!currentFile) return
    const fileName = currentFile.path.split('/').pop() || 'Editor'
    let title = currentFile.modified ? `● ${fileName}` : fileName
    if (isFileDeleted) {
      title = `${fileName} (deleted)`
    }
    props.api.setTitle(title)
  }, [currentFile?.modified, currentFile?.path, isFileDeleted])

  // Start watching file for external changes
  useEffect(() => {
    if (!currentFile?.path) return

    console.log('👁️  Starting watch for:', currentFile.path)

    // Start watching
    window.api.fileWatch.start(currentFile.path).then((result) => {
      if (!result.success) {
        console.error('Failed to start watching file:', result.error)
      }
    })

    // Set up event listeners
    const unsubscribeChanged = window.api.fileWatch.onFileChanged((data) => {
      if (data.filePath === currentFile.path) {
        handleExternalChange()
      }
    })

    const unsubscribeDeleted = window.api.fileWatch.onFileDeleted((data) => {
      if (data.filePath === currentFile.path) {
        handleFileDeleted()
      }
    })

    const unsubscribeError = window.api.fileWatch.onFileError((data) => {
      if (data.filePath === currentFile.path) {
        console.error('File watch error:', data.error)
        showToast({
          title: 'File Watch Error',
          message: data.error,
          type: 'error'
        })
      }
    })

    // Cleanup on unmount or file change
    return () => {
      console.log('👁️  Stopping watch for:', currentFile.path)
      window.api.fileWatch.stop(currentFile.path)
      unsubscribeChanged()
      unsubscribeDeleted()
      unsubscribeError()
    }
  }, [currentFile?.path])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          setShowCloseConfirm(true)
        } else {
          props.api.close()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentFile])

  // Auto-save: debounced save 2 seconds after last edit
  useEffect(() => {
    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Only auto-save if file is modified
    if (currentFile?.modified) {
      autoSaveTimerRef.current = setTimeout(() => {
        handleSave(true) // Auto-save
      }, 2000)
    }

    // Cleanup timer on unmount
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [currentFile?.content, currentFile?.modified])

  // Build scroll map when content changes or view mode changes to split
  useEffect(() => {
    if (viewMode !== 'split' || !currentFile || !isEditorReady) return

    // Wait for preview to render, then build map
    // Double RAF ensures layout is complete before building map
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const map = buildScrollMap()
        scrollMapRef.current = map
        console.log(`📍 Scroll map built: ${map.length} entries`)
        setIsScrollMapReady(true)
      })
    })
  }, [currentFile?.content, viewMode, isEditorReady])

  // Set up scroll synchronization listeners
  useEffect(() => {
    // Wait for editor to be ready, scroll map to be built, and split view mode
    if (viewMode !== 'split' || !isEditorReady || !previewRef.current) return
    if (scrollMapRef.current.length === 0) {
      console.log('⏸️  Waiting for scroll map to be built...')
      return
    }

    // Get direct editor access
    const editor = editorRef.current?.getEditor()
    if (!editor) {
      console.log('⏸️  Editor not available yet...')
      return
    }

    /**
     * Handle editor scroll events → sync to preview
     * Defined inside useEffect to avoid stale closures
     */
    const handleEditorScroll = () => {
      if (isSyncingRef.current || !previewRef.current) return

      console.log('🔄 Editor scrolled, syncing to preview...')
      const scrollTop = editor.getScrollTop()
      const targetOffset = interpolateScrollPosition(scrollTop, scrollMapRef.current, 'editor')

      isSyncingRef.current = true
      previewRef.current.scrollTop = targetOffset

      setTimeout(() => {
        isSyncingRef.current = false
      }, 50)
    }

    /**
     * Handle preview scroll events → sync to editor
     * Defined inside useEffect to avoid stale closures
     */
    const handlePreviewScroll = () => {
      if (isSyncingRef.current || !previewRef.current) return

      console.log('🔄 Preview scrolled, syncing to editor...')
      const scrollTop = previewRef.current.scrollTop
      const targetOffset = interpolateScrollPosition(scrollTop, scrollMapRef.current, 'preview')

      isSyncingRef.current = true
      editor.setScrollTop(targetOffset)

      setTimeout(() => {
        isSyncingRef.current = false
      }, 50)
    }

    // Editor scroll listener - attach directly to Monaco editor instance
    const editorDisposable = editor.onDidScrollChange(handleEditorScroll)

    // Preview scroll listener
    const previewElement = previewRef.current
    previewElement.addEventListener('scroll', handlePreviewScroll)

    console.log('✅ Scroll synchronization enabled with', scrollMapRef.current.length, 'map entries')

    return () => {
      editorDisposable.dispose()
      previewElement.removeEventListener('scroll', handlePreviewScroll)
      console.log('🔄 Scroll synchronization disabled')
    }
  }, [viewMode, currentFile, isEditorReady, isScrollMapReady])

  const handleEditorMount = (_editor: monaco.editor.IStandaloneCodeEditor) => {
    console.log('✅ Editor mounted and ready')
    setIsEditorReady(true)
  }

  const loadFile = async (filePath: string) => {
    console.log('Loading file:', filePath)
    setIsEditorReady(false) // Reset editor ready state when loading new file
    setIsScrollMapReady(false) // Reset scroll map ready state when loading new file
    try {
      const content = await window.api.file.readFile(filePath)
      console.log('File loaded successfully:', {
        filePath,
        contentLength: content.length,
        contentPreview: content.substring(0, 100)
      })
      setCurrentFile({
        path: filePath,
        content,
        modified: false
      })

      // Set view mode based on file type
      const extension = filePath.toLowerCase().split('.').pop()
      const isMarkdown = extension === 'md' || extension === 'markdown'
      setViewMode(isMarkdown ? 'preview' : 'editor')
    } catch (error) {
      console.error('Error loading file:', error)
    }
  }

  const handleContentChange = (newContent: string) => {
    if (!currentFile) return

    setCurrentFile({
      ...currentFile,
      content: newContent,
      modified: true
    })
  }

  const handleSave = async (isAutoSave: boolean = false) => {
    if (!currentFile) return

    // Set saving flag to prevent race conditions with file watcher
    isSavingRef.current = true

    try {
      if (isAutoSave) {
        setIsAutoSaving(true)
      }

      // Pause file watching during save to prevent race condition
      await window.api.fileWatch.pause(currentFile.path)

      await window.api.file.writeFile(currentFile.path, currentFile.content)
      setCurrentFile({
        ...currentFile,
        modified: false
      })

      // Clear any external change detection since we just saved
      setExternalChangeDetected(false)
      setIsFileDeleted(false)

      if (isAutoSave) {
        // Show auto-save indicator briefly
        setTimeout(() => setIsAutoSaving(false), 1000)
      }
    } catch (error) {
      console.error('Error saving file:', error)
      showToast({
        title: 'Save Error',
        message: 'Failed to save file',
        type: 'error'
      })
      setIsAutoSaving(false)
    } finally {
      // Resume file watching after save completes
      await window.api.fileWatch.resume(currentFile.path)
      isSavingRef.current = false
    }
  }

  /**
   * Handle external file changes
   */
  const handleExternalChange = async () => {
    console.log('📝 External change detected for:', currentFile?.path)

    // Ignore if we're currently saving (race condition prevention)
    if (isSavingRef.current) {
      console.log('⏸️  Ignoring external change (save in progress)')
      return
    }

    // Check if file has unsaved changes
    if (!currentFile?.modified) {
      // Safe to auto-reload
      console.log('✅ No local changes, auto-reloading...')
      await reloadFromDisk()
    } else {
      // Has unsaved changes - show conflict notification
      console.log('⚠️  Local changes detected, showing conflict notification')
      setExternalChangeDetected(true)
    }
  }

  /**
   * Reload file from disk
   */
  const reloadFromDisk = async () => {
    if (!currentFile) return

    setIsReloading(true)
    try {
      const content = await window.api.file.readFile(currentFile.path)
      setCurrentFile({
        ...currentFile,
        content,
        modified: false
      })
      setExternalChangeDetected(false)
      console.log('✅ File reloaded successfully')

      // Show reload indicator briefly (like auto-save)
      setTimeout(() => setIsReloading(false), 1000)
    } catch (error) {
      console.error('Error reloading file:', error)
      setIsReloading(false)
      showToast({
        title: 'Reload Error',
        message: 'Failed to reload file',
        type: 'error'
      })
    }
  }

  /**
   * Handle file deletion
   */
  const handleFileDeleted = () => {
    console.log('🗑️  File deleted externally:', currentFile?.path)
    setIsFileDeleted(true)
    setExternalChangeDetected(false) // Clear conflict notification if shown
    showToast({
      title: 'File Deleted',
      message: 'File was deleted on disk',
      type: 'warning'
    })
  }

  /**
   * Handle conflict resolution: Keep local version
   */
  const handleKeepLocal = () => {
    console.log('✅ User chose to keep local version')
    setExternalChangeDetected(false)
    showToast({
      title: 'Local Version Kept',
      message: 'Keeping your local version',
      type: 'info'
    })
  }

  const handleDividerResize = (newPosition: number) => {
    setDividerPosition(newPosition)
    localStorage.setItem('markdown-editor-divider-position', newPosition.toString())
  }

  /**
   * Build scroll map: line → pixel positions
   * Maps editor line numbers to preview element positions
   */
  const buildScrollMap = (): ScrollMapEntry[] => {
    if (!editorRef.current || !previewRef.current) return []

    const map: ScrollMapEntry[] = []
    const elements = previewRef.current.querySelectorAll('[data-line]')

    elements.forEach((el) => {
      const lineAttr = el.getAttribute('data-line')
      if (!lineAttr) return

      const line = parseInt(lineAttr, 10)
      if (isNaN(line)) return

      const previewOffset = (el as HTMLElement).offsetTop
      const editorOffset = editorRef.current!.getTopForLineNumber(line)

      map.push({ line, editorOffset, previewOffset })
    })

    return map.sort((a, b) => a.line - b.line)
  }

  /**
   * Interpolate scroll position between known mapping points
   * Uses linear interpolation for smooth scrolling
   */
  const interpolateScrollPosition = (
    scrollTop: number,
    map: ScrollMapEntry[],
    sourceType: 'editor' | 'preview'
  ): number => {
    if (map.length === 0) return scrollTop
    if (map.length === 1)
      return map[0][sourceType === 'editor' ? 'previewOffset' : 'editorOffset']

    const sourceKey = sourceType === 'editor' ? 'editorOffset' : 'previewOffset'
    const targetKey = sourceType === 'editor' ? 'previewOffset' : 'editorOffset'

    // Binary search for closest entries
    let left = 0,
      right = map.length - 1
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (map[mid][sourceKey] < scrollTop) left = mid + 1
      else right = mid
    }

    // Handle edge cases
    if (left === 0) return map[0][targetKey]
    if (left >= map.length) return map[map.length - 1][targetKey]

    // Linear interpolation between two points
    const before = map[left - 1]
    const after = map[left]

    const sourceRange = after[sourceKey] - before[sourceKey]
    if (sourceRange === 0) return before[targetKey]

    const ratio = (scrollTop - before[sourceKey]) / sourceRange
    const targetRange = after[targetKey] - before[targetKey]

    return before[targetKey] + ratio * targetRange
  }

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
            className={`view-mode-btn ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => setViewMode('split')}
            title="Split View"
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
        </div>

        {/* File conflict notification */}
        {externalChangeDetected && currentFile && (
          <FileConflictNotification
            fileName={currentFile.path.split('/').pop() || 'File'}
            onReload={reloadFromDisk}
            onKeepLocal={handleKeepLocal}
            onDismiss={() => setExternalChangeDetected(false)}
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
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div
              className="editor-pane"
              style={viewMode === 'split' ? { width: `${dividerPosition}%` } : undefined}
            >
              <MonacoMarkdownEditor
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
            <ResizableDivider onResize={handleDividerResize} />
          )}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div
              className="preview-pane"
              style={viewMode === 'split' ? { width: `${100 - dividerPosition}%` } : undefined}
            >
              <MarkdownPreview ref={previewRef} content={currentFile.content} filePath={currentFile.path} />
            </div>
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

      {showCloseConfirm && currentFile && (
        <ConfirmDialog
          title="Unsaved Changes"
          message={`File "${currentFile.path.split('/').pop()}" has unsaved changes. Close anyway?`}
          confirmLabel="Close Without Saving"
          cancelLabel="Cancel"
          danger={true}
          onConfirm={() => {
            setShowCloseConfirm(false)
            props.api.close()
          }}
          onCancel={() => {
            setShowCloseConfirm(false)
          }}
        />
      )}
    </div>
  )
}
