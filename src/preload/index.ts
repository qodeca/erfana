// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { FORCE_CRASH_ARG, TEST_HOOKS_ARG } from '../shared/constants'
import type { PdfExportRequest, PdfExportResponse } from '../shared/ipc/pdf-schema'
import type { DocxExportRequest, DocxExportResponse } from '../shared/ipc/docx-schema'
import type {
  ScreenshotCaptureRequest,
  ScreenshotCaptureResponse,
  GetDisplaysResponse,
  EnumerateWindowsRequest,
  EnumerateWindowsResponse,
  ScreenshotCapabilities,
  ScreenRecordingPermission
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
import { IMAGE_EXPORT_CHANNELS } from '../shared/ipc/image-export-channels'
import { BROWSER_CHANNELS } from '../shared/ipc/browser-channels'
import type { BrowserOpenFileResponse } from '../shared/ipc/browser-schema'
import type {
  ImageExportRequest,
  ImageExportResponse
} from '../shared/ipc/image-export-schema'
import {
  ClaudeStatusChannels,
  ClaudeStatusEvents
} from '../shared/ipc/claude-status-channels'
import type { ClaudeStatusChangePayload } from '../shared/ipc/claude-status-schema'
import { previewBridge } from './previewBridge'
import type {
  DocumentImportRequest,
  DocumentImportResult,
  DocumentImportProgress,
  DependencyReadyEvent,
  ImportToolStatusRequest,
  ImportToolStatusResponse
} from '../shared/ipc/import-schema'
import { fileBridge } from './fileBridge'
import { terminalBridge } from './terminalBridge'
import { markdownImageBridge } from './markdownImageBridge'
import { fileWatchBridge } from './fileWatchBridge'
import { directoryWatchBridge } from './directoryWatchBridge'
import { gitBridge, gitPollingBridge, gitWatcherBridge } from './gitBridge'
import { globalSettingsBridge, settingsBridge } from './settingsBridge'
import { loggingBridge } from './loggingBridge'
import { quitBridge } from './quitBridge'
import { systemBridge } from './systemBridge'
import { clipboardBridge } from './clipboardBridge'
import { projectLockBridge } from './projectLockBridge'
import type { FileNode, FileStats } from '../shared/ipc/file-schema'

export type { FileNode, FileStats }

// Custom APIs for renderer
const api = {
  /**
   * E2E test-hook switch. True only when main appended {@link TEST_HOOKS_ARG}
   * (unpackaged app + `ERFANA_E2E_TEST_HOOKS=1`). The preload is the only source:
   * the renderer reads this value, never a global that page script could set.
   */
  testHooks: { enabled: process.argv.includes(TEST_HOOKS_ARG) } as { readonly enabled: boolean },

  // File operations (see fileBridge.ts)
  file: fileBridge,

  // File watching operations (see fileWatchBridge.ts)
  fileWatch: fileWatchBridge,

  // Directory watching operations (see directoryWatchBridge.ts)
  directoryWatch: directoryWatchBridge,

  // gitIndexWatch API removed (Issue #74 review fix)
  // Replaced by gitWatcher API which provides broader coverage

  /**
   * Git watcher - monitors .git directory for state changes (see gitBridge.ts)
   * @see Issue #74 - real-time git status refresh
   */
  gitWatcher: gitWatcherBridge,

  /**
   * Git polling - fallback timer-based status refresh (see gitBridge.ts)
   * @see Issue #74 - real-time git status refresh
   */
  gitPolling: gitPollingBridge,

  // Settings operations (see settingsBridge.ts)
  settings: settingsBridge,

  // Copilot/Claude Code removed

  // Terminal operations (see terminalBridge.ts)
  terminal: terminalBridge,

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
     * Optional import tool status – LibreOffice found / missing / unsafe (#250).
     * `{ recheck: true }` re-runs detection ("Check again"); main rate-limits
     * it. Never rejects: failures arrive as `success: false`.
     */
    toolStatus: (request: ImportToolStatusRequest): Promise<ImportToolStatusResponse> =>
      ipcRenderer.invoke(IMPORT_CHANNELS.TOOL_STATUS, request),

    /**
     * Subscribe to document import progress events
     * Returns cleanup function to unsubscribe
     */
    onDocumentProgress: (callback: (progress: DocumentImportProgress) => void): (() => void) => {
      const listener = (_event: unknown, data: DocumentImportProgress): void => callback(data)
      ipcRenderer.on(IMPORT_CHANNELS.DOCUMENT_PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(IMPORT_CHANNELS.DOCUMENT_PROGRESS, listener)
      }
    },

    /**
     * Subscribe to dependency detection completion event
     * Returns cleanup function to unsubscribe
     */
    onDependenciesReady: (callback: (event: DependencyReadyEvent) => void): (() => void) => {
      const listener = (_event: unknown, data: DependencyReadyEvent): void => callback(data)
      ipcRenderer.on(IMPORT_CHANNELS.DEPENDENCIES_READY, listener)
      return () => {
        ipcRenderer.removeListener(IMPORT_CHANNELS.DEPENDENCIES_READY, listener)
      }
    }
  },

  // Git status (see gitBridge.ts)
  git: gitBridge,

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
      ipcRenderer.invoke('screenshot:getCapabilities'),

    /**
     * Advisory macOS Screen Recording status (`'granted' | 'denied' |
     * 'not-determined' | 'restricted' | 'unknown'`). Non-macOS returns
     * `'unknown'`. Used ONLY to enrich the denial dialog — never to gate a
     * capture. See `system.openScreenRecordingSettings` / `relaunchApp`.
     */
    getScreenPermission: (): Promise<ScreenRecordingPermission> =>
      ipcRenderer.invoke('screenshot:getScreenPermission')

    // Note (#164 lens-review F[6]): the overlay-only verbs
    // (`areaSelected` / `areaCancelled`) are intentionally NOT exposed here.
    // They live in `src/preload/screenshotOverlay.ts`, which is loaded only
    // by the per-display area-select overlay BrowserWindows. Exposing them
    // to every renderer would let any compromised window forge a selection
    // or DoS an active capture.
  },

  /**
   * System / OS-integration actions for the screen-recording permission flow
   * (see systemBridge.ts). Both are sender-gated main-side.
   */
  system: systemBridge,

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
      return () => {
        ipcRenderer.removeListener('transcription:progress', listener)
      }
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
    ensureBinary: (): Promise<{ success: boolean; path?: string; error?: string; cancelled?: boolean }> =>
      ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_ENSURE_BINARY),

    /**
     * Ensure a specific whisper model is downloaded
     *
     * Triggers download if not present. Progress is streamed via onDownloadProgress.
     *
     * @param model - Model size to ensure (tiny, base, small, medium, large)
     * @returns Success status with model path or error
     */
    ensureModel: (model: WhisperModel): Promise<{ success: boolean; path?: string; error?: string; cancelled?: boolean }> =>
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
     * Cancel the running binary or model download. Its pending ensure call
     * resolves with `cancelled: true` and the partial file is deleted.
     *
     * @returns Success status (false when nothing was downloading)
     */
    cancelDownload: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_CANCEL_DOWNLOAD),

    /**
     * Subscribe to whisper model download progress events
     *
     * @param callback - Called with download progress updates
     * @returns Cleanup function to remove the listener
     */
    onDownloadProgress: (callback: (progress: { percent: number; downloadedBytes: number; totalBytes: number }) => void): (() => void) => {
      const listener = (_event: unknown, data: { percent: number; downloadedBytes: number; totalBytes: number }): void => callback(data)
      ipcRenderer.on(TRANSCRIPTION_CHANNELS.WHISPER_DOWNLOAD_PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(TRANSCRIPTION_CHANNELS.WHISPER_DOWNLOAD_PROGRESS, listener)
      }
    }
  },

  // Global settings operations (see settingsBridge.ts)
  globalSettings: globalSettingsBridge,

  // Logging operations (see loggingBridge.ts)
  logging: loggingBridge,

  /**
   * Central text-clipboard bridge, sandbox-safe and async (see clipboardBridge.ts)
   * @see Issue #203 - Central text-clipboard service
   */
  clipboard: clipboardBridge,

  /**
   * Image export bridge (#73).
   *
   * Sends a path and a target; gets back a small structured result. NO IMAGE
   * BYTES cross this bridge in either direction — the main process reads the
   * file fresh from disk and writes or copies the output itself, so a 50 MB
   * source never becomes a ~67 MB base64 payload on the wire.
   *
   * Never rejects: failures arrive as the `success: false` branch, carrying a
   * code and the message to show for it.
   */
  imageExport: {
    /** Export the image at `filePath` as PNG, as PDF, or to the clipboard. */
    run: (request: ImageExportRequest): Promise<ImageExportResponse> =>
      ipcRenderer.invoke(IMAGE_EXPORT_CHANNELS.RUN, request)
  },

  /**
   * Open in default browser (#124). Sends a file path, never an address: main
   * confines it to the open project and launches the real path. Never rejects.
   */
  browser: {
    openFile: (filePath: string): Promise<BrowserOpenFileResponse> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.OPEN_FILE, { filePath })
  },

  /**
   * Images referenced from Markdown (#71). Sends a path; gets back a `data:`
   * URL, `unchanged`, or a refusal reason. Never rejects for a refusal.
   */
  markdownImage: markdownImageBridge,

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
      return () => {
        ipcRenderer.removeListener(ClaudeStatusEvents.CHANGED, listener)
      }
    }
  },

  // Running HTML preview bridge (#74): WebContentsView-backed preview control
  preview: previewBridge,

  // Quit confirmation operations (see quitBridge.ts)
  quit: quitBridge,

  /**
   * Project lock operations for multi-instance support (see projectLockBridge.ts)
   * @see Issue #27 - Multiple independent instances
   */
  projectLock: projectLockBridge,

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

