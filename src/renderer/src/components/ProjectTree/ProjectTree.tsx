import { useState, useEffect, useRef, useMemo } from 'react'
import { FilePlus, FolderPlus, FolderOpen, Replace, Trash, Edit, FileText, Files, RotateCw, X as CloseIcon, Copy, Scissors, Clipboard } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import type { FilterMode } from '../../types/filters'
import { ProjectTreeNode } from './ProjectTreeNode'
import { ContextMenu, ContextMenuItem } from '../ContextMenu/ContextMenu'
import { useDialog } from '../Dialog'
import './ProjectTree.css'
import { showGlobalToast } from '../Toast/toastService'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  DragOverlay,
  type CollisionDetection,
  pointerWithin,
  rectIntersection
} from '@dnd-kit/core'
import { useDragDropTree } from '../../hooks/useDragDropTree'
import { useClipboardStore } from '../../stores/useClipboardStore'
import { formatFileOperationError } from '../../utils/errorUtils'

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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    // Initialize with project root expanded
    return projectPath ? new Set([projectPath]) : new Set()
  })
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

  // Drag-drop state
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const autoExpandTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const autoScrollIntervalRef = useRef<number | null>(null)
  const treeContainerRef = useRef<HTMLDivElement | null>(null)

  // Drag-drop hooks
  const { flattenedItems, isDescendant } = useDragDropTree(files, projectPath)
  const clipboard = useClipboardStore()

  // Drag sensors - require 5px movement to prevent accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5
      }
    })
  )

  // Custom collision detection that prioritizes folders
  const customCollisionDetection: CollisionDetection = (args) => {
    // First use pointer intersection for immediate feedback
    const pointerCollisions = pointerWithin(args)

    if (pointerCollisions.length > 0) {
      // Prioritize directories over files
      const directoryCollisions = pointerCollisions.filter(collision => {
        const droppableData = args.droppableContainers.find(c => c.id === collision.id)?.data.current
        return droppableData?.type === 'directory'
      })

      if (directoryCollisions.length > 0) {
        return directoryCollisions
      }

      return pointerCollisions
    }

    // Fallback to rectangle intersection
    return rectIntersection(args)
  }

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

      // Clear UI state for new project and expand root folder
      setExpandedFolders(data.newPath ? new Set([data.newPath]) : new Set())
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
    // Find the node to determine type
    const node = enhancedFlattenedItems.find(item => item.path === filePath)

    if (node?.type === 'directory') {
      // Set selected folder for paste operations
      setSelectedFolder(filePath)
    } else {
      // Open file in editor
      onFileSelect(filePath)
    }
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

  /**
   * Create synthetic root folder node (VS Code style)
   * The project root appears as the first item in the tree
   */
  const rootFolderNode: FileNode | null = useMemo(() => {
    if (!projectPath || filteredFiles.length === 0) {
      return null
    }

    const projectName = projectPath.split('/').pop() || 'Project'
    return {
      name: projectName,
      path: projectPath,
      type: 'directory',
      children: filteredFiles,
      extension: undefined
    }
  }, [projectPath, filteredFiles])

  /**
   * Enhanced flattenedItems that includes the root folder node
   * This ensures the root folder can be found during drag-drop operations
   */
  const enhancedFlattenedItems = useMemo(() => {
    if (!rootFolderNode) {
      return flattenedItems
    }

    // Add root folder as first item with depth 0, parentId null
    return [
      {
        ...rootFolderNode,
        parentId: null,
        depth: 0,
        index: 0
      },
      ...flattenedItems.map(item => ({
        ...item,
        // Adjust depth to account for root folder
        depth: item.depth + 1,
        // If item has no parent, its parent is now the root folder
        parentId: item.parentId || rootFolderNode.path
      }))
    ]
  }, [rootFolderNode, flattenedItems])

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

      showGlobalToast({
        title: 'Success',
        message: 'Item renamed successfully',
        type: 'success'
      })
    } catch (err) {
      const errorMessage = formatFileOperationError(err, 'rename')
      showGlobalToast({
        title: 'Error',
        message: errorMessage,
        type: 'error'
      })
      console.error('Error renaming:', err)
    } finally {
      // Resume watcher - wrap in try-catch to ensure cleanup always happens
      if (projectPath) {
        try {
          await window.api.directoryWatch.resume(projectPath)
        } catch (resumeErr) {
          console.error('Failed to resume directory watcher:', resumeErr)
        }
      }
      isInternalOperation.current = false
      setLoading(false)
    }
  }

  // Auto-scroll logic
  const startAutoScroll = (direction: 'up' | 'down') => {
    if (autoScrollIntervalRef.current) return // Already scrolling

    const container = treeContainerRef.current
    if (!container) return

    autoScrollIntervalRef.current = window.setInterval(() => {
      const scrollAmount = direction === 'up' ? -5 : 5
      container.scrollTop += scrollAmount
    }, 16) // ~60fps
  }

  const stopAutoScroll = () => {
    if (autoScrollIntervalRef.current) {
      window.clearInterval(autoScrollIntervalRef.current)
      autoScrollIntervalRef.current = null
    }
  }

  // Auto-expand logic
  const startAutoExpandTimer = (folderId: string) => {
    // Cancel any existing timer
    if (autoExpandTimeoutRef.current) {
      clearTimeout(autoExpandTimeoutRef.current)
      autoExpandTimeoutRef.current = null
    }

    // Don't auto-expand if already expanded
    if (expandedFolders.has(folderId)) return

    // Set new timer for 1 second
    autoExpandTimeoutRef.current = setTimeout(() => {
      console.log('🔓 Auto-expanding folder:', folderId)
      setExpandedFolders(prev => new Set([...prev, folderId]))
      autoExpandTimeoutRef.current = null
    }, 1000)
  }

  const cancelAutoExpandTimer = () => {
    if (autoExpandTimeoutRef.current) {
      clearTimeout(autoExpandTimeoutRef.current)
      autoExpandTimeoutRef.current = null
    }
  }

  // Drag-drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
    console.log('🔵 Drag start:', event.active.id)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const newOverId = event.over?.id as string | null

    // Handle auto-scroll based on pointer position
    if (treeContainerRef.current && event.activatorEvent) {
      const container = treeContainerRef.current
      const rect = container.getBoundingClientRect()

      // Type guard for mouse/pointer events
      const pointerY = ('clientY' in event.activatorEvent && typeof event.activatorEvent.clientY === 'number')
        ? event.activatorEvent.clientY
        : 0

      const distanceFromTop = pointerY - rect.top
      const distanceFromBottom = rect.bottom - pointerY

      if (distanceFromTop < 50 && distanceFromTop > 0) {
        startAutoScroll('up')
      } else if (distanceFromBottom < 50 && distanceFromBottom > 0) {
        startAutoScroll('down')
      } else {
        stopAutoScroll()
      }
    }

    // Handle auto-expand
    if (newOverId && newOverId !== overId) {
      // Moved to a new target
      cancelAutoExpandTimer()

      // Check if the new target is a collapsed folder
      const overNode = enhancedFlattenedItems.find(item => item.path === newOverId)
      if (overNode && overNode.type === 'directory' && !expandedFolders.has(newOverId)) {
        startAutoExpandTimer(newOverId)
      }
    }

    setOverId(newOverId)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    // Cleanup timers and state
    stopAutoScroll()
    cancelAutoExpandTimer()

    setActiveId(null)
    setOverId(null)

    if (!over || active.id === over.id) {
      console.log('🔵 Drag cancelled - no valid drop target')
      return
    }

    const sourcePath = active.id as string
    const targetPath = over.id as string

    console.log('🔵 Drag end:', { sourcePath, targetPath })

    // Simple validation: prevent moving folder into its own descendant
    if (isDescendant(targetPath, sourcePath)) {
      showGlobalToast({
        title: 'Invalid Move',
        message: 'Cannot move folder into its own subfolder',
        type: 'error'
      })
      return
    }

    // Prevent moving project root
    if (projectPath && sourcePath === projectPath) {
      showGlobalToast({
        title: 'Invalid Move',
        message: 'Cannot move project root',
        type: 'error'
      })
      return
    }

    // Get target folder - if dropping on a file, use its parent directory
    const targetNode = enhancedFlattenedItems.find(item => item.path === targetPath)
    if (!targetNode) {
      showGlobalToast({
        title: 'Error',
        message: 'Cannot determine target location',
        type: 'error'
      })
      return
    }

    // Determine target parent directory
    let targetParent: string
    if (targetNode.type === 'directory') {
      // Dropping into a folder - use the folder itself
      targetParent = targetNode.path
    } else {
      // Dropping on a file - use the file's parent directory
      targetParent = targetNode.parentId || projectPath || ''
    }

    if (!targetParent) {
      showGlobalToast({
        title: 'Error',
        message: 'Cannot determine target location',
        type: 'error'
      })
      return
    }

    try {
      setLoading(true)
      isInternalOperation.current = true

      // Pause watcher
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      // Execute move
      const result = await window.api.file.moveItem(sourcePath, targetParent)
      console.log('✅ Move completed:', result.path)

      // Refresh tree
      if (projectPath) {
        const fileTree = await window.api.file.readDirectory(projectPath)
        setFiles(fileTree)
      }

      // Show success message with symlink warning if applicable
      if (result.isSymlink) {
        showGlobalToast({
          title: 'Symlink Moved',
          message: 'Warning: You moved a symbolic link. The target file remains at its original location.',
          type: 'warning'
        })
      } else {
        showGlobalToast({
          title: 'Success',
          message: 'Item moved successfully',
          type: 'success'
        })
      }
    } catch (err) {
      const errorMessage = formatFileOperationError(err, 'move')
      showGlobalToast({
        title: 'Error',
        message: errorMessage,
        type: 'error'
      })
      console.error('Error moving item:', err)
    } finally {
      // Resume watcher - wrap in try-catch to ensure cleanup always happens
      if (projectPath) {
        try {
          await window.api.directoryWatch.resume(projectPath)
        } catch (resumeErr) {
          console.error('Failed to resume directory watcher:', resumeErr)
        }
      }
      isInternalOperation.current = false
      setLoading(false)
    }
  }

  // Keyboard shortcuts for cut/copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl/Cmd + X/C/V
      if ((e.ctrlKey || e.metaKey) && selectedFolder) {
        const node = flattenedItems.find(item => item.path === selectedFolder)
        if (!node) return

        if (e.key === 'x') {
          // Cut
          e.preventDefault()
          clipboard.cut(node.path, node.name, node.type)
          console.log('✂️ Cut:', node.name)
          showGlobalToast({
            title: 'Cut',
            message: `"${node.name}" ready to move`,
            type: 'info'
          })
        } else if (e.key === 'c') {
          // Copy
          e.preventDefault()
          clipboard.copy(node.path, node.name, node.type)
          console.log('📋 Copy:', node.name)
          showGlobalToast({
            title: 'Copied',
            message: `"${node.name}" ready to paste`,
            type: 'info'
          })
        } else if (e.key === 'v' && clipboard.hasClipboard()) {
          // Paste
          e.preventDefault()
          handlePaste()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFolder, flattenedItems, clipboard])

  const handlePaste = async (targetFolder?: string) => {
    const targetPath = targetFolder || selectedFolder

    if (!targetPath) {
      showGlobalToast({
        title: 'Error',
        message: 'Select a folder to paste into',
        type: 'error'
      })
      return
    }

    // Check for name conflict BEFORE attempting paste (cut operations only)
    const sourceItemName = clipboard.itemName
    const sourceItemType = clipboard.itemType
    if (sourceItemName && clipboard.operation === 'cut') {
      try {
        const hasConflict = await window.api.file.checkConflict(targetPath, sourceItemName)

        if (hasConflict) {
          // Show replace confirmation dialog
          const itemTypeLabel = sourceItemType === 'directory' ? 'folder' : 'file'
          const shouldReplace = await showConfirm({
            title: 'Replace Item',
            message: `A ${itemTypeLabel} named "${sourceItemName}" already exists in the target folder. Do you want to replace it?`,
            confirmLabel: 'Replace',
            cancelLabel: 'Cancel',
            danger: true
          })

          if (!shouldReplace) {
            return // User cancelled
          }

          // User confirmed, proceed with replace
          await executePaste(targetPath, true)
          return
        }
      } catch (error) {
        console.error('Error checking conflict:', error)
        // Fall through to normal paste (backend will handle error)
      }
    }

    // No conflict or copy operation, proceed normally
    await executePaste(targetPath, false)
  }

  // Helper function to execute paste operation
  const executePaste = async (targetPath: string, replaceExisting: boolean) => {
    try {
      setLoading(true)
      isInternalOperation.current = true

      // Pause watcher
      if (projectPath) {
        await window.api.directoryWatch.pause(projectPath)
      }

      const result = await clipboard.paste(targetPath, replaceExisting)

      if (result.success) {
        // Refresh tree
        if (projectPath) {
          const fileTree = await window.api.file.readDirectory(projectPath)
          setFiles(fileTree)
        }

        // Show success message with symlink warning if applicable
        if (result.isSymlink) {
          const operation = clipboard.getOperation() === 'cut' ? 'moved' : 'copied'
          showGlobalToast({
            title: 'Symlink ' + (clipboard.getOperation() === 'cut' ? 'Moved' : 'Copied'),
            message: `Warning: You ${operation} a symbolic link. The target file remains at its original location.`,
            type: 'warning'
          })
        } else {
          const operationLabel = clipboard.getOperation() === 'cut' ? 'moved' : 'copied'
          const replacedLabel = replaceExisting ? ' and replaced existing item' : ''
          showGlobalToast({
            title: 'Success',
            message: `Item ${operationLabel}${replacedLabel}`,
            type: 'success'
          })
        }
      } else {
        showGlobalToast({
          title: 'Error',
          message: result.error || 'Failed to paste',
          type: 'error'
        })
      }
    } catch (err) {
      const errorMessage = formatFileOperationError(err, 'paste')
      showGlobalToast({
        title: 'Error',
        message: errorMessage,
        type: 'error'
      })
      console.error('Error pasting:', err)
    } finally {
      // Resume watcher - wrap in try-catch to ensure cleanup always happens
      if (projectPath) {
        try {
          await window.api.directoryWatch.resume(projectPath)
        } catch (resumeErr) {
          console.error('Failed to resume directory watcher:', resumeErr)
        }
      }
      isInternalOperation.current = false
      setLoading(false)
    }
  }

  const getContextMenuItems = (node: FileNode): ContextMenuItem[] => {
    const baseItems: ContextMenuItem[] = []

    // Cut/Copy/Paste for all items
    baseItems.push(
      {
        label: 'Cut',
        icon: <Scissors size={14} strokeWidth={2} />,
        action: () => {
          clipboard.cut(node.path, node.name, node.type)
          showGlobalToast({ title: 'Cut', message: `"${node.name}" ready to move`, type: 'info' })
        }
      },
      {
        label: 'Copy',
        icon: <Copy size={14} strokeWidth={2} />,
        action: () => {
          clipboard.copy(node.path, node.name, node.type)
          showGlobalToast({ title: 'Copied', message: `"${node.name}" ready to paste`, type: 'info' })
        }
      }
    )

    // Paste only for directories
    if (node.type === 'directory' && clipboard.hasClipboard()) {
      baseItems.push({
        label: 'Paste',
        icon: <Clipboard size={14} strokeWidth={2} />,
        action: () => {
          handlePaste(node.path)
        }
      })
    }

    baseItems.push({ separator: true } as ContextMenuItem)

    if (node.type === 'directory') {
      return [
        ...baseItems,
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
        ...baseItems,
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

      <div className="project-tree-content" ref={treeContainerRef}>
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {rootFolderNode ? (
            <ProjectTreeNode
              key={rootFolderNode.path}
              node={rootFolderNode}
              level={0}
              onFileClick={handleFileClick}
              onContextMenu={handleContextMenu}
              selectedFolder={selectedFolder}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolder}
              isDragging={activeId === rootFolderNode.path}
              isDropTarget={overId === rootFolderNode.path}
              clipboardCut={clipboard.itemPath === rootFolderNode.path && clipboard.operation === 'cut'}
            />
          ) : (
            <div className="project-tree-empty">
              {projectPath ? (filterMode === 'markdown' ? 'No markdown files found' : 'No files found') : 'Open a project to get started'}
            </div>
          )}
          <DragOverlay dropAnimation={null}>
            {activeId ? (
              <div className="drag-overlay">
                <span className="file-name">
                  {enhancedFlattenedItems.find(item => item.path === activeId)?.name}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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
