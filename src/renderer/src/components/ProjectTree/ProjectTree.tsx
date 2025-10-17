import { useState, useEffect, useRef, useMemo } from 'react'
import { FilePlus, FolderPlus, FolderOpen, Replace, Trash, AlertTriangle, Edit, FileText, Files, RotateCw, X as CloseIcon } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import type { FilterMode } from '../../types/filters'
import { ProjectTreeNode } from './ProjectTreeNode'
import { ContextMenu, ContextMenuItem } from '../ContextMenu/ContextMenu'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import './ProjectTree.css'
import { showGlobalToast } from '../Toast/toastService'

interface ProjectTreeProps {
  onFileSelect: (filePath: string) => void
  showControlPanel: boolean
  filterMode: FilterMode
  onFilterModeChange: (mode: FilterMode) => void
}

export function ProjectTree({ onFileSelect, showControlPanel, filterMode, onFilterModeChange }: ProjectTreeProps) {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [files, setFiles] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const isInternalOperation = useRef(false)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [createFileError, setCreateFileError] = useState<string | null>(null)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [createFolderError, setCreateFolderError] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isSwitchingProject, setIsSwitchingProject] = useState(false)
  const initialLoadCompleteRef = useRef(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: FileNode
  } | null>(null)

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  // Load last project on mount
  useEffect(() => {
    const loadLastProject = async () => {
      try {
        setLoading(true)
        const lastPath = await window.api.file.getLastProjectPath()

        if (lastPath) {
          setProjectPath(lastPath)
          const fileTree = await window.api.file.readDirectory(lastPath)
          setFiles(fileTree)
          initialLoadCompleteRef.current = true
        }
      } catch (err) {
        console.error('Error loading last project:', err)
        // Don't show error to user, just fail silently
      } finally {
        setLoading(false)
      }
    }

    loadLastProject()
  }, [])

  // Listen for project change events from other components
  useEffect(() => {
    const unsubscribe = window.api.file.onProjectChanged(async (data) => {
      console.log('🌳 ProjectTree: Project changed event received:', data)

      // Clear UI state for new project
      setExpandedFolders(new Set())
      setSelectedFolder(null)
      setError(null)

      // Update project path and load new tree
      if (data.newPath) {
        setProjectPath(data.newPath)
        try {
          setLoading(true)
          const fileTree = await window.api.file.readDirectory(data.newPath)
          setFiles(fileTree)
          initialLoadCompleteRef.current = true
        } catch (err) {
          console.error('Error loading new project tree:', err)
          setError(err instanceof Error ? err.message : 'Failed to load project')
        } finally {
          setLoading(false)
        }
      } else {
        // Project was closed
        setProjectPath(null)
        setFiles([])
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Directory watching for auto-refresh
  useEffect(() => {
    if (!projectPath) return
    if (!initialLoadCompleteRef.current) return

    // Start watching the project directory
    window.api.directoryWatch.start(projectPath).catch((err) => {
      console.error('Failed to start directory watch:', err)
    })

      // Listen for directory changes
      const unsubscribeChanged = window.api.directoryWatch.onDirectoryChanged((data) => {
      // Only refresh if not during our own internal operations
      if (!isInternalOperation.current) {
        console.log(`📁 Directory changed, refreshing project tree... (${data.eventCount} events)`)
        refreshProjectTree()
      }
    })

    // Listen for project deletion
    const unsubscribeDeleted = window.api.directoryWatch.onProjectDeleted(() => {
      setError('Project folder no longer exists')
      setProjectPath(null)
      setFiles([])
      setExpandedFolders(new Set())
    })

    // Listen for errors
    const unsubscribeError = window.api.directoryWatch.onDirectoryError((data) => {
      console.error('Directory watch error:', data.error)
    })

    // Cleanup on unmount or when project changes
    return () => {
      window.api.directoryWatch.stop(projectPath)
      unsubscribeChanged()
      unsubscribeDeleted()
      unsubscribeError()
    }
  }, [projectPath])

  // no watch depth control in UI

  const switchTokenRef = useRef(0)

  const handleOpenProject = async () => {
    try {
      setIsSwitchingProject(true)
      setError(null)
      // Check for unsaved editors
      const hasDirty = await import('../../stores/useProjectStore')
        .then(({ useProjectStore }) => useProjectStore.getState().hasDirtyEditors())
        .catch(() => false)

      // Terminal recent activity check (3s window)
      const terminalBusy = await import('../../stores/useTerminalStore')
        .then(({ useTerminalStore }) => {
          const store = useTerminalStore.getState()
          return store.hasUserInteracted() && store.isRecentlyActive(20000)
        })
        .catch(() => false)

      if (hasDirty || terminalBusy) {
        return setConfirmDialog({
          title: hasDirty ? 'Unsaved Changes' : 'Active Terminal Session',
          message: hasDirty
            ? 'You have unsaved changes. Discard and switch project?'
            : 'Terminal shows recent activity. Stop it and switch project?',
          onConfirm: async () => {
            setConfirmDialog(null)
            // Graceful signal to terminal if active
            try {
              const { useTerminalStore } = await import('../../stores/useTerminalStore')
              const tid = useTerminalStore.getState().getActiveTerminalId()
              if (tid) {
                // Send Ctrl+C signal
                window.api.terminal.write(tid, '\u0003')
                await new Promise((r) => setTimeout(r, 300))
                // If no new activity, mark idle
                if (!useTerminalStore.getState().isRecentlyActiveId(tid, 300)) {
                  useTerminalStore.getState().clearActivity(tid)
                }
              }
            } catch (e) {
              console.warn('Failed to signal terminal before switching project:', e)
            }
            const currentToken = ++switchTokenRef.current
            const path = await window.api.file.openProject()
            if (path && currentToken === switchTokenRef.current) {
              setProjectPath(path)
              const fileTree = await window.api.file.readDirectory(path)
              setFiles(fileTree)
              showGlobalToast({ type: 'success', title: 'Project Opened', message: path })
            }
            setIsSwitchingProject(false)
          }
        })
      }
      const path = await window.api.file.openProject()

      if (path) {
        setProjectPath(path)
        const fileTree = await window.api.file.readDirectory(path)
        setFiles(fileTree)
        showGlobalToast({ type: 'success', title: 'Project Opened', message: path })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open project')
      console.error('Error opening project:', err)
      showGlobalToast({ type: 'error', title: 'Open Project Failed', message: String(err instanceof Error ? err.message : err) })
    } finally {
      setIsSwitchingProject(false)
    }
  }

  const handleCloseProject = async () => {
    try {
      setIsSwitchingProject(true)
      setError(null)
      const hasDirty = await import('../../stores/useProjectStore')
        .then(({ useProjectStore }) => useProjectStore.getState().hasDirtyEditors())
        .catch(() => false)
      const terminalBusy = await import('../../stores/useTerminalStore')
        .then(({ useTerminalStore }) => {
          const store = useTerminalStore.getState()
          return store.hasUserInteracted() && store.isRecentlyActive(20000)
        })
        .catch(() => false)
      if (hasDirty || terminalBusy) {
        return setConfirmDialog({
          title: hasDirty ? 'Unsaved Changes' : 'Active Terminal Session',
          message: hasDirty
            ? 'You have unsaved changes. Discard and close project?'
            : 'Terminal shows recent activity. Stop it and close project?',
          onConfirm: async () => {
            setConfirmDialog(null)
            try {
              const { useTerminalStore } = await import('../../stores/useTerminalStore')
              const tid = useTerminalStore.getState().getActiveTerminalId()
              if (tid) {
                window.api.terminal.write(tid, '\u0003')
                await new Promise((r) => setTimeout(r, 300))
                if (!useTerminalStore.getState().isRecentlyActiveId(tid, 300)) {
                  useTerminalStore.getState().clearActivity(tid)
                }
              }
            } catch (e) {
              console.warn('Failed to signal terminal before closing project:', e)
            }
            const currentToken = ++switchTokenRef.current
            const ok = await window.api.file.closeProject()
            if (ok && currentToken === switchTokenRef.current) {
              setProjectPath(null)
              setFiles([])
              setExpandedFolders(new Set())
              showGlobalToast({ type: 'info', title: 'Project Closed', message: 'Current project has been closed.' })
            }
            setIsSwitchingProject(false)
          }
        })
      }
      const ok = await window.api.file.closeProject()
      if (ok) {
        setProjectPath(null)
        setFiles([])
        setExpandedFolders(new Set())
        showGlobalToast({ type: 'info', title: 'Project Closed', message: 'Current project has been closed.' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close project')
      console.error('Error closing project:', err)
      showGlobalToast({ type: 'error', title: 'Close Project Failed', message: String(err instanceof Error ? err.message : err) })
    } finally {
      setIsSwitchingProject(false)
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

  const refreshProjectTree = async () => {
    if (!projectPath) return
    try {
      const fileTree = await window.api.file.readDirectory(projectPath)
      setFiles(fileTree)
      // Expanded folders are preserved automatically via state
    } catch (err) {
      console.error('Error refreshing project tree:', err)
    }
  }

  /**
   * Check if a file is a markdown file
   */
  const isMarkdownFile = (fileName: string): boolean => {
    const lower = fileName.toLowerCase()
    return lower.endsWith('.md') || lower.endsWith('.markdown')
  }

  /**
   * Recursively filter file tree to show only markdown files and folders containing them
   */
  const filterMarkdownFiles = (nodes: FileNode[]): FileNode[] => {
    return nodes
      .map(node => {
        if (node.type === 'file') {
          // Keep only markdown files
          return isMarkdownFile(node.name) ? node : null
        } else {
          // For directories, recursively filter children
          if (node.children && node.children.length > 0) {
            const filteredChildren = filterMarkdownFiles(node.children)

            // Keep directory only if it has markdown children
            if (filteredChildren.length > 0) {
              return {
                ...node,
                children: filteredChildren
              }
            }
          }
          return null
        }
      })
      .filter((node): node is FileNode => node !== null)
  }

  /**
   * Apply filtering based on current filter mode
   */
  const filteredFiles = useMemo(() => {
    if (filterMode === 'all') {
      return files
    } else {
      return filterMarkdownFiles(files)
    }
  }, [files, filterMode])

  const handleToggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath)
      } else {
        newSet.add(folderPath)
      }
      return newSet
    })
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

      // Mark as internal operation and pause directory watcher
      isInternalOperation.current = true
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      const createdFilePath = await window.api.file.createFile(targetPath, newFileName)

      // Refresh project tree
      await refreshProjectTree()

      // Resume directory watcher
      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false

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

      // Make sure to resume watcher even on error
      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false
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

      // Mark as internal operation and pause directory watcher
      isInternalOperation.current = true
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      await window.api.file.createFolder(targetPath, newFolderName)

      // Refresh project tree
      await refreshProjectTree()

      // Resume directory watcher
      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false

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

      // Make sure to resume watcher even on error
      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false
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
  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
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

          // Mark as internal operation and pause directory watcher
          isInternalOperation.current = true
          if (projectPath) {
            await window.api.directoryWatch.pause(projectPath)
          }

          await window.api.file.deleteFile(filePath)
          await refreshProjectTree()

          // Resume directory watcher
          if (projectPath) {
            await window.api.directoryWatch.resume(projectPath)
          }
          isInternalOperation.current = false

          setConfirmDialog(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to delete file')
          console.error('Error deleting file:', err)

          // Make sure to resume watcher even on error
          if (projectPath) {
            await window.api.directoryWatch.resume(projectPath)
          }
          isInternalOperation.current = false
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

          // Mark as internal operation and pause directory watcher
          isInternalOperation.current = true
          if (projectPath) {
            await window.api.directoryWatch.pause(projectPath)
          }

          await window.api.file.deleteFolder(folderPath)
          await refreshProjectTree()

          // Resume directory watcher
          if (projectPath) {
            await window.api.directoryWatch.resume(projectPath)
          }
          isInternalOperation.current = false

          setConfirmDialog(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to delete folder')
          console.error('Error deleting folder:', err)

          // Make sure to resume watcher even on error
          if (projectPath) {
            await window.api.directoryWatch.resume(projectPath)
          }
          isInternalOperation.current = false
        } finally {
          setLoading(false)
        }
      }
    })
    setContextMenu(null)
  }

  const handleRename = (path: string, currentName: string) => {
    setRenamingPath(path)
    setRenameValue(currentName)
    setRenameError(null)
    setIsRenaming(true)
    setContextMenu(null)
  }

  const handleCancelRename = () => {
    setIsRenaming(false)
    setRenamingPath(null)
    setRenameValue('')
    setRenameError(null)
  }

  const handleRenameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRenameValue(e.target.value)
    if (renameError) {
      setRenameError(null)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleConfirmRename()
    } else if (e.key === 'Escape') {
      handleCancelRename()
    }
  }

  const handleConfirmRename = async () => {
    if (!renameValue.trim()) {
      setRenameError('Please enter a name')
      return
    }

    if (!renamingPath) return

    try {
      setLoading(true)
      setRenameError(null)

      // Mark as internal operation and pause directory watcher
      isInternalOperation.current = true
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      await window.api.file.rename(renamingPath, renameValue)

      // Refresh project tree
      await refreshProjectTree()

      // Resume directory watcher
      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false

      // Reset state
      setIsRenaming(false)
      setRenamingPath(null)
      setRenameValue('')
    } catch (err) {
      // Clean up error message for better UX
      let errorMessage = 'Failed to rename'
      if (err instanceof Error) {
        errorMessage = err.message.replace(/^Error invoking remote method.*?Error:\s*/i, '')

        if (errorMessage.includes('already exists')) {
          errorMessage = 'An item with this name already exists'
        }
      }
      setRenameError(errorMessage)
      console.error('Error renaming:', err)

      // Make sure to resume watcher even on error
      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false
    } finally {
      setLoading(false)
    }
  }

  const getContextMenuItems = (node: FileNode): ContextMenuItem[] => {
    if (node.type === 'directory') {
      return [
        {
          label: 'New File',
          icon: <FilePlus size={14} strokeWidth={2} />,
          action: () => handleNewFileInFolder(node.path)
        },
        {
          label: 'New Folder',
          icon: <FolderPlus size={14} strokeWidth={2} />,
          action: () => handleNewFolderInFolder(node.path)
        },
        {
          label: 'Rename',
          icon: <Edit size={14} strokeWidth={2} />,
          action: () => handleRename(node.path, node.name)
        },
        { separator: true } as ContextMenuItem,
        {
          label: 'Delete',
          icon: <Trash size={14} strokeWidth={2} />,
          danger: true,
          action: () => handleDeleteFolder(node.path, node.name)
        }
      ]
    } else {
      return [
        {
          label: 'Rename',
          icon: <Edit size={14} strokeWidth={2} />,
          action: () => handleRename(node.path, node.name)
        },
        { separator: true } as ContextMenuItem,
        {
          label: 'Delete',
          icon: <Trash size={14} strokeWidth={2} />,
          danger: true,
          action: () => handleDeleteFile(node.path, node.name)
        }
      ]
    }
  }

  return (
    <div className="project-tree">
      {error && (
        <div className="project-tree-error">
          {error}
        </div>
      )}

      <div className="project-tree-path">
        <span className="project-name">{projectPath ? projectPath.split('/').pop() : 'No project open'}</span>
        <div className="project-tree-actions">
          <button
            className="icon-btn"
            onClick={handleOpenProject}
            disabled={isSwitchingProject}
            title={projectPath ? 'Change project' : 'Open project'}
          >
            {isSwitchingProject ? (
              <RotateCw size={14} strokeWidth={2} className="spin" />
            ) : projectPath ? (
              <Replace size={14} strokeWidth={2} />
            ) : (
              <FolderOpen size={14} strokeWidth={2} />
            )}
          </button>
          {projectPath && (
            <button
              className="icon-btn"
              onClick={handleCloseProject}
              disabled={isSwitchingProject}
              title="Close project"
            >
              <CloseIcon size={14} strokeWidth={2} />
            </button>
          )}
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

      {isRenaming && (
        <div className="new-file-dialog">
          <div className="new-file-content">
            <h4>Rename</h4>
            <input
              type="text"
              className={`new-file-input ${renameError ? 'error' : ''}`}
              placeholder="Enter new name"
              value={renameValue}
              onChange={handleRenameChange}
              onKeyDown={handleRenameKeyDown}
              autoFocus
            />
            {renameError && (
              <div className="new-file-error">
                <span className="error-icon">
                  <AlertTriangle size={14} strokeWidth={2} />
                </span>
                <span className="error-message">{renameError}</span>
              </div>
            )}
            <div className="new-file-actions">
              <button onClick={handleConfirmRename} disabled={!renameValue.trim()}>
                Rename
              </button>
              <button onClick={handleCancelRename}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Control Panel */}
      {showControlPanel && (
        <div className="project-control-panel">
          <div className="control-panel-content">
          <div className="control-panel-section">
            <div className="control-panel-label">File Filter</div>
            <div className="filter-options">
                <button
                  className={`filter-option ${filterMode === 'all' ? 'active' : ''}`}
                  onClick={() => onFilterModeChange('all')}
                  title="Show all files and folders"
                >
                  <Files size={14} />
                  <span>All Files</span>
                </button>
                <button
                  className={`filter-option ${filterMode === 'markdown' ? 'active' : ''}`}
                  onClick={() => onFilterModeChange('markdown')}
                  title="Show only markdown files and their folders"
                >
                  <FileText size={14} />
                  <span>Markdown Only</span>
                </button>
            </div>
          </div>
          {/* Watching controls removed from UI by request */}
        </div>
      </div>
    )}

      <div className="project-tree-content">
        {filteredFiles.length > 0 ? (
          filteredFiles.map((node) => (
            <ProjectTreeNode
              key={node.path}
              node={node}
              level={0}
              onFileClick={handleFileClick}
              onContextMenu={handleContextMenu}
              selectedFolder={selectedFolder}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolder}
            />
          ))
        ) : (
          <div className="project-tree-empty">
            {projectPath ? (filterMode === 'markdown' ? 'No markdown files found' : 'No files found') : 'Open a project to get started'}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
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
