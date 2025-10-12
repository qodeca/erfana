import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
}

export interface FileStats {
  size: number
  modified: Date
  created: Date
}

// Custom APIs for renderer
const api = {
  // File operations
  file: {
    openProject: (): Promise<string | null> => ipcRenderer.invoke('file:openProject'),
    getLastProjectPath: (): Promise<string | null> =>
      ipcRenderer.invoke('file:getLastProjectPath'),
    readDirectory: (dirPath: string): Promise<FileNode[]> =>
      ipcRenderer.invoke('file:readDirectory', dirPath),
    readFile: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('file:readFile', filePath),
    writeFile: (filePath: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke('file:writeFile', filePath, content),
    getStats: (filePath: string): Promise<FileStats> =>
      ipcRenderer.invoke('file:getStats', filePath),
    getProjectPath: (): Promise<string | null> => ipcRenderer.invoke('file:getProjectPath'),
    createFile: (dirPath: string, fileName: string): Promise<string> =>
      ipcRenderer.invoke('file:createFile', dirPath, fileName),
    createFolder: (dirPath: string, folderName: string): Promise<string> =>
      ipcRenderer.invoke('file:createFolder', dirPath, folderName),
    deleteFile: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('file:deleteFile', filePath),
    deleteFolder: (folderPath: string): Promise<boolean> =>
      ipcRenderer.invoke('file:deleteFolder', folderPath),
    rename: (oldPath: string, newName: string): Promise<string> =>
      ipcRenderer.invoke('file:rename', oldPath, newName)
  },

  // File watching operations
  fileWatch: {
    start: (filePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file-watch:start', filePath),
    stop: (filePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file-watch:stop', filePath),
    stopAll: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file-watch:stopAll'),
    pause: (filePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file-watch:pause', filePath),
    resume: (filePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file-watch:resume', filePath),
    getStats: (): Promise<{ success: boolean; stats?: any; error?: string }> =>
      ipcRenderer.invoke('file-watch:stats'),

    // Event listeners
    onFileChanged: (callback: (data: { filePath: string }) => void) => {
      const listener = (_event: any, data: { filePath: string }) => callback(data)
      ipcRenderer.on('file-watch:changed', listener)
      return () => ipcRenderer.removeListener('file-watch:changed', listener)
    },
    onFileDeleted: (callback: (data: { filePath: string }) => void) => {
      const listener = (_event: any, data: { filePath: string }) => callback(data)
      ipcRenderer.on('file-watch:deleted', listener)
      return () => ipcRenderer.removeListener('file-watch:deleted', listener)
    },
    onFileError: (callback: (data: { filePath: string; error: string }) => void) => {
      const listener = (_event: any, data: { filePath: string; error: string }) => callback(data)
      ipcRenderer.on('file-watch:error', listener)
      return () => ipcRenderer.removeListener('file-watch:error', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
