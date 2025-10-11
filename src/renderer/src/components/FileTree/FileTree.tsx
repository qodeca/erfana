import { useState, useEffect } from 'react'
import type { FileNode } from '../../../../preload/index'
import { FileTreeNode } from './FileTreeNode'
import './FileTree.css'

interface FileTreeProps {
  onFileSelect: (filePath: string) => void
}

export function FileTree({ onFileSelect }: FileTreeProps) {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [files, setFiles] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenProject = async () => {
    try {
      setLoading(true)
      setError(null)
      const path = await window.api.file.openProject()

      if (path) {
        setProjectPath(path)
        const fileTree = await window.api.file.readDirectory(path)
        setFiles(fileTree)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open project')
      console.error('Error opening project:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleFileClick = (filePath: string) => {
    onFileSelect(filePath)
  }

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <button
          className="open-project-btn"
          onClick={handleOpenProject}
          disabled={loading}
        >
          {loading ? 'Opening...' : projectPath ? 'Change Project' : 'Open Project'}
        </button>
      </div>

      {error && (
        <div className="file-tree-error">
          {error}
        </div>
      )}

      {projectPath && (
        <div className="file-tree-path">
          {projectPath.split('/').pop()}
        </div>
      )}

      <div className="file-tree-content">
        {files.length > 0 ? (
          files.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              level={0}
              onFileClick={handleFileClick}
            />
          ))
        ) : (
          <div className="file-tree-empty">
            {projectPath ? 'No files found' : 'Open a project to get started'}
          </div>
        )}
      </div>
    </div>
  )
}
