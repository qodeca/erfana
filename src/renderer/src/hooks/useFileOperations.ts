/**
 * useFileOperations Hook
 *
 * Encapsulates all file/folder CRUD operations (create, rename, delete).
 *
 * Responsibilities:
 * - Create new files and folders with dialog prompts
 * - Delete files and folders with confirmation
 * - Rename files and folders with duplicate detection
 * - Integrate with directory watcher pause/resume
 * - Show success/error toast notifications
 *
 * Extracted from ProjectTree.tsx (lines 135-460, ~325 lines)
 * Complexity reduction: Each handler ~30-50 lines, complexity d5
 */

import type { IProjectTreeApi } from '../interfaces/IProjectTreeApi'
import type { IUseFileOperationsOptions, IUseFileOperationsReturn } from '../interfaces/IFileOperationsHook'
import { useDialog } from '../components/Dialog'
import { showGlobalToast } from '../components/Toast/toastService'
import { withWatcherPause } from '../components/ProjectTree/withWatcherPause'
import { formatFileOperationError } from '../utils/errorUtils'

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
    api = window.api as unknown as IProjectTreeApi,
    projectPath,
    files,
    selectedFolder,
    setSelectedFolder,
    onFileSelect,
    refreshProjectTree,
    isInternalOperationRef,
    setFileOperationLoading
  } = options

  const { showConfirm, showRename, showNewFile, showNewFolder } = useDialog()

  /**
   * Create a new file in the current selected folder or project root
   */
  const handleNewFile = async (): Promise<void> => {
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
      const createdFilePath = await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          const filePath = await api.file.createFile(targetPath, fileName)
          await refreshProjectTree()
          return filePath
        }
      )

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
    }
  }

  /**
   * Create a new folder in the current selected folder or project root
   */
  const handleNewFolder = async (): Promise<void> => {
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
      await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          await api.file.createFolder(targetPath, folderName)
          await refreshProjectTree()
        }
      )

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
   * Delete a file with confirmation
   */
  const handleDeleteFile = async (filePath: string, fileName: string): Promise<void> => {
    const confirmed = await showConfirm({
      title: 'Delete File',
      message: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })

    if (!confirmed) return

    try {
      await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          await api.file.deleteFile(filePath)
          await refreshProjectTree()
        }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete file'
      showGlobalToast({ type: 'error', title: 'Delete Failed', message })
      console.error('Error deleting file:', err)
    }
  }

  /**
   * Delete a folder (and all contents) with confirmation
   */
  const handleDeleteFolder = async (folderPath: string, folderName: string): Promise<void> => {
    const confirmed = await showConfirm({
      title: 'Delete Folder',
      message: `Are you sure you want to delete "${folderName}" and all its contents? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })

    if (!confirmed) return

    try {
      await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          await api.file.deleteFolder(folderPath)
          await refreshProjectTree()
        }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete folder'
      showGlobalToast({ type: 'error', title: 'Delete Failed', message })
      console.error('Error deleting folder:', err)
    }
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
      await withWatcherPause(
        projectPath,
        isInternalOperationRef,
        setFileOperationLoading,
        async () => {
          await api.file.rename(path, newName)
          await refreshProjectTree()
        }
      )

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
      console.error('Error renaming item:', err)
    }
  }

  return {
    handleNewFile,
    handleNewFolder,
    handleNewFileInFolder,
    handleNewFolderInFolder,
    handleDeleteFile,
    handleDeleteFolder,
    handleRename
  }
}
