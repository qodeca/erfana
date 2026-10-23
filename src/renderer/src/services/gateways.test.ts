// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The gateways forward every bridge method, with the same arguments and
 * result, and read `window.api` on each call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryWatchBridge } from '../../../shared/ipc/directory-watch-schema'
import type { FileBridge } from '../../../shared/ipc/file-schema'
import type { FileWatchBridge } from '../../../shared/ipc/file-watch-schema'
import type { GitBridge } from '../../../shared/ipc/git-schema'
import type { GitPollingBridge, GitWatcherBridge } from '../../../shared/ipc/git-watcher-schema'
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'
import type { ClipboardBridge } from '../../../shared/ipc/clipboard-schema'
import type { GlobalSettingsBridge } from '../../../shared/ipc/global-settings-schema'
import type { LoggingBridge } from '../../../shared/ipc/logging-schema'
import type { QuitBridge } from '../../../shared/ipc/quit-schema'
import type { SettingsBridge } from '../../../shared/ipc/settings-schema'
import type { SystemBridge } from '../../../shared/ipc/system-schema'
import type { BrowserBridge } from '../../../shared/ipc/browser-schema'
import type { CameraBridge } from '../../../shared/ipc/camera-schema'
import type { DocxBridge } from '../../../shared/ipc/docx-schema'
import type { ImageExportBridge } from '../../../shared/ipc/image-export-schema'
import type { ImportBridge } from '../../../shared/ipc/import-schema'
import type { MarkdownImageBridge } from '../../../shared/ipc/markdown-image-schema'
import type { PdfBridge } from '../../../shared/ipc/pdf-schema'
import type { TranscriptionBridge, WhisperBridge } from '../../../shared/ipc/transcription-schema'
import { fileGateway } from './fileGateway'
import { terminalGateway } from './terminalGateway'
import { fileWatchGateway } from './fileWatchGateway'
import { directoryWatchGateway } from './directoryWatchGateway'
import { gitGateway, gitPollingGateway, gitWatcherGateway } from './gitGateway'
import { globalSettingsGateway, settingsGateway } from './settingsGateway'
import { loggingGateway } from './loggingGateway'
import { quitGateway } from './quitGateway'
import { systemGateway } from './systemGateway'
import { clipboardGateway } from './clipboardGateway'
import { testHooksGateway } from './testHooksGateway'
import { importGateway } from './importGateway'
import { transcriptionGateway, whisperGateway } from './transcriptionGateway'
import { cameraGateway } from './cameraGateway'
import { docxGateway, pdfGateway } from './documentExportGateway'
import { imageExportGateway } from './imageExportGateway'
import { browserGateway } from './browserGateway'
import { markdownImageGateway } from './markdownImageGateway'
import { previewGateway } from './previewGateway'
import type { PreviewBridge } from '../../../shared/ipc/preview-bridge-types'
import { claudeStatusGateway } from './claudeStatusGateway'
import { screenshotGateway } from './screenshotGateway'
import { utilsGateway } from './utilsGateway'
import type { ClaudeStatusBridge } from '../../../shared/ipc/claude-status-schema'
import type { ScreenshotBridge } from '../../../shared/ipc/screenshot-schema'
import type { Api } from '../../../preload/index'
import { getDefaultProjectTreeApi } from './projectTreeApi'
import { onFileStructureChanged } from './fileStructureSignal'

// Exhaustive by construction: a method added to a contract fails to compile here
const FILE_METHODS: Record<keyof FileBridge, true> = {
  openProject: true,
  openProjectByPath: true,
  getSession: true,
  readDirectory: true,
  findByName: true,
  readFile: true,
  writeFile: true,
  getStats: true,
  exists: true,
  getProjectPath: true,
  createFile: true,
  createFolder: true,
  deleteFile: true,
  deleteFolder: true,
  rename: true,
  revealInFileManager: true,
  moveItem: true,
  copyItem: true,
  checkConflict: true,
  validatePath: true,
  readImage: true,
  validateExternal: true,
  copyFromExternal: true,
  moveFromExternal: true,
  moveBatchFromExternal: true,
  selectExternalFiles: true,
  onProjectChanged: true,
  closeProject: true
}

