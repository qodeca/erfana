import { useState, useEffect, useRef, useMemo } from 'react'
import { FilePlus, FolderPlus, FolderOpen, Replace, Trash, Edit, FileText, Files, RotateCw, X as CloseIcon } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import type { FilterMode } from '../../types/filters'
import { ProjectTreeNode } from './ProjectTreeNode'
import { ContextMenu, ContextMenuItem } from '../ContextMenu/ContextMenu'
import { useDialog } from '../Dialog'
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
  const [isSwitchingProject, setIsSwitchingProject] = useState(false)
  const initialLoadCompleteRef = useRef(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: FileNode
  } | null>(null)

  // New unified dialog system
  const { showConfirm, showRename, showNewFile, showNewFolder } = useDialog()

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
        const confirmed = await showConfirm({
          title: hasDirty ? 'Unsaved Changes' : 'Active Terminal Session',
          message: hasDirty
            ? 'You have unsaved changes. Discard and switch project?'
            : 'Terminal shows recent activity. Stop it and switch project?',
          confirmLabel: 'Switch Anyway',
          danger: true
        })

        if (!confirmed) {
          setIsSwitchingProject(false)
          return
        }

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
      }

      const currentToken = ++switchTokenRef.current
      const path = await window.api.file.openProject()

      if (path && currentToken === switchTokenRef.current) {
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
        const confirmed = await showConfirm({
          title: hasDirty ? 'Unsaved Changes' : 'Active Terminal Session',
          message: hasDirty
            ? 'You have unsaved changes. Discard and close project?'
            : 'Terminal shows recent activity. Stop it and close project?',
          confirmLabel: 'Close Anyway',
          danger: true
        })

        if (!confirmed) {
          setIsSwitchingProject(false)
          return
        }

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
      }

      const currentToken = ++switchTokenRef.current
      const ok = await window.api.file.closeProject()
      if (ok && currentToken === switchTokenRef.current) {
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

  const handleNewFile = async () => {
    const targetPath = selectedFolder || projectPath
    if (!targetPath) return

    const relativePath = targetPath.replace(projectPath || '', '') || '/'
    const fileName = await showNewFile({
      title: 'Create New File',
      message: '',
      parentPath: relativePath,
      inputPlaceholder: 'notes.md'
    })

    if (!fileName) return

    try {
      setLoading(true)
      isInternalOperation.current = true
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      const createdFilePath = await window.api.file.createFile(targetPath, fileName)
      await refreshProjectTree()

      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false

      onFileSelect(createdFilePath)
      setSelectedFolder(null)
    } catch (err) {
      let errorMessage = 'Failed to create file'
      if (err instanceof Error) {
        errorMessage = err.message.replace(/^Error invoking remote method.*?Error:\s*/i, '')
        if (errorMessage.includes('already exists')) {
          errorMessage = 'A file with this name already exists'
        }
      }
      showGlobalToast({ type: 'error', title: 'Operation Failed', message: errorMessage })
      console.error('Error creating file:', err)

      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false
    } finally {
      setLoading(false)
    }
  }

  const handleNewFolder = async () => {
    const targetPath = selectedFolder || projectPath
    if (!targetPath) return

    const relativePath = targetPath.replace(projectPath || '', '') || '/'
    const folderName = await showNewFolder({
      title: 'Create New Folder',
      message: '',
      parentPath: relativePath,
      inputPlaceholder: 'new-folder'
    })

    if (!folderName) return

    try {
      setLoading(true)
      isInternalOperation.current = true
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      await window.api.file.createFolder(targetPath, folderName)
      await refreshProjectTree()

      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false

      setSelectedFolder(null)
    } catch (err) {
      let errorMessage = 'Failed to create folder'
      if (err instanceof Error) {
        errorMessage = err.message.replace(/^Error invoking remote method.*?Error:\s*/i, '')
        if (errorMessage.includes('already exists')) {
          errorMessage = 'A folder with this name already exists'
        }
      }
      showGlobalToast({ type: 'error', title: 'Operation Failed', message: errorMessage })
      console.error('Error creating folder:', err)

      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false
    } finally {
      setLoading(false)
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
    setContextMenu(null)
    handleNewFile()
  }

  const handleNewFolderInFolder = (folderPath: string) => {
    setSelectedFolder(folderPath)
    setContextMenu(null)
    handleNewFolder()
  }

  const handleDeleteFile = async (filePath: string, fileName: string) => {
    setContextMenu(null)

    const confirmed = await showConfirm({
      title: 'Delete File',
      message: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })

    if (!confirmed) return

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

  const handleDeleteFolder = async (folderPath: string, folderName: string) => {
    setContextMenu(null)

    const confirmed = await showConfirm({
      title: 'Delete Folder',
      message: `Are you sure you want to delete "${folderName}" and all its contents? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })

    if (!confirmed) return

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

  const handleRename = async (path: string, currentName: string, itemType: 'file' | 'directory') => {
    setContextMenu(null)

    // Extract parent directory path
    const lastSlash = path.lastIndexOf('/')
    const parentPath = lastSlash > 0 ? path.substring(0, lastSlash) : '/'

    // Get existing sibling names for duplicate detection
    const siblings = files.filter((file) => {
      const siblingParent = file.path.substring(0, file.path.lastIndexOf('/'))
      return siblingParent === parentPath && file.name !== currentName
    })
    const existingNames = siblings.map((s) => s.name)

    // Show specialized rename dialog
    const newName = await showRename({
      title: itemType === 'file' ? 'Rename File' : 'Rename Folder',
      message: '',
      currentName,
      itemPath: path,
      itemType,
      parentPath,
      existingNames
    })

    // User cancelled
    if (!newName) return

    try {
      setLoading(true)

      // Mark as internal operation and pause directory watcher
      isInternalOperation.current = true
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      await window.api.file.rename(path, newName)

      // Refresh project tree
      await refreshProjectTree()

      // Resume directory watcher
      if (projectPath) {
        await window.api.directoryWatch.resume(projectPath)
      }
      isInternalOperation.current = false

      showGlobalToast({
        title: 'Success',
        message: 'Item renamed successfully',
        type: 'success'
      })
    } catch (err) {
      // Clean up error message for better UX
      let errorMessage = 'Failed to rename'
      if (err instanceof Error) {
        errorMessage = err.message.replace(/^Error invoking remote method.*?Error:\s*/i, '')

        if (errorMessage.includes('already exists')) {
          errorMessage = 'An item with this name already exists'
        }
      }
      showGlobalToast({
        title: 'Error',
        message: errorMessage,
        type: 'error'
      })
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
          action: () => handleRename(node.path, node.name, 'directory')
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
          action: () => handleRename(node.path, node.name, 'file')
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
                disabled={loading}
                title="Create new markdown file"
              >
                <FilePlus size={14} strokeWidth={2} />
              </button>
              <button
                className="icon-btn"
                onClick={handleNewFolder}
                disabled={loading}
                title="Create new folder"
              >
                <FolderPlus size={14} strokeWidth={2} />
              </button>
            </>
          )}
        </div>
      </div>

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

    </div>
  )
}
