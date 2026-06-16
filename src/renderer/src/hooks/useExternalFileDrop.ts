// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * External File Drop Hook
 *
 * Handles drag-and-drop operations from external sources (Finder, file managers, desktop)
 * into the project tree. Provides detection, validation, visual feedback, and file extraction.
 *
 * @module useExternalFileDrop
 * @see Spec #012 External File Drop to Project Tree
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { AUTO_EXPAND } from '../components/ProjectTree/constants'
import { logger } from '../utils/logger'
import { isPathInside } from '../utils/fileUtils'

/**
 * Represents a file dropped from an external source.
 * Contains the file path and metadata needed for move/copy/import operations.
 */
export interface ExternalDropFile {
  /** Absolute path to the file on the local filesystem */
  path: string
  /** File name (basename) */
  name: string
  /** File size in bytes (explicit naming for consistency with ImportFileInfo) */
  sizeInBytes: number
  /**
   * Whether the dropped item is a directory.
   * Directories are filtered out per FR-011 (silently reject folder drops).
   */
  isDirectory: boolean
}

/**
 * Configuration options for the external file drop hook.
 */
export interface UseExternalFileDropOptions {
  /** Current project root path, or null if no project is open */
  projectPath: string | null
  /** Set of currently expanded folder paths in the tree */
  expandedFolders: Set<string>
  /** State setter to update expanded folders (for auto-expand feature) */
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>
}

/**
 * Result returned by the useExternalFileDrop hook.
 * Contains state and event handlers for external drag-drop operations.
 */
export interface UseExternalFileDropResult {
  // State
  /** True when an external drag is active over the project tree */
  isExternalDragActive: boolean
  /** Path of the folder currently being hovered during external drag, or null */
  externalDropTarget: string | null

  // Event handlers (attach to container)
  /** Handler for dragenter events on the project tree container */
  handleDragEnter: (e: DragEvent) => void
  /** Handler for dragover events - must call preventDefault to allow drop */
  handleDragOver: (e: DragEvent) => void
  /** Handler for dragleave events on the project tree container */
  handleDragLeave: (e: DragEvent) => void
  /** Handler for drop events - extracts and returns dropped files */
  handleDrop: (e: DragEvent) => ExternalDropFile[] | null

  // Helpers
  /** Validates whether a path is a valid drop target (folder within project) */
  isValidDropTarget: (path: string, isDirectory: boolean) => boolean
  /** Extracts the target folder path from a drag event's target element */
  getTargetFromEvent: (e: DragEvent) => string | null
}

/**
 * Detects whether a drag event contains external files.
 *
 * External drags are distinguished from internal dnd-kit drags by checking
 * for the 'Files' type in dataTransfer.types. This is the standard HTML5
 * DataTransfer API indicator for file drags from the OS.
 *
 * @param e - The drag event to check
 * @returns True if the drag contains external files
 *
 * @example
 * ```typescript
 * function handleDragEnter(e: DragEvent) {
 *   if (isExternalDrag(e)) {
 *     // Handle external file drag
 *   } else {
 *     // Let dnd-kit handle internal drag
 *   }
 * }
 * ```
 */
export function isExternalDrag(e: DragEvent): boolean {
  // dataTransfer.types is a DOMStringList containing the types of data being dragged
  // For external file drags, it includes 'Files' (standard HTML5 drag-drop API)
  // Internal dnd-kit drags do not set this type
  return e.dataTransfer?.types.includes('Files') ?? false
}

/**
 * Extracts file information from dropped files.
 *
 * In Electron, dropped files include the full filesystem path via a non-standard
 * `path` property on the File object. This function extracts that path along with
 * file metadata.
 *
 * Platform handling:
 * - macOS/Linux: Paths are POSIX format (e.g., /Users/name/file.txt)
 * - Windows: Paths are Windows format (e.g., C:\Users\name\file.txt)
 * Electron provides the correct format for each platform automatically.
 *
 * @param files - FileList from the drop event's dataTransfer
 * @returns Array of ExternalDropFile objects with path and metadata
 *
 * @example
 * ```typescript
 * const dropFiles = extractDroppedFiles(e.dataTransfer.files);
 * // Filter out directories per FR-011
 * const filesToProcess = dropFiles.filter(f => !f.isDirectory);
 * ```
 */
