---
brs_id: 9
document_type: technical_adr
sequence: 1
---

# ADR-BRS009-001: Media import with transcription

**Date:** 2025-12 | **Status:** Draft

**BRS Reference**: `specs/business-reqs/brs009-media-import-transcription/`

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Component design](#2-component-design)
3. [Integration points](#3-integration-points)
4. [Technology decisions](#4-technology-decisions)
5. [Security considerations](#5-security-considerations)
6. [Implementation phases](#6-implementation-phases)
7. [Risk assessment](#7-risk-assessment)
8. [Appendices](#appendices)

---

## 1. System overview

### 1.1 High-level architecture

```
                                    RENDERER PROCESS
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────────────┐     ┌──────────────────┐    ┌────────────────────┐    │
│  │  Home Tab       │────▶│ LanguageDialog   │───▶│ TranscriptionModal │    │
│  │  Import Button  │     │ (Pre-import)     │    │ (Progress display) │    │
│  └─────────────────┘     └──────────────────┘    └─────────┬──────────┘    │
│                                                             │               │
│                                  IPC Events                 │               │
│                          ┌──────────────────────────────────┤               │
│                          │  transcription:progress          │               │
│                          │  transcription:complete          │               │
│                          │  transcription:error             │               │
└──────────────────────────┼──────────────────────────────────┼───────────────┘
                           │                                  │
═══════════════════════════│══════════IPC BRIDGE══════════════│═══════════════
                           │                                  │
                           ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAIN PROCESS                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         ImportService                                │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │   │
│  │  │  PdfConverter   │  │  TextConverter  │  │  MediaConverter     │  │   │
│  │  │  (existing)     │  │  (existing)     │  │  (NEW - BRS-009)    │  │   │
│  │  └─────────────────┘  └─────────────────┘  └──────────┬──────────┘  │   │
│  └───────────────────────────────────────────────────────┼──────────────┘   │
│                                                          │                  │
│                                                          ▼                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      TranscriptionService                             │  │
│  │  ┌────────────────────────────────────────────────────────────────┐   │  │
│  │  │                   ITranscriptionBackend                        │   │  │
│  │  │  ┌─────────────────────┐    ┌────────────────────────────┐    │   │  │
│  │  │  │ OpenAIBackend       │    │ LocalWhisperBackend        │    │   │  │
│  │  │  │ - GPT-4o-transcribe │    │ - whisper.cpp via          │    │   │  │
│  │  │  │ - Whisper-1 fallback│    │   smart-whisper            │    │   │  │
│  │  │  └─────────────────────┘    └────────────────────────────┘    │   │  │
│  │  └────────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌────────────────────────┐    ┌────────────────────────┐                  │
│  │  AudioExtractionService│    │  ChunkingService       │                  │
│  │  (ffmpeg-static)       │    │  (File splitting)      │                  │
│  └────────────────────────┘    └────────────────────────┘                  │
│                                                                             │
│  ┌────────────────────────┐    ┌────────────────────────┐                  │
│  │  MarkdownGenerator     │    │  SecureKeyStorage      │                  │
│  │  (Frontmatter + body)  │    │  (Electron safeStorage)│                  │
│  └────────────────────────┘    └────────────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component responsibilities

| Component | Responsibility | Layer |
|-----------|----------------|-------|
| `MediaConverter` | Implements `IConverter`, orchestrates media import flow | Main |
| `TranscriptionService` | Manages transcription backends, chunking, retry logic | Main |
| `OpenAIBackend` | OpenAI API integration (GPT-4o-transcribe, Whisper-1) | Main |
| `LocalWhisperBackend` | Local whisper.cpp via smart-whisper native module | Main |
| `AudioExtractionService` | Extract audio from video files using ffmpeg | Main |
| `ChunkingService` | Split audio files exceeding 10 minutes | Main |
| `MarkdownGenerator` | Generate markdown with YAML frontmatter | Main |
| `SecureKeyStorage` | Encrypt/decrypt API keys via Electron safeStorage | Main |
| `LanguageDialog` | Pre-import language selection UI | Renderer |
| `TranscriptionModal` | Progress display with ETA and chunk status | Renderer |

### 1.3 Data flow - Transcription pipeline

```
1. User clicks Import button in Home tab
   (center section, triggers file picker for media files)
        │
        ▼
2. LanguageDialog shows
   (User selects language or auto-detect)
        │
        ▼
3. MediaConverter.validate()
   - Check file exists
   - Validate format via magic bytes
   - Check file size
        │
        ▼
4. Is Video? ─────Yes────▶ AudioExtractionService
        │                         │
        No                        │ Extract audio track
        │                         │ (ffmpeg → temp .wav)
        ▼                         │
5. Duration > 10 min? ◀───────────┘
        │
       Yes ────────▶ ChunkingService
        │                   │
        No                  │ Split at 9-min boundaries
        │                   │ with 5-second overlap
        ▼                   │
6. TranscriptionService ◀──┘
        │
        ├── OpenAIBackend (if settings.backend === 'openai')
        │       │
        │       └── Rate limit? → Exponential backoff
        │
        └── LocalWhisperBackend (if settings.backend === 'local')
                │
                └── Model not found? → Prompt to download
        │
        ▼
7. Concatenate chunks (if chunked)
   - Remove overlap duplicates
   - Maintain sentence continuity
        │
        ▼
8. MarkdownGenerator
   - Add YAML frontmatter
   - Format transcript body
        │
        ▼
9. ImportService.writeFile()
   - Write to project/import/
   - Handle filename conflicts
        │
        ▼
10. Cleanup temp files
    - Extracted audio
    - Chunk files
        │
        ▼
11. Open file in editor
```

---

## 2. Component design

### 2.1 MediaConverter

Implements the existing `IConverter` interface to integrate with `ImportService`.

```typescript
// src/main/services/import/converters/MediaConverter.ts

import type { IConverter, ValidationResult, ConversionResult, FileTypeCategory } from '../types'
import type { TranscriptionService } from '../../transcription/TranscriptionService'
import type { AudioExtractionService } from '../../transcription/AudioExtractionService'
import type { TranscriptionOptions } from '../../transcription/types'
import type { FileTypeResult } from 'file-type'
import { fileTypeFromFile } from 'file-type'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { TRANSCRIPTION } from '@shared/constants'

/**
 * Audio file extensions supported for direct transcription
 */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma'] as const

/**
 * Video file extensions requiring audio extraction first
 */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'] as const

/**
 * All media extensions for type guards
 */
export const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS] as const

export type MediaExtension = (typeof MEDIA_EXTENSIONS)[number]

/**
 * Check if extension is a video format
 */
export function isVideoExtension(ext: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())
}

/**
 * Media Converter
 *
 * Converts audio and video files to markdown transcripts.
 * Uses TranscriptionService for the actual transcription work.
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles media-to-transcript conversion
 * - Open/Closed: New media formats added via MEDIA_EXTENSIONS constant
 * - Dependency Inversion: Depends on TranscriptionService abstraction
 */
export class MediaConverter implements IConverter {
  /** Supported extensions - no spread needed, MEDIA_EXTENSIONS is already an array */
  readonly supportedExtensions: string[] = MEDIA_EXTENSIONS as unknown as string[]
  readonly requiresConversion = true

  /**
   * Category determined dynamically based on file extension
   */
  getCategory(filePath: string): FileTypeCategory {
    const ext = extname(filePath).slice(1).toLowerCase()
    return isVideoExtension(ext) ? 'video' : 'audio'
  }

  /** Default category for interface compliance */
  readonly category: FileTypeCategory = 'audio'

  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly audioExtractionService: AudioExtractionService
  ) {}

  /**
   * Validate media file before conversion
   *
   * @param filePath - Absolute path to media file
   * @returns ValidationResult with success status and any issues
   */
  async validate(filePath: string): Promise<ValidationResult> {
    const issues: string[] = []

    // 1. Check file exists and get size
    let fileSize: number
    try {
      const stats = await stat(filePath)
      fileSize = stats.size
    } catch {
      return { valid: false, issues: ['File not found or inaccessible'] }
    }

    // 2. Check file size
    if (fileSize > TRANSCRIPTION.MAX_FILE_SIZE_BYTES) {
      const maxMB = Math.round(TRANSCRIPTION.MAX_FILE_SIZE_BYTES / (1024 * 1024))
      issues.push(`File exceeds maximum size of ${maxMB}MB`)
    }

    if (fileSize === 0) {
      return { valid: false, issues: ['File is empty'] }
    }

    // 3. Validate format using file-type library (magic bytes)
    let detectedType: FileTypeResult | undefined
    try {
      detectedType = await fileTypeFromFile(filePath)
    } catch {
      issues.push('Unable to detect file type')
    }

    if (detectedType) {
      const ext = detectedType.ext
      if (!MEDIA_EXTENSIONS.includes(ext as MediaExtension)) {
        issues.push(`Detected format '${ext}' is not supported for transcription`)
      }
    }

    return {
      valid: issues.length === 0,
      issues
    }
  }

  /**
   * Convert media file to markdown transcript
   *
   * @param filePath - Absolute path to media file
   * @param options - Transcription options (language, progress callback, abort signal)
   * @returns ConversionResult with markdown content or error
   */
  async convert(
    filePath: string,
    options?: TranscriptionOptions
  ): Promise<ConversionResult> {
    // Implementation: orchestrate extraction, transcription, markdown generation
    // See TranscriptionService.transcribe() for the actual flow
  }
}
```

**Note**: The `convert` method signature extension with `options` requires updating the `IConverter` interface. See section 3.1 for the interface evolution strategy.

**Interface versioning consideration**: When adding optional parameters, document the version in which they were added to help maintainers track compatibility.

### 2.2 TranscriptionService

The core orchestration service managing transcription backends and progress.

```typescript
// src/main/services/transcription/TranscriptionService.ts

import { EventEmitter } from 'events'
import type { ITranscriptionBackend, TranscriptionProgress, TranscriptionResult, BackendType } from './types'
import type { ChunkingService } from './ChunkingService'
import type { AudioExtractionService } from './AudioExtractionService'
import type { GlobalSettingsService } from '../GlobalSettingsService'
import { TRANSCRIPTION } from '@shared/constants'
import { TranscriptionError, ErrorCode } from '@shared/errors'

/**
 * Transcription Service Events
 */
export interface TranscriptionServiceEvents {
  progress: (progress: TranscriptionProgress) => void
  complete: (result: TranscriptionResult) => void
  error: (error: TranscriptionError) => void
}

/**
 * Transcription Service
 *
 * Orchestrates transcription across different backends with:
 * - Backend selection based on GlobalSettings
 * - Automatic chunking for large files
 * - Progress tracking via EventEmitter (decoupled from Electron)
 * - Retry logic with exponential backoff
 * - Cleanup of temporary files
 * - Concurrency control (one transcription at a time)
 *
 * SOLID Principles:
 * - Single Responsibility: Orchestration only, delegates to backends
 * - Open/Closed: New backends added via dependency injection
 * - Liskov Substitution: All backends interchangeable via interface
 * - Interface Segregation: Minimal ITranscriptionBackend contract
 * - Dependency Inversion: Depends on backend abstractions injected via constructor
 */
export class TranscriptionService extends EventEmitter {
  private activeTranscription: AbortController | null = null

  /**
   * Create TranscriptionService with injected dependencies
   *
   * @param backends - Map of backend type to implementation (injected for testability)
   * @param chunkingService - Service for splitting large audio files
   * @param audioService - Service for audio metadata extraction
   * @param globalSettings - Global settings service for backend selection
   */
  constructor(
    private readonly backends: Map<BackendType, ITranscriptionBackend>,
    private readonly chunkingService: ChunkingService,
    private readonly audioService: AudioExtractionService,
    private readonly globalSettings: GlobalSettingsService
  ) {
    super()
  }

  /**
   * Check if a transcription is currently in progress
   */
  isTranscribing(): boolean {
    return this.activeTranscription !== null
  }

  /**
   * Get the currently configured backend
   *
   * @throws TranscriptionError if backend not registered
   */
  getActiveBackend(): ITranscriptionBackend {
    const backendType = this.globalSettings.get('transcription.backend') as BackendType
    const backend = this.backends.get(backendType)
    if (!backend) {
      throw new TranscriptionError(
        `Backend '${backendType}' not registered`,
        ErrorCode.TRANSCRIPTION_BACKEND_NOT_FOUND
      )
    }
    return backend
  }

  /**
   * Transcribe an audio file
   *
   * @param audioPath - Path to audio file
   * @param options - Transcription options (language, etc.)
   * @returns TranscriptionResult with text and metadata
   * @throws TranscriptionError if transcription already in progress or fails
   */
  async transcribe(
    audioPath: string,
    options: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    // Concurrency guard - reject if already transcribing
    if (this.activeTranscription) {
      throw new TranscriptionError(
        'Transcription already in progress. Cancel the current transcription first.',
        ErrorCode.TRANSCRIPTION_ALREADY_IN_PROGRESS
      )
    }

    const abortController = new AbortController()
    this.activeTranscription = abortController

    // Merge abort signal with options
    const optionsWithSignal: TranscriptionOptions = {
      ...options,
      signal: abortController.signal
    }

    try {
      // Get audio duration for chunking decision
      const duration = await this.getAudioDuration(audioPath)

      if (duration > TRANSCRIPTION.CHUNK_THRESHOLD_SECONDS) {
        return await this.transcribeWithChunking(audioPath, optionsWithSignal, duration)
      }

      // Direct transcription for files under threshold
      return await this.transcribeSingleFile(audioPath, optionsWithSignal)
    } catch (error) {
      // Re-throw TranscriptionError as-is, wrap others
      if (error instanceof TranscriptionError) {
        throw error
      }
      throw new TranscriptionError(
        error instanceof Error ? error.message : 'Transcription failed',
        ErrorCode.TRANSCRIPTION_UNKNOWN_ERROR,
        { cause: error }
      )
    } finally {
      // Always clean up AbortController
      this.activeTranscription = null
    }
  }

  /**
   * Cancel active transcription
   *
   * @returns true if transcription was cancelled, false if none was active
   */
  cancel(): boolean {
    if (this.activeTranscription) {
      this.activeTranscription.abort()
      this.activeTranscription = null
      return true
    }
    return false
  }

  /**
   * Get audio duration using AudioExtractionService
   *
   * @param audioPath - Path to audio file
   * @returns Duration in seconds
   */
  private async getAudioDuration(audioPath: string): Promise<number> {
    const metadata = await this.audioService.probe(audioPath)
    return metadata.duration
  }

  /**
   * Transcribe a single file (under chunk threshold)
   */
  private async transcribeSingleFile(
    audioPath: string,
    options: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const backend = this.getActiveBackend()

    this.emitProgress({
      stage: 'transcribing',
      percent: 10,
      message: `Transcribing with ${backend.name}...`
    })

    const result = await backend.transcribe(audioPath, options, (percent) => {
      this.emitProgress({
        stage: 'transcribing',
        percent: 10 + Math.round(percent * 0.85), // Map 0-100 to 10-95
        message: 'Transcribing...'
      })
    })

    this.emitProgress({
      stage: 'finalizing',
      percent: 95,
      message: 'Finalizing transcript...'
    })

    return result
  }

  /**
   * Transcribe a large file by chunking
   */
  private async transcribeWithChunking(
    audioPath: string,
    options: TranscriptionOptions,
    duration: number
  ): Promise<TranscriptionResult> {
    // Implementation: split, transcribe chunks, concatenate
    // See ChunkingService for chunk splitting logic
  }

  /**
   * Emit progress event (decoupled from Electron)
   * Callers can subscribe via on('progress', callback)
   */
  private emitProgress(progress: TranscriptionProgress): void {
    this.emit('progress', progress)
  }
}

/**
 * Factory function for creating TranscriptionService with default backends
 * (for production use)
 */
export function createTranscriptionService(
  chunkingService: ChunkingService,
  audioService: AudioExtractionService,
  globalSettings: GlobalSettingsService,
  openAIBackend: ITranscriptionBackend,
  localBackend: ITranscriptionBackend
): TranscriptionService {
  const backends = new Map<BackendType, ITranscriptionBackend>([
    ['openai', openAIBackend],
    ['local', localBackend]
  ])
  return new TranscriptionService(backends, chunkingService, audioService, globalSettings)
}
```

**Key design decisions**:
1. **Dependency injection**: Backends are injected via constructor for testability
2. **EventEmitter pattern**: Decouples progress events from Electron's BrowserWindow
3. **Concurrency control**: Explicit rejection when transcription already in progress
4. **Factory function**: Provides convenient construction with default backends

### 2.3 ITranscriptionBackend interface

Strategy pattern interface for pluggable transcription backends.

```typescript
// src/main/services/transcription/types.ts

/**
 * Backend type identifier
 */
export type BackendType = 'openai' | 'local'

/**
 * Transcription options passed from UI
 */
export interface TranscriptionOptions {
  /** ISO 639-1 language code or 'auto' for detection */
  language: string
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Progress event for IPC
 */
export interface TranscriptionProgress {
  /** Current stage of processing */
  stage: 'validating' | 'extracting' | 'uploading' | 'transcribing' | 'finalizing'
  /** Overall progress 0-100 */
  percent: number
  /** Current chunk number (1-indexed) */
  chunk?: number
  /** Total number of chunks */
  totalChunks?: number
  /** Estimated time remaining in seconds */
  etaSeconds?: number
  /** Human-readable status message */
  message: string
}

/**
 * Transcription result from backend
 */
export interface TranscriptionResult {
  /** Transcribed text */
  text: string
  /** Detected or confirmed language */
  language: string
  /** Audio duration in seconds */
  durationSeconds: number
  /** Model used for transcription */
  model: string
  /** Backend used */
  backend: BackendType
}

/**
 * Transcription Backend Interface
 *
 * Strategy pattern: Each backend implements this interface
 * to provide transcription via different engines.
 */
export interface ITranscriptionBackend {
  /** Backend identifier */
  readonly type: BackendType

  /** Human-readable name */
  readonly name: string

  /**
   * Check if backend is configured and ready
   * (API key present for OpenAI, model downloaded for local)
   */
  isConfigured(): Promise<boolean>

  /**
   * Get configuration issues (for settings UI)
   */
  getConfigurationIssues(): Promise<string[]>

  /**
   * Transcribe a single audio file or chunk
   *
   * @param audioPath - Path to audio file (WAV format preferred)
   * @param options - Transcription options
   * @param onProgress - Callback for progress updates (0-100)
   * @returns Transcription text
   * @throws TranscriptionError on failure
   */
  transcribe(
    audioPath: string,
    options: TranscriptionOptions,
    onProgress?: (percent: number) => void
  ): Promise<TranscriptionResult>

  /**
   * Get supported audio formats
   */
  getSupportedFormats(): string[]

  /**
   * Maximum file size this backend accepts (in bytes)
   */
  getMaxFileSize(): number

  /**
   * Maximum duration this backend handles efficiently (in seconds)
   */
  getOptimalMaxDuration(): number
}
```

### 2.4 OpenAIBackend

OpenAI Whisper API implementation.

```typescript
// src/main/services/transcription/backends/OpenAIBackend.ts

import OpenAI from 'openai'
import { createReadStream, type ReadStream } from 'fs'
import type { ITranscriptionBackend, TranscriptionOptions, TranscriptionResult } from '../types'
import type { SecureKeyStorage } from '../../SecureKeyStorage'
import { TranscriptionError, ErrorCode } from '@shared/errors'
import { TRANSCRIPTION } from '@shared/constants'

/**
 * OpenAI Transcription Backend
 *
 * Uses OpenAI's transcription API with:
 * - GPT-4o-transcribe as primary model (best accuracy, 2025)
 * - Whisper-1 as fallback for compatibility
 * - Automatic retry with exponential backoff for rate limits
 * - Secure API key retrieval via safeStorage
 * - Proper stream cleanup on success and failure
 *
 * API Limits (as of 2025):
 * - 25MB max file size per request
 * - ~10 minutes optimal duration per chunk
 */
export class OpenAIBackend implements ITranscriptionBackend {
  readonly type = 'openai' as const
  readonly name = 'OpenAI Whisper API'

  private client: OpenAI | null = null

  /**
   * Create OpenAIBackend with injected dependencies
   *
   * @param keyStorage - Secure storage for API keys
   * @param clientFactory - Optional factory for creating OpenAI client (for testing)
   */
  constructor(
    private readonly keyStorage: SecureKeyStorage,
    private readonly clientFactory?: (apiKey: string) => OpenAI
  ) {}

  async isConfigured(): Promise<boolean> {
    const result = await this.keyStorage.getApiKey('openai')
    return result.success && result.key.length > 0
  }

  async getConfigurationIssues(): Promise<string[]> {
    const issues: string[] = []
    const result = await this.keyStorage.getApiKey('openai')

    if (!result.success) {
      if (result.reason === 'decryption_failed') {
        issues.push('OpenAI API key corrupted - please re-enter')
      } else {
        issues.push('OpenAI API key not configured')
      }
    }
    return issues
  }

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions,
    onProgress?: (percent: number) => void
  ): Promise<TranscriptionResult> {
    // Validate API key BEFORE reporting progress
    const client = await this.getClient()

    // Now safe to report progress
    onProgress?.(5)

    try {
      // Attempt GPT-4o-transcribe first (best accuracy)
      const response = await this.transcribeWithRetry(
        client,
        audioPath,
        'gpt-4o-transcribe',
        options,
        onProgress
      )

      return this.buildResult(response, 'gpt-4o-transcribe', options.language)
    } catch (error) {
      // Fallback to Whisper-1 if GPT-4o-transcribe unavailable
      if (this.isModelUnavailableError(error)) {
        onProgress?.(10) // Reset progress for retry
        const response = await this.transcribeWithRetry(
          client,
          audioPath,
          'whisper-1',
          options,
          onProgress
        )
        return this.buildResult(response, 'whisper-1', options.language)
      }
      throw error
    }
  }

  /**
   * Build TranscriptionResult from API response
   */
  private buildResult(
    response: OpenAI.Audio.Transcription,
    model: string,
    requestedLanguage: string
  ): TranscriptionResult {
    // Handle empty string language from API (use detected or fallback to 'en')
    const detectedLanguage = response.language
    const language = requestedLanguage === 'auto'
      ? (detectedLanguage && detectedLanguage.length > 0 ? detectedLanguage : 'en')
      : requestedLanguage

    return {
      text: response.text,
      language,
      durationSeconds: response.duration ?? 0,
      model,
      backend: 'openai'
    }
  }

  /**
   * Transcribe with exponential backoff for rate limits (iterative, not recursive)
   */
  private async transcribeWithRetry(
    client: OpenAI,
    audioPath: string,
    model: string,
    options: TranscriptionOptions,
    onProgress?: (percent: number) => void
  ): Promise<OpenAI.Audio.Transcription> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= TRANSCRIPTION.MAX_RETRY_ATTEMPTS; attempt++) {
      // Check for cancellation before each attempt
      options.signal?.throwIfAborted()

      // Create stream for this attempt (new stream needed for retry)
      let stream: ReadStream | null = null

      try {
        stream = createReadStream(audioPath)

        const response = await client.audio.transcriptions.create({
          file: stream,
          model,
          language: options.language === 'auto' ? undefined : options.language,
          response_format: 'verbose_json'
        })

        onProgress?.(90)
        return response
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Rate limit - retry with backoff
        if (this.isRateLimitError(error) && attempt < TRANSCRIPTION.MAX_RETRY_ATTEMPTS) {
          const delay = TRANSCRIPTION.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
          await this.delay(delay)
          continue
        }

        // Non-retryable error
        throw error
      } finally {
        // Always cleanup stream
        if (stream) {
          stream.destroy()
        }
      }
    }

    // Exhausted all retries
    throw lastError ?? new TranscriptionError(
      'Transcription failed after max retries',
      ErrorCode.TRANSCRIPTION_RATE_LIMITED
    )
  }

  getSupportedFormats(): string[] {
    return ['mp3', 'mp4', 'm4a', 'mpeg', 'mpga', 'wav', 'webm', 'flac', 'ogg']
  }

  getMaxFileSize(): number {
    return 25 * 1024 * 1024 // 25MB
  }

  getOptimalMaxDuration(): number {
    return 600 // 10 minutes
  }

  /**
   * Get or create OpenAI client
   *
   * Note: Client (and API key) persists in memory for performance.
   * Call invalidateClient() to force re-creation (e.g., after key change).
   */
  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      const result = await this.keyStorage.getApiKey('openai')

      if (!result.success) {
        throw new TranscriptionError(
          result.reason === 'decryption_failed'
            ? 'API key corrupted - please re-enter in Settings'
            : 'OpenAI API key not configured',
          ErrorCode.TRANSCRIPTION_API_KEY_MISSING
        )
      }

      this.client = this.clientFactory
        ? this.clientFactory(result.key)
        : new OpenAI({ apiKey: result.key })
    }
    return this.client
  }

  /**
   * Invalidate cached client (call after API key change)
   */
  invalidateClient(): void {
    this.client = null
  }

  private isRateLimitError(error: unknown): boolean {
    return error instanceof OpenAI.RateLimitError
  }

  private isModelUnavailableError(error: unknown): boolean {
    return (
      error instanceof OpenAI.NotFoundError ||
      (error instanceof Error && error.message.includes('model'))
    )
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
```

**Key improvements**:
1. **Stream cleanup**: Streams are always destroyed in `finally` block
2. **Iterative retry**: Replaced recursion with iteration to avoid stack overflow
3. **API key validation first**: Validates before reporting any progress
4. **Empty language handling**: Properly handles empty string from API
5. **Client factory injection**: Enables mocking for tests
6. **Error type discrimination**: `getApiKey` now returns result object to distinguish errors

### 2.5 LocalWhisperBackend

Local whisper.cpp implementation via smart-whisper.

```typescript
// src/main/services/transcription/backends/LocalWhisperBackend.ts

import type { ITranscriptionBackend, TranscriptionOptions, TranscriptionResult } from '../types'
import type { Whisper } from 'smart-whisper'
import type { AudioExtractionService } from '../AudioExtractionService'
import type { GlobalSettingsService } from '../../GlobalSettingsService'
import type { MainLogger } from '@main/utils/logger'
import { app } from 'electron'
import { join, extname } from 'path'
import { access, constants, unlink } from 'fs/promises'
import { TranscriptionError, ErrorCode } from '@shared/errors'

/**
 * Whisper model sizes and their approximate memory requirements
 */
export const WHISPER_MODELS = {
  tiny: { size: '75MB', memory: '390MB', accuracy: 'Low' },
  base: { size: '142MB', memory: '500MB', accuracy: 'Medium' },
  small: { size: '466MB', memory: '1GB', accuracy: 'Good' },
  medium: { size: '1.5GB', memory: '2.6GB', accuracy: 'High' },
  large: { size: '3GB', memory: '4.7GB', accuracy: 'Best' }
} as const

export type WhisperModelSize = keyof typeof WHISPER_MODELS

/**
 * Model download URLs (Hugging Face)
 */
const MODEL_URLS: Record<WhisperModelSize, string> = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
  large: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin'
}

/**
 * Expected SHA-256 checksums for model verification
 */
const MODEL_CHECKSUMS: Record<WhisperModelSize, string> = {
  tiny: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  base: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
  small: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1c616b1c39',
  medium: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
  large: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'
}

/**
 * Local Whisper Backend
 *
 * Uses whisper.cpp via smart-whisper native module for:
 * - Fully offline transcription
 * - No API costs
 * - Privacy (audio never leaves device)
 *
 * Trade-offs:
 * - Requires model download (75MB - 3GB)
 * - Slower than cloud API (depends on hardware)
 * - Higher memory usage during transcription
 *
 * Sandbox compatibility:
 * - Native module may fail in sandboxed Electron
 * - Use isNativeModuleAvailable() to check before use
 * - Falls back to OpenAI if native module unavailable
 */
export class LocalWhisperBackend implements ITranscriptionBackend {
  readonly type = 'local' as const
  readonly name = 'Local Whisper (Offline)'

  private whisper: Whisper | null = null
  private currentModel: WhisperModelSize | null = null
  private nativeModuleAvailable: boolean | null = null

  /**
   * Create LocalWhisperBackend with injected dependencies
   *
   * @param globalSettings - Global settings service
   * @param audioService - Audio extraction/conversion service
   * @param logger - Logger instance
   */
  constructor(
    private readonly globalSettings: GlobalSettingsService,
    private readonly audioService: AudioExtractionService,
    private readonly logger: MainLogger
  ) {}

  /**
   * Check if native module is available (sandbox compatibility)
   */
  async isNativeModuleAvailable(): Promise<boolean> {
    if (this.nativeModuleAvailable !== null) {
      return this.nativeModuleAvailable
    }

    try {
      // Attempt to import the native module
      await import('smart-whisper')
      this.nativeModuleAvailable = true
    } catch (error) {
      this.logger.warn('smart-whisper native module not available:', error)
      this.nativeModuleAvailable = false
    }

    return this.nativeModuleAvailable
  }

  async isConfigured(): Promise<boolean> {
    // First check native module availability
    if (!(await this.isNativeModuleAvailable())) {
      return false
    }

    const modelSize = this.getConfiguredModelSize()
    return this.isModelDownloaded(modelSize)
  }

  async getConfigurationIssues(): Promise<string[]> {
    const issues: string[] = []

    // Check native module
    if (!(await this.isNativeModuleAvailable())) {
      issues.push(
        'Local transcription unavailable: native module failed to load. ' +
        'This may be due to Electron sandboxing. Use OpenAI backend instead.'
      )
      return issues
    }

    // Check model downloaded
    const modelSize = this.getConfiguredModelSize()
    if (!(await this.isModelDownloaded(modelSize))) {
      issues.push(`Whisper ${modelSize} model not downloaded`)
    }

    return issues
  }

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions,
    onProgress?: (percent: number) => void
  ): Promise<TranscriptionResult> {
    // Verify native module before starting
    if (!(await this.isNativeModuleAvailable())) {
      throw new TranscriptionError(
        'Local transcription unavailable - native module not loaded',
        ErrorCode.TRANSCRIPTION_MODEL_NOT_FOUND
      )
    }

    const whisper = await this.getWhisper()
    onProgress?.(5)

    // Check if conversion is needed (whisper.cpp requires 16kHz mono WAV)
    let processedPath = audioPath
    let needsCleanup = false
    const ext = extname(audioPath).toLowerCase()

    if (ext !== '.wav') {
      onProgress?.(10)
      processedPath = await this.audioService.convertToWav(audioPath)
      needsCleanup = true
      onProgress?.(20)
    }

    const startTime = Date.now()

    try {
      const result = await whisper.transcribe(processedPath, {
        language: options.language === 'auto' ? undefined : options.language,
        onProgress: (progress: number) => {
          // Map whisper progress (0-1) to our range (20-90)
          const adjustedProgress = needsCleanup ? 20 : 10
          onProgress?.(adjustedProgress + Math.round(progress * 70))
        }
      })

      onProgress?.(95)

      return {
        text: result.text,
        language: result.language ?? options.language,
        durationSeconds: (Date.now() - startTime) / 1000,
        model: `whisper-${this.getConfiguredModelSize()}`,
        backend: 'local'
      }
    } finally {
      // Cleanup temp file if we converted (always, even on error)
      if (needsCleanup && processedPath !== audioPath) {
        await this.cleanupTempFile(processedPath)
      }
    }
  }

  getSupportedFormats(): string[] {
    return ['wav', 'mp3', 'm4a', 'ogg', 'flac']
  }

  getMaxFileSize(): number {
    return 500 * 1024 * 1024 // 500MB
  }

  getOptimalMaxDuration(): number {
    return 900 // 15 minutes
  }

  /**
   * Download a whisper model with checksum verification
   *
   * @param size - Model size to download
   * @param onProgress - Progress callback (0-100)
   */
  async downloadModel(
    size: WhisperModelSize,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const url = MODEL_URLS[size]
    const expectedChecksum = MODEL_CHECKSUMS[size]
    const modelPath = this.getModelPath(size)

    // Implementation: Download with progress, verify checksum
    // See Appendix for full implementation
    this.logger.info(`Downloading whisper model: ${size} from ${url}`)

    // After download, verify checksum
    // const actualChecksum = await this.calculateChecksum(modelPath)
    // if (actualChecksum !== expectedChecksum) {
    //   await unlink(modelPath)
    //   throw new TranscriptionError('Model checksum mismatch', ErrorCode.TRANSCRIPTION_MODEL_CORRUPTED)
    // }
  }

  /**
   * Check if a model is downloaded
   */
  async isModelDownloaded(size: WhisperModelSize): Promise<boolean> {
    const modelPath = this.getModelPath(size)
    try {
      await access(modelPath, constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * Dispose of the whisper instance and free resources
   */
  async dispose(): Promise<void> {
    if (this.whisper) {
      try {
        await this.whisper.dispose()
      } catch (error) {
        // Log but don't throw - disposal errors shouldn't block app shutdown
        this.logger.warn('Error disposing whisper instance:', error)
      } finally {
        this.whisper = null
        this.currentModel = null
      }
    }
  }

  private getConfiguredModelSize(): WhisperModelSize {
    const configured = this.globalSettings.get('transcription.whisperModel')
    // Validate that configured model exists in our map
    if (configured && configured in WHISPER_MODELS) {
      return configured as WhisperModelSize
    }
    return 'small' // Default fallback
  }

  private getModelPath(size: WhisperModelSize): string {
    const modelsDir = join(app.getPath('userData'), 'models', 'whisper')
    return join(modelsDir, `ggml-${size}.bin`)
  }

  private async getWhisper(): Promise<Whisper> {
    const modelSize = this.getConfiguredModelSize()

    // Reload if model changed
    if (this.whisper && this.currentModel !== modelSize) {
      await this.dispose() // Use safe dispose method
    }

    if (!this.whisper) {
      // Verify model exists before loading
      if (!(await this.isModelDownloaded(modelSize))) {
        throw new TranscriptionError(
          `Whisper ${modelSize} model not downloaded`,
          ErrorCode.TRANSCRIPTION_MODEL_NOT_FOUND
        )
      }

      const { Whisper } = await import('smart-whisper')
      const modelPath = this.getModelPath(modelSize)
      this.whisper = new Whisper(modelPath)
      this.currentModel = modelSize
    }

    return this.whisper
  }

  /**
   * Cleanup temporary file with logging on failure
   */
  private async cleanupTempFile(tempPath: string): Promise<void> {
    try {
      await unlink(tempPath)
    } catch (error) {
      // Log but don't throw - cleanup errors shouldn't fail transcription
      this.logger.warn(`Failed to cleanup temp file ${tempPath}:`, error)
    }
  }
}
```

**Key improvements**:
1. **Sandbox compatibility check**: `isNativeModuleAvailable()` validates native module before use
2. **Safe dispose**: `dispose()` handles errors gracefully with logging
3. **Proper cleanup flow**: Uses flag to track if cleanup needed, always cleans in `finally`
4. **Model checksums**: SHA-256 verification after download
5. **Dependency injection**: AudioService and Logger injected for testability
6. **Model validation**: Validates configured model exists in known list

### 2.6 AudioExtractionService

Handles audio extraction from video files and format conversion.

```typescript
// src/main/services/transcription/AudioExtractionService.ts

import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import ffmpeg, { type FfmpegCommand } from 'fluent-ffmpeg'
import { app } from 'electron'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import type { MainLogger } from '@main/utils/logger'
import { TranscriptionError, ErrorCode } from '@shared/errors'
import { TRANSCRIPTION } from '@shared/constants'

// Validate ffmpeg binary path exists
if (!ffmpegPath) {
  throw new Error('ffmpeg-static binary path not found')
}

// Configure fluent-ffmpeg with bundled binaries
ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobeStatic.path)

/**
 * Filename pattern for sanitization (alphanumeric, dots, dashes, underscores)
 */
const SAFE_FILENAME_PATTERN = /^[\w\-. ]+$/

/**
 * Audio metadata from probe
 */
export interface AudioMetadata {
  /** Duration in seconds */
  duration: number
  /** Audio codec (e.g., 'aac', 'mp3') */
  codec: string
  /** Sample rate in Hz */
  sampleRate: number
  /** Number of audio channels */
  channels: number
  /** Bitrate in bps */
  bitrate: number
}

/**
 * Audio Extraction Service
 *
 * Uses ffmpeg-static to:
 * - Extract audio tracks from video files
 * - Convert audio to WAV format for whisper.cpp
 * - Probe audio metadata (duration, codec, etc.)
 * - Split audio at specified timestamps
 *
 * Security measures:
 * - Filename sanitization before ffmpeg processing
 * - Operation timeouts to prevent hangs
 * - Cleanup tracking with logging on failure
 *
 * All temp files are created in configurable temp directory
 * and cleaned up after processing.
 */
export class AudioExtractionService {
  private readonly tempDir: string

  /**
   * Create AudioExtractionService with injected dependencies
   *
   * @param logger - Logger instance for cleanup error logging
   * @param tempDir - Optional custom temp directory (for testing)
   */
  constructor(
    private readonly logger: MainLogger,
    tempDir?: string
  ) {
    this.tempDir = tempDir ?? app.getPath('temp')
  }

  /**
   * Validate filename is safe for ffmpeg processing
   *
   * @param filePath - Path to validate
   * @throws TranscriptionError if filename contains unsafe characters
   */
  private validateFilename(filePath: string): void {
    const filename = basename(filePath)
    if (!SAFE_FILENAME_PATTERN.test(filename)) {
      throw new TranscriptionError(
        'Filename contains unsafe characters. Please rename the file using only letters, numbers, spaces, dots, dashes, and underscores.',
        ErrorCode.TRANSCRIPTION_UNSUPPORTED_FORMAT
      )
    }
  }

  /**
   * Probe audio/video file for metadata
   *
   * @param filePath - Path to media file
   * @returns Audio metadata including duration
   * @throws TranscriptionError if no audio track or probe fails
   */
  async probe(filePath: string): Promise<AudioMetadata> {
    this.validateFilename(filePath)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new TranscriptionError(
          'Probe operation timed out',
          ErrorCode.TRANSCRIPTION_EXTRACTION_FAILED
        ))
      }, TRANSCRIPTION.FFMPEG_PROBE_TIMEOUT_MS)

      ffmpeg.ffprobe(filePath, (err, metadata) => {
        clearTimeout(timeout)

        if (err) {
          reject(new TranscriptionError(
            `Failed to probe file: ${err.message}`,
            ErrorCode.TRANSCRIPTION_EXTRACTION_FAILED
          ))
          return
        }

        // Safely check for metadata existence
        if (!metadata?.format || !metadata?.streams) {
          reject(new TranscriptionError(
            'Invalid media file: no metadata found',
            ErrorCode.TRANSCRIPTION_UNSUPPORTED_FORMAT
          ))
          return
        }

        const audioStream = metadata.streams.find(s => s.codec_type === 'audio')
        if (!audioStream) {
          reject(new TranscriptionError(
            'No audio track found in file',
            ErrorCode.TRANSCRIPTION_NO_AUDIO
          ))
          return
        }

        resolve({
          duration: metadata.format.duration ?? 0,
          codec: audioStream.codec_name ?? 'unknown',
          sampleRate: typeof audioStream.sample_rate === 'number'
            ? audioStream.sample_rate
            : parseInt(String(audioStream.sample_rate), 10) || 0,
          channels: audioStream.channels ?? 0,
          bitrate: typeof audioStream.bit_rate === 'number'
            ? audioStream.bit_rate
            : parseInt(String(audioStream.bit_rate), 10) || 0
        })
      })
    })
  }

  /**
   * Extract audio from video file with timeout
   *
   * @param videoPath - Path to video file
   * @param onProgress - Progress callback (0-100)
   * @returns Path to extracted audio file (WAV format)
   */
  async extractAudio(
    videoPath: string,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    this.validateFilename(videoPath)
    const outputPath = join(this.tempDir, `erfana-audio-${randomUUID()}.wav`)

    return this.runFfmpegWithTimeout(
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav'),
      outputPath,
      onProgress,
      'Audio extraction'
    )
  }

  /**
   * Convert audio to 16kHz mono WAV (required by whisper.cpp)
   */
  async convertToWav(
    audioPath: string,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    this.validateFilename(audioPath)
    const outputPath = join(this.tempDir, `erfana-converted-${randomUUID()}.wav`)

    return this.runFfmpegWithTimeout(
      ffmpeg(audioPath)
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav'),
      outputPath,
      onProgress,
      'Audio conversion'
    )
  }

  /**
   * Split audio file at specified times
   */
  async extractChunk(
    audioPath: string,
    startSeconds: number,
    durationSeconds: number
  ): Promise<string> {
    this.validateFilename(audioPath)
    const outputPath = join(this.tempDir, `erfana-chunk-${randomUUID()}.wav`)

    return this.runFfmpegWithTimeout(
      ffmpeg(audioPath)
        .setStartTime(startSeconds)
        .setDuration(durationSeconds)
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav'),
      outputPath,
      undefined,
      'Chunk extraction'
    )
  }

  /**
   * Run ffmpeg command with timeout handling
   */
  private runFfmpegWithTimeout(
    command: FfmpegCommand,
    outputPath: string,
    onProgress?: (percent: number) => void,
    operationName = 'FFmpeg operation'
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        command.kill('SIGKILL')
        reject(new TranscriptionError(
          `${operationName} timed out after ${TRANSCRIPTION.FFMPEG_OPERATION_TIMEOUT_MS / 1000}s`,
          ErrorCode.TRANSCRIPTION_EXTRACTION_FAILED
        ))
      }, TRANSCRIPTION.FFMPEG_OPERATION_TIMEOUT_MS)

      command
        .on('progress', (progress) => {
          // progress.percent may be undefined or NaN
          const percent = progress?.percent
          if (typeof percent === 'number' && !isNaN(percent)) {
            onProgress?.(Math.round(percent))
          }
        })
        .on('error', (err) => {
          clearTimeout(timeout)
          if (!timedOut) {
            reject(new TranscriptionError(
              `${operationName} failed: ${err.message}`,
              ErrorCode.TRANSCRIPTION_EXTRACTION_FAILED
            ))
          }
        })
        .on('end', () => {
          clearTimeout(timeout)
          if (!timedOut) {
            resolve(outputPath)
          }
        })
        .save(outputPath)
    })
  }

  /**
   * Cleanup temporary file with logging
   */
  async cleanup(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    } catch (error) {
      // Log cleanup failures for diagnostics
      this.logger.warn(`Failed to cleanup temp file ${filePath}:`, error)
    }
  }

  /**
   * Cleanup multiple temporary files
   */
  async cleanupAll(filePaths: string[]): Promise<void> {
    await Promise.all(filePaths.map(p => this.cleanup(p)))
  }
}
```

**Key improvements**:
1. **Filename sanitization**: Validates filenames before ffmpeg processing
2. **Operation timeouts**: All ffmpeg operations have configurable timeout
3. **Safe metadata access**: Properly handles undefined metadata fields
4. **Cleanup logging**: Logs cleanup failures instead of silently ignoring
5. **DI for temp directory**: Enables testing with custom temp paths
6. **ffmpeg binary validation**: Validates binary exists at startup

### 2.7 ChunkingService

Handles splitting large audio files for API limits.

```typescript
// src/main/services/transcription/ChunkingService.ts

