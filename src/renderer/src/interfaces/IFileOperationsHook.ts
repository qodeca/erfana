// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File Operations Hook Interface
 *
 * Defines the contract for the useFileOperations hook, which encapsulates
 * all file/folder CRUD operations (create, rename, delete).
 *
 * This interface follows the Dependency Inversion Principle by allowing
 * the hook to accept optional dependencies for testing and flexibility.
 *
 * Extracted from ProjectTree.tsx (~300 lines of file operation logic)
 */

import type { IProjectTreeApi, FileNode } from './IProjectTreeApi'

/**
 * Options for useFileOperations hook
 */
export interface IUseFileOperationsOptions {
  /**
   * Optional API override for testing
   * Defaults to window.api if not provided
   */
  api?: IProjectTreeApi

  /**
   * Current project path (required for all operations)
   */
  projectPath: string | null

  /**
   * File tree for sibling detection in rename operations
   */
  files: FileNode[]

  /**
   * Currently selected folder (used as default parent for new file/folder)
   */
  selectedFolder: string | null

  /**
   * Callback to update selected folder state
   */
  setSelectedFolder: (folder: string | null) => void

  /**
   * Callback invoked when a new file is created (to open it in editor)
   */
  onFileSelect: (filePath: string) => void

  /**
   * Callback to refresh the file tree after operations
   */
  refreshProjectTree: () => Promise<void>

  /**
   * Ref to track internal operations (prevents watcher false positives)
   */
  isInternalOperationRef: React.MutableRefObject<boolean>

  /**
   * Loading state setter for file operations
   */
  setFileOperationLoading: (loading: boolean) => void

  /**
   * Optional callback to refresh git status after file operations
   * Triggers git status update to show badges on new/modified files
   */
  onGitRefresh?: () => void
}

/**
 * Return value from useFileOperations hook
 *
 * Provides file/folder operation handlers
 */
export interface IUseFileOperationsReturn {
  /**
   * Create a new file in the current selected folder or project root
   * - Shows file name input dialog
   * - Creates file via IPC
   * - Refreshes tree
   * - Opens file in editor
   */
  handleNewFile: () => Promise<void>

  /**
   * Create a new folder in the current selected folder or project root
   * - Shows folder name input dialog
   * - Creates folder via IPC
   * - Refreshes tree
   */
  handleNewFolder: () => Promise<void>

  /**
   * Create a new file in a specific folder
   * - Sets selectedFolder to targetPath
   * - Delegates to handleNewFile
   * - Used by context menu
   */
  handleNewFileInFolder: (folderPath: string) => void

  /**
   * Create a new folder in a specific folder
   * - Sets selectedFolder to targetPath
   * - Delegates to handleNewFolder
   * - Used by context menu
   */
  handleNewFolderInFolder: (folderPath: string) => void

  /**
   * Delete a file with confirmation
   * - Shows confirmation dialog
   * - Deletes file via IPC
   * - Refreshes tree
   */
  handleDeleteFile: (filePath: string, fileName: string) => Promise<void>

  /**
   * Delete a folder (and all contents) with confirmation
   * - Shows confirmation dialog
   * - Deletes folder via IPC
   * - Refreshes tree
   */
  handleDeleteFolder: (folderPath: string, folderName: string) => Promise<void>

  /**
   * Rename a file or folder
   * - Shows rename dialog with duplicate detection
   * - Renames item via IPC
   * - Refreshes tree
   * - Shows success/error toast
   */
  handleRename: (path: string, currentName: string, itemType: 'file' | 'directory') => Promise<void>
}
