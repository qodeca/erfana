import { useState, useEffect } from 'react'
import { FileEdit, Columns2, Eye, Save as SaveIcon } from 'lucide-react'
import { IDockviewPanelProps } from 'dockview'
import { MonacoMarkdownEditor } from '../Editor/MonacoMarkdownEditor'
import { MarkdownPreview } from '../Editor/MarkdownPreview'
import './MarkdownEditorPanel.css'

interface EditorFile {
  path: string
  content: string
  modified: boolean
}

export function MarkdownEditorPanel(props: IDockviewPanelProps<{ filePath?: string }>) {
  const [files, setFiles] = useState<Map<string, EditorFile>>(new Map())
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split')
  const [selectedText, setSelectedText] = useState<string>('')

  // Load file when panel receives a file path
  useEffect(() => {
    const filePath = props.params?.filePath
    if (filePath && !files.has(filePath)) {
      loadFile(filePath)
    }
  }, [props.params?.filePath])

  const loadFile = async (filePath: string) => {
    try {
      const content = await window.api.file.readFile(filePath)
      const newFile: EditorFile = {
        path: filePath,
        content,
        modified: false
      }
      setFiles(new Map(files.set(filePath, newFile)))
      setCurrentFilePath(filePath)
    } catch (error) {
      console.error('Error loading file:', error)
    }
  }

  const handleContentChange = (newContent: string) => {
    if (!currentFilePath) return

    const currentFile = files.get(currentFilePath)
    if (!currentFile) return

    const updatedFile: EditorFile = {
      ...currentFile,
      content: newContent,
      modified: true
    }

    setFiles(new Map(files.set(currentFilePath, updatedFile)))
  }

  const handleSave = async () => {
    if (!currentFilePath) return

    const currentFile = files.get(currentFilePath)
    if (!currentFile) return

    try {
      await window.api.file.writeFile(currentFilePath, currentFile.content)
      const updatedFile: EditorFile = {
        ...currentFile,
        modified: false
      }
      setFiles(new Map(files.set(currentFilePath, updatedFile)))
    } catch (error) {
      console.error('Error saving file:', error)
    }
  }

  const currentFile = currentFilePath ? files.get(currentFilePath) : null
  const fileName = currentFilePath ? currentFilePath.split('/').pop() : 'No file open'

  return (
    <div className="markdown-editor-panel">
      <div className="editor-toolbar">
        <div className="editor-file-info">
          <span className="file-name">{fileName}</span>
          {currentFile?.modified && <span className="modified-indicator">●</span>}
        </div>

        <div className="editor-controls">
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

          <div className="toolbar-separator" />

          <button
            className="save-btn"
            onClick={handleSave}
            disabled={!currentFile?.modified}
            title="Save (Cmd/Ctrl+S)"
          >
            <SaveIcon size={16} strokeWidth={2} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {currentFile ? (
        <div className={`editor-content view-mode-${viewMode}`}>
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div className="editor-pane">
              <MonacoMarkdownEditor
                value={currentFile.content}
                onChange={handleContentChange}
                filePath={currentFile.path}
                onSelectionChange={setSelectedText}
              />
            </div>
          )}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className="preview-pane">
              <MarkdownPreview content={currentFile.content} />
            </div>
          )}
        </div>
      ) : (
        <div className="editor-empty">
          <p>No file open</p>
          <p className="hint">Select a markdown file from the file explorer to start editing</p>
        </div>
      )}

      {selectedText && (
        <div className="selection-info">
          {selectedText.length} characters selected
        </div>
      )}
    </div>
  )
}
