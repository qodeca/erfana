// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import type {
  ExternalFileValidateResponse,
  ExternalFileCopyResponse,
  ExternalFileMoveResponse,
  ConflictResolution
} from '../shared/ipc/external-file-schema'
import type {
  DocumentImportRequest,
  DocumentImportResult,
  DocumentImportProgress,
  DependencyReadyEvent
} from '../shared/ipc/import-schema'
import type { ClipboardBridge } from '../shared/ipc/clipboard-schema'
import type { ClaudeStatusBridge } from '../shared/ipc/claude-status-schema'

declare global {
  interface Window {
    electron: ElectronAPI & {
      shell: {
        openExternal: (url: string) => Promise<void>
      }
    }
    api: {
      file: {
        openProject: () => Promise<string | null>
        openProjectByPath: (projectPath: string) => Promise<string>
        getLastProjectPath: () => Promise<string | null>
        readDirectory: (dirPath: string) => Promise<FileNode[]>
        readFile: (filePath: string) => Promise<string>
        writeFile: (filePath: string, content: string) => Promise<boolean>
        getStats: (filePath: string) => Promise<FileStats>
        exists: (filePath: string) => Promise<boolean>
        getProjectPath: () => Promise<string | null>
        createFile: (dirPath: string, fileName: string) => Promise<string>
        createFolder: (dirPath: string, folderName: string) => Promise<string>
        deleteFile: (filePath: string) => Promise<boolean>
        deleteFolder: (folderPath: string) => Promise<boolean>
        rename: (oldPath: string, newName: string) => Promise<string>
        revealInFileManager: (filePath: string) => Promise<string>
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
         * Read a file as base64-encoded data URL
         * @see Spec #015 - Image preview viewer specification
         */
        readAsBase64: (filePath: string) => Promise<string>
        /**
         * Validate an external file for drop into project
         * @see Spec #012 - External file drop to project tree
         */
        validateExternal: (
          sourcePath: string,
          projectRoot: string
        ) => Promise<ExternalFileValidateResponse>
        /**
         * Copy an external file into the project
         * @see Spec #012 - External file drop to project tree
         */
        copyFromExternal: (
          sourcePath: string,
          targetFolder: string,
          projectRoot: string,
          conflictResolution?: ConflictResolution
        ) => Promise<ExternalFileCopyResponse>
        /**
         * Move an external file into the project
         * @see Spec #012 - External file drop to project tree
         */
        moveFromExternal: (
          sourcePath: string,
          targetFolder: string,
          projectRoot: string,
          conflictResolution?: ConflictResolution
        ) => Promise<ExternalFileMoveResponse>
        /**
         * Open native file picker for selecting external files
         * @see Spec #012 - External file drop to project tree
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
        /**
         * Create a terminal. Response includes `shellKind` so renderer
         * path-quoting works without a follow-up IPC round-trip
         * (#164 round-2 F#1).
         */
        create: (config?: {
          shell?: string
          cwd?: string
          env?: Record<string, string>
          cols?: number
          rows?: number
        }) => Promise<{
          success: boolean
          terminalId?: string
          shellKind?: 'posix' | 'cmd' | 'powershell'
          error?: string
        }>
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
        /** Import a document via LiteParse converter with options */
        documentImport: (request: DocumentImportRequest) => Promise<DocumentImportResult>
        /** Cancel an active document import */
        cancelDocument: () => Promise<{ success: boolean; error?: string }>
        /** Get list of supported document extensions (depends on system tools) */
        getDocumentExtensions: () => Promise<string[]>
        /** Subscribe to document import progress events */
        onDocumentProgress: (callback: (progress: DocumentImportProgress) => void) => () => void
        /** Subscribe to dependency detection completion event */
        onDependenciesReady: (callback: (event: DependencyReadyEvent) => void) => () => void
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
       * Screenshot capture operations (cross-platform: macOS native +
       * Windows / Linux desktopCapturer).
       * @see Issue #86 - original macOS screenshot capture
       * @see Issue #164 - Windows Phase 3 parity
       */
      screenshot: {
        /** Get available displays for multi-monitor support */
        getDisplays: () => Promise<GetDisplaysResponse>
        /** Enumerate capturable windows (empty array on macOS — uses native picker) */
        enumerateWindows: (request?: EnumerateWindowsRequest) => Promise<EnumerateWindowsResponse>
        /** Capture a screenshot */
        capture: (request: ScreenshotCaptureRequest) => Promise<ScreenshotCaptureResponse>
        /** Platform capability matrix (#164 F[31]) */
        getCapabilities: () => Promise<ScreenshotCapabilities>
        // Overlay-only verbs are NOT exposed here (#164 F[6]). The overlay
        // window's preload (`src/preload/screenshotOverlay.ts`) exposes them
        // as `window.overlayApi.areaSelected` / `areaCancelled`.
      }
      /**
       * Camera photo capture operations
       * @see Spec #014 - Camera photo capture specification
       */
      camera: {
        /** Save a captured photo to temp file */
        save: (request: CameraSaveRequest) => Promise<CameraSaveResponse>
      }
      /**
       * Transcription operations for audio-to-text conversion
       * @see Issue #75 - Media import with transcription
       */
      transcription: {
        /** Import an audio file with transcription */
        import: (request: TranscriptionImportRequest) => Promise<TranscriptionImportResult>
        /** Cancel the active transcription */
        cancel: () => Promise<{ success: boolean; error?: string }>
        /** Validate an audio file before import */
        validate: (filePath: string) => Promise<{
          valid: boolean; error?: string; durationSeconds?: number; sizeInMB: number
        }>
        /** Store an API key in Electron safeStorage */
        setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
        /** Check whether an API key exists in safeStorage */
        hasApiKey: () => Promise<boolean>
        /** Remove the stored API key from safeStorage */
        clearApiKey: () => Promise<{ success: boolean; error?: string }>
        /** Subscribe to transcription progress events */
        onProgress: (callback: (progress: TranscriptionProgress) => void) => () => void
      }
      /**
       * Whisper model management for local transcription backend
       * @see Issue #111 - Local Whisper transcription backend
       */
      whisper: {
        /** Ensure whisper.cpp binary is downloaded */
        ensureBinary: () => Promise<{ success: boolean; path?: string; error?: string }>
        /** Ensure a specific whisper model is downloaded */
        ensureModel: (model: WhisperModel) => Promise<{ success: boolean; path?: string; error?: string }>
        /** List installed whisper models with info */
        listModels: () => Promise<{
          success: boolean
          models: Array<{ name: WhisperModel; size: number; installed: boolean }>
        }>
        /** Delete a downloaded whisper model */
        deleteModel: (model: WhisperModel) => Promise<{ success: boolean; error?: string }>
        /** Subscribe to whisper model download progress */
        onDownloadProgress: (callback: (progress: { percent: number; downloadedBytes: number; totalBytes: number }) => void) => () => void
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
        getLogsDir: () => Promise<string>
        openLogsFolder: () => Promise<string>
      }
      /**
       * Central text-clipboard bridge
       * @see Issue #203 - Central text-clipboard service
       */
      clipboard: ClipboardBridge
      /**
       * Per-terminal Claude Code context status bridge
       * @see Issue #216 - Per-terminal Claude Code context status bar
       */
      claudeStatus: ClaudeStatusBridge
      quit: {
        onQuitRequested: (callback: (data: { reason?: string }) => void) => () => void
        sendQuitResponse: (proceed: boolean) => void
      }
      /**
       * Project lock operations for multi-instance support
       * @see Issue #27 - Multiple independent instances
       * @see Spec #010 - Multi-instance support specification
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
        /**
         * Get the current CPU architecture
         * Used to gate features by arch (e.g., local Whisper on Windows x64 only)
         */
        getArch: () => NodeJS.Architecture
      }
    }
    /**
     * Area-select overlay API exposed only by the per-display overlay
     * BrowserWindows via `src/preload/screenshotOverlay.ts`. `undefined`
     * in every other renderer — declared optional so callers must guard.
     *
     * @see Issue #164 (lens-review F[6]) - split preload bundle.
     */
    overlayApi?: {
      areaSelected: (
        selection: import('../shared/ipc/screenshot-schema').AreaSelection
      ) => void
      areaCancelled: () => void
    }
  }
}
