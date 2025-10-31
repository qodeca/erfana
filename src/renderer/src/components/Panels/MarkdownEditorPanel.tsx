import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { FileEdit, Columns2, Rows2, Eye, Bold, Italic, Code, Link, Image, Heading1, List, ListOrdered, Strikethrough } from 'lucide-react'
import { IDockviewPanelProps } from 'dockview'
import * as monaco from 'monaco-editor'
import { MonacoMarkdownEditor, MonacoEditorHandle } from '../Editor/MonacoMarkdownEditor'
import { MarkdownPreview } from '../Editor/MarkdownPreview'
import { ResizableDivider } from '../Editor/ResizableDivider'
import { useDialog } from '../Dialog'
import { FileConflictNotification } from '../FileConflictNotification/FileConflictNotification'
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

export function MarkdownEditorPanel(
  props: IDockviewPanelProps<{ filePath?: string; panelId?: string }>
) {
  const [currentFile, setCurrentFile] = useState<EditorFile | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'split-horizontal' | 'editor' | 'preview'>('preview')
  const [selectedText, setSelectedText] = useState<string>('')
  const [isAutoSaving, setIsAutoSaving] = useState(false)

  // New unified dialog system
  const { showConfirm } = useDialog()

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

  // File watching state
  const [externalChangeDetected, setExternalChangeDetected] = useState(false)
  const [isFileDeleted, setIsFileDeleted] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const panelIdRef = useRef<string | undefined>(props.params?.panelId)

  const editorRef = useRef<MonacoEditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isSavingRef = useRef(false) // Track save operations to prevent race conditions

  // Scroll synchronization state
  const scrollMapRef = useRef<ScrollMapEntry[]>([])
  const isSyncingRef = useRef(false)
  const [isEditorReady, setIsEditorReady] = useState(false)

  // Unified helper: detect any split mode (vertical or horizontal)
  // Used consistently across all scroll sync effects to avoid code duplication
  const isAnySplitMode = viewMode === 'split' || viewMode === 'split-horizontal'

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

  // Reset editor state when view mode changes - force rebuild on next effect
  useEffect(() => {
    setIsEditorReady(false) // Trigger rebuild cycle
    console.log('🔄 Resetting editor state due to view mode change:', viewMode)
  }, [viewMode])

  // Notify Monaco of layout changes (no state coordination needed)
  useEffect(() => {
    if (!isAnySplitMode) return

    const editor = editorRef.current?.getEditor()
    if (editor) {
      requestAnimationFrame(() => {
        console.log('📐 Notifying Monaco Editor of layout change')
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
    console.log('🔨 rebuildScrollMap called, checking conditions...', {
      hasEditor: !!editorRef.current,
      hasPreview: !!previewRef.current,
      isAnySplitMode
    })

    if (!editorRef.current || !previewRef.current || !isAnySplitMode) {
      console.log('⏭️  Skipping scroll map rebuild: preconditions not met')
      return
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          console.log('🏗️  Building scroll map...')
          const map = buildScrollMap()
          scrollMapRef.current = map
          console.log(`📍 Scroll map rebuilt: ${map.length} entries`)
          if (map.length > 0) {
            console.log('✅ First few entries:', map.slice(0, 3))
          }
        } catch (error) {
          console.error('Error rebuilding scroll map:', error)
          scrollMapRef.current = []
        }
      })
    })
  }, [isAnySplitMode])

  // Trigger scroll map rebuild when content or file changes
  useEffect(() => {
    console.log('🔔 Rebuild trigger effect fired:', {
      isAnySplitMode,
      isEditorReady,
      hasContent: !!currentFile?.content,
      viewMode
    })

    if (!isAnySplitMode || !isEditorReady) {
      console.log('⏭️  Skipping rebuild trigger: preconditions not met')
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
      console.log('⏳ Waiting for preview content readiness...')
      await waitForPreviewReady()
      if (cancelled) return
      console.log('🔔 Content ready. Rebuilding scroll map...')
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
      console.error('Error in handleEditorScroll:', error)
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
      console.error('Error in handlePreviewScroll:', error)
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

  // Attach scroll listeners - simplified approach without polling
  useEffect(() => {
    if (!isAnySplitMode || !isEditorReady || !previewRef.current) {
      console.log('⏭️  Skipping listener attachment:', {
        isAnySplitMode,
        isEditorReady,
        hasPreviewRef: !!previewRef.current
      })
      return
    }

    const editor = editorRef.current?.getEditor()
    if (!editor) {
      console.log('⏭️  Skipping listener attachment: no editor')
      return
    }

    console.log('🔄 Attaching scroll listeners directly...')

    // Attach listeners immediately - scroll map should be built by now
    try {
      const editorDisposable = editor.onDidScrollChange(handleEditorScroll)
      const previewElement = previewRef.current!
      previewElement.addEventListener('scroll', handlePreviewScroll)

      console.log('🔗 Scroll listeners attached successfully')
      console.log('📊 Current scroll map size:', scrollMapRef.current.length)

      return () => {
        console.log('🧹 Removing scroll listeners')
        editorDisposable.dispose()
        previewElement.removeEventListener('scroll', handlePreviewScroll)
      }
    } catch (error) {
      console.error('❌ Error attaching scroll listeners:', error)
      return undefined
    }
  }, [viewMode, currentFile?.path, isEditorReady, handleEditorScroll, handlePreviewScroll])

  const handleEditorMount = (_editor: monaco.editor.IStandaloneCodeEditor) => {
    console.log('✅ Editor mounted and ready, in mode:', viewMode)

    // Immediately build scroll map if in split mode
    if (viewMode === 'split' || viewMode === 'split-horizontal') {
      console.log('🔨 Triggering immediate scroll map build after editor mount in', viewMode)
      // Schedule it for next frame to ensure Monaco is fully ready
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            const map = buildScrollMap()
            scrollMapRef.current = map
            console.log(`📍 Scroll map built immediately after mount: ${map.length} entries`)
          } catch (error) {
            console.error('Error building scroll map immediately after mount:', error)
          }
        })
      })
    }

    setIsEditorReady(true)
  }

  const loadFile = async (filePath: string) => {
    console.log('Loading file:', filePath)
    setIsEditorReady(false) // Reset editor ready state when loading new file
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
    // Mark panel as dirty in global store (if panel id known)
    if (panelIdRef.current) {
      import('../../stores/useProjectStore').then(({ useProjectStore }) => {
        useProjectStore.getState().setEditorDirty(panelIdRef.current!, true)
      })
    }
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
      if (panelIdRef.current) {
        import('../../stores/useProjectStore').then(({ useProjectStore }) => {
          useProjectStore.getState().setEditorDirty(panelIdRef.current!, false)
        })
      }

      // Clear any external change detection since we just saved
      setExternalChangeDetected(false)
      setIsFileDeleted(false)

      if (isAutoSave) {
        // Show auto-save indicator briefly
        setTimeout(() => setIsAutoSaving(false), 1000)
      }
    } catch (error) {
      console.error('Error saving file:', error)
      setIsAutoSaving(false)
    } finally {
      // Resume file watching after save completes
      await window.api.fileWatch.resume(currentFile.path)
      isSavingRef.current = false
    }
  }

  // Cleanup: ensure panel is not marked dirty on unmount
  useEffect(() => {
    return () => {
      if (panelIdRef.current) {
        import('../../stores/useProjectStore').then(({ useProjectStore }) => {
          useProjectStore.getState().setEditorDirty(panelIdRef.current!, false)
        })
      }
    }
  }, [])

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
    }
  }

  /**
   * Handle file deletion
   */
  const handleFileDeleted = () => {
    console.log('🗑️  File deleted externally:', currentFile?.path)
    setIsFileDeleted(true)
    setExternalChangeDetected(false) // Clear conflict notification if shown
  }

  /**
   * Handle conflict resolution: Keep local version
   */
  const handleKeepLocal = () => {
    console.log('✅ User chose to keep local version')
    setExternalChangeDetected(false)
  }

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
   * Build scroll map: line → pixel positions
   * Maps editor line numbers to preview element positions
   *
   * CRITICAL FIX: Uses getBoundingClientRect() for accurate positioning
   * relative to the scrollable container, accounting for padding and margins.
   * Previously used offsetTop which didn't account for container padding.
   */
  const buildScrollMap = (): ScrollMapEntry[] => {
    console.log('🗺️  buildScrollMap() called')

    if (!editorRef.current || !previewRef.current) {
      console.log('⏭️  Skipping buildScrollMap: missing refs')
      return []
    }

    const editor = editorRef.current.getEditor()
    if (!editor) {
      console.log('⏭️  Skipping buildScrollMap: no editor')
      return []
    }

    const container = previewRef.current
    const containerRect = container.getBoundingClientRect()
    const containerScrollTop = container.scrollTop

    // Collect candidates using start/end ranges
    const nodeList = container.querySelectorAll('[data-line-start]')
    console.log(`🔍 Found ${nodeList.length} elements with data-line-start attribute`)

    // Use a map of line -> { previewOffset: number }
    // We'll emit a single mapping per line to keep source keys monotonic
    const lineToPreviewOffset = new Map<number, number>()

    nodeList.forEach((el) => {
      const startAttr = el.getAttribute('data-line-start')
      const endAttr = el.getAttribute('data-line-end')
      if (!startAttr) return

      const startLine = parseInt(startAttr, 10)
      const endLine = endAttr ? parseInt(endAttr, 10) : startLine
      if (isNaN(startLine)) return

      const rect = (el as HTMLElement).getBoundingClientRect()
      const topOffset = rect.top - containerRect.top + containerScrollTop
      const bottomOffset = rect.bottom - containerRect.top + containerScrollTop

      // For the start line of a block, prefer the smallest (top-most) offset
      const existingStart = lineToPreviewOffset.get(startLine)
      if (existingStart == null || topOffset < existingStart) {
        lineToPreviewOffset.set(startLine, topOffset)
      }

      // If the block spans multiple lines, add an entry for the end line using the bottom
      if (!isNaN(endLine) && endLine !== startLine) {
        const existingEnd = lineToPreviewOffset.get(endLine)
        // For the end line, prefer the largest (bottom-most) offset
        if (existingEnd == null || bottomOffset > existingEnd) {
          lineToPreviewOffset.set(endLine, bottomOffset)
        }
      }
    })

    // Build scroll map entries from the deduplicated lines
    const map: ScrollMapEntry[] = []
    for (const [line, previewOffset] of lineToPreviewOffset.entries()) {
      const editorOffset = editor.getTopForLineNumber(line)
      map.push({ line, editorOffset, previewOffset })
    }

    // Sort by line number to ensure source monotonicity
    map.sort((a, b) => a.line - b.line)

    // Enforce monotonic non-decreasing preview offsets to avoid jitter
    for (let i = 1; i < map.length; i++) {
      if (map[i].previewOffset < map[i - 1].previewOffset) {
        map[i].previewOffset = map[i - 1].previewOffset + 0.1 // epsilon
      }
    }

    console.log(`✅ buildScrollMap completed: ${map.length} entries`)
    return map
  }

  /**
   * Interpolate scroll position between known mapping points
   * Uses linear interpolation for smooth scrolling
   * CRITICAL: Handles end-of-document scrolling by calculating proportional offset
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
    if (left === 0) {
      // Before first entry: extrapolate using line through first two points (y = m x + b)
      const p1 = map[0]
      const p2 = map[1]
      const dx = p2[sourceKey] - p1[sourceKey]
      if (dx === 0) return p1[targetKey]
      const dy = p2[targetKey] - p1[targetKey]
      const m = dy / dx
      const b = p1[targetKey] - m * p1[sourceKey]
      return m * scrollTop + b
    }

    if (left >= map.length) {
      // After last entry: extrapolate using line through last two points (y = m x + b)
      const p2 = map[map.length - 1]
      const p1 = map[map.length - 2]
      const dx = p2[sourceKey] - p1[sourceKey]
      if (dx === 0) return p2[targetKey]
      const dy = p2[targetKey] - p1[targetKey]
      const m = dy / dx
      const b = p1[targetKey] - m * p1[sourceKey]
      return m * scrollTop + b
    }

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
          {/* HORIZONTAL SPLIT: Preview on top, Editor on bottom */}
          {viewMode === 'split-horizontal' && (
            <>
              <div
                className="preview-pane"
                style={{ height: `${dividerPositionHorizontal}%` }}
              >
                <MarkdownPreview key={`preview-${viewMode}`} ref={previewRef} content={currentFile.content} filePath={currentFile.path} />
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
                  <MarkdownPreview key={`preview-${viewMode}`} ref={previewRef} content={currentFile.content} filePath={currentFile.path} />
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