import type { AudioExtractionService } from './AudioExtractionService'
import { TRANSCRIPTION } from '@shared/constants'

/**
 * Constants for overlap detection algorithm
 */
const OVERLAP_DETECTION = {
  /** Characters to search at boundary for overlap detection */
  SEARCH_WINDOW_CHARS: 100,
  /** Maximum overlap length to try matching */
  MAX_OVERLAP_CHARS: 50,
  /** Minimum overlap length required for a valid match */
  MIN_OVERLAP_CHARS: 10
} as const

/**
 * Chunking configuration
 */
export interface ChunkConfig {
  /** Maximum duration per chunk in seconds */
  maxDurationSeconds: number
  /** Overlap between chunks in seconds (for word boundary handling) */
  overlapSeconds: number
}

/**
 * Chunk metadata
 */
export interface ChunkInfo {
  /** Chunk index (0-based) */
  index: number
  /** Start time in source file (seconds) */
  startSeconds: number
  /** Duration of this chunk (seconds) */
  durationSeconds: number
  /** Path to chunk file */
  filePath: string
}

/**
 * Chunking Service
 *
 * Splits large audio files into chunks that fit within
 * API size/duration limits.
 *
 * Strategy:
 * - Split at 9-minute boundaries (under 10-min API limit)
 * - 5-second overlap to catch split words
 * - Post-processing to remove duplicate content at boundaries
 *
 * Limitations:
 * - Character-based overlap detection may miss boundaries in:
 *   - Non-Latin scripts (different word boundaries)
 *   - Speaker changes within overlap region
 *   - Heavily accented or mumbled speech
 * - Consider word-level timestamps from Whisper verbose_json for better accuracy
 */
