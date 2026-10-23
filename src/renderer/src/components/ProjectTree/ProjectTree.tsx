// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { FilePlus, FolderPlus, FolderOpen, Replace, FileText, Files, FileUp, RotateCw, X as CloseIcon } from 'lucide-react'
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import type { FileNode } from '../../../../preload/index'
import type { FilterMode } from '../../types/filters'
import { ProjectTreeNode, TREE_ROW_HEIGHT } from './ProjectTreeNode'
import { buildVisibleRows, dropTargetPath, isNodeRow, placeholderKey } from './visibleRows'
import { TreePlaceholderRow } from './TreePlaceholderRow'
import { filterMarkdownTree } from './markdownFilter'
import { resolveInternalDropFolder, isSameFolderMove } from './dropTarget'
import { isKeyboardContextMenu, rowMenuAnchor, KEYBOARD_MENU_ECHO_MS, type PointerPress } from './contextMenuOrigin'
import { resolveTreeKey, findTypeAheadMatch, isTypeAheadKey } from './treeKeyboard'
import { isStrictDescendant } from '../../utils/fileUtils'
import { ContextMenu, ContextMenuItem } from '../ContextMenu/ContextMenu'
import { useDialog } from '../Dialog'
import type { DropModeDialogResult, ConflictDialogResult } from '../Dialog/types'
import './ProjectTree.css'
import { showGlobalToast } from '../Toast/toastService'
import { isPointInElement } from '../../utils/domGeometry'
import { getBasename, getDirname } from '../../utils/fileUtils'
import { openFileInPanel } from '../../utils/openFileInPanel'
import { openInDefaultBrowser } from '../Panels/HtmlPreviewPanel/previewOpenInBrowser'
import { useProjectStore } from '../../stores/useProjectStore'
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
  type DroppableContainer,
  pointerWithin,
  rectIntersection
} from '@dnd-kit/core'
import { useDragDropTree } from '../../hooks/useDragDropTree'
import { useClipboardStore } from '../../stores/useClipboardStore'
import { formatFileOperationError } from '../../utils/errorUtils'
import { DRAG_DROP, AUTO_EXPAND } from './constants'
import { withWatcherPause } from './withWatcherPause'
import { useLazyFolderChildren } from './useLazyFolderChildren'
import { logger } from '../../utils/logger'
import { getLastSeenProjectGeneration } from '../../services/projectGeneration'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { formatShortcut } from '../../utils/shortcutLabel'
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
import { isTreeClipboardKeystroke, treeClipboardAction } from './treeClipboardScope'
import { isMacOS } from '../../utils/platform'
import { useTreeFocusRecovery, findTreeFocusFallback } from './useTreeFocusRecovery'
import { fileGateway } from '../../services/fileGateway'
import { moveExternalBatch, type PendingExternalMove } from './externalMoveBatch'
import { refuseOversizedDrop } from './externalDropLimit'

interface ProjectTreeProps {
  onFileSelect: (filePath: string) => void
  showControlPanel: boolean
  filterMode: FilterMode
  onFilterModeChange: (mode: FilterMode) => void
}

/**
 * Collision detection that prioritises folders over files.
 *
 * Pointer intersection first (immediate feedback while dragging), narrowed to
 * directory targets when there are any, with rectangle intersection as the
 * fallback for pointer-less collisions.
 *
 * Two properties matter for large trees:
 * - Each collision already carries the container it came from in
 *   `data.droppableContainer` (`pointerWithin` populates it), so the type is
 *   read off the entry instead of scanning `args.droppableContainers` once per
 *   collision — that scan was O(collisions x droppables) on every pointer move,
 *   with one droppable per rendered row.
 * - It lives at module scope, so its identity is stable across renders and
 *   `DndContext` is never handed a fresh `collisionDetection` prop.
 */
const treeCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)

  if (pointerCollisions.length > 0) {
    const directoryCollisions = pointerCollisions.filter(collision => {
      const container = collision.data?.droppableContainer as DroppableContainer | undefined
      return container?.data.current?.type === 'directory'
    })

    if (directoryCollisions.length > 0) {
      return directoryCollisions
    }

    return pointerCollisions
  }

  // Fallback to rectangle intersection
  return rectIntersection(args)
}

