import { ipcMain, dialog } from 'electron'
import { fileService } from '../services/FileService'

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

    const projectPath = result.filePaths[0]
    fileService.setProjectPath(projectPath)
    return projectPath
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
}
