// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { FilePlus, FolderPlus, FolderOpen, Replace, FileText, Files, FileUp, RotateCw, X as CloseIcon } from 'lucide-react'
import type { FileNode } from '../../../../preload/index'
import type { FilterMode } from '../../types/filters'
import { ProjectTreeNode } from './ProjectTreeNode'
import { ContextMenu, ContextMenuItem } from '../ContextMenu/ContextMenu'
import { useDialog } from '../Dialog'
import type { DropModeDialogResult, ConflictDialogResult } from '../Dialog/types'
import './ProjectTree.css'
import { showGlobalToast } from '../Toast/toastService'
import { isPointInElement } from '../../utils/domGeometry'
import { getBasename, getDirname } from '../../utils/fileUtils'
import type { MenuContext } from './context-menu/types'
import { ContextMenuFactory } from './context-menu/factory'
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
import { DRAG_DROP, AUTO_SCROLL, AUTO_EXPAND } from './constants'
import { withWatcherPause } from './withWatcherPause'
import { logger } from '../../utils/logger'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { formatPathsForTerminal } from '../../utils/shellPathEscape'
import { TEST_IDS as TERMINAL_TEST_IDS } from '../../constants/testids'
import { useDirectoryWatcher } from '../../hooks/useDirectoryWatcher'
import { useProjectManagementContext, useProjectChangedEffect } from '../../context/ProjectManagementContext'
import { useFileOperations } from '../../hooks/useFileOperations'
import { useImport } from '../../hooks/useImport'
import { runToolbarImport } from './toolbarImport.logic'
import { useGitStatus } from '../../hooks/useGitStatus'
import { GitStatusBar } from './GitStatusBar'
import { GitErrorBoundary } from './GitErrorBoundary'
import { TEST_IDS } from '../../constants/testids'
import {
  useExternalFileDrop,
  isExternalDrag,
  type ExternalDropFile
} from '../../hooks/useExternalFileDrop'
import type { ConflictResolution } from '../../../../shared/ipc/external-file-schema'
import { IMPORT } from '../../../../shared/constants'

interface ProjectTreeProps {
  onFileSelect: (filePath: string) => void
  showControlPanel: boolean
  filterMode: FilterMode
  onFilterModeChange: (mode: FilterMode) => void
}

