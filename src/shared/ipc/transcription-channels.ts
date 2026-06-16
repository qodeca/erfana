// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Transcription IPC Channel Names
 *
 * Type-safe channel name constants for transcription IPC communication.
 * Using constants eliminates typos and enables refactoring.
 *
 * @see Issue #75 - Media import with transcription
 * @see Spec #009 - Media import with transcription specification
 */

/**
 * Transcription request/response channels (ipcMain.handle)
 * and streaming channels (webContents.send)
 */
export const TRANSCRIPTION_CHANNELS = {
  /** Full import with progress streaming (ipcMain.handle) */
  IMPORT: 'transcription:import',
  /** Cancel active transcription (ipcMain.handle) */
  CANCEL: 'transcription:cancel',
  /** Quick validation of audio file (ipcMain.handle) */
  VALIDATE: 'transcription:validate',

  /** Progress event streamed to renderer (webContents.send) */
  PROGRESS: 'transcription:progress',

  /** Store API key in safeStorage (ipcMain.handle) */
  SET_API_KEY: 'transcription:setApiKey',
  /** Check if API key exists (ipcMain.handle) */
  HAS_API_KEY: 'transcription:hasApiKey',
  /** Remove stored API key (ipcMain.handle) */
  CLEAR_API_KEY: 'transcription:clearApiKey',

  /** Ensure whisper.cpp binary is downloaded (ipcMain.handle) */
  WHISPER_ENSURE_BINARY: 'transcription:whisperEnsureBinary',
  /** Ensure a specific whisper model is downloaded (ipcMain.handle) */
  WHISPER_ENSURE_MODEL: 'transcription:whisperEnsureModel',
  /** List installed whisper models (ipcMain.handle) */
  WHISPER_LIST_MODELS: 'transcription:whisperListModels',
  /** Delete a whisper model (ipcMain.handle) */
  WHISPER_DELETE_MODEL: 'transcription:whisperDeleteModel',
  /** Download progress event streamed to renderer (webContents.send) */
  WHISPER_DOWNLOAD_PROGRESS: 'transcription:whisperDownloadProgress'
} as const

/**
 * Union type of all transcription channel names
 */
export type TranscriptionChannel =
  (typeof TRANSCRIPTION_CHANNELS)[keyof typeof TRANSCRIPTION_CHANNELS]
