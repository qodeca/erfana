import { useState } from 'react'
import { FilePlus, FolderPlus, FolderOpen, Replace, Trash, AlertTriangle } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import { FileTreeNode } from './FileTreeNode'
import { ContextMenu, ContextMenuItem } from '../ContextMenu/ContextMenu'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import './FileTree.css'

interface FileTreeProps {
  onFileSelect: (filePath: string) => void
}

export function FileTree({ onFileSelect }: FileTreeProps) {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [files, setFiles] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [createFileError, setCreateFileError] = useState<string | null>(null)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [createFolderError, setCreateFolderError] = useState<string | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    elementRect: DOMRect
    node: FileNode
  } | null>(null)

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

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

  const handleNewFile = () => {
    setIsCreatingFile(true)
    setNewFileName('')
    setCreateFileError(null)
  }

  const handleCancelNewFile = () => {
    setIsCreatingFile(false)
    setNewFileName('')
    setCreateFileError(null)
  }

  const handleNewFolder = () => {
    setIsCreatingFolder(true)
    setNewFolderName('')
    setCreateFolderError(null)
  }

  const handleCancelNewFolder = () => {
    setIsCreatingFolder(false)
    setNewFolderName('')
    setCreateFolderError(null)
  }

  const handleFileNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewFileName(e.target.value)
    // Clear error as user types
    if (createFileError) {
      setCreateFileError(null)
    }
  }

  const handleFolderNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewFolderName(e.target.value)
    // Clear error as user types
    if (createFolderError) {
      setCreateFolderError(null)
    }
  }

  const refreshFileTree = async () => {
    if (!projectPath) return
    try {
      const fileTree = await window.api.file.readDirectory(projectPath)
      setFiles(fileTree)
    } catch (err) {
      console.error('Error refreshing file tree:', err)
    }
  }

  const handleCreateFile = async () => {
    if (!newFileName.trim()) {
      setCreateFileError('Please enter a file name')
      return
    }

    try {
      setLoading(true)
      setCreateFileError(null)

      // Use selected folder or project root
      const targetPath = selectedFolder || projectPath
      if (!targetPath) {
        setCreateFileError('No project open')
        return
      }

      const createdFilePath = await window.api.file.createFile(targetPath, newFileName)

      // Refresh file tree
      await refreshFileTree()

      // Open the newly created file
      onFileSelect(createdFilePath)

      // Reset state
      setIsCreatingFile(false)
      setNewFileName('')
      setSelectedFolder(null)
    } catch (err) {
      // Clean up error message for better UX
      let errorMessage = 'Failed to create file'
      if (err instanceof Error) {
        // Remove technical IPC prefix
        errorMessage = err.message.replace(/^Error invoking remote method.*?Error:\s*/i, '')

        // Make common errors more user-friendly
        if (errorMessage.includes('already exists')) {
          errorMessage = 'A file with this name already exists'
        }
      }
      setCreateFileError(errorMessage)
      console.error('Error creating file:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setCreateFolderError('Please enter a folder name')
      return
    }

    try {
      setLoading(true)
      setCreateFolderError(null)

      // Use selected folder or project root
      const targetPath = selectedFolder || projectPath
      if (!targetPath) {
        setCreateFolderError('No project open')
        return
      }

      await window.api.file.createFolder(targetPath, newFolderName)

      // Refresh file tree
      await refreshFileTree()

      // Reset state
      setIsCreatingFolder(false)
      setNewFolderName('')
      setSelectedFolder(null)
    } catch (err) {
      // Clean up error message for better UX
      let errorMessage = 'Failed to create folder'
      if (err instanceof Error) {
        // Remove technical IPC prefix
        errorMessage = err.message.replace(/^Error invoking remote method.*?Error:\s*/i, '')

        // Make common errors more user-friendly
        if (errorMessage.includes('already exists')) {
          errorMessage = 'A folder with this name already exists'
        }
      }
      setCreateFolderError(errorMessage)
      console.error('Error creating folder:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleFileKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCreateFile()
    } else if (e.key === 'Escape') {
      handleCancelNewFile()
    }
  }

  const handleFolderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCreateFolder()
    } else if (e.key === 'Escape') {
      handleCancelNewFolder()
    }
  }

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, node: FileNode, elementRect: DOMRect) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      elementRect,
      node
    })
  }

  const handleCloseContextMenu = () => {
    setContextMenu(null)
  }

  const handleNewFileInFolder = (folderPath: string) => {
    setSelectedFolder(folderPath)
    setIsCreatingFile(true)
    setNewFileName('')
    setCreateFileError(null)
    setContextMenu(null)
  }

  const handleNewFolderInFolder = (folderPath: string) => {
    setSelectedFolder(folderPath)
    setIsCreatingFolder(true)
    setNewFolderName('')
    setCreateFolderError(null)
    setContextMenu(null)
  }

  const handleDeleteFile = async (filePath: string, fileName: string) => {
    setConfirmDialog({
      title: 'Delete File',
      message: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          setLoading(true)
          setError(null)
          await window.api.file.deleteFile(filePath)
          await refreshFileTree()
          setConfirmDialog(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to delete file')
          console.error('Error deleting file:', err)
        } finally {
          setLoading(false)
        }
      }
    })
    setContextMenu(null)
  }

  const handleDeleteFolder = async (folderPath: string, folderName: string) => {
    setConfirmDialog({
      title: 'Delete Folder',
      message: `Are you sure you want to delete "${folderName}" and all its contents? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          setLoading(true)
          setError(null)
          await window.api.file.deleteFolder(folderPath)
          await refreshFileTree()
          setConfirmDialog(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to delete folder')
          console.error('Error deleting folder:', err)
        } finally {
          setLoading(false)
        }
      }
    })
    setContextMenu(null)
  }

  const getContextMenuItems = (node: FileNode): ContextMenuItem[] => {
    if (node.type === 'directory') {
      return [
        {
          label: 'New File...',
          icon: <FilePlus size={14} strokeWidth={2} />,
          action: () => handleNewFileInFolder(node.path)
        },
        {
          label: 'New Folder...',
          icon: <FolderPlus size={14} strokeWidth={2} />,
          action: () => handleNewFolderInFolder(node.path)
        },
        { separator: true } as ContextMenuItem,
        {
          label: 'Delete Folder',
          icon: <Trash size={14} strokeWidth={2} />,
          danger: true,
          action: () => handleDeleteFolder(node.path, node.name)
        }
      ]
    } else {
      return [
        {
          label: 'Delete File',
          icon: <Trash size={14} strokeWidth={2} />,
          danger: true,
          action: () => handleDeleteFile(node.path, node.name)
        }
      ]
    }
  }

  return (
    <div className="file-tree">
      {error && (
        <div className="file-tree-error">
          {error}
        </div>
      )}

      <div className="file-tree-path">
        <span className="project-name">
          {projectPath ? projectPath.split('/').pop() : 'No project open'}
        </span>
        <div className="file-tree-actions">
          <button
            className="icon-btn"
            onClick={handleOpenProject}
            disabled={loading}
            title={projectPath ? 'Change project' : 'Open project'}
          >
            {projectPath ? (
              <Replace size={14} strokeWidth={2} />
            ) : (
              <FolderOpen size={14} strokeWidth={2} />
            )}
          </button>
          {projectPath && (
            <>
              <button
                className="icon-btn"
                onClick={handleNewFile}
                disabled={loading || isCreatingFile || isCreatingFolder}
                title="Create new markdown file"
              >
                <FilePlus size={14} strokeWidth={2} />
              </button>
              <button
                className="icon-btn"
                onClick={handleNewFolder}
                disabled={loading || isCreatingFile || isCreatingFolder}
                title="Create new folder"
              >
                <FolderPlus size={14} strokeWidth={2} />
              </button>
            </>
          )}
        </div>
      </div>

      {isCreatingFile && (
        <div className="new-file-dialog">
          <div className="new-file-content">
            <h4>Create New File</h4>
            {selectedFolder && (
              <p className="target-folder">
                in: {selectedFolder.replace(projectPath || '', '') || '/'}
              </p>
            )}
            <input
              type="text"
              className={`new-file-input ${createFileError ? 'error' : ''}`}
              placeholder="Enter file name (e.g., notes.md)"
              value={newFileName}
              onChange={handleFileNameChange}
              onKeyDown={handleFileKeyDown}
              autoFocus
            />
            {createFileError && (
              <div className="new-file-error">
                <span className="error-icon">
                  <AlertTriangle size={14} strokeWidth={2} />
                </span>
                <span className="error-message">{createFileError}</span>
              </div>
            )}
            <div className="new-file-actions">
              <button onClick={handleCreateFile} disabled={!newFileName.trim()}>
                Create
              </button>
              <button onClick={handleCancelNewFile}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {isCreatingFolder && (
        <div className="new-file-dialog">
          <div className="new-file-content">
            <h4>Create New Folder</h4>
            {selectedFolder && (
              <p className="target-folder">
                in: {selectedFolder.replace(projectPath || '', '') || '/'}
              </p>
            )}
            <input
              type="text"
              className={`new-file-input ${createFolderError ? 'error' : ''}`}
              placeholder="Enter folder name"
              value={newFolderName}
              onChange={handleFolderNameChange}
              onKeyDown={handleFolderKeyDown}
              autoFocus
            />
            {createFolderError && (
              <div className="new-file-error">
                <span className="error-icon">
                  <AlertTriangle size={14} strokeWidth={2} />
                </span>
                <span className="error-message">{createFolderError}</span>
              </div>
            )}
            <div className="new-file-actions">
              <button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                Create
              </button>
              <button onClick={handleCancelNewFolder}>Cancel</button>
            </div>
          </div>
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
              onContextMenu={handleContextMenu}
              selectedFolder={selectedFolder}
            />
          ))
        ) : (
          <div className="file-tree-empty">
            {projectPath ? 'No files found' : 'Open a project to get started'}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          elementRect={contextMenu.elementRect}
          items={getContextMenuItems(contextMenu.node)}
          onClose={handleCloseContextMenu}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel="Delete"
          danger={true}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}
