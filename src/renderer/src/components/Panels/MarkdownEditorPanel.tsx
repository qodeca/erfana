import { useState, useEffect, useRef, useMemo } from 'react'
import { FileEdit, Columns2, Eye, Save as SaveIcon, Bold, Italic, Code, Link, Image, Heading1, List, ListOrdered, Strikethrough } from 'lucide-react'
import { IDockviewPanelProps } from 'dockview'
import { MonacoMarkdownEditor, MonacoEditorHandle } from '../Editor/MonacoMarkdownEditor'
import { MarkdownPreview } from '../Editor/MarkdownPreview'
import { ResizableDivider } from '../Editor/ResizableDivider'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
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
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split')
  const [selectedText, setSelectedText] = useState<string>('')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const [dividerPosition, setDividerPosition] = useState<number>(() => {
    // Load from localStorage, default to 50%
    const saved = localStorage.getItem('markdown-editor-divider-position')
    return saved ? parseFloat(saved) : 50
  })
  const editorRef = useRef<MonacoEditorHandle>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

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
    const title = currentFile.modified ? `● ${fileName}` : fileName
    props.api.setTitle(title)
  }, [currentFile?.modified, currentFile?.path])

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

  const loadFile = async (filePath: string) => {
    console.log('Loading file:', filePath)
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

    try {
      if (isAutoSave) {
        setIsAutoSaving(true)
      }

      await window.api.file.writeFile(currentFile.path, currentFile.content)
      setCurrentFile({
        ...currentFile,
        modified: false
      })

      if (isAutoSave) {
        // Show auto-save indicator briefly
        setTimeout(() => setIsAutoSaving(false), 1000)
      }
    } catch (error) {
      console.error('Error saving file:', error)
      setIsAutoSaving(false)
    }
  }

  const handleDividerResize = (newPosition: number) => {
    setDividerPosition(newPosition)
    localStorage.setItem('markdown-editor-divider-position', newPosition.toString())
  }

  return (
    <div className="markdown-editor-panel">
      <div className="editor-toolbar">
        <div className="editor-file-info">
          {currentFile?.modified && <span className="modified-indicator">●</span>}
        </div>

        <div className="editor-controls">
          {isAutoSaving && <span className="auto-save-indicator">Auto-saving...</span>}
          <button
            className="save-btn"
            onClick={() => handleSave(false)}
            disabled={!currentFile?.modified}
            title="Save (Cmd/Ctrl+S)"
          >
            <SaveIcon size={16} strokeWidth={2} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {currentFile && (
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
      )}

      {currentFile ? (
        <div className={`editor-content view-mode-${viewMode}`}>
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div
              className="editor-pane"
              style={viewMode === 'split' ? { width: `${dividerPosition}%` } : undefined}
            >
              <MonacoMarkdownEditor
                key={currentFile.path}
                ref={editorRef}
                value={currentFile.content}
                onChange={handleContentChange}
                filePath={currentFile.path}
                onSelectionChange={setSelectedText}
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
              <MarkdownPreview content={currentFile.content} filePath={currentFile.path} />
            </div>
          )}
        </div>
      ) : (
        <div className="editor-empty">
          <p>No file open</p>
          <p className="hint">Select a markdown file from the file explorer to start editing</p>
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