/** The shape of `window.api`; the renderer's global type is this, never a hand-written copy. */
export type Api = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
// Narrow electron surface: only shell.openExternal is used by the renderer.
// The generic ipcRenderer / webFrame / process helpers are deliberately not exposed.
const electron = {
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  }
}

/**
 * E2E crash-injection flag.
 *
 * The main process appends {@link FORCE_CRASH_ARG} to `webPreferences
 * .additionalArguments` only when the app is UNPACKAGED and
 * `ERFANA_E2E_FORCE_CRASH=1` is set, so a packaged build can never see it and
 * the renderer can never set it. Mirrors the shipped overlay-token mechanism
 * (`ScreenshotOverlayWindow.ts` → `screenshotOverlay.ts`).
 *
 * Exposed ONLY when true — absent (`undefined`) in every normal run, so a
 * `=== true` check in the renderer is the whole contract.
 *
 * @see docs/design/design-issue-60.md §2.8
 */
const forceCrash = process.argv.includes(FORCE_CRASH_ARG)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electron)
    contextBridge.exposeInMainWorld('api', api)
    if (forceCrash) {
      contextBridge.exposeInMainWorld('__ERFANA_FORCE_CRASH__', true)
    }
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as unknown as { electron: typeof electron }).electron = electron
  ;(window as unknown as { api: typeof api }).api = api
  if (forceCrash) {
    ;(window as unknown as { __ERFANA_FORCE_CRASH__: boolean }).__ERFANA_FORCE_CRASH__ = true
  }
}
