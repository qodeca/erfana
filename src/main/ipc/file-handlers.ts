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
}
