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
    getStats: (): Promise<{ success: boolean; stats?: any; error?: string }> =>
      ipcRenderer.invoke('directory-watch:get-stats'),

    // Event listeners
    onDirectoryChanged: (
      callback: (data: { dirPath: string; eventCount: number; summary: any }) => void
    ) => {
      const listener = (
        _event: any,
        data: { dirPath: string; eventCount: number; summary: any }
      ) => callback(data)
      ipcRenderer.on('directory-watch:changed', listener)
      return () => ipcRenderer.removeListener('directory-watch:changed', listener)
    },
    onProjectDeleted: (callback: (data: { dirPath: string }) => void) => {
      const listener = (_event: any, data: { dirPath: string }) => callback(data)
      ipcRenderer.on('directory-watch:project-deleted', listener)
      return () => ipcRenderer.removeListener('directory-watch:project-deleted', listener)
    },
    onDirectoryError: (callback: (data: { dirPath: string; error: string }) => void) => {
      const listener = (_event: any, data: { dirPath: string; error: string }) => callback(data)
      ipcRenderer.on('directory-watch:error', listener)
      return () => ipcRenderer.removeListener('directory-watch:error', listener)
    }
  },

  // Settings operations
  settings: {
    getApprovedTools: (): Promise<{ success: boolean; tools?: string[]; error?: string }> =>
      ipcRenderer.invoke('settings:getApprovedTools'),
    setApprovedTools: (
      tools: string[]
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setApprovedTools', tools),
    addApprovedTool: (
      toolName: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:addApprovedTool', toolName),
    removeApprovedTool: (
      toolName: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:removeApprovedTool', toolName),
    resetApprovedTools: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:resetApprovedTools'),
    getProjectFilterMode: (): Promise<{ success: boolean; mode?: string; error?: string }> =>
      ipcRenderer.invoke('settings:getProjectFilterMode'),
    setProjectFilterMode: (mode: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setProjectFilterMode', mode)
  },

  // Claude Code operations - Persistent Session Architecture
  claudeCode: {
    // Session lifecycle
    startSession: (projectPath: string, planningMode?: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('claudeCode:startSession', projectPath, planningMode),

    stopSession: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('claudeCode:stopSession'),

    getSessionState: (): Promise<{
      success: boolean
      state?: 'stopped' | 'starting' | 'ready' | 'error'
      error?: string
    }> => ipcRenderer.invoke('claudeCode:getSessionState'),

    // Send message (event-based for streaming)
    sendMessage: (prompt: string, context: any, sessionId: string): void => {
      ipcRenderer.send('claudeCode:sendMessage', { prompt, context, sessionId })
    },

    // Stop generation (not supported in persistent mode)
    stop: (): void => {
      ipcRenderer.send('claudeCode:stop')
    },

    // CLI installation and authentication
    isInstalled: (): Promise<boolean> => ipcRenderer.invoke('claudeCode:isInstalled'),

    checkAuth: (): Promise<{
      isAuthenticated: boolean
      username?: string
      error?: string
    }> => ipcRenderer.invoke('claudeCode:checkAuth'),

    setToken: (token: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('claudeCode:setToken', token),

    // Tool approval (always persists to settings)
    approveTool: (
      toolName: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('claudeCode:approveTool', toolName),

    denyTool: (toolName: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('claudeCode:denyTool', toolName),

    // Event listeners - Messages
    onMessage: (callback: (data: { sessionId: string; message: any }) => void) => {
      const listener = (_event: any, data: { sessionId: string; message: any }) => callback(data)
      ipcRenderer.on('claudeCode:message', listener)
      return () => ipcRenderer.removeListener('claudeCode:message', listener)
    },

    // Streaming message updates (--include-partial-messages)
    onMessageUpdate: (callback: (data: { message: any }) => void) => {
      const listener = (_event: any, data: { message: any }) => callback(data)
      ipcRenderer.on('claudeCode:messageUpdate', listener)
      return () => ipcRenderer.removeListener('claudeCode:messageUpdate', listener)
    },

    onMessageComplete: (callback: (data: { message: any }) => void) => {
      const listener = (_event: any, data: { message: any }) => callback(data)
      ipcRenderer.on('claudeCode:messageComplete', listener)
      return () => ipcRenderer.removeListener('claudeCode:messageComplete', listener)
    },

    onComplete: (callback: (data: { sessionId: string }) => void) => {
      const listener = (_event: any, data: { sessionId: string }) => callback(data)
      ipcRenderer.on('claudeCode:complete', listener)
      return () => ipcRenderer.removeListener('claudeCode:complete', listener)
    },

    onError: (callback: (data: { sessionId: string; error: string }) => void) => {
      const listener = (_event: any, data: { sessionId: string; error: string }) => callback(data)
      ipcRenderer.on('claudeCode:error', listener)
      return () => ipcRenderer.removeListener('claudeCode:error', listener)
    },

    // Event listeners - Session lifecycle
    onSessionStarted: (callback: (data: { projectPath: string }) => void) => {
      const listener = (_event: any, data: { projectPath: string }) => callback(data)
      ipcRenderer.on('claudeCode:sessionStarted', listener)
      return () => ipcRenderer.removeListener('claudeCode:sessionStarted', listener)
    },

    onSessionStopped: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('claudeCode:sessionStopped', listener)
      return () => ipcRenderer.removeListener('claudeCode:sessionStopped', listener)
    },

    onSessionRestarting: (
      callback: (data: { attempt: number; maxAttempts: number }) => void
    ) => {
      const listener = (_event: any, data: { attempt: number; maxAttempts: number }) =>
        callback(data)
      ipcRenderer.on('claudeCode:sessionRestarting', listener)
      return () => ipcRenderer.removeListener('claudeCode:sessionRestarting', listener)
    },

    onSessionError: (callback: (error: { message: string; recoverable: boolean }) => void) => {
      const listener = (_event: any, error: { message: string; recoverable: boolean }) =>
        callback(error)
      ipcRenderer.on('claudeCode:sessionError', listener)
      return () => ipcRenderer.removeListener('claudeCode:sessionError', listener)
    },

    // Event listeners - Tool approval
    onToolApprovalNeeded: (
      callback: (request: {
        toolName: string
        toolId: string
        input: any
        description: string
      }) => void
    ) => {
      const listener = (
        _event: any,
        request: { toolName: string; toolId: string; input: any; description: string }
      ) => callback(request)
      ipcRenderer.on('claudeCode:toolApprovalNeeded', listener)
      return () => ipcRenderer.removeListener('claudeCode:toolApprovalNeeded', listener)
    },

    onSessionResumed: (
      callback: (data: { projectPath: string; approvedTools: string[] }) => void
    ) => {
      const listener = (
        _event: any,
        data: { projectPath: string; approvedTools: string[] }
      ) => callback(data)
      ipcRenderer.on('claudeCode:sessionResumed', listener)
      return () => ipcRenderer.removeListener('claudeCode:sessionResumed', listener)
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