const TERMINAL_METHODS: Record<keyof TerminalBridge, true> = {
  isAvailable: true,
  create: true,
  write: true,
  resize: true,
  kill: true,
  getInfo: true,
  list: true,
  getActivity: true,
  onData: true,
  onExit: true,
  onError: true,
  onClear: true,
  markClearComplete: true,
  ackOutput: true
}

const FILE_WATCH_METHODS: Record<keyof FileWatchBridge, true> = {
  start: true,
  stop: true,
  stopAll: true,
  pause: true,
  resume: true,
  getStats: true,
  onFileChanged: true,
  onFileDeleted: true,
  onFileError: true
}

const DIRECTORY_WATCH_METHODS: Record<keyof DirectoryWatchBridge, true> = {
  start: true,
  stop: true,
  stopAll: true,
  pause: true,
  resume: true,
  getStats: true,
  onDirectoryChanged: true,
  onProjectDeleted: true,
  onDirectoryError: true
}

const GIT_METHODS: Record<keyof GitBridge, true> = { getStatus: true }

const GIT_WATCHER_METHODS: Record<keyof GitWatcherBridge, true> = {
  start: true,
  stop: true,
  getStatus: true,
  onStateChanged: true
}

const GIT_POLLING_METHODS: Record<keyof GitPollingBridge, true> = {
  start: true,
  stop: true,
  setInterval: true,
  setEnabled: true,
  onPollTriggered: true
}

const SETTINGS_METHODS: Record<keyof SettingsBridge, true> = {
  getProjectFilterMode: true,
  setProjectFilterMode: true,
  getDirectoryWatchDepth: true,
  setDirectoryWatchDepth: true,
  getRecentProjects: true,
  addRecentProject: true,
  removeRecentProject: true
}

const GLOBAL_SETTINGS_METHODS: Record<keyof GlobalSettingsBridge, true> = {
  get: true,
  set: true,
  reset: true,
  onSettingsChanged: true
}

const LOGGING_METHODS: Record<keyof LoggingBridge, true> = {
  log: true,
  getLevel: true,
  getLogsDir: true,
  openLogsFolder: true
}

const QUIT_METHODS: Record<keyof QuitBridge, true> = {
  onQuitRequested: true,
  sendQuitResponse: true
}

const SYSTEM_METHODS: Record<keyof SystemBridge, true> = {
  openScreenRecordingSettings: true,
  relaunchApp: true
}

const CLIPBOARD_METHODS: Record<keyof ClipboardBridge, true> = {
  readText: true,
  writeText: true
}

const IMPORT_METHODS: Record<keyof ImportBridge, true> = {
  selectFile: true,
  validate: true,
  process: true,
  getSupportedExtensions: true,
  isSupported: true,
  documentImport: true,
  cancelDocument: true,
  getDocumentExtensions: true,
  toolStatus: true,
  onDocumentProgress: true,
  onDependenciesReady: true
}

const TRANSCRIPTION_METHODS: Record<keyof TranscriptionBridge, true> = {
  import: true,
  cancel: true,
  validate: true,
  setApiKey: true,
  hasApiKey: true,
  clearApiKey: true,
  onProgress: true
}

const WHISPER_METHODS: Record<keyof WhisperBridge, true> = {
  ensureBinary: true,
  ensureModel: true,
  listModels: true,
  deleteModel: true,
  onDownloadProgress: true
}

const CAMERA_METHODS: Record<keyof CameraBridge, true> = { save: true }
const PDF_METHODS: Record<keyof PdfBridge, true> = { exportToPdf: true }
const DOCX_METHODS: Record<keyof DocxBridge, true> = { exportToDocx: true }
const IMAGE_EXPORT_METHODS: Record<keyof ImageExportBridge, true> = { run: true }
const BROWSER_METHODS: Record<keyof BrowserBridge, true> = { openFile: true }
const MARKDOWN_IMAGE_METHODS: Record<keyof MarkdownImageBridge, true> = { read: true }