export function extractDroppedFiles(files: FileList): ExternalDropFile[] {
  const result: ExternalDropFile[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]

    // In sandboxed Electron (default since Electron 20), the File.path property
    // is not available. Use webUtils.getPathForFile() via the preload API instead.
    // This is the recommended approach for getting file paths in modern Electron.
    let filePath: string | null = null

    try {
      // Use Electron's webUtils.getPathForFile() exposed via preload
      filePath = window.api.utils.getPathForFile(file)
    } catch {
      logger.warn('Failed to get file path via webUtils', { fileName: file.name })
    }

    if (filePath) {
      // Directory detection heuristic (M3 documented limitation):
      // Directories dropped from Finder/file managers have type='' and size=0.
      // LIMITATION: This has false positives for empty files (0 bytes) which
      // also match this pattern. Empty files will be treated as directories
      // and filtered out. This is acceptable because:
      // 1. Empty files are rarely intentionally dropped for import
      // 2. Users can still import empty files via the dialog (selectFile API)
      // A more reliable check would require async fs.stat() call per file.
      const isDirectory = file.type === '' && file.size === 0

      result.push({
        path: filePath,
        name: file.name,
        sizeInBytes: file.size,
        isDirectory
      })
    } else {
      // Fallback for non-Electron environments (should not happen in production)
      logger.warn('Dropped file without path - not in Electron context or webUtils unavailable', { fileName: file.name })
    }
  }

  return result
}

/**
 * Custom hook for handling external file drops into the project tree.
 *
 * This hook manages the complete lifecycle of external drag-drop operations:
 * 1. Detection of external drags (vs internal dnd-kit drags)
 * 2. Visual feedback state (active drag, hover target)
 * 3. Auto-expand folders after hover delay
 * 4. Drop target validation (folders within project only)
 * 5. File path extraction from dropped files
 *
 * The hook integrates with the existing project tree drag-drop system by:
 * - Using the same AUTO_EXPAND.HOVER_DELAY constant (1 second)
 * - Reusing expanded folders state for auto-expand
 * - Providing data attributes for CSS-based visual feedback
 *
 * @param options - Configuration including project path and folder state
 * @returns Object containing state, event handlers, and helper functions
 *
 * @example
 * ```tsx
 * function ProjectTree() {
 *   const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
 *
 *   const {
 *     isExternalDragActive,
 *     externalDropTarget,
 *     handleDragEnter,
 *     handleDragOver,
 *     handleDragLeave,
 *     handleDrop
 *   } = useExternalFileDrop({
 *     projectPath: '/path/to/project',
 *     expandedFolders,
 *     setExpandedFolders
 *   });
 *
 *   return (
 *     <div
 *       data-external-drag={isExternalDragActive}
 *       onDragEnter={handleDragEnter}
 *       onDragOver={handleDragOver}
 *       onDragLeave={handleDragLeave}
 *       onDrop={handleDrop}
 *     >
 *       {// ... tree nodes}
 *     </div>
 *   );
 * }
 * ```
 */