/**
 * The expansion set a project starts from: its root row, and nothing else.
 *
 * Shared by the two places that seed it — the lazy `useState` initializer (a
 * remount, e.g. a project switch) and the project-changed callback (an in-place
 * change, e.g. closing a project) — so the two can never disagree about what
 * "freshly opened" looks like.
 *
 * @param path - The project path, or `null`/empty when no project is open
 * @returns A new set holding the root path, or an empty one
 */
function seedExpansion(path: string | null): Set<string> {
  return path ? new Set([path]) : new Set()
}

/** Rows rendered above and below the viewport, so a fast scroll does not show blanks. */
const TREE_OVERSCAN = 10

/** Type-ahead forgets what was typed after this long without a key (APG tree view). */
const TYPE_AHEAD_RESET_MS = 500

/** dnd-kit's screen-reader markup goes to the body, outside role="tree". */
const TREE_DND_ACCESSIBILITY = { container: typeof document !== 'undefined' ? document.body : undefined }

/** The mounted row element for `path`, if it is in range (paths compared as data, not as a selector). */
function findMountedRow(container: HTMLElement, path: string): HTMLElement | null {
  for (const row of container.querySelectorAll<HTMLElement>('.project-tree-item[data-path]')) {
    if (row.dataset.path === path) return row
  }
  return null
}

/** The focusable tree row a keyboard or focus event came from, if any. */
function rowFromEventTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement && target.matches('.project-tree-item[data-path]') ? target : null
}