const PREVIEW_METHODS: Record<keyof PreviewBridge, true> = {
  checkEligibility: true,
  open: true,
  close: true,
  setBounds: true,
  setVisibility: true,
  reload: true,
  approveHost: true,
  find: true,
  stopFind: true,
  exportPdf: true,
  navigate: true,
  focusPage: true,
  onFailuresChanged: true,
  onHostBlocked: true,
  onVisibilityApplied: true,
  onAllowlistChanged: true,
  onFindResult: true,
  onStillFrameChanged: true,
  onLoadStateChanged: true,
  onBackdropChanged: true,
  onBoundsApplied: true,
  onForwardedShortcut: true,
  onOpenFileRequested: true,
  onPageChanged: true,
  onResizeHold: true
}

const CLAUDE_STATUS_METHODS: Record<keyof ClaudeStatusBridge, true> = {
  register: true,
  unregister: true,
  nudge: true,
  onChanged: true
}

const SCREENSHOT_METHODS: Record<keyof ScreenshotBridge, true> = {
  getDisplays: true,
  enumerateWindows: true,
  capture: true,
  getCapabilities: true,
  getScreenPermission: true
}

const UTILS_METHODS: Record<keyof Api['utils'], true> = {
  getPathForFile: true,
  getPlatform: true,
  getArch: true
}

type Anything = (...args: unknown[]) => unknown

function fakeBridge(methods: string[]): Record<string, ReturnType<typeof vi.fn>> {
  return Object.fromEntries(methods.map((name) => [name, vi.fn(() => `${name}-result`)]))
}

const original = window.api

afterEach(() => {
  window.api = original
})

describe.each([
  ['fileGateway', 'file', fileGateway, FILE_METHODS],
  ['terminalGateway', 'terminal', terminalGateway, TERMINAL_METHODS],
  ['fileWatchGateway', 'fileWatch', fileWatchGateway, FILE_WATCH_METHODS],
  ['directoryWatchGateway', 'directoryWatch', directoryWatchGateway, DIRECTORY_WATCH_METHODS],
  ['gitGateway', 'git', gitGateway, GIT_METHODS],
  ['gitWatcherGateway', 'gitWatcher', gitWatcherGateway, GIT_WATCHER_METHODS],
  ['gitPollingGateway', 'gitPolling', gitPollingGateway, GIT_POLLING_METHODS],
  ['settingsGateway', 'settings', settingsGateway, SETTINGS_METHODS],
  ['globalSettingsGateway', 'globalSettings', globalSettingsGateway, GLOBAL_SETTINGS_METHODS],
  ['loggingGateway', 'logging', loggingGateway, LOGGING_METHODS],
  ['quitGateway', 'quit', quitGateway, QUIT_METHODS],
  ['systemGateway', 'system', systemGateway, SYSTEM_METHODS],
  ['clipboardGateway', 'clipboard', clipboardGateway, CLIPBOARD_METHODS],
  ['importGateway', 'import', importGateway, IMPORT_METHODS],
  ['transcriptionGateway', 'transcription', transcriptionGateway, TRANSCRIPTION_METHODS],
  ['whisperGateway', 'whisper', whisperGateway, WHISPER_METHODS],
  ['cameraGateway', 'camera', cameraGateway, CAMERA_METHODS],
  ['pdfGateway', 'pdf', pdfGateway, PDF_METHODS],
  ['docxGateway', 'docx', docxGateway, DOCX_METHODS],
  ['imageExportGateway', 'imageExport', imageExportGateway, IMAGE_EXPORT_METHODS],
  ['browserGateway', 'browser', browserGateway, BROWSER_METHODS],
  ['markdownImageGateway', 'markdownImage', markdownImageGateway, MARKDOWN_IMAGE_METHODS],
  ['previewGateway', 'preview', previewGateway, PREVIEW_METHODS],
  ['claudeStatusGateway', 'claudeStatus', claudeStatusGateway, CLAUDE_STATUS_METHODS],
  ['screenshotGateway', 'screenshot', screenshotGateway, SCREENSHOT_METHODS],
  ['utilsGateway', 'utils', utilsGateway, UTILS_METHODS]
] as const)('%s', (_name, key, gateway, methods) => {
  const names = Object.keys(methods)

  it('has exactly the contract methods', () => {
    expect(Object.keys(gateway).sort()).toEqual([...names].sort())
  })

  it.each(names)('%s forwards its arguments and returns the bridge result', async (method) => {
    const bridge = fakeBridge(names)
    window.api = { [key]: bridge } as unknown as typeof window.api

    const result = (gateway as unknown as Record<string, Anything>)[method]('a', 2, { c: 3 })

    // The bridge is called before the first await, so the call is visible at once
    expect(bridge[method]).toHaveBeenCalledTimes(1)
    expect(bridge[method]).toHaveBeenCalledWith('a', 2, { c: 3 })
    expect(await result).toBe(`${method}-result`)
  })

  it('forwards a call with no arguments without inventing any', () => {
    const bridge = fakeBridge(names)
    window.api = { [key]: bridge } as unknown as typeof window.api

    ;(gateway as unknown as Record<string, Anything>)[names[0]]()

    expect(bridge[names[0]]).toHaveBeenCalledWith()
  })

  it('reads window.api on every call', () => {
    const first = fakeBridge(names)
    const second = fakeBridge(names)

    window.api = { [key]: first } as unknown as typeof window.api
    ;(gateway as unknown as Record<string, Anything>)[names[0]]()
    window.api = { [key]: second } as unknown as typeof window.api
    ;(gateway as unknown as Record<string, Anything>)[names[0]]()

    expect(first[names[0]]).toHaveBeenCalledTimes(1)
    expect(second[names[0]]).toHaveBeenCalledTimes(1)
  })
})

