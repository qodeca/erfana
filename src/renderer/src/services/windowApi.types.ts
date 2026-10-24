// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Compile-time proof that the renderer's `window.api` is the preload object's
 * own type, and that each gateway is typed as its bridge contract.
 *
 * Nothing imports this file and it has no runtime content: `npm run typecheck`
 * compiles it.
 */
import type { Api } from '../../../preload/index'
import type { BrowserBridge } from '../../../shared/ipc/browser-schema'
import type { CameraBridge } from '../../../shared/ipc/camera-schema'
import type { ClipboardBridge } from '../../../shared/ipc/clipboard-schema'
import type { DocxBridge } from '../../../shared/ipc/docx-schema'
import type { ImageExportBridge } from '../../../shared/ipc/image-export-schema'
import type { ImportBridge } from '../../../shared/ipc/import-schema'
import type { MarkdownImageBridge } from '../../../shared/ipc/markdown-image-schema'
import type { PdfBridge } from '../../../shared/ipc/pdf-schema'
import type { PreviewBridge } from '../../../shared/ipc/preview-bridge-types'
import type { previewGateway } from './previewGateway'
import type { TranscriptionBridge, WhisperBridge } from '../../../shared/ipc/transcription-schema'
import type { browserGateway } from './browserGateway'
import type { cameraGateway } from './cameraGateway'
import type { docxGateway, pdfGateway } from './documentExportGateway'
import type { imageExportGateway } from './imageExportGateway'
import type { importGateway } from './importGateway'
import type { markdownImageGateway } from './markdownImageGateway'
import type { transcriptionGateway, whisperGateway } from './transcriptionGateway'
import type { DirectoryWatchBridge } from '../../../shared/ipc/directory-watch-schema'
import type { FileBridge } from '../../../shared/ipc/file-schema'
import type { FileWatchBridge } from '../../../shared/ipc/file-watch-schema'
import type { GitBridge } from '../../../shared/ipc/git-schema'
import type { GitPollingBridge, GitWatcherBridge } from '../../../shared/ipc/git-watcher-schema'
import type { GlobalSettingsBridge } from '../../../shared/ipc/global-settings-schema'
import type { LoggingBridge } from '../../../shared/ipc/logging-schema'
import type { QuitBridge } from '../../../shared/ipc/quit-schema'
import type { SettingsBridge } from '../../../shared/ipc/settings-schema'
import type { SystemBridge } from '../../../shared/ipc/system-schema'
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'
import type { clipboardGateway } from './clipboardGateway'
import type { directoryWatchGateway } from './directoryWatchGateway'
import type { fileGateway } from './fileGateway'
import type { fileWatchGateway } from './fileWatchGateway'
import type { gitGateway, gitPollingGateway, gitWatcherGateway } from './gitGateway'
import type { loggingGateway } from './loggingGateway'
import type { quitGateway } from './quitGateway'
import type { globalSettingsGateway, settingsGateway } from './settingsGateway'
import type { systemGateway } from './systemGateway'
import type { terminalGateway } from './terminalGateway'
import type { testHooksGateway } from './testHooksGateway'
import type { ClaudeStatusBridge } from '../../../shared/ipc/claude-status-schema'
import type { ScreenshotBridge } from '../../../shared/ipc/screenshot-schema'
import type { claudeStatusGateway } from './claudeStatusGateway'
import type { screenshotGateway } from './screenshotGateway'
import type { utilsGateway } from './utilsGateway'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type WindowApiChecks = [
  // Only the bridges the TerminalPanel files still read directly (see preload/index.d.ts)
  Assert<Equal<Window['api'], Pick<Api, 'utils' | 'screenshot'>>>,
  Assert<Equal<typeof fileGateway, FileBridge>>,
  Assert<Equal<typeof terminalGateway, TerminalBridge>>,
  Assert<Equal<typeof fileWatchGateway, FileWatchBridge>>,
  Assert<Equal<typeof directoryWatchGateway, DirectoryWatchBridge>>,
  Assert<Equal<typeof gitGateway, GitBridge>>,
  Assert<Equal<typeof gitWatcherGateway, GitWatcherBridge>>,
  Assert<Equal<typeof gitPollingGateway, GitPollingBridge>>,
  Assert<Equal<typeof settingsGateway, SettingsBridge>>,
  Assert<Equal<typeof globalSettingsGateway, GlobalSettingsBridge>>,
  Assert<Equal<typeof loggingGateway, LoggingBridge>>,
  Assert<Equal<typeof quitGateway, QuitBridge>>,
  Assert<Equal<typeof systemGateway, SystemBridge>>,
  Assert<Equal<typeof clipboardGateway, ClipboardBridge>>,
  Assert<Equal<typeof testHooksGateway, Api['testHooks']>>,
  Assert<Equal<typeof importGateway, ImportBridge>>,
  Assert<Equal<typeof transcriptionGateway, TranscriptionBridge>>,
  Assert<Equal<typeof whisperGateway, WhisperBridge>>,
  Assert<Equal<typeof cameraGateway, CameraBridge>>,
  Assert<Equal<typeof pdfGateway, PdfBridge>>,
  Assert<Equal<typeof docxGateway, DocxBridge>>,
  Assert<Equal<typeof imageExportGateway, ImageExportBridge>>,
  Assert<Equal<typeof browserGateway, BrowserBridge>>,
  Assert<Equal<typeof markdownImageGateway, MarkdownImageBridge>>,
  Assert<Equal<typeof previewGateway, PreviewBridge>>,
  Assert<Equal<typeof claudeStatusGateway, ClaudeStatusBridge>>,
  Assert<Equal<typeof screenshotGateway, ScreenshotBridge>>,
  Assert<Equal<typeof utilsGateway, Api['utils']>>
]