export function useExternalFileDrop(
  options: UseExternalFileDropOptions
): UseExternalFileDropResult {
  const { projectPath, expandedFolders, setExpandedFolders } = options

  // State for external drag tracking
  const [isExternalDragActive, setIsExternalDragActive] = useState(false)
  const [externalDropTarget, setExternalDropTarget] = useState<string | null>(null)

  // Ref for auto-expand timer (must be ref to avoid stale closure issues)
  const autoExpandTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Track current hover target for timer management
  const currentHoverTargetRef = useRef<string | null>(null)

  // Track drag enter count to handle nested elements
  // (dragenter fires for each child element entered)
  const dragEnterCountRef = useRef(0)

  /**
   * Clears the auto-expand timer if one is active.
   * Called when hover target changes or drag ends.
   */
  const cancelAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current)
      autoExpandTimerRef.current = null
    }
  }, [])

  /**
   * Starts auto-expand timer for a collapsed folder.
   * After HOVER_DELAY (1 second), the folder will expand automatically.
   *
   * @param folderPath - Path of the folder to auto-expand
   */
  const startAutoExpandTimer = useCallback((folderPath: string) => {
    // Cancel any existing timer first
    cancelAutoExpandTimer()

    // Don't auto-expand if already expanded
    if (expandedFolders.has(folderPath)) {
      return
    }

    // Set timer to expand folder after delay
    autoExpandTimerRef.current = setTimeout(() => {
      logger.info('Auto-expanding folder during external drag', { folderPath })
      setExpandedFolders(prev => new Set([...prev, folderPath]))
      autoExpandTimerRef.current = null
    }, AUTO_EXPAND.HOVER_DELAY)
  }, [expandedFolders, setExpandedFolders, cancelAutoExpandTimer])

  /**
   * Validates whether a path is a valid drop target.
   *
   * Valid targets must:
   * - Be a directory (isDirectory = true)
   * - Be within the project root (starts with projectPath)
   *
   * @param path - The path to validate
   * @param isDirectory - Whether the path is a directory
   * @returns True if the path is a valid drop target
   */
  const isValidDropTarget = useCallback((path: string, isDirectory: boolean): boolean => {
    // Must be a folder
    if (!isDirectory) {
      return false
    }

    // Must have a project open
    if (!projectPath) {
      return false
    }

    // UX-level drop-target gate; authoritative project confinement is enforced
    // main-side in ExternalFileService (NFR-004). isPathInside treats an equal
    // path as inside, so dropping ON the project root remains a valid target.
    // Handles both POSIX and Windows separators.
    return isPathInside(projectPath, path)
  }, [projectPath])

  /**
   * Extracts the target folder path from a drag event's target element.
   *
   * Walks up the DOM tree from the event target looking for elements with
   * data-path and data-type attributes that indicate a tree node.
   *
   * @param e - The drag event
   * @returns The folder path if hovering over a valid folder, null otherwise
   */
  const getTargetFromEvent = useCallback((e: DragEvent): string | null => {
    const target = e.target as HTMLElement

    // Walk up the DOM tree looking for a tree node with path data
    let current: HTMLElement | null = target
    while (current) {
      const path = current.dataset?.path
      const type = current.dataset?.type

      if (path && type === 'directory') {
        return path
      }

      // Also check for the root folder (project path)
      if (path && current.classList.contains('project-tree-item')) {
        // Get type from parent or data attribute
        if (current.classList.contains('directory')) {
          return path
        }
      }

      current = current.parentElement
    }

    // If no specific folder found but we're in the tree, use project root
    // This allows dropping at the root level
    if (projectPath && target.closest('.project-tree-content')) {
      return projectPath
    }

    return null
  }, [projectPath])

  /**
   * Handles dragenter events.
   * Activates external drag mode and sets initial hover target.
   */
  const handleDragEnter = useCallback((e: DragEvent) => {
    // Only handle external drags (not dnd-kit internal drags)
    if (!isExternalDrag(e)) {
      return
    }

    // Increment enter count (handle nested elements)
    dragEnterCountRef.current++

    // Only set active on first enter
    if (dragEnterCountRef.current === 1) {
      setIsExternalDragActive(true)
      logger.info('External drag entered project tree')
    }

    // Update hover target
    const targetPath = getTargetFromEvent(e)
    if (targetPath !== currentHoverTargetRef.current) {
      currentHoverTargetRef.current = targetPath
      setExternalDropTarget(targetPath)

      // Start auto-expand timer if hovering over collapsed folder
      if (targetPath && !expandedFolders.has(targetPath)) {
        startAutoExpandTimer(targetPath)
      } else {
        cancelAutoExpandTimer()
      }
    }
  }, [getTargetFromEvent, expandedFolders, startAutoExpandTimer, cancelAutoExpandTimer])

  /**
   * Handles dragover events.
   * Must call preventDefault to indicate drop is allowed.
   * Also updates hover target as mouse moves.
   */
  const handleDragOver = useCallback((e: DragEvent) => {
    // Only handle external drags
    if (!isExternalDrag(e)) {
      return
    }

    // CRITICAL: Must prevent default to allow drop
    e.preventDefault()

    // Set drop effect based on target validity
    const targetPath = getTargetFromEvent(e)
    if (targetPath && isValidDropTarget(targetPath, true)) {
      e.dataTransfer!.dropEffect = 'copy'
    } else {
      e.dataTransfer!.dropEffect = 'none'
    }

    // Update hover target if changed
    if (targetPath !== currentHoverTargetRef.current) {
      currentHoverTargetRef.current = targetPath
      setExternalDropTarget(targetPath)

      // Manage auto-expand timer
      if (targetPath && !expandedFolders.has(targetPath)) {
        startAutoExpandTimer(targetPath)
      } else {
        cancelAutoExpandTimer()
      }
    }
  }, [getTargetFromEvent, isValidDropTarget, expandedFolders, startAutoExpandTimer, cancelAutoExpandTimer])

  /**
   * Handles dragleave events.
   * Deactivates external drag mode when leaving the tree container.
   */
  const handleDragLeave = useCallback((e: DragEvent) => {
    // Only handle external drags
    if (!isExternalDrag(e)) {
      return
    }

    // Decrement enter count
    dragEnterCountRef.current--

    // Only deactivate when fully leaving the tree
    if (dragEnterCountRef.current <= 0) {
      dragEnterCountRef.current = 0
      setIsExternalDragActive(false)
      setExternalDropTarget(null)
      currentHoverTargetRef.current = null
      cancelAutoExpandTimer()
      logger.info('External drag left project tree')
    }
  }, [cancelAutoExpandTimer])

  /**
   * Handles drop events.
   * Extracts dropped files and returns them for processing.
   * Directories are filtered out per FR-011.
   *
   * @returns Array of dropped files (excluding directories), or null if invalid drop
   */
  const handleDrop = useCallback((e: DragEvent): ExternalDropFile[] | null => {
    // Reset state
    dragEnterCountRef.current = 0
    setIsExternalDragActive(false)
    setExternalDropTarget(null)
    currentHoverTargetRef.current = null
    cancelAutoExpandTimer()

    // Only handle external drags
    if (!isExternalDrag(e)) {
      return null
    }

    // Prevent default browser behavior (opening file)
    e.preventDefault()

    // Validate drop target
    const targetPath = getTargetFromEvent(e)
    if (!targetPath || !isValidDropTarget(targetPath, true)) {
      logger.warn('External drop on invalid target', { targetPath })
      return null
    }

    // Extract files from dataTransfer
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) {
      logger.warn('External drop with no files')
      return null
    }

    const droppedFiles = extractDroppedFiles(files)

    // Filter out directories per FR-011 (silently reject folder drops)
    const filesToProcess = droppedFiles.filter(f => !f.isDirectory)

    if (filesToProcess.length === 0) {
      // All dropped items were directories - silently reject
      logger.info('External drop contained only directories, rejected per FR-011')
      return null
    }

    logger.info('External drop processed', {
      totalDropped: droppedFiles.length,
      filesAccepted: filesToProcess.length,
      directoriesRejected: droppedFiles.length - filesToProcess.length,
      targetPath
    })

    return filesToProcess
  }, [getTargetFromEvent, isValidDropTarget, cancelAutoExpandTimer])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      cancelAutoExpandTimer()
    }
  }, [cancelAutoExpandTimer])

  return {
    // State
    isExternalDragActive,
    externalDropTarget,

    // Event handlers
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,

    // Helpers
    isValidDropTarget,
    getTargetFromEvent
  }
}