export class ChunkingService {
  private readonly defaultConfig: ChunkConfig

  constructor(private readonly audioService: AudioExtractionService) {
    // Use constants instead of magic numbers
    this.defaultConfig = Object.freeze({
      maxDurationSeconds: TRANSCRIPTION.CHUNK_DURATION_SECONDS,
      overlapSeconds: TRANSCRIPTION.CHUNK_OVERLAP_SECONDS
    })
  }

  /**
   * Calculate chunk boundaries for an audio file
   *
   * Handles edge cases:
   * - Files shorter than one chunk → single chunk returned
   * - Files with duration ≤ overlap → single chunk returned
   * - Ensures at least one chunk is always returned
   *
   * @param totalDurationSeconds - Total duration of audio (must be > 0)
   * @param config - Optional custom chunk configuration
   * @returns Array of chunk boundaries (start, duration), never empty
   */
  calculateChunks(
    totalDurationSeconds: number,
    config: ChunkConfig = this.defaultConfig
  ): Array<{ start: number; duration: number }> {
    // Validate input
    if (totalDurationSeconds <= 0) {
      return [{ start: 0, duration: 0 }]
    }

    const { maxDurationSeconds, overlapSeconds } = config
    const chunks: Array<{ start: number; duration: number }> = []

    // Edge case: file shorter than one chunk
    if (totalDurationSeconds <= maxDurationSeconds) {
      return [{ start: 0, duration: totalDurationSeconds }]
    }

    // Edge case: file shorter than or equal to overlap
    // (shouldn't happen in practice but prevents infinite loop)
    if (totalDurationSeconds <= overlapSeconds) {
      return [{ start: 0, duration: totalDurationSeconds }]
    }

    let currentStart = 0

    while (currentStart < totalDurationSeconds) {
      const remainingDuration = totalDurationSeconds - currentStart
      const chunkDuration = Math.min(maxDurationSeconds, remainingDuration)

      chunks.push({
        start: currentStart,
        duration: chunkDuration
      })

      // Calculate next start position
      const nextStart = currentStart + chunkDuration - overlapSeconds

      // Ensure we make forward progress to prevent infinite loop
      if (nextStart <= currentStart) {
        break
      }

      // Check if remaining content is too small for another chunk
      const remainingAfterNext = totalDurationSeconds - nextStart
      if (remainingAfterNext <= overlapSeconds) {
        break
      }

      currentStart = nextStart
    }

    // Safety: ensure at least one chunk
    if (chunks.length === 0) {
      chunks.push({ start: 0, duration: totalDurationSeconds })
    }

    return chunks
  }

