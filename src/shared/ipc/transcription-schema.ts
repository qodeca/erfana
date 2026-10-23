// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Transcription IPC Schemas and Types
 *
 * Zod schemas and TypeScript types for transcription IPC communication.
 * Defines the contract between renderer and main process for audio
 * transcription operations.
 *
 * @see Issue #75 - Media import with transcription
 * @see Spec #009 - Media import with transcription specification
 */
import { z } from 'zod'
import type { IpcAck } from './schema'

/**
 * Transcription backend selection
 *
 * Currently only OpenAI is supported. Additional backends
 * can be added as new enum values.
 */
export const TranscriptionBackendSchema = z.enum(['openai', 'local'])
export type TranscriptionBackend = z.infer<typeof TranscriptionBackendSchema>

/**
 * Whisper model sizes for local transcription backend
 *
 * Controls quality vs. speed trade-off for local whisper.cpp inference.
 */
export const WhisperModelSchema = z.enum(['tiny', 'base', 'small', 'medium', 'large'])
export type WhisperModel = z.infer<typeof WhisperModelSchema>

/**
 * Language options for transcription
 *
 * Covers OpenAI's commonly supported languages plus 'auto' for
 * automatic detection.
 */
export const TranscriptionLanguageSchema = z.enum([
  'auto', 'en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'zh', 'ko',
  'ar', 'cs', 'da', 'fi', 'el', 'he', 'hi', 'hu', 'id', 'ms', 'no', 'ro',
  'sk', 'sv', 'th', 'tr', 'uk', 'vi'
])
export type TranscriptionLanguage = z.infer<typeof TranscriptionLanguageSchema>

/**
 * Import request from renderer to main process
 */
export const TranscriptionImportRequestSchema = z.object({
  filePath: z.string().min(1),
  language: TranscriptionLanguageSchema
})
export type TranscriptionImportRequest = z.infer<typeof TranscriptionImportRequestSchema>

/**
 * Progress event streamed from main to renderer via webContents.send
 */
export interface TranscriptionProgress {
  /** Overall progress 0-100 */
  percent: number
  /** Current phase description */
  phase: string
  /** Current chunk (1-based) */
  currentChunk?: number
  /** Total chunks */
  totalChunks?: number
  /** Estimated seconds remaining */
  etaSeconds?: number
}

/**
 * Import result returned via ipcMain.handle response
 */
export interface TranscriptionImportResult {
  success: boolean
  outputPath?: string
  error?: string
  errorCode?: string
}

/**
 * Transcription result from TranscriptionService
 */
export interface TranscriptionResult {
  success: boolean
  transcript?: string
  duration?: number
  language?: string
  error?: string
  errorCode?: string
}

/**
 * Transcription settings schema (embedded in GlobalSettings)
 */
export const TranscriptionSettingsSchema = z.object({
  /** Selected transcription backend */
  backend: TranscriptionBackendSchema.default('openai'),
  /** Whether an API key has been stored (key itself in safeStorage) */
  openaiApiKeyStored: z.boolean().default(false),
  /** Selected whisper.cpp model for local backend */
  whisperModel: WhisperModelSchema.default('base')
})
export type TranscriptionSettings = z.infer<typeof TranscriptionSettingsSchema>

/** `transcription:validate`: whether an audio file can be transcribed. */
export interface TranscriptionValidation {
  valid: boolean
  error?: string
  durationSeconds?: number
  sizeInMB: number
}

/**
 * Shared contract for the preload `transcription` bridge.
 *
 * Implemented by `window.api.transcription` (preload,
 * `transcriptionBridge.ts`) and consumed by the renderer transcription gateway.
 *
 * @see Issue #75 - Media import with transcription
 */
export interface TranscriptionBridge {
  /** Validate, transcribe (in chunks for long files) and write Markdown to `import/`; progress arrives through `onProgress`. */
  import(request: TranscriptionImportRequest): Promise<TranscriptionImportResult>
  /** Stop the running transcription and remove its temp files. */
  cancel(): Promise<IpcAck>
  validate(filePath: string): Promise<TranscriptionValidation>
  /** Store the API key in Electron safeStorage; settings keep only a flag. */
  setApiKey(apiKey: string): Promise<IpcAck>
  hasApiKey(): Promise<boolean>
  clearApiKey(): Promise<IpcAck>
  onProgress(callback: (progress: TranscriptionProgress) => void): () => void
}

/** `transcription:whisperDownloadProgress`: a model download's progress. */
export interface WhisperDownloadProgress {
  percent: number
  downloadedBytes: number
  totalBytes: number
}

/**
 * Shared contract for the preload `whisper` bridge: the whisper.cpp binary
 * and models of the local transcription backend.
 *
 * Implemented by `window.api.whisper` (preload, `transcriptionBridge.ts`) and
 * consumed by the renderer transcription gateway.
 *
 * @see Issue #111 - Local Whisper transcription backend
 */
export interface WhisperBridge {
  /** Download the whisper.cpp binary if it is not there yet. */
  ensureBinary(): Promise<{ success: boolean; path?: string; error?: string }>
  /** Download a model if it is not there yet; progress arrives through `onDownloadProgress`. */
  ensureModel(model: WhisperModel): Promise<{ success: boolean; path?: string; error?: string }>
  listModels(): Promise<{
    success: boolean
    models: Array<{ name: WhisperModel; size: number; installed: boolean }>
  }>
  deleteModel(model: WhisperModel): Promise<IpcAck>
  onDownloadProgress(callback: (progress: WhisperDownloadProgress) => void): () => void
}