export function ProjectTree({ onFileSelect, showControlPanel, filterMode, onFilterModeChange }: ProjectTreeProps) {
  // UI-specific state (not managed by hooks)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const isInternalOperation = useRef(false)

  // Project lifecycle management via context (singleton - avoids duplicate IPC listeners)
  const {
    projectPath,
    files: baseFiles,
    loading,
    error,
    isSwitchingProject,
    initialLoadComplete,
    handleOpenProject,
    handleCloseProject,
    refreshFiles
  } = useProjectManagementContext()

  // Seeded from the CURRENT project path rather than starting empty (#60).
  // ProjectPanel keys the tree's error boundary by project path, so opening or
  // switching a project REMOUNTS this component: any expansion the
  // project-changed callback below wrote into the outgoing instance dies with
  // it, and an empty initial set renders the new project fully collapsed. The
  // lazy initializer runs on the remount itself, when the context already
  // carries the new path, so the root is expanded on first paint.
  // Declared after the context read for that reason – it needs `projectPath`.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() =>
    seedExpansion(projectPath)
  )

  // The tree as rendered and operated on: the base tree with the children of
  // the lazy folders (ignored, or past the walk's cap) read on expand
  // Only lazy folders in view are read: below the root row, through the filter shown
  const lazyView = useMemo(
    () => ({ rootPath: projectPath, filter: filterMode === 'markdown' ? filterMarkdownTree : undefined }),
    [projectPath, filterMode]
  )
  const {
    tree: files,
    status: lazyStatus,
    loaded: lazyLoaded
  } = useLazyFolderChildren(baseFiles, expandedFolders, lazyView)

  // Register for project change notifications to reset UI state.
  // Still required for IN-PLACE changes (a project change that does not remount
  // this component, e.g. closing a project): the initializer only runs on mount.
  useProjectChangedEffect((newPath) => {
    // Reset UI state when project changes
    setExpandedFolders(seedExpansion(newPath))
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
  const treeContainerRef = useRef<HTMLDivElement | null>(null)
  const lastMousePositionRef = useRef<{ x: number; y: number } | null>(null)

  // Drag-drop hooks.
  // `findNode` resolves the base tree only; `findNodeWithRoot` also resolves
  // the synthetic project root. Both are Map-backed – never scan the flattened
  // array here, or the root-inclusion policy stops living in one module.
  const { findNode, findNodeWithRoot, isDescendant } = useDragDropTree(files, projectPath)
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

  // Project management (loading, switching, closing) now handled by useProjectManagement hook

  const handleFileClick = (filePath: string) => {
    // Find the node to determine type (root-inclusive: clicking the project
    // root selects it as a paste target)
    const node = findNodeWithRoot(filePath, rootFolderNode)

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
      // Send the generation this window last saw: a stale close must not close a newer project
      fileGateway.closeProject({ expectedGeneration: getLastSeenProjectGeneration() }).catch(err => {
        logger.error('Error closing deleted project', err instanceof Error ? err : undefined)
      })
      setExpandedFolders(new Set())
    },
    onError: (error) => {
      logger.error('Directory watch error', undefined, { error })
    }
  })

  /**
   * Apply filtering based on current filter mode. In Markdown mode a lazy
   * folder is judged by what is known of it (`markdownFilter.ts`, #320).
   */
  const filteredFiles = useMemo(() => {
    if (filterMode === 'all') {
      return files
    } else {
      // A lazy folder read against an older base tree counts as unread (#320)
      return filterMarkdownTree(files, lazyLoaded, lazyStatus, baseFiles)
    }
  }, [files, filterMode, lazyLoaded, lazyStatus, baseFiles])

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

  // Stable identity (setter-only), so the memoised rows are not re-rendered by it.
  const handleToggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath)
      } else {
        newSet.add(folderPath)
      }
      return newSet
    })
  }, [])

  /** Open or close one folder, leaving the set untouched when it is already in that state. */
  const setFolderExpanded = useCallback((folderPath: string, expand: boolean) => {
    setExpandedFolders((prev) => {
      if (prev.has(folderPath) === expand) return prev
      const newSet = new Set(prev)
      if (expand) newSet.add(folderPath)
      else newSet.delete(folderPath)
      return newSet
    })
  }, [])

  // Context menu handlers (stable identity: refs and the setter only).
  // The last pointer press on the tree, and the last menu the keyboard opened
  // – together they tell a right-click from a key-made native event
  // (contextMenuOrigin.ts).
  const lastPointerPressRef = useRef<PointerPress | null>(null)
  const keyboardMenuRef = useRef<{ path: string; at: number } | null>(null)
  const handleTreePointerDownCapture = useCallback((e: React.PointerEvent) => {
    lastPointerPressRef.current = { x: e.clientX, y: e.clientY, at: performance.now() }
  }, [])
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    const now = performance.now()
    const pointerType = (e.nativeEvent as Partial<PointerEvent>).pointerType
    if (!isKeyboardContextMenu({ clientX: e.clientX, clientY: e.clientY, pointerType }, lastPointerPressRef.current, now)) {
      setContextMenu({ x: e.clientX, y: e.clientY, node })
      return
    }
    // Keyboard-made (Windows turns the Menu key into a native event at the
    // row's centre). If keydown already opened this row's menu, this is its
    // echo: keep the one menu where it is.
    const opened = keyboardMenuRef.current
    keyboardMenuRef.current = null
    if (opened !== null && opened.path === node.path && now - opened.at <= KEYBOARD_MENU_ECHO_MS) return
    setContextMenu({ ...rowMenuAnchor(e.currentTarget), node })
  }, [])

  // ---------------------------------------------------------------------------
  // Visible rows, virtualisation and keyboard (#87, review finding [33])
  // ---------------------------------------------------------------------------

  // The expanded part of the tree as a flat list: what the virtualiser renders
  // and what the arrow keys walk. Rebuilt only when the tree or the expansion
  // changes – never on a selection, focus or drag-hover change.
  const { rows: visibleRows, indexByPath } = useMemo(
    () => buildVisibleRows(rootFolderNode, expandedFolders, lazyStatus),
    [rootFolderNode, expandedFolders, lazyStatus]
  )

  // The row that holds the tree's one Tab stop (roving tabindex). Follows DOM
  // focus (`handleTreeFocus`); falls back to the selection, then to the first
  // row, when that row is no longer visible (collapsed away, deleted).
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const tabStopIndex = useMemo(() => {
    if (focusedPath !== null && indexByPath.has(focusedPath)) return indexByPath.get(focusedPath)!
    if (selectedFolder !== null && indexByPath.has(selectedFolder)) return indexByPath.get(selectedFolder)!
    return visibleRows.length > 0 ? 0 : -1
  }, [focusedPath, selectedFolder, indexByPath, visibleRows.length])
  const dragIndex = activeId !== null ? indexByPath.get(activeId) ?? -1 : -1

  // Always render the Tab-stop row and the row being dragged, even when they
  // are scrolled out of view. If the focused row unmounted on a wheel scroll,
  // focus would fall to <body> (and focus recovery would yank the scroll
  // back); if the dragged row unmounted, dnd-kit would lose its active node.
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range)
    for (const pinned of [tabStopIndex, dragIndex]) {
      if (pinned >= 0 && pinned < range.count && !indexes.includes(pinned)) indexes.push(pinned)
    }
    return indexes.sort((a, b) => a - b)
  }, [tabStopIndex, dragIndex])

  // The scroll container is padded; the list starts that far into it.
  const [listOffset, setListOffset] = useState(0)
  useLayoutEffect(() => {
    const container = treeContainerRef.current
    if (!container) return
    const padding = parseFloat(getComputedStyle(container).paddingTop)
    setListOffset(Number.isFinite(padding) ? padding : 0)
  }, [rootFolderNode])

  // The rule warns that React Compiler skips this component; the app does not
  // build with the compiler, and the virtualizer is only read during render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => treeContainerRef.current,
    estimateSize: () => TREE_ROW_HEIGHT,
    getItemKey: (index) => {
      const row = visibleRows[index]
      return isNodeRow(row) ? row.node.path : placeholderKey(row.folderPath)
    },
    overscan: TREE_OVERSCAN,
    scrollMargin: listOffset,
    rangeExtractor
  })

  // A keyboard move to a row that is not mounted yet parks its path here; the
  // layout effect below focuses it once the row renders. Only then: a row that
  // is already mounted is focused at once, so nothing is left parked to fire
  // on some later, unrelated render.
  const pendingFocusRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const path = pendingFocusRef.current
    const container = treeContainerRef.current
    if (path === null || !container) return
    // Never pull focus back from outside: a pending move only completes while
    // the keyboard is still in the tree (or focus fell to <body>, which is
    // where a removed row leaves it).
    const active = document.activeElement
    if (active !== null && active !== document.body && !container.contains(active)) {
      pendingFocusRef.current = null
      return
    }
    const row = findMountedRow(container, path)
    if (row) {
      pendingFocusRef.current = null
      row.focus({ preventScroll: true })
    }
  })

  const moveFocusTo = useCallback((index: number) => {
    const row = visibleRows[index]
    const container = treeContainerRef.current
    // A placeholder line is never focused (lazy folders, #320)
    if (!isNodeRow(row) || !container) return
    virtualizer.scrollToIndex(index, { align: 'auto' })
    setFocusedPath(row.node.path)
    const mounted = findMountedRow(container, row.node.path)
    if (mounted) {
      pendingFocusRef.current = null
      mounted.focus({ preventScroll: true })
    } else {
      pendingFocusRef.current = row.node.path
    }
  }, [visibleRows, virtualizer])

  // Focus leaving the tree cancels a parked move (see the layout effect).
  const handleTreeBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget
    if (next instanceof Node && e.currentTarget.contains(next)) return
    pendingFocusRef.current = null
  }

  // A rename or delete removes the focused row; focus goes to the nearest row
  // that still exists in the DATA – the same path, else the nearest ancestor
  // folder, else the first row – even if that row is scrolled out of range.
  const focusFallbackRef = useRef<(lostPath: string) => void>(() => {})
  focusFallbackRef.current = (lostPath: string) => {
    const index = findTreeFocusFallback(lostPath, indexByPath)
    if (index !== null) moveFocusTo(index)
  }
  useTreeFocusRecovery(treeContainerRef, focusFallbackRef)

  // Type-ahead buffer: characters typed in quick succession form one query.
  const typeAheadRef = useRef<{ query: string; timer: ReturnType<typeof setTimeout> | null }>({ query: '', timer: null })
  useEffect(() => () => {
    if (typeAheadRef.current.timer) clearTimeout(typeAheadRef.current.timer)
  }, [])

  const handleCloseContextMenu = () => {
    setContextMenu(null)
  }

  // Remaining handlers now provided by useFileOperations hook

  // Auto-scroll while dragging near the tree's top or bottom edge is dnd-kit's
  // own (`DndContext` autoScroll, on by default), driven by the live pointer.
  // The tree's former interval read `activatorEvent.clientY` – the pointer
  // position when the drag STARTED – so it scrolled on a stale position.

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

  // Track mouse position globally during drag (more reliable than @dnd-kit delta).
  // Deliberately silent: this runs on every pointermove/mousemove of a drag, so
  // logging here floods the log file (and the IPC bridge) at pointer rate. The
  // position that actually matters is recorded once in `handleDragEnd`.
  const handlePointerEvent = useCallback((e: PointerEvent | MouseEvent) => {
    lastMousePositionRef.current = { x: e.clientX, y: e.clientY }
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
    // Over a lazy folder's placeholder line means over the folder (#320)
    const overRaw = event.over?.id as string | null | undefined
    const newOverId = overRaw ? dropTargetPath(overRaw) : null

    // Handle auto-expand
    if (newOverId && newOverId !== overId) {
      // Moved to a new target
      cancelAutoExpandTimer()

      // Check if the new target is a collapsed folder
      const overNode = findNodeWithRoot(newOverId, rootFolderNode)
      if (overNode && overNode.type === 'directory' && !expandedFolders.has(newOverId)) {
        startAutoExpandTimer(newOverId)
      }
    }

    setOverId(newOverId)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    // Cleanup timers and state
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

        const formattedPath = useTerminalStore.getState().formatPathsForActiveTerminal([sourcePath])
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
    // A drop on a lazy folder's placeholder line lands in the folder (#320)
    const targetPath = dropTargetPath(over.id as string)

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
    const targetNode = findNodeWithRoot(targetPath, rootFolderNode)
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

    // Dropped next to itself (on a sibling, or on its own folder): nothing to
    // move, so end quietly instead of asking main to move it onto itself.
    if (isSameFolderMove(sourcePath, targetParent)) {
      logger.info('Drag ended in the item\'s own folder - nothing to move')
      return
    }

    try {
      const result = await withWatcherPause(projectPath, isInternalOperation, setFileOperationLoading, async () => {
        // Execute move
        const moveResult = await fileGateway.moveItem({ sourcePath, targetParentPath: targetParent })
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

  /**
   * Execute a clipboard paste into `targetPath`.
   *
   * Memoized because `handlePaste` (and therefore the cut/copy/paste keydown
   * listener) depends on it: an unstable identity here would silently pin the
   * listener to a stale project path / refresh callback.
   */
  const executePaste = useCallback(async (targetPath: string, replaceExisting: boolean) => {
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
  }, [projectPath, clipboard, refreshProjectTree])

  /**
   * Paste the clipboard item into `targetFolder` (defaults to the selection).
   *
   * Memoized and listed in the keydown effect's deps: this is the destructive
   * path (a cut+replace deletes the target), so it must never run against a
   * closure captured on an earlier render.
   */
  const handlePaste = useCallback(async (targetFolder?: string) => {
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
        const hasConflict = await fileGateway.checkConflict({ targetParentPath: targetPath, itemName: sourceItemName })

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
  }, [selectedFolder, clipboard, showConfirm, executePaste])

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

      // Cmd+X/C/V on macOS, Ctrl+X/C/V elsewhere
      const action = treeClipboardAction(e, isMacOS())
      if (action !== null && selectedFolder) {
        // Only when the keystroke belongs to the tree ([27]): otherwise a
        // folder clicked earlier hijacked Cmd+C on selected text elsewhere.
        if (!isTreeClipboardKeystroke(treeContainerRef.current, document.activeElement, window.getSelection())) {
          return
        }
        // Root-EXCLUSIVE on purpose: the synthetic project root must not
        // resolve here, which is what keeps it non-cuttable / non-copyable.
        const node = findNode(selectedFolder)
        if (!node) return

        if (action === 'cut') {
          // Cut
          e.preventDefault()
          clipboard.cut(node.path, node.name, node.type)
          logger.info('Cut', { nodeName: node.name })
          showGlobalToast({
            title: 'Cut',
            message: `"${node.name}" ready to move`,
            type: 'info'
          })
        } else if (action === 'copy') {
          // Copy
          e.preventDefault()
          clipboard.copy(node.path, node.name, node.type)
          logger.info('Copy', { nodeName: node.name })
          showGlobalToast({
            title: 'Copied',
            message: `"${node.name}" ready to paste`,
            type: 'info'
          })
        } else if (action === 'paste' && clipboard.hasClipboard()) {
          // Paste
          e.preventDefault()
          handlePaste()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFolder, findNode, clipboard, handlePaste])

  /**
   * Execute external file drop operation (Spec #012)
   *
   * Handles the complete workflow for dropped external files:
   * 0. Refuse a drop over the file limit ("Too many files"), before any question
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

    // A drop too large to add is refused before the user is asked how to add it
    if (refuseOversizedDrop(droppedFiles.length)) return

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

    // Step 3: Validate each file and settle its name conflict. Copies run as they go;
    // moves are collected and sent together (below), so the user is asked once
    let successCount = 0
    let failCount = 0
    const pendingMoves: PendingExternalMove[] = []

    for (const file of droppedFiles) {
      try {
        // Validate file still exists and is valid
        const validation = await fileGateway.validateExternal({ sourcePath: file.path })

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
        const hasConflict = await fileGateway.checkConflict({ targetParentPath: targetFolder, itemName: file.name })

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
          pendingMoves.push({ file, conflictResolution })
        } else if (mode === 'copy') {
          const result = await fileGateway.copyFromExternal({
            sourcePath: file.path,
            targetFolder,
            conflictResolution
          })

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

    // Step 3b: One request for all the moves: main shows ONE confirmation box
    if (pendingMoves.length > 0) {
      const outcome = await moveExternalBatch(fileGateway, pendingMoves, targetFolder)
      successCount += outcome.successCount
      failCount += outcome.failCount
    }

    // Step 3c: Refresh tree and show summary
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
    const result = await fileGateway.selectExternalFiles()
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
          const stats = await fileGateway.getStats({ filePath })
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
          const node = findNodeWithRoot(selectedFolder, rootFolderNode)
          if (node && node.type === 'directory') {
            e.preventDefault()
            handleImportShortcut(selectedFolder)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFolder, findNodeWithRoot, rootFolderNode, handleImportShortcut])

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
    api: fileGateway,
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
    importFile,
    // "Open as source" bypasses the running preview and opens the `.html` file
    // in Monaco. The editor-area dockview API lives in the project store (the
    // same seam MarkdownEditorPanel uses); pinning `kind: 'editor'` skips the
    // preview eligibility check entirely.
    openAsSource: (filePath: string) => {
      openFileInPanel(useProjectStore.getState().dockviewApi ?? undefined, filePath, {
        kind: 'editor'
      })
    },
    // The same action as the preview toolbar's button, so both raise the same toasts (#124).
    openInBrowser: openInDefaultBrowser
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

  // `handleFileClick` reads the current tree and selection, so it changes on
  // every render. The rows get a stable wrapper instead; it always calls the
  // latest version, and the memoised rows are not re-rendered by it.
  const handleFileClickRef = useRef(handleFileClick)
  handleFileClickRef.current = handleFileClick
  const handleRowClick = useCallback((filePath: string) => handleFileClickRef.current(filePath), [])

  /** Roving tabindex: the row that takes DOM focus becomes the Tab stop. */
  const handleTreeFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const row = rowFromEventTarget(e.target)
    const path = row?.dataset.path
    if (path !== undefined && path !== focusedPath) setFocusedPath(path)
  }

  /**
   * The tree's keyboard contract (WAI-ARIA APG tree view, decided by
   * design/system/components/row/index.html); the key → action mapping lives
   * in `treeKeyboard.ts`. Keys only count when a row has focus, so nothing
   * here reaches a keystroke meant for a dialog or input elsewhere.
   */
  const handleTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const row = rowFromEventTarget(e.target)
    const index = row?.dataset.path !== undefined ? indexByPath.get(row.dataset.path) : undefined
    if (row === null || index === undefined) return

    const action = resolveTreeKey(visibleRows, index, e)
    if (action === null) {
      if (!isTypeAheadKey(e)) return
      const buffer = typeAheadRef.current
      if (buffer.timer) clearTimeout(buffer.timer)
      buffer.query += e.key
      buffer.timer = setTimeout(() => { buffer.query = ''; buffer.timer = null }, TYPE_AHEAD_RESET_MS)
      const match = findTypeAheadMatch(visibleRows, index, buffer.query)
      if (match !== null) {
        e.preventDefault()
        moveFocusTo(match)
      }
      return
    }

    e.preventDefault()
    const focused = visibleRows[index]
    if (!isNodeRow(focused)) return
    const { node } = focused
    switch (action.type) {
      case 'focus':
        moveFocusTo(action.index)
        break
      case 'expand':
        setFolderExpanded(action.path, true)
        break
      case 'collapse':
        setFolderExpanded(action.path, false)
        break
      case 'activate':
        // Exactly what a click does: a folder toggles and becomes the paste
        // target, a file opens.
        if (node.type === 'directory') handleToggleFolder(node.path)
        handleFileClick(node.path)
        break
      case 'menu': {
        // Shift+F10 / the Menu key: open the menu under the row, not at a
        // pointer position the keyboard user never set. Handled here on every
        // platform; a native `contextmenu` that Windows sends after it is
        // recognised as its echo in handleContextMenu, so there is one menu.
        keyboardMenuRef.current = { path: node.path, at: performance.now() }
        setContextMenu({ ...rowMenuAnchor(row), node })
        break
      }
    }
  }

  const virtualItems = virtualizer.getVirtualItems()
  // Drop feedback for the folder a drag will land in (see dropTarget.ts).
  const internalDropFolder = useMemo(
    () => resolveInternalDropFolder(visibleRows, indexByPath, activeId, overId),
    [activeId, overId, indexByPath, visibleRows]
  )
  const isCut = clipboard.operation === 'cut'

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
                title={`Refresh (${formatShortcut('R', { mod: true, alt: true })})`}
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

      <div
        className="project-tree-content"
        role="tree"
        aria-label="Project files"
        ref={treeContainerRef}
        onKeyDown={handleTreeKeyDown}
        onFocus={handleTreeFocus}
        onBlur={handleTreeBlur}
        onPointerDownCapture={handleTreePointerDownCapture}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={treeCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          // dnd-kit renders its live region and instructions next to the
          // rows; inside role="tree" they would be children a tree may not
          // own (only treeitem and group). Render them at the body instead.
          accessibility={TREE_DND_ACCESSIBILITY}
        >
          {rootFolderNode ? (
            // Only the rows in (and just around) the viewport are mounted; the
            // sizer gives the scroll container the height of the whole list.
            <div className="project-tree-rows" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((item) => {
                const row = visibleRows[item.index]
                if (!isNodeRow(row)) {
                  return (
                    <TreePlaceholderRow
                      key={item.key}
                      folderPath={row.folderPath}
                      level={row.level}
                      status={row.status}
                      top={item.start - listOffset}
                    />
                  )
                }
                const { node } = row
                const dropZone =
                  internalDropFolder !== null && isStrictDescendant(internalDropFolder, node.path)
                    ? 'internal'
                    : externalDropTarget !== null && isStrictDescendant(externalDropTarget, node.path)
                      ? 'external'
                      : null
                return (
                  <ProjectTreeNode
                    key={item.key}
                    node={node}
                    level={row.level}
                    posInSet={row.posInSet}
                    setSize={row.setSize}
                    parentPath={row.parentPath}
                    top={item.start - listOffset}
                    isExpanded={row.isExpanded}
                    isBusy={row.isExpanded && lazyStatus.get(node.path) === 'loading'}
                    // "Selected" = the paste-target folder; see the prop's doc.
                    isSelected={node.path === selectedFolder}
                    isTabStop={item.index === tabStopIndex}
                    onFileClick={handleRowClick}
                    onContextMenu={handleContextMenu}
                    onToggleFolder={handleToggleFolder}
                    isDragging={activeId === node.path}
                    isDropTarget={internalDropFolder === node.path}
                    clipboardCut={isCut && clipboard.itemPath === node.path}
                    inDropZone={dropZone}
                    gitStatus={node.type === 'file' ? getFileStatus(node.path) : getFolderStatus(node.path)}
                    isExternalDragActive={isExternalDragActive}
                    isExternalDropTarget={externalDropTarget === node.path}
                  />
                )
              })}
            </div>
          ) : (
            <div className="project-tree-empty" data-testid={TEST_IDS.PROJECT_TREE_EMPTY}>
              {projectPath ? (filterMode === 'markdown' ? 'No markdown files found' : 'No files found') : 'Open a project to get started'}
            </div>
          )}
          <DragOverlay dropAnimation={null}>
            {activeId ? (
              <div className="drag-overlay" data-testid={TEST_IDS.PROJECT_TREE_DRAG_OVERLAY}>
                <span className="file-name">
                  {findNodeWithRoot(activeId, rootFolderNode)?.name}
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