  /**
   * Split audio file into chunks
   *
   * @param audioPath - Path to audio file
   * @param totalDurationSeconds - Total duration of audio
   * @param onProgress - Progress callback (0-100)
   * @returns Array of chunk info with file paths
   */
  async splitIntoChunks(
    audioPath: string,
    totalDurationSeconds: number,
    onProgress?: (percent: number) => void
  ): Promise<ChunkInfo[]> {
    const boundaries = this.calculateChunks(totalDurationSeconds)
    const chunks: ChunkInfo[] = []

    for (let i = 0; i < boundaries.length; i++) {
      const { start, duration } = boundaries[i]

      const chunkPath = await this.audioService.extractChunk(
        audioPath,
        start,
        duration
      )

      chunks.push({
        index: i,
        startSeconds: start,
        durationSeconds: duration,
        filePath: chunkPath
      })

      onProgress?.(Math.round(((i + 1) / boundaries.length) * 100))
    }

    return chunks
  }

  /**
   * Concatenate chunk transcripts, removing overlaps
   *
   * Uses fuzzy matching to find and remove duplicate content
   * at chunk boundaries.
   *
   * @param transcripts - Array of transcript texts (in order)
   * @returns Concatenated transcript
   */
  concatenateTranscripts(transcripts: string[]): string {
    if (transcripts.length === 0) return ''
    if (transcripts.length === 1) return transcripts[0]

    let result = transcripts[0]

    for (let i = 1; i < transcripts.length; i++) {
      const previous = result
      const current = transcripts[i]

      // Find overlap by looking for common suffix/prefix
      const overlap = this.findOverlap(previous, current)

      if (overlap) {
        // Remove overlap from start of current
        result = previous + current.substring(overlap.length)
      } else {
        // No overlap found - check if we need a separator
        const needsSeparator = !previous.endsWith(' ') && !current.startsWith(' ')
        result = previous + (needsSeparator ? ' ' : '') + current
      }
    }

    return result.trim()
  }

