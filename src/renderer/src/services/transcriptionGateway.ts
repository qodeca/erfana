// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer transcription gateways: the one place `window.api.transcription`
 * and `window.api.whisper` are read.
 *
 * Renderer code calls `transcriptionGateway` or `whisperGateway`, which forward
 * to the preload bridges with the same contracts ({@link TranscriptionBridge},
 * {@link WhisperBridge}). Keeping the access in one module gives the renderer a
 * single seam to change or fake.
 */
import type { TranscriptionBridge, WhisperBridge } from '../../../shared/ipc/transcription-schema'

interface TranscriptionBridges {
  transcription: TranscriptionBridge
  whisper: WhisperBridge
}

/** The bridges are read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves these bridges out of its type; this module is the only place they are put back
const bridges = (): TranscriptionBridges => (window as unknown as { api: TranscriptionBridges }).api

export const transcriptionGateway: TranscriptionBridge = {
  import: (...args) => bridges().transcription.import(...args),
  cancel: (...args) => bridges().transcription.cancel(...args),
  validate: (...args) => bridges().transcription.validate(...args),
  setApiKey: (...args) => bridges().transcription.setApiKey(...args),
  hasApiKey: (...args) => bridges().transcription.hasApiKey(...args),
  clearApiKey: (...args) => bridges().transcription.clearApiKey(...args),
  onProgress: (...args) => bridges().transcription.onProgress(...args)
}

export const whisperGateway: WhisperBridge = {
  ensureBinary: (...args) => bridges().whisper.ensureBinary(...args),
  ensureModel: (...args) => bridges().whisper.ensureModel(...args),
  listModels: (...args) => bridges().whisper.listModels(...args),
  deleteModel: (...args) => bridges().whisper.deleteModel(...args),
  onDownloadProgress: (...args) => bridges().whisper.onDownloadProgress(...args)
}
