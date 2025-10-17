import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectChanged } from '../shared/ipc/schema'
import { electronAPI } from '@electron-toolkit/preload'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
  isSymlink?: boolean
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
      ipcRenderer.invoke('file:rename', oldPath, newName),

    // Project change event listener
    onProjectChanged: (callback: (data: ProjectChanged) => void) => {
      const listener = (
        _event: unknown,
        data: ProjectChanged
      ) =>
        callback(data)
      ipcRenderer.on('project:changed', listener)
      return () => ipcRenderer.removeListener('project:changed', listener)
    },
    closeProject: (): Promise<boolean> => ipcRenderer.invoke('file:closeProject')
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
    getStats: (): Promise<{ success: boolean; stats?: unknown; error?: string }> =>
      ipcRenderer.invoke('file-watch:stats'),

    // Event listeners
    onFileChanged: (callback: (data: { filePath: string }) => void) => {
      const listener = (_event: unknown, data: { filePath: string }) => callback(data)
      ipcRenderer.on('file-watch:changed', listener)
      return () => ipcRenderer.removeListener('file-watch:changed', listener)
    },
    onFileDeleted: (callback: (data: { filePath: string }) => void) => {
      const listener = (_event: unknown, data: { filePath: string }) => callback(data)
      ipcRenderer.on('file-watch:deleted', listener)
      return () => ipcRenderer.removeListener('file-watch:deleted', listener)
    },
    onFileError: (callback: (data: { filePath: string; error: string }) => void) => {
      const listener = (_event: unknown, data: { filePath: string; error: string }) => callback(data)
      ipcRenderer.on('file-watch:error', listener)
      return () => ipcRenderer.removeListener('file-watch:error', listener)
    }
  },

  // Directory watching operations
  directoryWatch: {
    start: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('directory-watch:start', dirPath),
    stop: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('directory-watch:stop', dirPath),
    stopAll: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('directory-watch:stop-all'),
    pause: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('directory-watch:pause', dirPath),
    resume: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('directory-watch:resume', dirPath),
    getStats: (): Promise<{ success: boolean; stats?: unknown; error?: string }> =>
      ipcRenderer.invoke('directory-watch:get-stats'),

    // Event listeners
    onDirectoryChanged: (
      callback: (data: { dirPath: string; eventCount: number; summary: Record<string, number> }) => void
    ) => {
      const listener = (
        _event: unknown,
        data: { dirPath: string; eventCount: number; summary: Record<string, number> }
      ) => callback(data)
      ipcRenderer.on('directory-watch:changed', listener)
      return () => ipcRenderer.removeListener('directory-watch:changed', listener)
    },
    onProjectDeleted: (callback: (data: { dirPath: string }) => void) => {
      const listener = (_event: unknown, data: { dirPath: string }) => callback(data)
      ipcRenderer.on('directory-watch:project-deleted', listener)
      return () => ipcRenderer.removeListener('directory-watch:project-deleted', listener)
    },
    onDirectoryError: (callback: (data: { dirPath: string; error: string }) => void) => {
      const listener = (_event: unknown, data: { dirPath: string; error: string }) => callback(data)
      ipcRenderer.on('directory-watch:error', listener)
      return () => ipcRenderer.removeListener('directory-watch:error', listener)
    }
  },

  // Settings operations
  settings: {
    getProjectFilterMode: (): Promise<{ success: boolean; mode?: string; error?: string }> =>
      ipcRenderer.invoke('settings:getProjectFilterMode'),
    setProjectFilterMode: (mode: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setProjectFilterMode', mode)
  },

  // Copilot/Claude Code removed

  // Terminal operations
  terminal: {
    // Check availability
    isAvailable: (): Promise<{ success: boolean; available: boolean }> =>
      ipcRenderer.invoke('terminal:isAvailable'),

    // Create terminal
    create: (config?: {
      shell?: string
      cwd?: string
      env?: Record<string, string>
      cols?: number
      rows?: number
    }): Promise<{ success: boolean; terminalId?: string; error?: string }> =>
      ipcRenderer.invoke('terminal:create', config),

    // Write to terminal
    write: (terminalId: string, data: string): void => {
      ipcRenderer.send('terminal:write', { terminalId, data })
    },

    // Resize terminal
    resize: (terminalId: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', { terminalId, cols, rows })
    },

    // Kill terminal
    kill: (terminalId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:kill', terminalId),

    // Get terminal info
    getInfo: (terminalId: string): Promise<{
      success: boolean
      info?: { id: string; cwd: string; title: string }
      error?: string
    }> => ipcRenderer.invoke('terminal:getInfo', terminalId),

    // List terminals
    list: (): Promise<{
      success: boolean
      terminals?: Array<{ id: string; title: string }>
      error?: string
    }> => ipcRenderer.invoke('terminal:list'),

    // Event listeners
    onData: (callback: (data: { terminalId: string; data: string }) => void) => {
      const listener = (_event: unknown, data: { terminalId: string; data: string }) => callback(data)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },

    onExit: (callback: (data: { terminalId: string; exitCode: number; signal?: number }) => void) => {
      const listener = (
        _event: unknown,
        data: { terminalId: string; exitCode: number; signal?: number }
      ) => callback(data)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },

    onError: (callback: (data: { terminalId: string; error: string }) => void) => {
      const listener = (_event: unknown, data: { terminalId: string; error: string }) =>
        callback(data)
      ipcRenderer.on('terminal:error', listener)
      return () => ipcRenderer.removeListener('terminal:error', listener)
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
  ;(window as unknown as { electron: typeof electronAPI }).electron = electronAPI
  ;(window as unknown as { api: typeof api }).api = api
}