describe('testHooksGateway', () => {
  it('has only the enabled switch', () => {
    expect(Object.keys(testHooksGateway)).toEqual(['enabled'])
  })

  it.each([true, false])('reads enabled = %s from the current window.api', (enabled) => {
    window.api = { testHooks: { enabled: !enabled } } as unknown as typeof window.api
    expect(testHooksGateway.enabled).toBe(!enabled)
    window.api = { testHooks: { enabled } } as unknown as typeof window.api
    expect(testHooksGateway.enabled).toBe(enabled)
  })
})

describe('fileGateway – file structure signal', () => {
  // The methods that can add, remove or move an entry; the preview's link cache
  // relies on hearing about every one of them (the watcher is paused for them)
  const STRUCTURAL = [
    'createFile',
    'createFolder',
    'deleteFile',
    'deleteFolder',
    'rename',
    'moveItem',
    'copyItem',
    'copyFromExternal',
    'moveFromExternal',
    'moveBatchFromExternal'
  ]
  const names = Object.keys(FILE_METHODS).filter((name) => name !== 'onProjectChanged')

  it.each(names)('%s raises the signal only if it can change the structure', async (method) => {
    window.api = { file: fakeBridge(names) } as unknown as typeof window.api
    const heard = vi.fn()
    const stop = onFileStructureChanged(heard)
    try {
      await (fileGateway as unknown as Record<string, Anything>)[method]()
    } finally {
      stop()
    }
    expect(heard).toHaveBeenCalledTimes(STRUCTURAL.includes(method) ? 1 : 0)
  })

  it('raises the signal after a failed structural call too, and still rejects', async () => {
    const bridge = fakeBridge(names)
    bridge.moveItem.mockRejectedValue(new Error('disk full'))
    window.api = { file: bridge } as unknown as typeof window.api
    const heard = vi.fn()
    const stop = onFileStructureChanged(heard)
    await expect(fileGateway.moveItem({} as never)).rejects.toThrow('disk full')
    stop()
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('getDefaultProjectTreeApi', () => {
  it('hands the project tree the file, directory-watch and terminal gateways', () => {
    const api = getDefaultProjectTreeApi()

    expect(api.file).toBe(fileGateway)
    expect(api.terminal).toBe(terminalGateway)
    expect(api.directoryWatch).toBe(directoryWatchGateway)
  })

  it('keeps its identity, so effect dependencies hold', () => {
    expect(getDefaultProjectTreeApi()).toBe(getDefaultProjectTreeApi())
  })

  it('reaches the directory watcher of the current window.api', async () => {
    const first = { start: vi.fn() }
    const second = { start: vi.fn() }
    window.api = { directoryWatch: first } as unknown as typeof window.api
    const api = getDefaultProjectTreeApi()
    window.api = { directoryWatch: second } as unknown as typeof window.api

    await api.directoryWatch.start('/p')

    expect(first.start).not.toHaveBeenCalled()
    expect(second.start).toHaveBeenCalledWith('/p')
  })
})
