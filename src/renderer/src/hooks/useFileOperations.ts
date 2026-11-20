// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useFileOperations Hook
 *
 * Encapsulates the tree toolbar's create and rename operations. Delete lives in
 * the context-menu commands (`context-menu/deleteCommands.ts`, #486).
 *
 * Responsibilities:
 * - Create new files and folders with dialog prompts
 * - Rename files and folders with duplicate detection
 * - Integrate with directory watcher pause/resume
 * - Show success/error toast notifications
 *
 * Extracted from ProjectTree.tsx (lines 135-460, ~325 lines)
 * Complexity reduction: Each handler ~30-50 lines, complexity d5
 */

import { getDefaultProjectTreeApi } from '../services/projectTreeApi'
import type { IUseFileOperationsOptions, IUseFileOperationsReturn } from '../interfaces/IFileOperationsHook'
import { useDialog } from '../components/Dialog'
import { showGlobalToast } from '../components/Toast/toastService'
import { withWatcherPause } from '../components/ProjectTree/withWatcherPause'
import { formatFileOperationError } from '../utils/errorUtils'
import { logger } from '../utils/logger'
import {
  getTargetPath,
  isValidTargetPath,
  getRelativePath,
  extractParentPath,
  getSiblingNames,
  createRenameSuccessMessage,
  formatCreateFileError,
  formatCreateFolderError,
  createFileCreationErrorLog,
  createFolderCreationErrorLog,
  createRenameErrorLog
} from './useFileOperations.logic'

/**
 * Hook for managing file/folder operations
 *
 * @param options - Configuration and callbacks
 * @returns File operation handlers
 */
export function useFileOperations(
  options: IUseFileOperationsOptions
): IUseFileOperationsReturn {
  const {
    api = getDefaultProjectTreeApi(),
    projectPath,
    files,
    selectedFolder,
    setSelectedFolder,
    onFileSelect,
    refreshProjectTree,
    isInternalOperationRef,
    setFileOperationLoading,
    onGitRefresh
  } = options

  const { showRename, showNewFile, showNewFolder } = useDialog()

  /**
   * Create a new file in the current selected folder or project root
   */
  const handleNewFile = async (): Promise<void> => {
    const targetPath = getTargetPath(selectedFolder, projectPath)
    if (!isValidTargetPath(targetPath)) return

    const relativePath = getRelativePath(targetPath!, projectPath)
    const fileName = await showNewFile({
      title: 'Create New File',
      message: '',
      parentPath: relativePath,
      inputPlaceholder: 'notes.md'
    })

    if (!fileName) return

    try {
      const createdFilePath = await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          const filePath = await api.file.createFile({ dirPath: targetPath!, name: fileName })
          await refreshProjectTree()
          return filePath
        }
      )

      onFileSelect(createdFilePath)
      setSelectedFolder(null)
      onGitRefresh?.() // Refresh git status to show badge on new file
    } catch (err) {
      const errorMessage = formatCreateFileError(err)
      showGlobalToast({ type: 'error', title: 'Operation Failed', message: errorMessage })
      logger.error(createFileCreationErrorLog(), err instanceof Error ? err : undefined)
    }
  }

  /**
   * Create a new folder in the current selected folder or project root
   */
  const handleNewFolder = async (): Promise<void> => {
    const targetPath = getTargetPath(selectedFolder, projectPath)
    if (!isValidTargetPath(targetPath)) return

    const relativePath = getRelativePath(targetPath!, projectPath)
    const folderName = await showNewFolder({
      title: 'Create New Folder',
      message: '',
      parentPath: relativePath,
      inputPlaceholder: 'new-folder'
    })

    if (!folderName) return

    try {
      await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          await api.file.createFolder({ dirPath: targetPath!, name: folderName })
          await refreshProjectTree()
        }
      )

      setSelectedFolder(null)
      onGitRefresh?.() // Refresh git status
    } catch (err) {
      const errorMessage = formatCreateFolderError(err)
      showGlobalToast({ type: 'error', title: 'Operation Failed', message: errorMessage })
      logger.error(createFolderCreationErrorLog(), err instanceof Error ? err : undefined)
    }
  }

  /**
   * Create a new file in a specific folder (used by context menu)
   */
  const handleNewFileInFolder = (folderPath: string): void => {
    setSelectedFolder(folderPath)
    // handleNewFile will run async, but we don't await here
    // because this is called from a synchronous context menu handler
    handleNewFile()
  }

  /**
   * Create a new folder in a specific folder (used by context menu)
   */
  const handleNewFolderInFolder = (folderPath: string): void => {
    setSelectedFolder(folderPath)
    // handleNewFolder will run async, but we don't await here
    // because this is called from a synchronous context menu handler
    handleNewFolder()
  }

  /**
   * Rename a file or folder with duplicate detection
   */
  const handleRename = async (
    path: string,
    currentName: string,
    itemType: 'file' | 'directory'
  ): Promise<void> => {
    // Extract parent directory path
    const parentPath = extractParentPath(path)

    // Get existing sibling names for duplicate detection
    const existingNames = getSiblingNames(files, path, currentName)

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
      await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          await api.file.rename({ oldPath: path, newName })
          await refreshProjectTree()
        }
      )

      showGlobalToast({
        title: 'Success',
        message: createRenameSuccessMessage(),
        type: 'success'
      })
      onGitRefresh?.() // Refresh git status after rename
    } catch (err) {
      const errorMessage = formatFileOperationError(err, 'rename')
      showGlobalToast({
        title: 'Error',
        message: errorMessage,
        type: 'error'
      })
      logger.error(createRenameErrorLog(), err instanceof Error ? err : undefined)
    }
  }

  return {
    handleNewFile,
    handleNewFolder,
    handleNewFileInFolder,
    handleNewFolderInFolder,
    handleRename
  }
}