  /**
   * Find overlapping text between end of previous and start of current
   *
   * Algorithm:
   * 1. Take last N chars from previous transcript
   * 2. Take first N chars from current transcript
   * 3. Search for longest common substring at boundary
   * 4. Minimum 10 chars required for valid match
   *
   * @returns The overlapping portion from current, or null if none found
   */
  private findOverlap(previous: string, current: string): string | null {
    const { SEARCH_WINDOW_CHARS, MAX_OVERLAP_CHARS, MIN_OVERLAP_CHARS } = OVERLAP_DETECTION

    // Get last N chars of previous
    const searchWindow = previous.slice(-SEARCH_WINDOW_CHARS)
    // Get first N chars of current
    const matchWindow = current.slice(0, SEARCH_WINDOW_CHARS)

    // Try to find the longest common substring at the boundary
    const maxLen = Math.min(MAX_OVERLAP_CHARS, searchWindow.length, matchWindow.length)

    for (let len = maxLen; len >= MIN_OVERLAP_CHARS; len--) {
      const suffix = searchWindow.slice(-len).toLowerCase().trim()
      const prefixMatch = matchWindow.toLowerCase().trim().startsWith(suffix)

      if (prefixMatch && suffix.length > 0) {
        // Find actual start position respecting case
        const actualStart = current.toLowerCase().indexOf(suffix)
        if (actualStart !== -1) {
          return current.substring(0, actualStart + suffix.length)
        }
      }
    }

    return null
  }
}
```

**Key improvements**:
1. **Extracted constants**: Magic numbers moved to `OVERLAP_DETECTION` object
2. **Fixed infinite loop**: Added explicit forward progress check
3. **Edge case handling**: Proper handling for files ≤ chunk size or ≤ overlap
4. **Guaranteed non-empty result**: Always returns at least one chunk
5. **Smarter separator logic**: Only adds space when needed
6. **Documentation**: Added limitations section for overlap detection

### 2.8 MarkdownGenerator

Generates markdown output with YAML frontmatter.

```typescript
// src/main/services/transcription/MarkdownGenerator.ts

import type { TranscriptionResult } from './types'

/**
 * Frontmatter metadata for transcript
 */
export interface TranscriptMetadata {
  /** Path to original source file */
  source: string
  /** Duration formatted as "MM:SS" or "HH:MM:SS" */
  duration: string
  /** ISO 8601 timestamp of transcription */
  transcribed: string
  /** ISO 639-1 language code */
  language: string
  /** Backend used for transcription */
  backend: 'openai' | 'local'
  /** Model used */
  model: string
}

/**
 * Markdown Generator
 *
 * Generates markdown output for transcripts with:
 * - YAML frontmatter containing metadata
 * - Properly formatted transcript body
 * - Paragraph detection from natural breaks
 */
export class MarkdownGenerator {
  /**
   * Generate markdown document from transcription result
   *
   * @param result - Transcription result from backend
   * @param sourcePath - Original media file path
   * @returns Complete markdown document
   */
  generate(result: TranscriptionResult, sourcePath: string): string {
    const metadata: TranscriptMetadata = {
      source: sourcePath,
      duration: this.formatDuration(result.durationSeconds),
      transcribed: new Date().toISOString(),
      language: result.language,
      backend: result.backend,
      model: result.model
    }

    const frontmatter = this.generateFrontmatter(metadata)
    const body = this.formatTranscript(result.text)

    return `${frontmatter}\n\n${body}\n`
  }

  /**
   * Generate YAML frontmatter
   *
   * Uses consistent quoting strategy:
   * - Strings with special chars or paths: quoted
   * - Simple values (codes, enums): unquoted
   */
  private generateFrontmatter(metadata: TranscriptMetadata): string {
    const lines = [
      '---',
      `source: "${this.escapeYamlString(metadata.source)}"`,
      `duration: "${metadata.duration}"`,
      `transcribed: "${metadata.transcribed}"`,
      `language: ${metadata.language}`,
      `backend: ${metadata.backend}`,
      `model: ${metadata.model}`,
      '---'
    ]
    return lines.join('\n')
  }

  /**
   * Escape special characters in YAML string values
   */
  private escapeYamlString(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
  }

  /**
   * Format transcript text with paragraphs
   *
   * Paragraph detection strategy:
   * 1. Existing double newlines preserved
   * 2. Multiple spaces after sentence-ending punctuation become paragraph breaks
   * 3. Empty/whitespace-only input returns empty string
   */
  private formatTranscript(text: string): string {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return ''
    }

    // First preserve existing paragraph breaks (double newlines)
    // Then split on sentence boundaries with multiple spaces
    const paragraphs = trimmed
      .split(/\n\n+/)
      .flatMap(block =>
        block
          .split(/(?<=[.!?])\s{2,}/)
          .map(p => p.trim())
          .filter(p => p.length > 0)
      )
      .filter(p => p.length > 0)

    if (paragraphs.length === 0) {
      return trimmed
    }

    return paragraphs.join('\n\n')
  }

  /**
   * Format duration as MM:SS or HH:MM:SS
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }
}
```

### 2.9 SecureKeyStorage

Secure API key management using Electron's safeStorage.

```typescript
// src/main/services/SecureKeyStorage.ts

import { safeStorage } from 'electron'
import { readFile, writeFile, mkdir, access, constants } from 'fs/promises'
import { join, dirname } from 'path'
import { app } from 'electron'
import type { MainLogger } from '@main/utils/logger'

/**
 * Key types supported
 */
export type KeyType = 'openai'

/**
 * Result type for getApiKey - distinguishes between different failure modes
 */
export type GetKeyResult =
  | { success: true; key: string }
  | { success: false; reason: 'not_stored' | 'decryption_failed' | 'storage_unavailable' }

/**
 * Encrypted key storage format
 */
interface EncryptedKeyStore {
  version: 1
  keys: {
    [K in KeyType]?: string // Base64-encoded encrypted data
  }
}

/**
 * Storage backend type from Electron
 */
type StorageBackend = 'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'dpapi' | 'keychain'

/**
 * Secure Key Storage
 *
 * Uses Electron's safeStorage API for secure credential storage:
 * - macOS: Keychain Access
 * - Windows: DPAPI
 * - Linux: kwallet/gnome-keyring
 *
 * CRITICAL: This service REFUSES to store credentials on Linux
 * without a proper keyring. The 'basic_text' backend uses a
 * hardcoded key that is publicly known in Electron's source code.
 *
 * Keys are encrypted at rest and never stored in plaintext.
 *
 * @see https://www.electronjs.org/docs/latest/api/safe-storage
 */
export class SecureKeyStorage {
  private readonly storePath: string
  private cache: EncryptedKeyStore | null = null

  /**
   * Create SecureKeyStorage
   *
   * @param logger - Logger for error reporting
   * @param userDataPath - Optional custom user data path (for testing)
   */
  constructor(
    private readonly logger: MainLogger,
    userDataPath?: string
  ) {
    const basePath = userDataPath ?? app.getPath('userData')
    this.storePath = join(basePath, 'secure', 'keys.json')
  }

