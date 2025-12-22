import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { ProjectChanged } from '../shared/ipc/schema'
import type { GitStatusResponse } from '../shared/ipc/git-schema'
import type { PdfExportRequest, PdfExportResponse } from '../shared/ipc/pdf-schema'
import type { DocxExportRequest, DocxExportResponse } from '../shared/ipc/docx-schema'
import type { GlobalSettings, GlobalSettingsChanged } from '../shared/ipc/global-settings-schema'
import type { LogEntry } from '../shared/ipc/logging-schema'
import type { GitStateChangeEvent, GitWatcherStatus, GitPollTriggeredEvent } from '../shared/ipc/git-watcher-schema'
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
    openProjectByPath: (projectPath: string): Promise<string> => ipcRenderer.invoke('file:openProjectByPath', projectPath),
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
    moveItem: (sourcePath: string, targetParentPath: string, newName?: string, replaceExisting?: boolean): Promise<string> =>
      ipcRenderer.invoke('file:moveItem', sourcePath, targetParentPath, newName, replaceExisting),
    copyItem: (sourcePath: string, targetParentPath: string, newName?: string): Promise<string> =>
      ipcRenderer.invoke('file:copyItem', sourcePath, targetParentPath, newName),
    checkConflict: (targetParentPath: string, itemName: string): Promise<boolean> =>
      ipcRenderer.invoke('file:checkConflict', targetParentPath, itemName),
    validatePath: (filePath: string, projectRoot?: string): Promise<{
      exists: boolean
      absolutePath?: string
      isFile?: boolean
      error?: string
    }> => ipcRenderer.invoke('file:validatePath', filePath, projectRoot),

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

  /**
   * Git index watching (for external git operations: git add, checkout, reset, etc.)
   * @deprecated Use gitWatcher API instead. This API will be removed in a future version.
   * @see gitWatcher - New unified git watcher API with broader coverage (index, HEAD, refs, fetch, stash)
   */
  gitIndexWatch: {
    start: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-index-watch:start', projectPath),
    stop: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-index-watch:stop'),

    // Event listener for git index changes
    onIndexChanged: (callback: (data: { projectPath: string }) => void) => {
      const listener = (_event: unknown, data: { projectPath: string }) => callback(data)
      ipcRenderer.on('git:index-changed', listener)
      return () => ipcRenderer.removeListener('git:index-changed', listener)
    }
  },

  /**
   * Git watcher - monitors .git directory for state changes
   * Watches: index, HEAD, refs, fetch, stash
   * @see Issue #74 - real-time git status refresh
   */
  gitWatcher: {
    /**
     * Start watching git directory for a project
     * @param projectPath - Root path of the git repository
     */
    start: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-watcher:start', projectPath),

    /**
     * Stop the current git watcher
     */
    stop: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-watcher:stop'),

    /**
     * Get current watcher status for debugging/monitoring
     */
    getStatus: (): Promise<GitWatcherStatus> =>
      ipcRenderer.invoke('git-watcher:status'),

    /**
     * Subscribe to git state change events
     * @param callback - Called when git state changes (index, HEAD, refs, etc.)
     * @returns Cleanup function to remove listener
     */
    onStateChanged: (callback: (event: GitStateChangeEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: GitStateChangeEvent): void => callback(data)
      ipcRenderer.on('git:state-changed', handler)
      return () => ipcRenderer.removeListener('git:state-changed', handler)
    }
  },

  /**
   * Git polling - fallback timer-based status refresh
   * Complements gitWatcher for cases where file watching misses changes
   * @see Issue #74 - real-time git status refresh
   */
  gitPolling: {
    /**
     * Start polling for git status updates
     * @param projectPath - Root path of the git repository
     */
    start: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-polling:start', projectPath),

    /**
     * Stop polling
     */
    stop: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-polling:stop'),

    /**
     * Set polling interval
     * @param ms - Interval in milliseconds
     */
    setInterval: (ms: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-polling:set-interval', ms),

    /**
     * Enable or disable polling
     * @param enabled - Whether polling should be active
     */
    setEnabled: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git-polling:set-enabled', enabled),

    /**
     * Subscribe to poll triggered events
     * @param callback - Called when polling interval fires
     * @returns Cleanup function to remove listener
     */
    onPollTriggered: (callback: (event: GitPollTriggeredEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: GitPollTriggeredEvent): void => callback(data)
      ipcRenderer.on('git:poll-triggered', handler)
      return () => ipcRenderer.removeListener('git:poll-triggered', handler)
    }
  },

  // Settings operations
  settings: {
    getProjectFilterMode: (): Promise<{ success: boolean; mode?: string; error?: string }> =>
      ipcRenderer.invoke('settings:getProjectFilterMode'),
    setProjectFilterMode: (mode: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setProjectFilterMode', mode),
    // Directory watcher depth
    getDirectoryWatchDepth: (): Promise<{ success: boolean; depth?: number; error?: string }> =>
      ipcRenderer.invoke('settings:getDirectoryWatchDepth'),
    setDirectoryWatchDepth: (depth: number | null): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setDirectoryWatchDepth', depth),
    // Recent projects
    getRecentProjects: (): Promise<{ success: boolean; projects?: Array<{ path: string; name: string; lastOpened: number }>; error?: string }> =>
      ipcRenderer.invoke('settings:getRecentProjects'),
    addRecentProject: (path: string, name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:addRecentProject', path, name),
    removeRecentProject: (path: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:removeRecentProject', path)
  },

  // Copilot/Claude Code removed

  // Terminal operations
  terminal: {
    // Check availability
    isAvailable: (terminalId?: string): Promise<{ success: boolean; available: boolean; initialized?: boolean }> =>
      ipcRenderer.invoke('terminal:isAvailable', terminalId),

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
    write: (terminalId: string, data: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:write', { terminalId, data }),

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
    },

    // Clear control channel (bypass normal data filter)
    onClear: (callback: (data: { terminalId: string }) => void) => {
      const listener = (_event: unknown, data: { terminalId: string }) => callback(data)
      ipcRenderer.on('terminal:clear', listener)
      return () => ipcRenderer.removeListener('terminal:clear', listener)
    },

    // Confirm clear was processed
    markClearComplete: (terminalId: string): void => {
      ipcRenderer.send('terminal:clearComplete', { terminalId })
    }
  },

  // Unified import operations (supports PDF, text, and future formats)
  import: {
    /**
     * Open native file dialog for selecting files to import
     * Returns file info or null if cancelled
     */
    selectFile: (): Promise<{
      path: string
      name: string
      sizeInMB: number
      extension: string
    } | null> => ipcRenderer.invoke('import:selectFile'),

    /**
     * Validate a file before import
     * Returns validation result with any warnings/errors
     */
    validate: (filePath: string): Promise<{
      valid: boolean
      error?: string
      sizeInMB: number
      fileName: string
    }> => ipcRenderer.invoke('import:validate', filePath),

    /**
     * Import a file into the current project
     * Full workflow: validate → convert → write to import/
     */
    process: (filePath: string): Promise<{
      success: boolean
      outputPath?: string
      error?: string
      errorCode?: string
    }> => ipcRenderer.invoke('import:process', filePath),

    /**
     * Get list of supported file extensions
     */
    getSupportedExtensions: (): Promise<string[]> =>
      ipcRenderer.invoke('import:getSupportedExtensions'),

    /**
     * Check if a file type is supported for import
     */
    isSupported: (extension: string): Promise<boolean> =>
      ipcRenderer.invoke('import:isSupported', extension)
  },

  // Git operations
  git: {
    /**
     * Get git status for a project directory
     * Returns branch name, file statuses, and status counts
     */
    getStatus: (projectPath: string): Promise<GitStatusResponse> =>
      ipcRenderer.invoke('git:getStatus', projectPath)
  },

  // PDF export operations
  pdf: {
    /**
     * Export HTML content to PDF
     *
     * Shows native save dialog, renders in hidden window, writes PDF file.
     * @param request - { html: string, fileName: string }
     * @returns Export result with file path or error
     */
    exportToPdf: (request: PdfExportRequest): Promise<PdfExportResponse> =>
      ipcRenderer.invoke('pdf:exportToPdf', request)
  },

  // DOCX export operations
  docx: {
    /**
     * Export HTML content to DOCX (Word)
     *
     * Shows native save dialog, parses HTML, generates DOCX file.
     * @param request - { html: string, fileName: string }
     * @returns Export result with file path or error
     * @see Issue #65 - DOCX export with Mermaid diagram support
     */
    exportToDocx: (request: DocxExportRequest): Promise<DocxExportResponse> =>
      ipcRenderer.invoke('docx:exportToDocx', request)
  },

  // Global settings operations
  globalSettings: {
    /**
     * Get all global settings from ~/.erfana/settings.json
     */
    get: (): Promise<{ success: boolean; settings?: GlobalSettings; error?: string }> =>
      ipcRenderer.invoke('globalSettings:get'),

    /**
     * Set a specific global setting
     * @param key - Setting key to update
     * @param value - New value for the setting
     */
    set: (key: string, value: unknown): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('globalSettings:set', { key, value }),

    /**
     * Reset all global settings to defaults
     */
    reset: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('globalSettings:reset'),

    /**
     * Subscribe to global settings changes
     * @param callback - Called when any global setting changes
     * @returns Cleanup function to remove listener
     */
    onSettingsChanged: (callback: (data: GlobalSettingsChanged) => void): (() => void) => {
      const listener = (_event: unknown, data: GlobalSettingsChanged): void => callback(data)
      ipcRenderer.on('globalSettings:changed', listener)
      return () => ipcRenderer.removeListener('globalSettings:changed', listener)
    }
  },

  // Logging operations
  logging: {
    /**
     * Send log entry to main process
     * One-way channel for performance
     */
    log: (entry: LogEntry): void => ipcRenderer.send('logging:log', entry),

    /**
     * Get current log level from main process
     */
    getLevel: (): Promise<string> => ipcRenderer.invoke('logging:getLevel')
  },

  // Quit confirmation operations
  quit: {
    /**
     * Listen for quit request from main process
     * Main sends this when user tries to close window or quit app
     *
     * @param callback - Called when quit is requested
     * @returns Cleanup function to remove listener
     */
    onQuitRequested: (callback: (data: { reason?: string }) => void): (() => void) => {
      const listener = (_event: unknown, data: { reason?: string }): void => callback(data)
      ipcRenderer.on('quit:requested', listener)
      return () => ipcRenderer.removeListener('quit:requested', listener)
    },

    /**
     * Send quit response to main process
     * Tells main whether to proceed with quit or cancel it
     *
     * @param proceed - true to quit, false to cancel
     */
    sendQuitResponse: (proceed: boolean): void => {
      ipcRenderer.send('quit:confirmResponse', { proceed })
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
