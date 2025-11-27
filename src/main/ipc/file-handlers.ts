import { ipcMain, dialog, BrowserWindow } from 'electron'
import { stat } from 'fs/promises'
import { ProjectService } from '../services/ProjectService'
import { fileService } from '../services/FileService'
import { fileWatcherService } from '../services/FileWatcherService'
import { directoryWatcherService } from '../services/DirectoryWatcherService'
import { settingsService } from '../services/SettingsService'
import type { ProjectChanged } from '../../shared/ipc/schema'

/**
 * Broadcast project change to all renderer processes
 * Used by handlers that need to notify renderers of project changes
 */
export function broadcastProjectChanged(payload: ProjectChanged): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('project:changed', payload)
      } catch {
        // ignore send errors for destroyed windows
      }
    }
  }
}

// REFACTORING (todo017): Create ProjectService singleton for orchestration
// Thin adapter pattern: IPC handler depends on service, not orchestration logic
const projectService = new ProjectService(
  fileService,
  fileWatcherService,
  directoryWatcherService,
  settingsService
)

/**
 * Common logic for opening a project by path
 * Used by both file:openProject (dialog) and file:openProjectByPath (direct)
 *
 * REFACTORING (todo017): Simplified to thin adapter delegating to ProjectService
 */
async function openProjectByPath(newProjectPath: string): Promise<string> {
  const result = await projectService.switchProject(newProjectPath)

  if (!result.success) {
    throw new Error(result.error || 'Unknown error')
  }

  return result.path
}