  /**
   * Check if secure storage is available
   *
   * SECURITY: Returns false on Linux without a proper keyring.
   * The 'basic_text' backend is NOT secure - it uses a hardcoded
   * encryption key that is publicly available.
   */
  isSecureStorageAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
      return false
    }

    // Check for the 'basic_text' backend (insecure)
    // getSelectedStorageBackend may not exist on older Electron versions
    const getBackend = safeStorage.getSelectedStorageBackend
    if (typeof getBackend === 'function') {
      const backend = getBackend() as StorageBackend | undefined
      if (backend === 'basic_text') {
        this.logger.warn(
          'Secure storage unavailable: Linux system without keyring. ' +
          'Install gnome-keyring or kwallet to enable API key storage.'
        )
        return false
      }
    }

    return true
  }

  /**
   * Get the storage backend name (for diagnostics)
   */
  getStorageBackend(): string {
    const getBackend = safeStorage.getSelectedStorageBackend
    if (typeof getBackend === 'function') {
      return getBackend() ?? 'unknown'
    }
    return 'unknown'
  }

  /**
   * Get API key for a service
   *
   * Returns a discriminated union to allow callers to distinguish:
   * - 'not_stored': Key was never saved
   * - 'decryption_failed': Key exists but decryption failed (corrupted)
   * - 'storage_unavailable': Secure storage not available on this system
   *
   * @param keyType - Type of key to retrieve
   * @returns GetKeyResult with success status and key or failure reason
   */
  async getApiKey(keyType: KeyType): Promise<GetKeyResult> {
    // Check storage availability first
    if (!this.isSecureStorageAvailable()) {
      return { success: false, reason: 'storage_unavailable' }
    }

    const store = await this.loadStore()
    const encryptedBase64 = store.keys[keyType]

    if (!encryptedBase64) {
      return { success: false, reason: 'not_stored' }
    }

    try {
      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64')
      const key = safeStorage.decryptString(encryptedBuffer)
      return { success: true, key }
    } catch (error) {
      // Log without exposing any key material
      this.logger.error(`Decryption failed for ${keyType} key - may be corrupted`)
      return { success: false, reason: 'decryption_failed' }
    }
  }

  /**
   * Store API key securely
   *
   * SECURITY: Refuses to store on Linux without proper keyring.
   * This is intentional - storing with 'basic_text' backend is
   * worse than no encryption because it creates false security.
   *
   * @param keyType - Type of key to store
   * @param apiKey - Plaintext API key to encrypt and store
   * @throws Error if secure storage not available
   */
  async setApiKey(keyType: KeyType, apiKey: string): Promise<void> {
    if (!this.isSecureStorageAvailable()) {
      const backend = this.getStorageBackend()
      throw new Error(
        `Secure storage not available (backend: ${backend}). ` +
        'On Linux, install gnome-keyring or kwallet to securely store API keys.'
      )
    }

    // Validate parent directory exists
    const storeDir = dirname(this.storePath)
    await mkdir(storeDir, { recursive: true })

    const store = await this.loadStore()
    const encryptedBuffer = safeStorage.encryptString(apiKey)
    store.keys[keyType] = encryptedBuffer.toString('base64')

    await this.saveStore(store)
    this.cache = store
  }

  /**
   * Remove API key
   *
   * @param keyType - Type of key to remove
   */
  async removeApiKey(keyType: KeyType): Promise<void> {
    const store = await this.loadStore()
    delete store.keys[keyType]
    await this.saveStore(store)
    this.cache = store
  }

  /**
   * Check if an API key is stored (without decrypting)
   */
  async hasApiKey(keyType: KeyType): Promise<boolean> {
    const store = await this.loadStore()
    return !!store.keys[keyType]
  }

  /**
   * Clear cached store (useful after settings change)
   */
  clearCache(): void {
    this.cache = null
  }

  private async loadStore(): Promise<EncryptedKeyStore> {
    if (this.cache) {
      return this.cache
    }

    try {
      // Check file exists before reading
      await access(this.storePath, constants.R_OK)
      const content = await readFile(this.storePath, 'utf-8')
      const parsed = JSON.parse(content) as EncryptedKeyStore

      // Validate store structure
      if (typeof parsed?.version !== 'number' || typeof parsed?.keys !== 'object') {
        this.logger.warn('Invalid key store format, resetting')
        return { version: 1, keys: {} }
      }

      this.cache = parsed
      return this.cache
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      return { version: 1, keys: {} }
    }
  }

  private async saveStore(store: EncryptedKeyStore): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true })
    await writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf-8')
  }
}

/**
 * Factory function for creating SecureKeyStorage
 * (prefer DI over singleton for testability)
 */
export function createSecureKeyStorage(logger: MainLogger): SecureKeyStorage {
  return new SecureKeyStorage(logger)
}
```

**Key improvements**:
1. **Result type discrimination**: `GetKeyResult` distinguishes 'not_stored', 'decryption_failed', 'storage_unavailable'
2. **Refuse insecure storage**: Throws error on Linux without keyring (not just warns)
3. **Proper optional chaining**: Handles missing `getSelectedStorageBackend` method
4. **Store validation**: Validates loaded store structure before use
5. **Factory function**: Enables dependency injection over singleton
6. **Enhanced diagnostics**: `getStorageBackend()` method for troubleshooting

### 2.10 Progress tracking system

Progress events use existing IPC patterns with typed schemas.

```typescript
// src/shared/ipc/transcription-schema.ts

import { z } from 'zod'

/**
 * Transcription stage enum
 */
export const TranscriptionStageSchema = z.enum([
  'validating',
  'extracting',
  'uploading',
  'transcribing',
  'finalizing'
])
export type TranscriptionStage = z.infer<typeof TranscriptionStageSchema>

/**
 * Progress event schema
 */
export const TranscriptionProgressSchema = z.object({
  stage: TranscriptionStageSchema,
  percent: z.number().min(0).max(100),
  chunk: z.number().optional(),
  totalChunks: z.number().optional(),
  etaSeconds: z.number().optional(),
  message: z.string()
})
export type TranscriptionProgress = z.infer<typeof TranscriptionProgressSchema>

/**
 * Supported language codes from SUPPORTED_LANGUAGES
 */
