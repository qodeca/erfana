import { ipcMain, dialog, BrowserWindow } from 'electron'
import { fileService } from '../services/FileService'
import { settingsService } from '../services/SettingsService'
import { fileWatcherService } from '../services/FileWatcherService'
import { directoryWatcherService } from '../services/DirectoryWatcherService'
import { stat } from 'fs/promises'

export function registerFileHandlers(): void {
  // Open project folder
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
    const oldProjectPath = fileService.getProjectPath()

    // If same path, just return
    if (oldProjectPath === newProjectPath) {
      return newProjectPath
    }

    // Stop all existing watchers before switching
    await fileWatcherService.stopAll()
    await directoryWatcherService.stopAll()

    // Update project path across services
    fileService.setProjectPath(newProjectPath)
    fileWatcherService.setProjectPath(newProjectPath)
    directoryWatcherService.setProjectPath(newProjectPath)

    // Persist last project path
    await settingsService.setLastProjectPath(newProjectPath)

    // Notify renderers
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('project:changed', {
        oldPath: oldProjectPath,
        newPath: newProjectPath
      })
    }

    return newProjectPath
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
}