export function registerFileHandlers(): void {
  // Open project folder via dialog
  ipcMain.handle('file:openProject', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Folder',
      buttonLabel: 'Open Project'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const newProjectPath = result.filePaths[0]
    return await openProjectByPath(newProjectPath)
  })

  // Open project folder by path (for recent projects, etc.)
  ipcMain.handle('file:openProjectByPath', async (_event, projectPath: string) => {
    // Input validation
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('Invalid project path: must be a non-empty string')
    }

    // Trim whitespace
    const trimmedPath = projectPath.trim()
    if (!trimmedPath) {
      throw new Error('Invalid project path: path is empty after trimming')
    }

    return await openProjectByPath(trimmedPath)
  })

  // Get last opened project path if it still exists
  ipcMain.handle('file:getLastProjectPath', async () => {
    const lastPath = await settingsService.getLastProjectPath()
    if (!lastPath) {
      return null
    }

    // Verify the folder still exists
    try {
      const stats = await stat(lastPath)
      if (stats.isDirectory()) {
        fileService.setProjectPath(lastPath)
        // Keep watchers in sync with restored project path
        try {
          fileWatcherService.setProjectPath(lastPath)
        } catch (e) {
          console.warn('Failed to set FileWatcherService projectPath on restore:', e)
        }
        try {
          directoryWatcherService.setProjectPath(lastPath)
        } catch (e) {
          console.warn('Failed to set DirectoryWatcherService projectPath on restore:', e)
        }
        // NOTE: Do NOT call addRecentProject here!
        // It's only called in openProjectByPath() to avoid duplicate writes
        // and ensure single source of truth for recent projects updates
        return lastPath
      }
    } catch {
      // Folder doesn't exist anymore, clear from settings
      await settingsService.clearLastProjectPath()
    }

    return null
  })

  // Read directory structure
  ipcMain.handle('file:readDirectory', async (_event, dirPath: string) => {
    try {
      return await fileService.readDirectory(dirPath)
    } catch (error) {
      console.error('Error reading directory:', error)
      throw error
    }
  })

  // Read file content
  ipcMain.handle('file:readFile', async (_event, filePath: string) => {
    try {
      return await fileService.readFile(filePath)
    } catch (error) {
      console.error('Error reading file:', error)
      throw error
    }
  })

  // Write file content
  ipcMain.handle('file:writeFile', async (_event, filePath: string, content: string) => {
    try {
      await fileService.writeFile(filePath, content)
      return true
    } catch (error) {
      console.error('Error writing file:', error)
      throw error
    }
  })

  // Get file stats
  ipcMain.handle('file:getStats', async (_event, filePath: string) => {
    try {
      const stats = await fileService.getFileStats(filePath)
      return {
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime
      }
    } catch (error) {
      console.error('Error getting file stats:', error)
      throw error
    }
  })

  // Get current project path
  ipcMain.handle('file:getProjectPath', async () => {
    return fileService.getProjectPath()
  })

  // Close current project
  ipcMain.handle('file:closeProject', async () => {
    const oldProjectPath = fileService.getProjectPath()

    if (!oldProjectPath) return true

    // Stop all watchers
    await fileWatcherService.stopAll()
    await directoryWatcherService.stopAll()

    // Clear project path in services
    fileService.setProjectPath('')
    fileWatcherService.setProjectPath('')
    directoryWatcherService.setProjectPath('')

    // Clear last project path from settings
    await settingsService.clearLastProjectPath()

    // Notify renderers of closed project
    const payload: ProjectChanged = {
      oldPath: oldProjectPath,
      newPath: null
    }
    broadcastProjectChanged(payload)

    return true
  })

  // Create new file
  ipcMain.handle('file:createFile', async (_event, dirPath: string, fileName: string) => {
    try {
      // Validate inputs
      if (!dirPath || typeof dirPath !== 'string') {
        throw new Error('Invalid directory path')
      }
      if (!fileName || typeof fileName !== 'string') {
        throw new Error('Invalid file name')
      }

      // Sanitize filename to prevent path traversal
      const sanitizedFileName = fileName.replace(/[/\\]/g, '')
      if (!sanitizedFileName) {
        throw new Error('Invalid file name')
      }

      const createdFilePath = await fileService.createFile(dirPath, sanitizedFileName)
      return createdFilePath
    } catch (error) {
      console.error('Error creating file:', error)
      throw error
    }
  })

  // Create new folder
  ipcMain.handle('file:createFolder', async (_event, dirPath: string, folderName: string) => {
    try {
      // Validate inputs
      if (!dirPath || typeof dirPath !== 'string') {
        throw new Error('Invalid directory path')
      }
      if (!folderName || typeof folderName !== 'string') {
        throw new Error('Invalid folder name')
      }

      // Sanitize folder name to prevent path traversal
      const sanitizedFolderName = folderName.replace(/[/\\]/g, '')
      if (!sanitizedFolderName) {
        throw new Error('Invalid folder name')
      }

      const createdFolderPath = await fileService.createFolder(dirPath, sanitizedFolderName)
      return createdFolderPath
    } catch (error) {
      console.error('Error creating folder:', error)
      throw error
    }
  })

  // Delete file
  ipcMain.handle('file:deleteFile', async (_event, filePath: string) => {
    try {
      // Validate input
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path')
      }

      await fileService.deleteFile(filePath)
      return true
    } catch (error) {
      console.error('Error deleting file:', error)
      throw error
    }
  })

  // Delete folder
  ipcMain.handle('file:deleteFolder', async (_event, folderPath: string) => {
    try {
      // Validate input
      if (!folderPath || typeof folderPath !== 'string') {
        throw new Error('Invalid folder path')
      }

      await fileService.deleteFolder(folderPath)
      return true
    } catch (error) {
      console.error('Error deleting folder:', error)
      throw error
    }
  })

  // Rename file or folder
  ipcMain.handle('file:rename', async (_event, oldPath: string, newName: string) => {
    try {
      // Validate inputs
      if (!oldPath || typeof oldPath !== 'string') {
        throw new Error('Invalid path')
      }
      if (!newName || typeof newName !== 'string') {
        throw new Error('Invalid name')
      }

      // Sanitize new name to prevent path traversal
      const sanitizedName = newName.replace(/[/\\]/g, '')
      if (!sanitizedName) {
        throw new Error('Invalid name')
      }

      const newPath = await fileService.rename(oldPath, sanitizedName)
      return newPath
    } catch (error) {
      console.error('Error renaming:', error)
      throw error
    }
  })

  // Move file or folder
  ipcMain.handle('file:moveItem', async (_event, sourcePath: string, targetParentPath: string, newName?: string, replaceExisting?: boolean) => {
    try {
      // Validate inputs
      if (!sourcePath || typeof sourcePath !== 'string') {
        throw new Error('Invalid source path')
      }
      if (!targetParentPath || typeof targetParentPath !== 'string') {
        throw new Error('Invalid target path')
      }
      if (newName !== undefined && typeof newName !== 'string') {
        throw new Error('Invalid new name')
      }
      if (replaceExisting !== undefined && typeof replaceExisting !== 'boolean') {
        throw new Error('Invalid replaceExisting flag')
      }

      // Sanitize new name if provided
      let sanitizedNewName: string | undefined = newName
      if (newName) {
        sanitizedNewName = newName.replace(/[/\\]/g, '')
        if (!sanitizedNewName) {
          throw new Error('Invalid new name')
        }
      }

      const newPath = await fileService.moveItem(sourcePath, targetParentPath, sanitizedNewName, replaceExisting)
      return newPath
    } catch (error) {
      console.error('Error moving item:', error)
      throw error
    }
  })

  // Copy file or folder
  ipcMain.handle('file:copyItem', async (_event, sourcePath: string, targetParentPath: string, newName?: string) => {
    try {
      // Validate inputs
      if (!sourcePath || typeof sourcePath !== 'string') {
        throw new Error('Invalid source path')
      }
      if (!targetParentPath || typeof targetParentPath !== 'string') {
        throw new Error('Invalid target path')
      }
      if (newName !== undefined && typeof newName !== 'string') {
        throw new Error('Invalid new name')
      }

      // Sanitize new name if provided
      let sanitizedNewName: string | undefined = newName
      if (newName) {
        sanitizedNewName = newName.replace(/[/\\]/g, '')
        if (!sanitizedNewName) {
          throw new Error('Invalid new name')
        }
      }

      const newPath = await fileService.copyItem(sourcePath, targetParentPath, sanitizedNewName)
      return newPath
    } catch (error) {
      console.error('Error copying item:', error)
      throw error
    }
  })

  // Check name conflict
  ipcMain.handle('file:checkConflict', async (_event, targetParentPath: string, itemName: string) => {
    try {
      // Validate inputs
      if (!targetParentPath || typeof targetParentPath !== 'string') {
        throw new Error('Invalid target path')
      }
      if (!itemName || typeof itemName !== 'string') {
        throw new Error('Invalid item name')
      }

      const hasConflict = await fileService.checkNameConflict(targetParentPath, itemName)
      return hasConflict
    } catch (error) {
      console.error('Error checking conflict:', error)
      throw error
    }
  })

  // Validate file path exists and return info
  // Note: projectRoot is optional to allow validation of absolute paths from terminal output.
  // When projectRoot is provided, path traversal protection is enforced.
  // When omitted, only absolute paths that the user can see in terminal output are validated.
  // This is acceptable because:
  // 1. Terminal output comes from user-initiated commands (not external input)
  // 2. The user can already see and access any file path shown in their terminal
  // 3. This handler only checks existence, it doesn't read or modify files
  ipcMain.handle('file:validatePath', async (_event, filePath: string, projectRoot?: string) => {
    try {
      // Validate input
      if (!filePath || typeof filePath !== 'string') {
        return { exists: false, error: 'Invalid file path' }
      }

      const trimmedPath = filePath.trim()
      if (!trimmedPath) {
        return { exists: false, error: 'Empty file path' }
      }

      // Security check: if projectRoot provided, ensure path is within it
      if (projectRoot) {
        const path = await import('path')
        const resolvedPath = path.resolve(trimmedPath)
        const resolvedRoot = path.resolve(projectRoot)
        if (!resolvedPath.startsWith(resolvedRoot)) {
          return { exists: false, error: 'Path outside project root' }
        }
      }

      // Check if file exists and is a file (not directory)
      const stats = await stat(trimmedPath)
      if (!stats.isFile()) {
        return { exists: false, error: 'Path is not a file' }
      }

      return {
        exists: true,
        absolutePath: trimmedPath,
        isFile: true
      }
    } catch (error) {
      // ENOENT means file doesn't exist - this is expected, not an error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { exists: false }
      }
      // Other errors (permissions, etc.)
      return {
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
}