const VALID_LANGUAGE_CODES = ['auto', 'en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'zh', 'ko'] as const
const LanguageCodeSchema = z.enum(VALID_LANGUAGE_CODES)

/**
 * Path validation schema - ensures absolute path format
 */
const AbsolutePathSchema = z.string()
  .min(1, 'Path cannot be empty')
  .refine(
    (path) => path.startsWith('/') || /^[A-Z]:\\/.test(path),
    'Path must be absolute (Unix: starts with /, Windows: starts with drive letter)'
  )
  .refine(
    (path) => !path.includes('..'),
    'Path must not contain directory traversal sequences'
  )

/**
 * Transcription start request
 */
export const TranscriptionStartSchema = z.object({
  filePath: AbsolutePathSchema,
  projectPath: AbsolutePathSchema,
  language: LanguageCodeSchema
})
export type TranscriptionStart = z.infer<typeof TranscriptionStartSchema>

/**
 * Transcription result event
 */
export const TranscriptionCompleteSchema = z.object({
  success: z.boolean(),
  outputPath: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional()
})
export type TranscriptionComplete = z.infer<typeof TranscriptionCompleteSchema>

/**
 * Language list for UI
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polish' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ko', name: 'Korean' }
] as const
```

---

## 3. Integration points

### 3.1 IConverter interface evolution

The existing `IConverter.convert()` method is synchronous and doesn't support options. For media conversion, we need to pass language selection. Two approaches:

**Option A: Extend interface with optional options (RECOMMENDED)**

```typescript
// src/main/services/import/types.ts

/**
 * Conversion options passed to convert()
 */
export interface ConversionOptions {
  /** Language for transcription (media files only) */
  language?: string
  /** Progress callback */
  onProgress?: (percent: number) => void
  /** Abort signal */
  signal?: AbortSignal
}

export interface IConverter {
  // ... existing properties ...

  /**
   * Convert/read the file content
   *
   * @param filePath - Absolute path to the file
   * @param options - Optional conversion settings
   * @returns Conversion result with content or error
   */
  convert(filePath: string, options?: ConversionOptions): Promise<ConversionResult>
}
```

**Option B: Use context/configuration object**

Store language in a request context that MediaConverter retrieves internally. More complex, less explicit.

**Recommendation**: Option A is simpler and follows existing patterns. Existing converters ignore the optional `options` parameter.

### 3.2 ImportService extension

```typescript
// src/main/services/import/ImportService.ts

/**
 * Extended import method for media files
 */
async importMediaFile(
  filePath: string,
  projectPath: string,
  options: MediaImportOptions
): Promise<ImportResult> {
  // 1. Get MediaConverter
  // 2. Validate file
  // 3. Call convert() with language option
  // 4. Write to project/import/
  // 5. Return result
}
```

### 3.3 IPC schema definitions

```typescript
// src/preload/index.ts additions

transcription: {
  /** Start transcription for media file */
  start: (params: TranscriptionStart) =>
    ipcRenderer.invoke('transcription:start', params),

  /** Cancel active transcription */
  cancel: () => ipcRenderer.invoke('transcription:cancel'),

  /** Subscribe to progress events */
  onProgress: (callback: (progress: TranscriptionProgress) => void) =>
    ipcRenderer.on('transcription:progress', (_, progress) => callback(progress)),

  /** Subscribe to completion events */
  onComplete: (callback: (result: TranscriptionComplete) => void) =>
    ipcRenderer.on('transcription:complete', (_, result) => callback(result)),

  /** Unsubscribe from events */
  offProgress: () => ipcRenderer.removeAllListeners('transcription:progress'),
  offComplete: () => ipcRenderer.removeAllListeners('transcription:complete')
}
```

### 3.4 IPC handlers implementation

```typescript
// src/main/ipc/transcription-handlers.ts

import { ipcMain, BrowserWindow } from 'electron'
import { normalize, isAbsolute, relative } from 'path'
import { TranscriptionStartSchema } from '@shared/ipc/transcription-schema'
import type { TranscriptionService } from '@main/services/transcription/TranscriptionService'
import type { MainLogger } from '@main/utils/logger'

/**
 * Path validation for transcription requests
 *
 * Security: Ensures filePath is within projectPath to prevent
 * directory traversal attacks
 */
function validatePaths(filePath: string, projectPath: string): boolean {
  const normalizedFile = normalize(filePath)
  const normalizedProject = normalize(projectPath)

  // Both must be absolute
  if (!isAbsolute(normalizedFile) || !isAbsolute(normalizedProject)) {
    return false
  }

  // File must be within project (relative path must not start with ..)
  const relativePath = relative(normalizedProject, normalizedFile)
  return !relativePath.startsWith('..') && !relativePath.startsWith('/')
}

export function registerTranscriptionHandlers(
  transcriptionService: TranscriptionService,
  logger: MainLogger
): void {
  ipcMain.handle('transcription:start', async (event, params: unknown) => {
    // 1. Validate schema
    const parseResult = TranscriptionStartSchema.safeParse(params)
    if (!parseResult.success) {
      logger.warn('Invalid transcription request', parseResult.error.flatten())
      return { success: false, error: 'Invalid request parameters' }
    }

    const { filePath, projectPath, language } = parseResult.data

    // 2. Validate paths (defense in depth - in addition to schema validation)
    if (!validatePaths(filePath, projectPath)) {
      logger.warn('Path validation failed', { filePath, projectPath })
      return { success: false, error: 'Invalid file path' }
    }

    // 3. Start transcription
    try {
      const result = await transcriptionService.transcribe(filePath, {
        language,
        projectPath,
        onProgress: (progress) => {
          const window = BrowserWindow.fromWebContents(event.sender)
          window?.webContents.send('transcription:progress', progress)
        }
      })
      return { success: true, outputPath: result.outputPath }
    } catch (error) {
      logger.error('Transcription failed', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: (error as { code?: string })?.code
      }
    }
  })

  ipcMain.handle('transcription:cancel', async () => {
    await transcriptionService.cancel()
    return { success: true }
  })
}
```

### 3.5 GlobalSettings schema extension

```typescript
// src/shared/ipc/global-settings-schema.ts additions

/**
 * Transcription backend type
 */
export const TranscriptionBackendSchema = z.enum(['openai', 'local'])
export type TranscriptionBackend = z.infer<typeof TranscriptionBackendSchema>

/**
 * Whisper model size
 */
export const WhisperModelSchema = z.enum(['tiny', 'base', 'small', 'medium', 'large'])
export type WhisperModel = z.infer<typeof WhisperModelSchema>

/**
 * Transcription settings
 */
export const TranscriptionSettingsSchema = z.object({
  /** Selected backend */
  backend: TranscriptionBackendSchema.default('openai'),
  /** Local whisper model size */
  whisperModel: WhisperModelSchema.default('small'),
  /** Default language (ISO 639-1 or 'auto') */
  defaultLanguage: z.string().default('auto')
})
export type TranscriptionSettings = z.infer<typeof TranscriptionSettingsSchema>

// Update GlobalSettingsSchema to include transcription
export const GlobalSettingsSchema = z.object({
  // ... existing fields ...
  transcription: TranscriptionSettingsSchema.default({
    backend: 'openai',
    whisperModel: 'small',
    defaultLanguage: 'auto'
  })
})
```

**Important notes**:
1. **API keys NOT in GlobalSettings**: API keys use `SecureKeyStorage` with Electron safeStorage encryption, never plaintext JSON.
2. **Default factory**: Use object literal `default({...})` not arrow function `default(() => ({...}))` for Zod schemas - arrow functions can cause serialization issues.
3. **Schema evolution**: When adding new fields, always provide defaults for backward compatibility with existing `settings.json` files.

### 3.6 Error codes extension

```typescript
// src/shared/errors.ts additions

export enum ErrorCode {
  // ... existing codes ...

  // Transcription errors
  TRANSCRIPTION_NO_AUDIO = 'TRANSCRIPTION_NO_AUDIO',
  TRANSCRIPTION_UNSUPPORTED_FORMAT = 'TRANSCRIPTION_UNSUPPORTED_FORMAT',
  TRANSCRIPTION_API_KEY_MISSING = 'TRANSCRIPTION_API_KEY_MISSING',
  TRANSCRIPTION_API_KEY_INVALID = 'TRANSCRIPTION_API_KEY_INVALID',
  TRANSCRIPTION_RATE_LIMITED = 'TRANSCRIPTION_RATE_LIMITED',
  TRANSCRIPTION_NETWORK_ERROR = 'TRANSCRIPTION_NETWORK_ERROR',
  TRANSCRIPTION_MODEL_NOT_FOUND = 'TRANSCRIPTION_MODEL_NOT_FOUND',
  TRANSCRIPTION_MODEL_CORRUPTED = 'TRANSCRIPTION_MODEL_CORRUPTED',
  TRANSCRIPTION_CANCELLED = 'TRANSCRIPTION_CANCELLED',
  TRANSCRIPTION_CHUNK_FAILED = 'TRANSCRIPTION_CHUNK_FAILED',
  TRANSCRIPTION_EXTRACTION_FAILED = 'TRANSCRIPTION_EXTRACTION_FAILED',
  TRANSCRIPTION_ALREADY_IN_PROGRESS = 'TRANSCRIPTION_ALREADY_IN_PROGRESS',
  TRANSCRIPTION_BACKEND_NOT_FOUND = 'TRANSCRIPTION_BACKEND_NOT_FOUND',
  TRANSCRIPTION_UNKNOWN_ERROR = 'TRANSCRIPTION_UNKNOWN_ERROR',
  TRANSCRIPTION_TIMEOUT = 'TRANSCRIPTION_TIMEOUT',
  TRANSCRIPTION_STORAGE_UNAVAILABLE = 'TRANSCRIPTION_STORAGE_UNAVAILABLE'
}

// Add user-friendly messages
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // ... existing messages ...
  [ErrorCode.TRANSCRIPTION_NO_AUDIO]: 'File contains no audio track',
  [ErrorCode.TRANSCRIPTION_UNSUPPORTED_FORMAT]: 'Audio format not supported',
  [ErrorCode.TRANSCRIPTION_API_KEY_MISSING]: 'OpenAI API key not configured',
  [ErrorCode.TRANSCRIPTION_API_KEY_INVALID]: 'Invalid OpenAI API key',
  [ErrorCode.TRANSCRIPTION_RATE_LIMITED]: 'API rate limit reached, please try again later',
  [ErrorCode.TRANSCRIPTION_NETWORK_ERROR]: 'Network error during transcription',
  [ErrorCode.TRANSCRIPTION_MODEL_NOT_FOUND]: 'Whisper model not downloaded',
  [ErrorCode.TRANSCRIPTION_MODEL_CORRUPTED]: 'Downloaded model failed checksum verification',
  [ErrorCode.TRANSCRIPTION_CANCELLED]: 'Transcription was cancelled',
  [ErrorCode.TRANSCRIPTION_CHUNK_FAILED]: 'Failed to process audio chunk',
  [ErrorCode.TRANSCRIPTION_EXTRACTION_FAILED]: 'Failed to extract audio from video',
  [ErrorCode.TRANSCRIPTION_ALREADY_IN_PROGRESS]: 'Another transcription is already in progress',
  [ErrorCode.TRANSCRIPTION_BACKEND_NOT_FOUND]: 'Transcription backend not registered',
  [ErrorCode.TRANSCRIPTION_UNKNOWN_ERROR]: 'Transcription failed unexpectedly',
  [ErrorCode.TRANSCRIPTION_TIMEOUT]: 'Transcription timed out',
  [ErrorCode.TRANSCRIPTION_STORAGE_UNAVAILABLE]: 'Secure storage unavailable - please configure gnome-keyring or kwallet'
}
```

---

## 4. Technology decisions

### 4.1 Audio processing library selection

| Library | Pros | Cons | Verdict |
|---------|------|------|---------|
| **ffmpeg-static** | Bundled binary, no system dependency, well-tested | +70MB app size, potential vuln updates | **SELECTED** |
| **ffmpeg-static-electron** | Electron-specific, handles asar | Smaller community, fewer updates | Alternative |
| System ffmpeg | No bundle size, native performance | Requires user installation, version variance | Not viable for UX |
| fluent-ffmpeg | Node.js wrapper, good API | Requires ffmpeg binary anyway | Use with ffmpeg-static |

**Decision**: Use `ffmpeg-static` with `fluent-ffmpeg` wrapper.

**Rationale**:
- Consistent behavior across platforms
- No user installation required
- Well-maintained packages
- ffmpeg-static 5.3.0 has no direct vulnerabilities (per Snyk)

**Security consideration**: Bundle specific ffmpeg version and monitor for CVEs. Current ffmpeg has known vulnerabilities in specific codecs - test with restricted input formats.

### 4.2 Local Whisper implementation

| Library | Pros | Cons | Verdict |
|---------|------|------|---------|
| **smart-whisper** | Native module, model management, parallel inference | Last update ~1 year ago | **SELECTED** |
| nodejs-whisper | Auto WAV conversion | Requires local whisper.cpp compilation | Alternative |
| whisper-node | Simple API | Less maintained | Alternative |
| whisper.cpp WASM | No native module | Performance ~2-3x slower | Fallback option |

**Decision**: Use `smart-whisper` as primary, with WASM fallback if native module fails.

**Rationale**:
- Native performance critical for large files
- Automatic model offloading prevents memory issues
- Cross-platform support (macOS, Windows, Linux)
- GPU acceleration on Apple Silicon

**Risk**: Native modules may have compatibility issues with Electron sandboxing. Mitigation: Test thoroughly, provide WASM fallback.

### 4.3 FFmpeg integration approach

**Decision**: Bundle ffmpeg binary via `ffmpeg-static`.

**Considerations**:
- `asar: false` in Erfana means no special handling for binary extraction
- ffmpeg-static provides platform-specific binaries
- fluent-ffmpeg abstraction simplifies usage

**Alternative considered**: Optional download
- Pros: Smaller initial app size (~70MB savings)
- Cons: Poor first-run experience, download failures

**Decision rationale**: Bundle for reliability. 70MB is acceptable for a desktop app.

### 4.4 OpenAI API model strategy

**Decision**: GPT-4o-transcribe as primary, Whisper-1 as fallback.

**Rationale**:
- GPT-4o-transcribe (2025) has better accuracy
- May have regional availability issues
- Whisper-1 is stable fallback
- Same API interface for both

### 4.5 Chunking strategy

**Decision**: 9-minute chunks with 5-second overlap.

**Rationale**:
- OpenAI limit: 25MB file size, ~10 min optimal
- 9 minutes provides safety margin
- 5-second overlap catches split words
- Post-processing removes duplicates

**Alternative considered**: Silence-based splitting
- Pros: Natural boundaries
- Cons: Complex implementation, may not find silence

---

## 5. Security considerations

### 5.1 API key storage and handling

**Requirement**: API keys must not appear in plaintext logs or config files (NFR-006).

**Implementation**: Electron safeStorage API

| Platform | Backend | Security Level |
|----------|---------|----------------|
| macOS | Keychain Access | High (protected by system keychain) |
| Windows | DPAPI | Medium (protected from other users) |
| Linux | gnome-keyring/kwallet | Varies (depends on DE setup) |

**Code safeguards**:
1. Never log API keys (even masked)
2. Never include in error messages
3. Clear from memory after use
4. Validate safeStorage availability before storing

**Fallback for Linux without keyring**:
- **REFUSE** to store API keys when secure storage unavailable
- Return `StorageUnavailableError` with actionable message
- Recommend installing gnome-keyring or kwallet
- User must configure secure storage before using OpenAI backend

**Rationale**: Allowing plaintext storage creates security vulnerabilities. Users must explicitly set up secure storage - we don't silently degrade security.

### 5.2 File validation (prevent malicious files)

**Threat**: Malicious media files exploiting ffmpeg vulnerabilities.

**Mitigations**:
1. **Format detection via `file-type` library**: Detects format from actual file content, not extension
2. **Size limits**: Reject files exceeding `TRANSCRIPTION.MAX_FILE_SIZE_BYTES`
3. **Format whitelist**: Only process formats in `MEDIA_EXTENSIONS` constant
4. **Sandboxed processing**: ffmpeg runs in separate process
5. **Timeout limits**: Abort processing after `FFMPEG_OPERATION_TIMEOUT_MS`

```typescript
// File validation using file-type library (NOT manual magic bytes)
import { fileTypeFromFile } from 'file-type'

