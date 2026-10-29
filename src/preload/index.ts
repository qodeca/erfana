// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { FORCE_CRASH_ARG, TEST_HOOKS_ARG } from '../shared/constants'
import { previewBridge } from './previewBridge'
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
import { importBridge } from './importBridge'
import { transcriptionBridge, whisperBridge } from './transcriptionBridge'
import { cameraBridge } from './cameraBridge'
import { docxBridge, pdfBridge } from './documentExportBridge'
import { imageExportBridge } from './imageExportBridge'
import { browserBridge } from './browserBridge'
import { screenshotBridge } from './screenshotBridge'
import { claudeStatusBridge } from './claudeStatusBridge'
import { previewCommentsBridge } from './previewCommentsBridge'
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

  // Unified import operations: PDF, text and documents (see importBridge.ts)
  import: importBridge,

  // Git status (see gitBridge.ts)
  git: gitBridge,

  // PDF and DOCX export operations (see documentExportBridge.ts)
  pdf: pdfBridge,
  docx: docxBridge,

  /**
   * Screenshot capture, cross-platform as of #164 (see screenshotBridge.ts;
   * the overlay-only verbs live in screenshotOverlay.ts)
   * @see Issue #86 - original macOS screenshot capture
   * @see Issue #164 - Windows Phase 3 parity
   */
  screenshot: screenshotBridge,

  /**
   * System / OS-integration actions for the screen-recording permission flow
   * (see systemBridge.ts). Both are sender-gated main-side.
   */
  system: systemBridge,

  /**
   * Camera photo capture (see cameraBridge.ts)
   * @see Spec #014 - Camera photo capture specification
   */
  camera: cameraBridge,

  /**
   * Audio transcription and the local whisper backend (see transcriptionBridge.ts)
   * @see Issue #75 - Media import with transcription
   * @see Issue #111 - Local Whisper transcription backend
   */
  transcription: transcriptionBridge,
  whisper: whisperBridge,

  // Global settings operations (see settingsBridge.ts)
  globalSettings: globalSettingsBridge,

  // Logging operations (see loggingBridge.ts)
  logging: loggingBridge,

  /**
   * Central text-clipboard bridge, sandbox-safe and async (see clipboardBridge.ts)
   * @see Issue #203 - Central text-clipboard service
   */
  clipboard: clipboardBridge,

  // Image export, no image bytes on the wire (#73, see imageExportBridge.ts)
  imageExport: imageExportBridge,

  // Open in default browser (#124, see browserBridge.ts)
  browser: browserBridge,

  /**
   * Images referenced from Markdown (#71). Sends a path; gets back a `data:`
   * URL, `unchanged`, or a refusal reason. Never rejects for a refusal.
   */
  markdownImage: markdownImageBridge,

  /**
   * Per-terminal Claude Code context status (#216, see claudeStatusBridge.ts).
   * Carries a `terminalId` only; the PTY pid is resolved main-side.
   */
  claudeStatus: claudeStatusBridge,

  // Running HTML preview bridge (#74): WebContentsView-backed preview control
  preview: previewBridge,

  /**
   * HTML Preview comments (see previewCommentsBridge.ts): mode, list, Show on
   * page, Save, the window's unsaved files. Keys and panel ids only – never a
   * path to write or an author.
   */
  previewComments: previewCommentsBridge,

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
 * @see docs/designs/large-projects/design-issue-60.md §2.8
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
