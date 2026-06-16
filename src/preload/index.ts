// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type { ProjectChanged } from '../shared/ipc/schema'
import type { GitStatusResponse } from '../shared/ipc/git-schema'
import type { PdfExportRequest, PdfExportResponse } from '../shared/ipc/pdf-schema'
import type { DocxExportRequest, DocxExportResponse } from '../shared/ipc/docx-schema'
import type { GlobalSettings, GlobalSettingsChanged } from '../shared/ipc/global-settings-schema'
import type { LogEntry } from '../shared/ipc/logging-schema'
import type { GitStateChangeEvent, GitWatcherStatus, GitPollTriggeredEvent } from '../shared/ipc/git-watcher-schema'
import type { LockResult, LockStatus } from '../shared/ipc/project-lock-schema'
import type {
  ScreenshotCaptureRequest,
  ScreenshotCaptureResponse,
  GetDisplaysResponse,
  EnumerateWindowsRequest,
  EnumerateWindowsResponse,
  ScreenshotCapabilities
} from '../shared/ipc/screenshot-schema'
import type {
  CameraSaveRequest,
  CameraSaveResponse
} from '../shared/ipc/camera-schema'
import type {
  TranscriptionImportRequest,
  TranscriptionImportResult,
  TranscriptionProgress,
  WhisperModel
} from '../shared/ipc/transcription-schema'
import { TRANSCRIPTION_CHANNELS } from '../shared/ipc/transcription-channels'
import { IMPORT_CHANNELS } from '../shared/ipc/import-channels'
import { CLIPBOARD_CHANNELS } from '../shared/ipc/clipboard-channels'
import {
  ClaudeStatusChannels,
  ClaudeStatusEvents
} from '../shared/ipc/claude-status-channels'
import type { ClaudeStatusChangePayload } from '../shared/ipc/claude-status-schema'
import type {
  DocumentImportRequest,
  DocumentImportResult,
  DocumentImportProgress,
  DependencyReadyEvent
} from '../shared/ipc/import-schema'
import type {
  ExternalFileValidateResponse,
  ExternalFileCopyResponse,
  ExternalFileMoveResponse,
  ConflictResolution
} from '../shared/ipc/external-file-schema'
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
    exists: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('file:exists', filePath),
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
    revealInFileManager: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('file:revealInFileManager', filePath),
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

    /**
     * Read a file as base64-encoded data URL
     *
     * Used by ImageViewerPanel to load images in the sandboxed renderer.
     * Returns a data URL like: data:image/png;base64,iVBORw0KGgo...
     *
     * @param filePath - Absolute path to the image file
     * @returns Data URL string for use in <img src="...">
     * @throws Error if file doesn't exist, is outside project, or unsupported format
     *
     * @see Spec #015 - Image preview viewer specification
     */
    readAsBase64: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('file:readAsBase64', filePath),

    // External file drop operations (Spec #012)
    /**
     * Validate an external file for drop into project
     *
     * Performs security checks: exists, is file, not device/pipe/socket,
     * symlink validation.
     *
     * @param sourcePath - Absolute path to external file
     * @param projectRoot - Absolute path to project root
     * @returns Validation result with file type info
     */
    validateExternal: (
      sourcePath: string,
      projectRoot: string
    ): Promise<ExternalFileValidateResponse> =>
      ipcRenderer.invoke('file:validateExternal', sourcePath, projectRoot),

    /**
     * Copy an external file into the project
     *
     * Validates file, then copies to target folder.
     *
     * @param sourcePath - Absolute path to external file
     * @param targetFolder - Absolute path to target folder within project
     * @param projectRoot - Absolute path to project root
     * @param conflictResolution - How to handle name conflicts: 'replace' or 'keepBoth'
     * @returns Copy result with new file path
     */
    copyFromExternal: (
      sourcePath: string,
      targetFolder: string,
      projectRoot: string,
      conflictResolution?: ConflictResolution
    ): Promise<ExternalFileCopyResponse> =>
      ipcRenderer.invoke(
        'file:copyFromExternal',
        sourcePath,
        targetFolder,
        projectRoot,
        conflictResolution
      ),

    /**
     * Move an external file into the project
     *
     * Validates file, copies to target folder, then deletes source.
     *
     * @param sourcePath - Absolute path to external file
     * @param targetFolder - Absolute path to target folder within project
     * @param projectRoot - Absolute path to project root
     * @param conflictResolution - How to handle name conflicts: 'replace' or 'keepBoth'
     * @returns Move result with new file path
     */
    moveFromExternal: (
      sourcePath: string,
      targetFolder: string,
      projectRoot: string,
      conflictResolution?: ConflictResolution
    ): Promise<ExternalFileMoveResponse> =>
      ipcRenderer.invoke(
        'file:moveFromExternal',
        sourcePath,
        targetFolder,
        projectRoot,
        conflictResolution
      ),

    /**
     * Open native file picker for selecting external files
     *
     * Used when a folder is selected and user presses Cmd+Shift+I.
     *
     * @returns Selected file paths or null if cancelled
     */
    selectExternalFiles: (): Promise<{ paths: string[] } | null> =>
      ipcRenderer.invoke('file:selectExternalFiles'),

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

  // gitIndexWatch API removed (Issue #74 review fix)
  // Replaced by gitWatcher API which provides broader coverage

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

    /**
     * Create a terminal. The response includes `shellKind` so the renderer
     * can quote pasted paths correctly without a follow-up IPC round-trip
     * (#164 round-2 F#1).
     */
    create: (config?: {
      shell?: string
      cwd?: string
      env?: Record<string, string>
      cols?: number
      rows?: number
    }): Promise<{
      success: boolean
      terminalId?: string
      shellKind?: 'posix' | 'cmd' | 'powershell'
      error?: string
    }> => ipcRenderer.invoke('terminal:create', config),

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
      ipcRenderer.invoke('import:isSupported', extension),

    /**
     * Import a document via LiteParse converter with options
     */
    documentImport: (request: DocumentImportRequest): Promise<DocumentImportResult> =>
      ipcRenderer.invoke(IMPORT_CHANNELS.DOCUMENT, request),

    /**
     * Cancel an active document import
     */
    cancelDocument: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IMPORT_CHANNELS.DOCUMENT_CANCEL),

    /**
     * Get list of supported document extensions (depends on system tools)
     */
    getDocumentExtensions: (): Promise<string[]> =>
      ipcRenderer.invoke(IMPORT_CHANNELS.GET_DOCUMENT_EXTENSIONS),

    /**
     * Subscribe to document import progress events
     * Returns cleanup function to unsubscribe
     */
    onDocumentProgress: (callback: (progress: DocumentImportProgress) => void): (() => void) => {
      const listener = (_event: unknown, data: DocumentImportProgress): void => callback(data)
      ipcRenderer.on(IMPORT_CHANNELS.DOCUMENT_PROGRESS, listener)
      return () => ipcRenderer.removeListener(IMPORT_CHANNELS.DOCUMENT_PROGRESS, listener)
    },

    /**
     * Subscribe to dependency detection completion event
     * Returns cleanup function to unsubscribe
     */
    onDependenciesReady: (callback: (event: DependencyReadyEvent) => void): (() => void) => {
      const listener = (_event: unknown, data: DependencyReadyEvent): void => callback(data)
      ipcRenderer.on(IMPORT_CHANNELS.DEPENDENCIES_READY, listener)
      return () => ipcRenderer.removeListener(IMPORT_CHANNELS.DEPENDENCIES_READY, listener)
    }
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

  /**
   * Screenshot capture operations.
   *
   * Cross-platform as of #164: macOS uses the native screencapture binary,
   * Windows + Linux fallback use Electron's desktopCapturer + an in-app
   * area-select overlay window.
   *
   * Captures screen, window, or selected area and saves to temp directory.
   * @see Issue #86 - original macOS screenshot capture
   * @see Issue #164 - Windows Phase 3 parity
   */
  screenshot: {
    /**
     * Get available displays for multi-monitor support.
     *
     * @returns Array of display information (id, label, isPrimary, bounds).
     */
    getDisplays: (): Promise<GetDisplaysResponse> =>
      ipcRenderer.invoke('screenshot:getDisplays'),

    /**
     * Enumerate capturable windows for the in-app picker dialog.
     *
     * On macOS this returns an empty list (`screencapture -iw` handles the
     * picker natively). On Windows / Linux it returns one entry per visible
     * window with a thumbnail data URL.
     */
    enumerateWindows: (request?: EnumerateWindowsRequest): Promise<EnumerateWindowsResponse> =>
      ipcRenderer.invoke('screenshot:enumerateWindows', request),

    /**
     * Capture a screenshot.
     *
     * @param request - `{ mode, displayId?, windowId? }`
     * @returns Capture result with file path or error.
     */
    capture: (request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse> =>
      ipcRenderer.invoke('screenshot:capture', request),

    /**
     * Describe what the running platform can do (#164 lens-review F[31]).
     * The renderer hook calls this on mount instead of branching on
     * `getPlatform()` so platform routing stays single-sourced in main.
     */
    getCapabilities: (): Promise<ScreenshotCapabilities> =>
      ipcRenderer.invoke('screenshot:getCapabilities')

    // Note (#164 lens-review F[6]): the overlay-only verbs
    // (`areaSelected` / `areaCancelled`) are intentionally NOT exposed here.
    // They live in `src/preload/screenshotOverlay.ts`, which is loaded only
    // by the per-display area-select overlay BrowserWindows. Exposing them
    // to every renderer would let any compromised window forge a selection
    // or DoS an active capture.
  },

  /**
   * Camera photo capture operations
   *
   * Saves webcam photos captured via MediaDevices API to temp directory.
   * @see Spec #014 - Camera photo capture specification
   */
  camera: {
    /**
     * Save a captured photo to temp file
     *
     * @param request - { dataUrl: string, timestamp?: number }
     * @returns Save result with file path or error
     */
    save: (request: CameraSaveRequest): Promise<CameraSaveResponse> =>
      ipcRenderer.invoke('camera:save', request)
  },

  /**
   * Transcription operations for audio-to-text conversion
   *
   * Provides import with progress streaming, validation, cancellation,
   * and API key management for the transcription backend.
   *
   * @see Issue #75 - Media import with transcription
   * @see Spec #009 - Media import with transcription specification
   */
  transcription: {
    /**
     * Import an audio file with transcription
     *
     * Starts the full transcription workflow: validate, transcribe (with chunking
     * for long files), and write markdown output to the import/ directory.
     * Progress events are streamed via onProgress.
     *
     * @param request - Import request with filePath and language
     * @returns Import result with success status and output path
     */
    import: (request: TranscriptionImportRequest): Promise<TranscriptionImportResult> =>
      ipcRenderer.invoke('transcription:import', request),

    /**
     * Cancel the active transcription
     *
     * Aborts any in-progress transcription and cleans up temp files.
     *
     * @returns Success status
     */
    cancel: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('transcription:cancel'),

    /**
     * Validate an audio file before import
     *
     * Checks file exists, is a supported audio format, and extracts metadata.
     *
     * @param filePath - Absolute path to the audio file
     * @returns Validation result with duration and size info
     */
    validate: (filePath: string): Promise<{
      valid: boolean; error?: string; durationSeconds?: number; sizeInMB: number
    }> => ipcRenderer.invoke('transcription:validate', filePath),

    /**
     * Store an API key in Electron safeStorage
     *
     * The key is encrypted and stored securely. Only a boolean flag
     * is saved in settings JSON.
     *
     * @param apiKey - The API key to store (e.g., OpenAI key starting with "sk-")
     * @returns Success status
     */
    setApiKey: (apiKey: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('transcription:setApiKey', apiKey),

    /**
     * Check whether an API key exists in safeStorage
     *
     * @returns true if a key is stored, false otherwise
     */
    hasApiKey: (): Promise<boolean> =>
      ipcRenderer.invoke('transcription:hasApiKey'),

    /**
     * Remove the stored API key from safeStorage
     *
     * @returns Success status
     */
    clearApiKey: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('transcription:clearApiKey'),

    /**
     * Subscribe to transcription progress events
     *
     * Progress events are streamed from main process during active transcription.
     * Returns a cleanup function to unsubscribe.
     *
     * @param callback - Called with progress updates (percent, phase, chunks, ETA)
     * @returns Cleanup function to remove the listener
     */
    onProgress: (callback: (progress: TranscriptionProgress) => void): (() => void) => {
      const listener = (_event: unknown, data: TranscriptionProgress): void => callback(data)
      ipcRenderer.on('transcription:progress', listener)
      return () => ipcRenderer.removeListener('transcription:progress', listener)
    }
  },

  /**
   * Whisper model management for local transcription backend
   *
   * Manages whisper.cpp binary and model downloads for offline transcription.
   *
   * @see Issue #111 - Local Whisper transcription backend
   */
  whisper: {
    /**
     * Ensure the whisper.cpp binary is downloaded and available
     *
     * @returns Success status with binary path or error
     */
    ensureBinary: (): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_ENSURE_BINARY),

    /**
     * Ensure a specific whisper model is downloaded
     *
     * Triggers download if not present. Progress is streamed via onDownloadProgress.
     *
     * @param model - Model size to ensure (tiny, base, small, medium, large)
     * @returns Success status with model path or error
     */
    ensureModel: (model: WhisperModel): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_ENSURE_MODEL, model),

    /**
     * List installed whisper models
     *
     * @returns Array of installed model names
     */
    listModels: (): Promise<{
      success: boolean
      models: Array<{ name: WhisperModel; size: number; installed: boolean }>
    }> => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_LIST_MODELS),

    /**
     * Delete a downloaded whisper model
     *
     * @param model - Model to delete
     * @returns Success status
     */
    deleteModel: (model: WhisperModel): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_DELETE_MODEL, model),

    /**
     * Subscribe to whisper model download progress events
     *
     * @param callback - Called with download progress updates
     * @returns Cleanup function to remove the listener
     */
    onDownloadProgress: (callback: (progress: { percent: number; downloadedBytes: number; totalBytes: number }) => void): (() => void) => {
      const listener = (_event: unknown, data: { percent: number; downloadedBytes: number; totalBytes: number }): void => callback(data)
      ipcRenderer.on(TRANSCRIPTION_CHANNELS.WHISPER_DOWNLOAD_PROGRESS, listener)
      return () => ipcRenderer.removeListener(TRANSCRIPTION_CHANNELS.WHISPER_DOWNLOAD_PROGRESS, listener)
    }
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
    getLevel: (): Promise<string> => ipcRenderer.invoke('logging:getLevel'),

    /**
     * Get logs directory path
     */
    getLogsDir: (): Promise<string> => ipcRenderer.invoke('logging:getLogsDir'),

    /**
     * Open logs folder in the system file manager
     * Returns empty string on success, error string on failure
     */
    openLogsFolder: (): Promise<string> => ipcRenderer.invoke('logging:openLogsFolder')
  },

  /**
   * Central text-clipboard bridge (sandbox-safe, async)
   * @see Issue #203 - Central text-clipboard service
   */
  clipboard: {
    /** Read plain text from the OS clipboard ('' on failure) */
    readText: (): Promise<string> => ipcRenderer.invoke(CLIPBOARD_CHANNELS.readText),
    /** Write plain text to the OS clipboard (false on failure/reject) */
    writeText: (text: string): Promise<boolean> =>
      ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text)
  },

  /**
   * Per-terminal Claude Code context status bridge (#216).
   *
   * `register`/`unregister`/`nudge` carry a `terminalId` only — the PTY pid is
   * resolved main-side and never sent (security §10). `onChanged` mirrors
   * `terminal.onData`: the returned unsubscribe removes the SAME wrapper
   * listener reference so its identity never drifts.
   */
  claudeStatus: {
    /** Begin tracking Claude status for a terminal panel. */
    register: (terminalId: string): Promise<void> =>
      ipcRenderer.invoke(ClaudeStatusChannels.REGISTER, { terminalId }),
    /** Stop tracking a terminal panel (idempotent). */
    unregister: (terminalId: string): Promise<void> =>
      ipcRenderer.invoke(ClaudeStatusChannels.UNREGISTER, { terminalId }),
    /** Activity-triggered light re-check for a terminal panel. */
    nudge: (terminalId: string): Promise<void> =>
      ipcRenderer.invoke(ClaudeStatusChannels.NUDGE, { terminalId }),
    /** Subscribe to per-terminal snapshot changes; returns an unsubscribe. */
    onChanged: (callback: (payload: ClaudeStatusChangePayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: ClaudeStatusChangePayload): void =>
        callback(payload)
      ipcRenderer.on(ClaudeStatusEvents.CHANGED, listener)
      return () => ipcRenderer.removeListener(ClaudeStatusEvents.CHANGED, listener)
    }
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
  },

  /**
   * Project lock operations for multi-instance support
   *
   * Prevents duplicate project opens across Erfana instances.
   * Uses file-based locking with focus request support.
   *
   * @see Issue #27 - Multiple independent instances
   * @see Spec #010 - Multi-instance support specification
   */
  projectLock: {
    /**
     * Acquire lock for a project path
     *
     * @param projectPath - Absolute path to the project directory
     * @returns LockResult - 'acquired', 'already_locked', or 'error'
     */
    acquire: (projectPath: string): Promise<LockResult> =>
      ipcRenderer.invoke('project-lock:acquire', { projectPath }),

    /**
     * Release lock for a project path
     *
     * @param projectPath - Absolute path to the project directory
     * @returns { success: boolean, error?: string }
     */
    release: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('project-lock:release', { projectPath }),

    /**
     * Check lock status for a project path
     *
     * @param projectPath - Absolute path to the project directory
     * @returns LockStatus - 'unlocked', 'locked_by_self', 'locked_by_other', or 'error'
     */
    check: (projectPath: string): Promise<LockStatus> =>
      ipcRenderer.invoke('project-lock:check', { projectPath }),

    /**
     * Request focus from the instance that holds the lock
     *
     * Used when user attempts to open a project that's already open
     * in another Erfana instance.
     *
     * @param projectPath - Absolute path to the project directory
     * @returns { success: boolean, error?: string }
     */
    requestFocus: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('project-lock:requestFocus', { projectPath }),

    /**
     * Cleanup stale locks at application startup
     *
     * Removes locks from dead processes or timed-out network locks.
     *
     * @returns { success: boolean, removedCount?: number, error?: string }
     */
    cleanup: (): Promise<{ success: boolean; removedCount?: number; error?: string }> =>
      ipcRenderer.invoke('project-lock:cleanup'),

    /**
     * Listen for focus requests from other instances
     *
     * When another instance tries to open a project locked by this instance,
     * it can request focus. This callback is triggered when focus is requested.
     *
     * @param callback - Called when focus is requested
     * @returns Cleanup function to remove listener
     */
    onFocused: (
      callback: (event: { projectPath: string; requesterPid: number }) => void
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        data: { projectPath: string; requesterPid: number }
      ): void => callback(data)
      ipcRenderer.on('project-lock:focused', handler)
      return () => ipcRenderer.removeListener('project-lock:focused', handler)
    }
  },

  /**
   * Utility operations for web content
   * Provides access to Electron's webUtils API and platform info
   */
  utils: {
    /**
     * Get the absolute file path for a dropped file
     *
     * Required because File.path is not available in sandboxed renderers.
     * Uses Electron's webUtils.getPathForFile() API.
     *
     * @param file - File object from drag-and-drop DataTransfer
     * @returns The absolute file path on the local filesystem
     * @see Issue #85 - Terminal drag-and-drop file path insertion
     */
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),

    /**
     * Get the current operating system platform
     *
     * Returns Node.js process.platform value.
     * Used for platform-specific UI features (e.g., screenshot buttons on macOS only).
     *
     * @returns Platform identifier ('darwin', 'win32', 'linux', etc.)
     * @see Issue #86 - Screenshot capture buttons for terminal panel
     */
    getPlatform: (): NodeJS.Platform => process.platform,

    /**
     * Get the current CPU architecture
     *
     * Returns Node.js process.arch value.
     * Used to gate features by arch (e.g., local Whisper on Windows x64 only,
     * ARM64 Windows falls back to OpenAI API).
     *
     * @returns Architecture identifier ('x64', 'arm64', 'ia32', etc.)
     * @see Issue #165 - Local Whisper Windows binary
     */
    getArch: (): NodeJS.Architecture => process.arch
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
// Custom electron API with shell.openExternal for external link handling
const electron = {
  ...electronAPI,
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electron)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as unknown as { electron: typeof electron }).electron = electron
  ;(window as unknown as { api: typeof api }).api = api
}
