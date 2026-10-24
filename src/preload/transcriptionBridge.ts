// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload transcription bridges: `window.api.transcription` (audio import,
 * API key) and `window.api.whisper` (the local whisper.cpp binary and models),
 * typed as {@link TranscriptionBridge} and {@link WhisperBridge}. Channel names
 * come from `transcription-channels.ts`.
 *
 * @see Issue #75 - Media import with transcription
 * @see Issue #111 - Local Whisper transcription backend
 */
import { ipcRenderer } from 'electron'
import { TRANSCRIPTION_CHANNELS } from '../shared/ipc/transcription-channels'
import type { TranscriptionBridge, WhisperBridge } from '../shared/ipc/transcription-schema'
import { subscribe } from './ipcSubscribe'

export const transcriptionBridge: TranscriptionBridge = {
  import: (request) => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.IMPORT, request),
  cancel: () => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.CANCEL),
  validate: (filePath) => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.VALIDATE, filePath),
  setApiKey: (apiKey) => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.SET_API_KEY, apiKey),
  hasApiKey: () => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.HAS_API_KEY),
  clearApiKey: () => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.CLEAR_API_KEY),
  onProgress: (callback) => subscribe(TRANSCRIPTION_CHANNELS.PROGRESS, callback)
}

export const whisperBridge: WhisperBridge = {
  ensureBinary: () => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_ENSURE_BINARY),
  ensureModel: (model) => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_ENSURE_MODEL, model),
  listModels: () => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_LIST_MODELS),
  deleteModel: (model) => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_DELETE_MODEL, model),
  cancelDownload: () => ipcRenderer.invoke(TRANSCRIPTION_CHANNELS.WHISPER_CANCEL_DOWNLOAD),
  onDownloadProgress: (callback) =>
    subscribe(TRANSCRIPTION_CHANNELS.WHISPER_DOWNLOAD_PROGRESS, callback)
}