async function validateFormat(filePath: string): Promise<ValidationResult> {
  const issues: string[] = []

  // Use file-type for robust format detection
  const detectedType = await fileTypeFromFile(filePath)

  if (!detectedType) {
    issues.push('Unable to detect file type from content')
    return { valid: false, issues }
  }

  // Check against whitelist
  if (!MEDIA_EXTENSIONS.includes(detectedType.ext as MediaExtension)) {
    issues.push(`Detected format '${detectedType.ext}' is not supported`)
    return { valid: false, issues }
  }

  return { valid: true, issues: [] }
}
```

**Why `file-type` library over manual magic bytes**:
- Handles format variants (e.g., MP3 with ID3v1 vs ID3v2 vs raw)
- Maintains comprehensive signature database
- Battle-tested in production by thousands of packages
- Automatic updates for new format variants

### 5.3 Sandboxing considerations for external processes

**Challenge**: Electron sandbox restricts native modules.

**Current state**: Erfana uses default sandbox (enabled since Electron 20).

**Compatibility testing required**:
1. `smart-whisper` native module with sandbox
2. `ffmpeg-static` binary execution with sandbox
3. Temp file access in sandboxed context

**Mitigation if sandbox issues arise**:
- Use `utilityProcess` API for subprocess isolation
- Communicate via IPC with main process

### 5.4 Temporary file cleanup

**Requirement**: All temp files cleaned up in all scenarios (NFR-007).

**Implementation**:
```typescript
class TempFileTracker {
  private files: Set<string> = new Set()

  add(path: string): void {
    this.files.add(path)
  }

  async cleanupAll(): Promise<void> {
    const promises = Array.from(this.files).map(async (path) => {
      try {
        await unlink(path)
      } catch {
        // Ignore errors - file may already be deleted
      }
    })
    await Promise.all(promises)
    this.files.clear()
  }
}

// Usage pattern
const tracker = new TempFileTracker()
try {
  const tempPath = await extractAudio(videoPath)
  tracker.add(tempPath)
  // ... processing
} finally {
  await tracker.cleanupAll() // Always runs
}
```

### 5.5 Network security

**OpenAI API calls**:
- HTTPS only (enforced by OpenAI SDK)
- No sensitive data in query parameters
- API key in Authorization header

**Local Whisper**:
- No network access required
- Model files from trusted sources (Hugging Face)
- Verify model checksums after download

---

## 6. Implementation phases

### Phase 1: Core infrastructure (Week 1-2)

**Deliverables**:
1. AudioExtractionService with ffmpeg-static
2. SecureKeyStorage with safeStorage
3. MarkdownGenerator
4. IPC schema definitions
5. GlobalSettings schema extension

**Acceptance criteria**:
- Unit tests for all services
- Integration test: extract audio from test video
- Secure storage works on macOS/Windows

### Phase 2: OpenAI backend (Week 2-3)

**Deliverables**:
1. OpenAIBackend implementation
2. ChunkingService
3. TranscriptionService (OpenAI path only)
4. MediaConverter skeleton

**Acceptance criteria**:
- AC-001: Import MP3 produces markdown
- AC-005: OpenAI API calls with auth
- AC-007: Large file chunking works
- AC-008: Rate limit retry logic

### Phase 3: Renderer integration (Week 3-4)

**Deliverables**:
1. LanguageDialog component
2. TranscriptionModal component
3. Settings UI for transcription config
4. Progress event handling

**Acceptance criteria**:
- AC-003: Progress bar accurate
- AC-004: Language selection works
- AC-012: Settings persist
- AC-015: UI responsive during transcription

### Phase 4: Local Whisper backend (Week 4-5)

**Deliverables**:
1. LocalWhisperBackend implementation
2. Model download manager
3. Model selection UI

**Acceptance criteria**:
- AC-006: Offline transcription works
- Model download with progress

### Phase 5: Video support & polish (Week 5-6)

**Deliverables**:
1. Video file validation
2. Audio extraction from video
3. Error handling polish
4. Cleanup & temp file management

**Acceptance criteria**:
- AC-002: Video import works
- AC-009, AC-010: Temp file cleanup
- AC-011: Error messages actionable
- AC-013, AC-014: Metadata correct

### Phase 6: Testing & documentation (Week 6)

**Deliverables**:
1. Unit test coverage >80%
2. Integration test suite
3. Documentation updates
4. CHANGELOG entry

**Acceptance criteria**:
- All AC-001 through AC-015 pass
- Definition of Done checklist complete

---

## 7. Risk assessment

### 7.1 Technical risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| smart-whisper incompatible with Electron sandbox | Medium | High | Test early, use `isNativeModuleAvailable()` check, fall back to OpenAI |
| ffmpeg CVEs in bundled binary | Low | High | Pin version, monitor advisories, update promptly |
| OpenAI API deprecates endpoints | Low | High | Abstract API calls, use official SDK with updates |
| Large files exhaust memory | Medium | Medium | Streaming where possible, chunk aggressively |
| Apple Silicon native module issues | Low | Medium | Test on both x64 and arm64 |
| Insufficient disk space for model download | Medium | Medium | Check available space before download, show estimate in UI |
| Interrupted model download | Medium | Low | Implement resume capability, delete partial files on failure |
| Model checksum verification failure | Low | Medium | Re-download automatically, limit retry attempts |
| ffmpeg operation hangs indefinitely | Low | High | Use `FFMPEG_OPERATION_TIMEOUT_MS`, kill process on timeout |
| Concurrent transcription attempts | Medium | Medium | `isTranscribing()` guard, reject with clear error message |

### 7.2 Performance considerations

| Concern | Impact | Mitigation |
|---------|--------|------------|
| UI freezes during transcription | High | All processing in main process, IPC for updates |
| Memory spikes for large files | Medium | Chunk files, stream ffmpeg output |
| Slow local Whisper on Intel Macs | Medium | Recommend OpenAI or smaller model |
| Network timeout for large chunks | Medium | Configurable timeout, retry logic |

### 7.3 Cross-platform compatibility

| Platform | Concern | Mitigation |
|----------|---------|------------|
| macOS arm64 | Native module compatibility | Universal binary for smart-whisper |
| macOS x64 | Rosetta 2 performance | Test performance, document expectations |
| Windows | Long path issues | Use short temp paths |
| Linux | Missing audio codecs | Document codec requirements |
| Linux | No keyring available | Refuse storage, require gnome-keyring/kwallet setup |

### 7.4 User experience risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Users unaware of API costs | Medium | Medium | Consider cost estimation (Q-001) |
| Transcription quality disappointment | High | Medium | Document accuracy expectations |
| Long wait times frustrate users | Medium | Medium | Accurate ETA, cancel option |
| Complex settings confuse users | Low | Low | Sensible defaults, clear descriptions |

---

## Appendices

### A. File structure

```
src/
├── main/
│   ├── services/
│   │   ├── import/
│   │   │   ├── converters/
│   │   │   │   ├── MediaConverter.ts        # NEW
│   │   │   │   └── MediaConverter.test.ts   # NEW
│   │   │   └── types.ts                     # MODIFIED (ConversionOptions)
│   │   ├── transcription/                   # NEW DIRECTORY
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── TranscriptionService.ts
│   │   │   ├── TranscriptionService.test.ts
│   │   │   ├── AudioExtractionService.ts
│   │   │   ├── AudioExtractionService.test.ts
│   │   │   ├── ChunkingService.ts
│   │   │   ├── ChunkingService.test.ts
│   │   │   ├── MarkdownGenerator.ts
│   │   │   ├── MarkdownGenerator.test.ts
│   │   │   └── backends/
│   │   │       ├── OpenAIBackend.ts
│   │   │       ├── OpenAIBackend.test.ts
│   │   │       ├── LocalWhisperBackend.ts
│   │   │       └── LocalWhisperBackend.test.ts
│   │   └── SecureKeyStorage.ts              # NEW
│   └── ipc/
│       └── transcription-handlers.ts        # NEW
├── shared/
│   ├── ipc/
│   │   ├── transcription-schema.ts          # NEW
│   │   └── global-settings-schema.ts        # MODIFIED
│   └── errors.ts                            # MODIFIED
├── preload/
│   └── index.ts                             # MODIFIED (transcription API)
└── renderer/
    └── src/
        ├── components/
        │   ├── Dialog/
        │   │   ├── LanguageDialog.tsx       # NEW
        │   │   └── LanguageDialog.test.tsx  # NEW
        │   └── Transcription/               # NEW DIRECTORY
        │       ├── TranscriptionModal.tsx
        │       ├── TranscriptionModal.test.tsx
        │       └── TranscriptionModal.css
        └── stores/
            └── useTranscriptionStore.ts     # NEW
```

### B. Constants to add

```typescript
// src/shared/constants.ts additions

/**
 * Transcription system constants
 */
export const TRANSCRIPTION = {
  // ── Chunking ──────────────────────────────────────────────────────────
  /** Chunk threshold in seconds (files longer trigger chunking) */
  CHUNK_THRESHOLD_SECONDS: 600, // 10 minutes
  /** Chunk duration in seconds */
  CHUNK_DURATION_SECONDS: 540, // 9 minutes
  /** Overlap between chunks in seconds */
  CHUNK_OVERLAP_SECONDS: 5,

  // ── Retry logic ───────────────────────────────────────────────────────
  /** Maximum retry attempts for API failures */
  MAX_RETRY_ATTEMPTS: 3,
  /** Base delay for exponential backoff in ms */
  RETRY_BASE_DELAY_MS: 1000,

  // ── Timeouts ──────────────────────────────────────────────────────────
  /** Timeout for OpenAI API requests in ms (2 minutes) */
  API_TIMEOUT_MS: 120_000,
  /** Timeout for ffprobe metadata extraction in ms (30 seconds) */
  FFMPEG_PROBE_TIMEOUT_MS: 30_000,
  /** Timeout for ffmpeg operations (extraction, conversion) in ms (5 minutes) */
  FFMPEG_OPERATION_TIMEOUT_MS: 300_000,

  // ── File limits ───────────────────────────────────────────────────────
  /** Maximum file size in bytes (500MB) */
  MAX_FILE_SIZE_BYTES: 500 * 1024 * 1024,
  /** OpenAI max file size per request (25MB) */
  OPENAI_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  /** Local whisper max file size (500MB) */
  LOCAL_MAX_FILE_SIZE_BYTES: 500 * 1024 * 1024,

  // ── Backend optimal durations ─────────────────────────────────────────
  /** OpenAI optimal max duration per chunk (10 minutes) */
  OPENAI_OPTIMAL_MAX_DURATION_SECONDS: 600,
  /** Local whisper optimal max duration per chunk (15 minutes) */
  LOCAL_OPTIMAL_MAX_DURATION_SECONDS: 900
} as const

/**
 * Overlap detection constants for ChunkingService
 */
export const OVERLAP_DETECTION = {
  /** Minimum word length to consider for overlap matching */
  MIN_WORD_LENGTH: 4,
  /** Maximum distance from chunk boundary to search for overlap (words) */
  BOUNDARY_SEARCH_DISTANCE: 20,
  /** Minimum overlap match score (0-1) to consider valid */
  MIN_MATCH_SCORE: 0.6
} as const

/**
 * Filename sanitization pattern for temp files
 */
export const SAFE_FILENAME_PATTERN = /^[\w\-. ]+$/
```

### C. References

**Research sources**:
- [OpenAI Whisper API best practices](https://community.openai.com/t/questions-regarding-transcribing-long-audios-25mb-in-whisper-api/267384)
- [smart-whisper npm package](https://www.npmjs.com/package/smart-whisper)
- [ffmpeg-static npm package](https://www.npmjs.com/package/ffmpeg-static)
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Building a Long Audio Transcription Tool](https://www.buildwithmatija.com/blog/building-a-long-audio-transcription-tool-with-openai-s-whisper-api)

**Related Erfana documentation**:
- `docs/architecture.md` - System architecture patterns
- `docs/security.md` - Security guidelines
- `docs/ipc-patterns.md` - IPC communication patterns
- `src/main/services/import/` - Existing import system

---

**Document history**:

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-22 | Technical Architect | Initial architecture specification |
