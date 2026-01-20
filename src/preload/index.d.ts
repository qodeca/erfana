import { ElectronAPI } from '@electron-toolkit/preload'
import { FileNode, FileStats } from './index'
import type { GitStatusResponse } from '../shared/ipc/git-schema'
import type { GitStateChangeEvent, GitWatcherStatus, GitPollTriggeredEvent } from '../shared/ipc/git-watcher-schema'
import type { PdfExportRequest, PdfExportResponse } from '../shared/ipc/pdf-schema'
import type { DocxExportRequest, DocxExportResponse } from '../shared/ipc/docx-schema'
import type { GlobalSettings, GlobalSettingsChanged } from '../shared/ipc/global-settings-schema'
import type { LogEntry } from '../shared/ipc/logging-schema'
import type { LockResult, LockStatus } from '../shared/ipc/project-lock-schema'
import type {
  ScreenshotCaptureRequest,
  ScreenshotCaptureResponse,
  GetDisplaysResponse
} from '../shared/ipc/screenshot-schema'
import type {
  CameraSaveRequest,
  CameraSaveResponse
} from '../shared/ipc/camera-schema'
import type {
  ExternalFileValidateResponse,
  ExternalFileCopyResponse,
  ExternalFileMoveResponse,
  ConflictResolution
} from '../shared/ipc/external-file-schema'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      file: {
        openProject: () => Promise<string | null>
        openProjectByPath: (projectPath: string) => Promise<string>
        getLastProjectPath: () => Promise<string | null>
        readDirectory: (dirPath: string) => Promise<FileNode[]>
        readFile: (filePath: string) => Promise<string>
        writeFile: (filePath: string, content: string) => Promise<boolean>
        getStats: (filePath: string) => Promise<FileStats>
        getProjectPath: () => Promise<string | null>
        createFile: (dirPath: string, fileName: string) => Promise<string>
        createFolder: (dirPath: string, folderName: string) => Promise<string>
        deleteFile: (filePath: string) => Promise<boolean>
        deleteFolder: (folderPath: string) => Promise<boolean>
        rename: (oldPath: string, newName: string) => Promise<string>
        moveItem: (sourcePath: string, targetParentPath: string, newName?: string) => Promise<{ path: string; isSymlink?: boolean }>
        copyItem: (sourcePath: string, targetParentPath: string, newName?: string) => Promise<{ path: string; isSymlink?: boolean }>
        checkConflict: (targetParentPath: string, itemName: string) => Promise<boolean>
        validatePath: (filePath: string, projectRoot?: string) => Promise<{
          exists: boolean
          absolutePath?: string
          isFile?: boolean
          error?: string
        }>
        /**
         * Validate an external file for drop into project
         * @see BRS-012 - External file drop to project tree
         */
        validateExternal: (
          sourcePath: string,
          projectRoot: string
        ) => Promise<ExternalFileValidateResponse>
        /**
         * Copy an external file into the project
         * @see BRS-012 - External file drop to project tree
         */
        copyFromExternal: (
          sourcePath: string,
          targetFolder: string,
          projectRoot: string,
          conflictResolution?: ConflictResolution
        ) => Promise<ExternalFileCopyResponse>
        /**
         * Move an external file into the project
         * @see BRS-012 - External file drop to project tree
         */
        moveFromExternal: (
          sourcePath: string,
          targetFolder: string,
          projectRoot: string,
          conflictResolution?: ConflictResolution
        ) => Promise<ExternalFileMoveResponse>
        /**
         * Open native file picker for selecting external files
         * @see BRS-012 - External file drop to project tree
         */
        selectExternalFiles: () => Promise<{ paths: string[] } | null>
        onProjectChanged: (
          callback: (data: { oldPath: string | null; newPath: string | null }) => void
        ) => () => void
        closeProject: () => Promise<boolean>
      }
      fileWatch: {
        start: (filePath: string) => Promise<{ success: boolean; error?: string }>
        stop: (filePath: string) => Promise<{ success: boolean; error?: string }>
        stopAll: () => Promise<{ success: boolean; error?: string }>
        pause: (filePath: string) => Promise<{ success: boolean; error?: string }>
        resume: (filePath: string) => Promise<{ success: boolean; error?: string }>
        getStats: () => Promise<{ success: boolean; stats?: unknown; error?: string }>
        onFileChanged: (callback: (data: { filePath: string }) => void) => () => void
        onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void
        onFileError: (callback: (data: { filePath: string; error: string }) => void) => () => void
      }
      directoryWatch: {
        start: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        stop: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        stopAll: () => Promise<{ success: boolean; error?: string }>
        pause: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        resume: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        getStats: () => Promise<{ success: boolean; stats?: unknown; error?: string }>
        onDirectoryChanged: (
          callback: (data: { dirPath: string; eventCount: number; summary: Record<string, number> }) => void
        ) => () => void
        onProjectDeleted: (callback: (data: { dirPath: string }) => void) => () => void
        onDirectoryError: (
          callback: (data: { dirPath: string; error: string }) => void
        ) => () => void
      }
      // gitIndexWatch API removed (Issue #74 review fix)
      // Replaced by gitWatcher API which provides broader coverage
      /**
       * Unified git watcher - monitors .git directory for state changes
       * Covers: index, HEAD, refs, fetch, stash
       * @see Issue #74 - real-time git status refresh
       */
      gitWatcher: {
        /** Start watching git directory for a project */
        start: (projectPath: string) => Promise<{ success: boolean; error?: string }>
        /** Stop the current git watcher */
        stop: () => Promise<{ success: boolean; error?: string }>
        /** Get current watcher status for debugging/monitoring */
        getStatus: () => Promise<GitWatcherStatus>
        /** Subscribe to git state changes */
        onStateChanged: (callback: (event: GitStateChangeEvent) => void) => () => void
      }
      /**
       * Git polling - fallback timer-based status refresh
       * Complements gitWatcher for cases where file watching misses changes
       * @see Issue #74 - real-time git status refresh
       */
      gitPolling: {
        /** Start polling for git status updates */
        start: (projectPath: string) => Promise<{ success: boolean; error?: string }>
        /** Stop polling */
        stop: () => Promise<{ success: boolean; error?: string }>
        /** Set polling interval in milliseconds */
        setInterval: (ms: number) => Promise<{ success: boolean; error?: string }>
        /** Enable or disable polling */
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
        /** Subscribe to poll-triggered events */
        onPollTriggered: (callback: (event: GitPollTriggeredEvent) => void) => () => void
      }
      // Copilot removed
      settings: {
        getProjectFilterMode: () => Promise<{ success: boolean; mode?: string; error?: string }>
        setProjectFilterMode: (mode: string) => Promise<{ success: boolean; error?: string }>
        getDirectoryWatchDepth: () => Promise<{ success: boolean; depth?: number; error?: string }>
        setDirectoryWatchDepth: (depth: number | null) => Promise<{ success: boolean; error?: string }>
        getRecentProjects: () => Promise<{ success: boolean; projects?: Array<{ path: string; name: string; lastOpened: number }>; error?: string }>
        addRecentProject: (path: string, name: string) => Promise<{ success: boolean; error?: string }>
        removeRecentProject: (path: string) => Promise<{ success: boolean; error?: string }>
      }
      terminal: {
        isAvailable: (terminalId?: string) => Promise<{ success: boolean; available: boolean; initialized?: boolean }>
        create: (config?: {
          shell?: string
          cwd?: string
          env?: Record<string, string>
          cols?: number
          rows?: number
        }) => Promise<{ success: boolean; terminalId?: string; error?: string }>
        write: (terminalId: string, data: string) => Promise<{ success: boolean; error?: string }>
        resize: (terminalId: string, cols: number, rows: number) => void
        kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>
        getInfo: (terminalId: string) => Promise<{
          success: boolean
          info?: { id: string; cwd: string; title: string }
          error?: string
        }>
        list: () => Promise<{
          success: boolean
          terminals?: Array<{ id: string; title: string }>
          error?: string
        }>
        onData: (callback: (data: { terminalId: string; data: string }) => void) => () => void
        onExit: (
          callback: (data: { terminalId: string; exitCode: number; signal?: number }) => void
        ) => () => void
        onError: (callback: (data: { terminalId: string; error: string }) => void) => () => void
        // Bootstrap pattern clear handshake methods
        onClear: (callback: (data: { terminalId: string }) => void) => () => void
        markClearComplete: (terminalId: string) => void
      }
      import: {
        selectFile: () => Promise<{
          path: string
          name: string
          sizeInMB: number
          extension: string
        } | null>
        validate: (filePath: string) => Promise<{
          valid: boolean
          error?: string
          sizeInMB: number
          fileName: string
        }>
        process: (filePath: string) => Promise<{
          success: boolean
          outputPath?: string
          error?: string
          errorCode?: string
        }>
        getSupportedExtensions: () => Promise<string[]>
        isSupported: (extension: string) => Promise<boolean>
      }
      git: {
        getStatus: (projectPath: string) => Promise<GitStatusResponse>
      }
      pdf: {
        exportToPdf: (request: PdfExportRequest) => Promise<PdfExportResponse>
      }
      docx: {
        exportToDocx: (request: DocxExportRequest) => Promise<DocxExportResponse>
      }
      /**
       * Screenshot capture operations (macOS only)
       * @see Issue #86 - Screenshot capture buttons for terminal panel
       */
      screenshot: {
        /** Get available displays for multi-monitor support */
        getDisplays: () => Promise<GetDisplaysResponse>
        /** Capture a screenshot */
        capture: (request: ScreenshotCaptureRequest) => Promise<ScreenshotCaptureResponse>
      }
      /**
       * Camera photo capture operations
       * @see BRS-014 - Camera photo capture specification
       */
      camera: {
        /** Save a captured photo to temp file */
        save: (request: CameraSaveRequest) => Promise<CameraSaveResponse>
      }
      globalSettings: {
        get: () => Promise<{ success: boolean; settings?: GlobalSettings; error?: string }>
        set: (key: string, value: unknown) => Promise<{ success: boolean; error?: string }>
        reset: () => Promise<{ success: boolean; error?: string }>
        onSettingsChanged: (callback: (data: GlobalSettingsChanged) => void) => () => void
      }
      logging: {
        log: (entry: LogEntry) => void
        getLevel: () => Promise<string>
      }
      quit: {
        onQuitRequested: (callback: (data: { reason?: string }) => void) => () => void
        sendQuitResponse: (proceed: boolean) => void
      }
      /**
       * Project lock operations for multi-instance support
       * @see Issue #27 - Multiple independent instances
       * @see BRS-010 - Multi-instance support specification
       */
      projectLock: {
        /** Acquire lock for a project path */
        acquire: (projectPath: string) => Promise<LockResult>
        /** Release lock for a project path */
        release: (projectPath: string) => Promise<{ success: boolean; error?: string }>
        /** Check lock status for a project path */
        check: (projectPath: string) => Promise<LockStatus>
        /** Request focus from the instance that holds the lock */
        requestFocus: (projectPath: string) => Promise<{ success: boolean; error?: string }>
        /** Cleanup stale locks at application startup */
        cleanup: () => Promise<{ success: boolean; removedCount?: number; error?: string }>
        /** Listen for focus requests from other instances */
        onFocused: (
          callback: (event: { projectPath: string; requesterPid: number }) => void
        ) => () => void
      }
      /**
       * Utility operations for web content
       * @see Issue #85 - Terminal drag-and-drop file path insertion
       * @see Issue #86 - Screenshot capture buttons for terminal panel
       */
      utils: {
        /**
         * Get the absolute file path for a dropped file
         * Required because File.path is not available in sandboxed renderers
         */
        getPathForFile: (file: File) => string
        /**
         * Get the current operating system platform
         * Used for platform-specific UI features
         */
        getPlatform: () => NodeJS.Platform
      }
    }
  }
}