export function ProjectTree({ onFileSelect, showControlPanel, filterMode, onFilterModeChange }: ProjectTreeProps) {
  // UI-specific state (not managed by hooks)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const isInternalOperation = useRef(false)

  // Project lifecycle management via context (singleton - avoids duplicate IPC listeners)
  const {
    projectPath,
    files,
    loading,
    error,
    isSwitchingProject,
    initialLoadComplete,
    handleOpenProject,
    handleCloseProject,
    refreshFiles
  } = useProjectManagementContext()

  // Register for project change notifications to reset UI state
  useProjectChangedEffect((newPath) => {
    // Reset UI state when project changes
    setExpandedFolders(newPath ? new Set([newPath]) : new Set())
    setSelectedFolder(null)
  })

  // Local loading state for file operations (separate from project loading)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_fileOperationLoading, setFileOperationLoading] = useState<boolean>(false)

  // Git status hook (auto-refreshes on file changes)
  // Must be called before useFileOperations so refreshGitStatus is available
  const {
    isGitRepo,
    branch,
    isDetached,
    counts,
    truncated,
    getFileStatus,
    getFolderStatus,
    refresh: refreshGitStatus,
    isRefreshing,
  } = useGitStatus({ projectPath })

  // File operation handlers via hook (only toolbar actions; context menu uses commands)
  const {
    handleNewFile,
    handleNewFolder
  } = useFileOperations({
    projectPath,
    files,
    selectedFolder,
    setSelectedFolder,
    onFileSelect,
    refreshProjectTree: refreshFiles,
    isInternalOperationRef: isInternalOperation,
    setFileOperationLoading,
    onGitRefresh: refreshGitStatus
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: FileNode
  } | null>(null)

  // Drag-drop state
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const autoExpandTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const autoScrollIntervalRef = useRef<number | null>(null)
  const treeContainerRef = useRef<HTMLDivElement | null>(null)
  const lastMousePositionRef = useRef<{ x: number; y: number } | null>(null)

  // Drag-drop hooks
  const { flattenedItems, isDescendant } = useDragDropTree(files, projectPath)
  const clipboard = useClipboardStore()

  // Import hook (for context menu, external drop, and toolbar button)
  const { importFile, processFiles, isImporting } = useImport()

  // Manual refresh handler - refreshes both file tree and git status
  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refreshFiles(),
      refreshGitStatus()
    ])
  }, [refreshFiles, refreshGitStatus])

  // Toolbar import handler - opens the native picker via the shared import hook,
  // then refreshes git status only on a successful import (parity with the
  // context-menu ImportCommand). Contract lives in toolbarImport.logic.ts.
  const handleToolbarImport = useCallback(() => {
    return runToolbarImport(importFile, refreshGitStatus)
  }, [importFile, refreshGitStatus])

  // Combined loading state for refresh operations
  const isAnyRefreshing = loading || isRefreshing

  // Context menu factory (Strategy + Command pattern)
  const contextMenuFactory = useMemo(() => new ContextMenuFactory(), [])

  // Dialog hooks
  const { showConfirm, showRename, showNewFile, showNewFolder, showDropMode, showConflict } = useDialog()

  // External file drop hook (Spec #012)
  const {
    isExternalDragActive,
    externalDropTarget,
    handleDragEnter: handleExternalDragEnter,
    handleDragOver: handleExternalDragOver,
    handleDragLeave: handleExternalDragLeave,
    handleDrop: handleExternalDrop,
    getTargetFromEvent
  } = useExternalFileDrop({
    projectPath,
    expandedFolders,
    setExpandedFolders
  })

  // Drag sensors - require movement to prevent accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: DRAG_DROP.ACTIVATION_DISTANCE
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

  // Project management (loading, switching, closing) now handled by useProjectManagement hook

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

  // File operation handlers (create, delete, rename) now handled by useFileOperations hook

  // Alias for hook's refreshFiles for use in file operations
  const refreshProjectTree = refreshFiles

  // Directory watching for auto-refresh
  useDirectoryWatcher({
    projectPath,
    initialLoadComplete,
    isInternalOperationRef: isInternalOperation,
    onRefresh: refreshProjectTree,
    onProjectDeleted: () => {
      // Show toast notification and close project via API
      showGlobalToast({
        type: 'error',
        title: 'Project Deleted',
        message: 'Project folder no longer exists'
      })
      // Close project via API (hook will update state via onProjectChanged listener)
      window.api.file.closeProject().catch(err => {
        logger.error('Error closing deleted project', err instanceof Error ? err : undefined)
      })
      setExpandedFolders(new Set())
    },
    onError: (error) => {
      logger.error('Directory watch error', undefined, { error })
    }
  })

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

    const projectName = getBasename(projectPath) || 'Project'
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

  // Remaining handlers now provided by useFileOperations hook

  // Auto-scroll logic
  const startAutoScroll = (direction: 'up' | 'down') => {
    if (autoScrollIntervalRef.current) return // Already scrolling

    const container = treeContainerRef.current
    if (!container) return

    autoScrollIntervalRef.current = window.setInterval(() => {
      const scrollAmount = direction === 'up' ? -AUTO_SCROLL.SCROLL_AMOUNT : AUTO_SCROLL.SCROLL_AMOUNT
      container.scrollTop += scrollAmount
    }, AUTO_SCROLL.SCROLL_INTERVAL) // ~60fps
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

    // Set new timer for auto-expand
    autoExpandTimeoutRef.current = setTimeout(() => {
      logger.info('Auto-expanding folder', { folderId })
      setExpandedFolders(prev => new Set([...prev, folderId]))
      autoExpandTimeoutRef.current = null
    }, AUTO_EXPAND.HOVER_DELAY)
  }

  const cancelAutoExpandTimer = () => {
    if (autoExpandTimeoutRef.current) {
      clearTimeout(autoExpandTimeoutRef.current)
      autoExpandTimeoutRef.current = null
    }
  }

  // Track mouse position globally during drag (more reliable than @dnd-kit delta)
  const handlePointerEvent = useCallback((e: PointerEvent | MouseEvent) => {
    lastMousePositionRef.current = { x: e.clientX, y: e.clientY }
    logger.info('Mouse position tracked', { x: e.clientX, y: e.clientY })
  }, [])

  // Drag-drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
    // Track ALL pointer/mouse events globally for terminal drop detection
    // Use capture phase to ensure we get events even with pointer capture
    document.addEventListener('pointermove', handlePointerEvent, { capture: true })
    document.addEventListener('mousemove', handlePointerEvent, { capture: true })
    document.addEventListener('pointerup', handlePointerEvent, { capture: true, once: true })
    document.addEventListener('mouseup', handlePointerEvent, { capture: true, once: true })
    logger.info('Drag start', { activeId: event.active.id })
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

      if (distanceFromTop < AUTO_SCROLL.TRIGGER_DISTANCE_TOP && distanceFromTop > 0) {
        startAutoScroll('up')
      } else if (distanceFromBottom < AUTO_SCROLL.TRIGGER_DISTANCE_BOTTOM && distanceFromBottom > 0) {
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

    // Stop tracking mouse position
    document.removeEventListener('pointermove', handlePointerEvent, { capture: true })
    document.removeEventListener('mousemove', handlePointerEvent, { capture: true })

    // Check if dragged to terminal (when no valid tree drop target)
    // Use globally tracked mouse position (more reliable than delta calculation)
    const lastPos = lastMousePositionRef.current
    logger.info('handleDragEnd debug', {
      hasOver: !!over,
      overId: over?.id,
      lastMousePosition: lastPos
    })

    if (!over && lastPos) {
      // Find terminal by checking if coordinates fall within terminal panel bounds
      // This is more reliable than elementFromPoint which can be blocked by overlays
      const terminalPanel = document.querySelector(`[data-testid="${TERMINAL_TEST_IDS.TERMINAL_PANEL}"]`)
      const terminalContainer = document.querySelector(`[data-testid="${TERMINAL_TEST_IDS.TERMINAL_INSTANCE}"]`)

      let isOverTerminal = false
      if (terminalPanel) {
        isOverTerminal = isPointInElement(lastPos.x, lastPos.y, terminalPanel)
        const rect = terminalPanel.getBoundingClientRect()
        logger.info('Terminal drop check', {
          x: lastPos.x,
          y: lastPos.y,
          terminalRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          isOverTerminal,
          hasTerminalContainer: !!terminalContainer
        })
      } else {
        logger.info('Terminal drop check - no terminal panel found')
      }

      if (isOverTerminal && terminalContainer) {
        const sourcePath = active.id as string
        logger.info('Drag to terminal SUCCESS', { sourcePath, x: lastPos.x, y: lastPos.y })

        const formattedPath = formatPathsForTerminal([sourcePath])
        const success = await useTerminalStore.getState().sendToTerminal(formattedPath, false)

        if (!success) {
          showGlobalToast({
            title: 'Drop failed',
            message: 'Could not insert path into terminal',
            type: 'error'
          })
        }

        lastMousePositionRef.current = null
        return
      }
    }

    lastMousePositionRef.current = null

    if (!over || active.id === over.id) {
      logger.info('Drag cancelled - no valid drop target')
      return
    }

    const sourcePath = active.id as string
    const targetPath = over.id as string

    logger.info('Drag end', { sourcePath, targetPath })

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
      const result = await withWatcherPause(projectPath, isInternalOperation, setFileOperationLoading, async () => {
        // Execute move
        const moveResult = await window.api.file.moveItem(sourcePath, targetParent)
        logger.info('Move completed', { path: moveResult.path })

        // Refresh tree
        await refreshProjectTree()

        return moveResult
      })

      // Refresh git status after successful move (outside watcher pause)
      refreshGitStatus()

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
      logger.error('Error moving item', err instanceof Error ? err : undefined)
    }
  }

  // Keyboard shortcuts for cut/copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when user is typing in text inputs (issue #37)
      const activeElement = document.activeElement as HTMLElement
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.contentEditable === 'true'
      ) {
        return // Let native text handling work
      }

      // Check for Ctrl/Cmd + X/C/V
      if ((e.ctrlKey || e.metaKey) && selectedFolder) {
        const node = flattenedItems.find(item => item.path === selectedFolder)
        if (!node) return

        if (e.key === 'x') {
          // Cut
          e.preventDefault()
          clipboard.cut(node.path, node.name, node.type)
          logger.info('Cut', { nodeName: node.name })
          showGlobalToast({
            title: 'Cut',
            message: `"${node.name}" ready to move`,
            type: 'info'
          })
        } else if (e.key === 'c') {
          // Copy
          e.preventDefault()
          clipboard.copy(node.path, node.name, node.type)
          logger.info('Copy', { nodeName: node.name })
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
        logger.error('Error checking conflict', error instanceof Error ? error : undefined)
        // Fall through to normal paste (backend will handle error)
      }
    }

    // No conflict or copy operation, proceed normally
    await executePaste(targetPath, false)
  }

  // Helper function to execute paste operation
  const executePaste = async (targetPath: string, replaceExisting: boolean) => {
    try {
      const result = await withWatcherPause(projectPath, isInternalOperation, setFileOperationLoading, async () => {
        const pasteResult = await clipboard.paste(targetPath, replaceExisting)

        if (pasteResult.success) {
          // Refresh tree
          await refreshProjectTree()
        }

        return pasteResult
      })

      if (result.success) {
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
      logger.error('Error pasting', err instanceof Error ? err : undefined)
    }
  }

  /**
   * Execute external file drop operation (Spec #012)
   *
   * Handles the complete workflow for dropped external files:
   * 1. Show drop mode dialog (move/copy/import)
   * 2. Validate each file
   * 3. Check for conflicts and prompt resolution
   * 4. Execute the operation
   *
   * @param droppedFiles - Array of files dropped from external source
   * @param targetFolder - Target folder path within project
   */
  const executeExternalDrop = useCallback(async (
    droppedFiles: ExternalDropFile[],
    targetFolder: string
  ): Promise<void> => {
    if (!projectPath || droppedFiles.length === 0) {
      return
    }

    logger.info('Executing external drop', {
      fileCount: droppedFiles.length,
      targetFolder
    })

    // Check if any files are importable (to conditionally show Import option)
    // Note: isSupported expects a filename/path, not just the extension
    let hasImportableFiles = false
    for (const file of droppedFiles) {
      if (await window.api.import.isSupported(file.name)) {
        hasImportableFiles = true
        break
      }
    }

    // Step 1: Show drop mode selection dialog
    const modeResult: DropModeDialogResult | null = await showDropMode({
      fileCount: droppedFiles.length,
      fileName: droppedFiles.length === 1 ? droppedFiles[0].name : undefined,
      showImport: hasImportableFiles
    })

    if (!modeResult) {
      logger.info('External drop cancelled by user')
      return
    }

    const { mode } = modeResult

    // Step 2: Handle import mode via unified processFiles workflow (SOLID compliance)
    // processFiles handles: large file warnings, IPC calls, toasts, organize prompt
    if (mode === 'import') {
      // Convert dropped files to ImportFileInfo format
      const importFiles = droppedFiles.map(file => ({
        path: file.path,
        name: file.name,
        sizeInBytes: file.sizeInBytes
      }))

      // Use unified import workflow
      await processFiles(importFiles)

      // Refresh tree and git status (processFiles handles all UI feedback)
      await refreshProjectTree()
      refreshGitStatus()
      return
    }

    // Step 3: Process move/copy for each file
    let successCount = 0
    let failCount = 0

    for (const file of droppedFiles) {
      try {
        // Validate file still exists and is valid
        const validation = await window.api.file.validateExternal(file.path, projectPath)

        if (!validation.valid) {
          logger.warn('External file validation failed', {
            path: file.path,
            error: validation.error
          })
          showGlobalToast({
            title: 'Validation failed',
            message: validation.error || `Cannot process "${file.name}"`,
            type: 'error'
          })
          failCount++
          continue
        }

        // For move/copy, check for conflicts
        // Note (M4): Using forward slash works cross-platform in Electron/Node.
        // Actual file operations use backend APIs that handle path joining correctly.
        const targetPath = `${targetFolder}/${file.name}`
        const hasConflict = await window.api.file.checkConflict(targetFolder, file.name)

        let conflictResolution: ConflictResolution | undefined

        if (hasConflict) {
          // Show conflict resolution dialog
          const conflictResult: ConflictDialogResult | null = await showConflict({
            fileName: file.name,
            targetPath
          })

          if (!conflictResult) {
            // User skipped this file
            logger.info('User skipped conflicting file', { fileName: file.name })
            continue
          }

          conflictResolution = conflictResult.resolution
        }

        // Execute the operation
        if (mode === 'move') {
          const result = await window.api.file.moveFromExternal(
            file.path,
            targetFolder,
            projectPath,
            conflictResolution
          )

          if (result.success) {
            successCount++
            if (result.isSymlink) {
              showGlobalToast({
                title: 'Symlink moved',
                message: 'Warning: You moved a symbolic link. The target file remains at its original location.',
                type: 'warning'
              })
            }
          } else {
            logger.warn('Move failed', { path: file.path, error: result.error })
            showGlobalToast({
              title: 'Move failed',
              message: result.error || `Failed to move "${file.name}"`,
              type: 'error'
            })
            failCount++
          }
        } else if (mode === 'copy') {
          const result = await window.api.file.copyFromExternal(
            file.path,
            targetFolder,
            projectPath,
            conflictResolution
          )

          if (result.success) {
            successCount++
            if (result.isSymlink) {
              showGlobalToast({
                title: 'Symlink copied',
                message: 'Warning: You copied a symbolic link. The target file remains at its original location.',
                type: 'warning'
              })
            }
          } else {
            logger.warn('Copy failed', { path: file.path, error: result.error })
            showGlobalToast({
              title: 'Copy failed',
              message: result.error || `Failed to copy "${file.name}"`,
              type: 'error'
            })
            failCount++
          }
        }
      } catch (err) {
        logger.error('Error processing external file', err instanceof Error ? err : undefined, {
          path: file.path
        })
        showGlobalToast({
          title: 'Error',
          message: `Failed to process "${file.name}"`,
          type: 'error'
        })
        failCount++
      }
    }

    // Step 3: Refresh tree and show summary
    await refreshProjectTree()
    refreshGitStatus()

    // Show success summary if any files were processed (move/copy only - import handled above)
    if (successCount > 0) {
      const operationLabel = mode === 'move' ? 'Moved' : 'Copied'
      const message = successCount === 1
        ? `${operationLabel} 1 file`
        : `${operationLabel} ${successCount} files`

      showGlobalToast({
        title: 'Success',
        message: failCount > 0 ? `${message} (${failCount} failed)` : message,
        type: failCount > 0 ? 'warning' : 'success'
      })
    }
  }, [projectPath, showDropMode, showConflict, refreshProjectTree, refreshGitStatus, processFiles])

  /**
   * Handle native dragenter events on the tree container.
   * Delegates to external drop handler if it's an external drag.
   */
  const handleNativeDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only handle external drags (files from Finder/file manager)
    if (isExternalDrag(e.nativeEvent)) {
      handleExternalDragEnter(e.nativeEvent)
    }
    // Internal dnd-kit drags are handled by DndContext
  }, [handleExternalDragEnter])

  /**
   * Handle native dragover events on the tree container.
   * Must call preventDefault to allow drop.
   */
  const handleNativeDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isExternalDrag(e.nativeEvent)) {
      handleExternalDragOver(e.nativeEvent)
    }
  }, [handleExternalDragOver])

  /**
   * Handle native dragleave events on the tree container.
   */
  const handleNativeDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isExternalDrag(e.nativeEvent)) {
      handleExternalDragLeave(e.nativeEvent)
    }
  }, [handleExternalDragLeave])

  /**
   * Handle native drop events on the tree container.
   * Processes external file drops.
   */
  const handleNativeDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalDrag(e.nativeEvent)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    // Get target folder from the drop location
    const targetFolder = getTargetFromEvent(e.nativeEvent)
    if (!targetFolder) {
      logger.warn('External drop on invalid target')
      return
    }

    // Extract dropped files
    const droppedFiles = handleExternalDrop(e.nativeEvent)
    if (!droppedFiles || droppedFiles.length === 0) {
      return
    }

    // Execute the drop operation
    await executeExternalDrop(droppedFiles, targetFolder)
  }, [getTargetFromEvent, handleExternalDrop, executeExternalDrop])

  /**
   * Handle keyboard shortcut Cmd+Shift+I for adding external files (NFR-002)
   * Only active when a folder is selected in the project tree.
   */
  const handleImportShortcut = useCallback(async (targetFolder: string) => {
    if (!projectPath) {
      return
    }

    // Open native file picker
    const result = await window.api.file.selectExternalFiles()
    if (!result || result.paths.length === 0) {
      return
    }

    // Early batch size check to avoid unnecessary file stats fetching (C2 fix)
    // Import mode goes through processFiles which enforces IMPORT.MAX_BATCH_SIZE
    // but we check here to prevent expensive Promise.all(getStats) for oversized batches
    if (result.paths.length > IMPORT.MAX_BATCH_SIZE) {
      showGlobalToast({
        title: 'Too many files',
        message: `Cannot add more than ${IMPORT.MAX_BATCH_SIZE} files at once. Please select fewer files.`,
        type: 'error'
      })
      return
    }

    // Convert paths to ExternalDropFile format with actual file stats (M1 fix)
    // Fetch real file sizes to enable proper large file warnings in import mode
    let statsFailureCount = 0
    const droppedFiles: ExternalDropFile[] = await Promise.all(
      result.paths.map(async (filePath) => {
        try {
          const stats = await window.api.file.getStats(filePath)
          return {
            path: filePath,
            name: getBasename(filePath) || 'unknown',
            sizeInBytes: stats.size,
            isDirectory: false // File picker only returns files
          }
        } catch {
          // If stats fail, use 0 as fallback (L3: warn user that size check may be skipped)
          logger.warn('Failed to get file stats for import shortcut', { filePath })
          statsFailureCount++
          return {
            path: filePath,
            name: getBasename(filePath) || 'unknown',
            sizeInBytes: 0, // Large file warning won't trigger
            isDirectory: false
          }
        }
      })
    )

    // L3: Warn user if some file sizes couldn't be determined
    if (statsFailureCount > 0) {
      showGlobalToast({
        title: 'Warning',
        message: `Could not determine size for ${statsFailureCount} file(s). Large file warnings may not apply.`,
        type: 'warning'
      })
    }

    await executeExternalDrop(droppedFiles, targetFolder)
  }, [projectPath, executeExternalDrop])

  // Keyboard shortcut for external file import (NFR-002)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when user is typing in text inputs
      const activeElement = document.activeElement as HTMLElement
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.contentEditable === 'true'
      ) {
        return
      }

      // Cmd+Shift+I (Mac) or Ctrl+Shift+I (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
        // Check if a folder is selected
        if (selectedFolder) {
          const node = enhancedFlattenedItems.find(item => item.path === selectedFolder)
          if (node && node.type === 'directory') {
            e.preventDefault()
            handleImportShortcut(selectedFolder)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFolder, enhancedFlattenedItems, handleImportShortcut])

  // Keyboard shortcut for manual refresh (Cmd/Ctrl+Alt+R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.contentEditable === 'true'
      ) {
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'r') {
        if (projectPath && !isAnyRefreshing) {
          e.preventDefault()
          handleRefresh()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [projectPath, isAnyRefreshing, handleRefresh])

  /**
   * Helper: Build MenuContext for context menu factory
   * Provides all dependencies needed by command execution
   */
  const buildMenuContext = (): MenuContext => ({
    projectPath,
    clipboard,
    dialogs: { showConfirm, showRename, showNewFile, showNewFolder },
    toast: showGlobalToast,
    // Cast to IProjectTreeApi['file'] to match interface (runtime behavior is compatible)
    api: window.api.file as unknown as MenuContext['api'],
    withWatcherPause: <T,>(op: () => Promise<T>) =>
      withWatcherPause(projectPath, isInternalOperation, setFileOperationLoading, op),
    refreshProjectTree: refreshFiles,
    onGitRefresh: refreshGitStatus,
    formatFileOperationError,
    getSiblingNames: (nodePath: string, currentName: string) => {
      const parentPath = getDirname(nodePath) || '/'
      const siblings = files.filter((file) => {
        const siblingParent = getDirname(file.path) || '/'
        return siblingParent === parentPath && file.name !== currentName
      })
      return siblings.map((s) => s.name)
    },
    importFile
  })

  /**
   * Get context menu items using Strategy + Command pattern
   * Uses factory to select appropriate strategy and build menu
   */
  const getContextMenuItems = (node: FileNode): ContextMenuItem[] => {
    const ctx = buildMenuContext()
    const menuItems = contextMenuFactory.build(node, ctx)

    // Adapt IMenuItem to ContextMenuItem (execute -> action)
    return menuItems.map((item) => ({
      label: item.label,
      icon: item.icon,
      danger: item.danger,
      separator: item.separator,
      action: item.execute
    }))
  }

  return (
    <div
      className="project-tree"
      data-testid={TEST_IDS.PROJECT_TREE}
      data-external-drag={isExternalDragActive}
      onDragEnter={handleNativeDragEnter}
      onDragOver={handleNativeDragOver}
      onDragLeave={handleNativeDragLeave}
      onDrop={handleNativeDrop}
    >
      {isExternalDragActive && (
        <div className="external-drop-overlay" data-testid={TEST_IDS.EXTERNAL_DROP_OVERLAY} aria-hidden="true" />
      )}
      {error && (
        <div className="project-tree-error" role="alert" data-testid={TEST_IDS.PROJECT_TREE_ERROR}>
          {error}
        </div>
      )}

      <div className="project-tree-path">
        <span className="project-name">{projectPath ? getBasename(projectPath) : 'No project open'}</span>
        <div className="project-tree-actions">
          <button
            className="icon-btn"
            onClick={handleOpenProject}
            disabled={isSwitchingProject}
            title={projectPath ? 'Change project' : 'Open project'}
            aria-label={projectPath ? 'Change project' : 'Open project'}
            data-testid={TEST_IDS.PROJECT_TREE_BTN_OPEN}
          >
            {isSwitchingProject ? (
              <RotateCw size={14} strokeWidth={2} className="spin" data-testid={TEST_IDS.PROJECT_TREE_LOADING} />
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
              aria-label="Close project"
              data-testid={TEST_IDS.PROJECT_TREE_BTN_CLOSE}
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
                aria-label="Create new markdown file"
                data-testid={TEST_IDS.PROJECT_TREE_BTN_NEW_FILE}
              >
                <FilePlus size={14} strokeWidth={2} />
              </button>
              <button
                className="icon-btn"
                onClick={handleNewFolder}
                disabled={loading}
                title="Create new folder"
                aria-label="Create new folder"
                data-testid={TEST_IDS.PROJECT_TREE_BTN_NEW_FOLDER}
              >
                <FolderPlus size={14} strokeWidth={2} />
              </button>
              <button
                className="icon-btn"
                onClick={handleToolbarImport}
                disabled={isImporting}
                title={isImporting ? 'Importing file...' : 'Import a file'}
                aria-label={isImporting ? 'Importing file...' : 'Import a file'}
                data-testid={TEST_IDS.PROJECT_TREE_BTN_IMPORT}
              >
                {isImporting ? (
                  <RotateCw size={14} strokeWidth={2} className="spin" />
                ) : (
                  <FileUp size={14} strokeWidth={2} />
                )}
              </button>
              <button
                className="icon-btn"
                onClick={handleRefresh}
                disabled={isAnyRefreshing}
                title="Refresh (Cmd/Ctrl+Alt+R)"
                aria-label="Refresh project tree and git status"
                data-testid={TEST_IDS.PROJECT_TREE_BTN_REFRESH}
              >
                <RotateCw size={14} strokeWidth={2} className={isAnyRefreshing ? 'spin' : ''} />
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

      <div className="project-tree-content" role="tree" aria-label="Project files" ref={treeContainerRef}>
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
              getFileStatus={getFileStatus}
              getFolderStatus={getFolderStatus}
              isExternalDragActive={isExternalDragActive}
              externalDropTarget={externalDropTarget}
            />
          ) : (
            <div className="project-tree-empty" data-testid={TEST_IDS.PROJECT_TREE_EMPTY}>
              {projectPath ? (filterMode === 'markdown' ? 'No markdown files found' : 'No files found') : 'Open a project to get started'}
            </div>
          )}
          <DragOverlay dropAnimation={null}>
            {activeId ? (
              <div className="drag-overlay" data-testid={TEST_IDS.PROJECT_TREE_DRAG_OVERLAY}>
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

      {/* Git Status Bar (footer) - wrapped in error boundary for resilience */}
      <GitErrorBoundary>
        <GitStatusBar
          isGitRepo={isGitRepo}
          branch={branch}
          isDetached={isDetached}
          counts={counts}
          truncated={truncated}
        />
      </GitErrorBoundary>

    </div>
  )
}
