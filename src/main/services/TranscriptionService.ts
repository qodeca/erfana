// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Transcription Service
 *
 * Core service for audio-to-text transcription using OpenAI API.
 * Handles chunking for long files, retry with exponential backoff,
 * progress reporting, and temp file cleanup.
 *
 * Features:
 * - GPT-4o-transcribe primary model, Whisper-1 fallback
 * - File chunking for files >8 minutes (480 seconds) with 0.5s overlap
 * - Exponential backoff retry (max 3 attempts, 1s-30s)
 * - AbortSignal cancellation support
 * - Temp file cleanup in finally blocks
 * - Progress callback for UI updates
 *
 * Uses native fetch() for OpenAI API calls (no openai npm package).
 *
 * @see Issue #75 - Media import with transcription
 */
import { readFile, writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join, extname } from 'path'
import { TRANSCRIPTION } from '../../shared/constants'
import { ErrorCode } from '../../shared/errors'
import type {
  TranscriptionLanguage,
  TranscriptionProgress,
  TranscriptionResult
} from '../../shared/ipc/transcription-schema'
import { apiKeyService } from './ApiKeyService'
import { audioMetadataService } from './AudioMetadataService'
import { logger } from './LoggingService'

/**
 * Transcription Service Interface
 */
interface ITranscriptionService {
  /** Transcribe an audio file to text */
  transcribe(
    filePath: string,
    language: TranscriptionLanguage,
    onProgress: (progress: TranscriptionProgress) => void,
    signal?: AbortSignal
  ): Promise<TranscriptionResult>
}

/**
 * Check if an error is retryable (rate limit or transient server error)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    // Rate limit or server errors
    if (message.includes('429') || message.includes('rate limit')) return true
    if (message.includes('500') || message.includes('502') || message.includes('503')) return true
    if (message.includes('timeout')) return true
    if (message.includes('network') || message.includes('fetch')) return true
  }
  return false
}

/**
 * Sleep for specified milliseconds, respecting AbortSignal
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const timer = setTimeout(resolve, ms)

    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }, { once: true })
  })
}

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = TRANSCRIPTION.MAX_RETRY_ATTEMPTS,
  signal?: AbortSignal
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (signal?.aborted) throw error
      if (attempt === maxAttempts) throw error
      if (!isRetryableError(error)) throw error

      const delay = Math.min(
        TRANSCRIPTION.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
        TRANSCRIPTION.RETRY_MAX_DELAY_MS
      )
      logger.debug('Retrying transcription API call', { attempt, delay })
      await sleep(delay, signal)
    }
  }
  // Unreachable, but TypeScript needs it
  throw new Error('Exhausted retries')
}

/**
 * MIME type mapping for supported audio formats
 */
const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac'
}

/**
 * Transcription Service Implementation
 */
class TranscriptionService implements ITranscriptionService {
  /** Set of temp file paths to clean up */
  private tempFiles: Set<string> = new Set()

  /**
   * Transcribe an audio file
   *
   * @param filePath - Absolute path to the audio file
   * @param language - Language code or 'auto' for detection
   * @param onProgress - Progress callback for UI updates
   * @param signal - Optional AbortSignal for cancellation
   * @returns Transcription result with transcript text
   */
  async transcribe(
    filePath: string,
    language: TranscriptionLanguage,
    onProgress: (progress: TranscriptionProgress) => void,
    signal?: AbortSignal
  ): Promise<TranscriptionResult> {
    // Track temp files for cleanup
    const localTempFiles = new Set<string>()

    try {
      // Check for cancellation early
      if (signal?.aborted) {
        return {
          success: false,
          error: 'Transcription was cancelled',
          errorCode: ErrorCode.TRANSCRIPTION_CANCELLED
        }
      }

      // Report initial progress
      onProgress({ percent: 0, phase: 'Preparing' })

      // Get API key
      const apiKey = await apiKeyService.getKey('openai')
      if (!apiKey) {
        return {
          success: false,
          error: 'No API key configured',
          errorCode: ErrorCode.TRANSCRIPTION_NO_API_KEY
        }
      }

      // Get audio duration for chunking decision
      onProgress({ percent: 5, phase: 'Analyzing audio' })
      let duration: number
      try {
        duration = await audioMetadataService.getDuration(filePath)
      } catch {
        return {
          success: false,
          error: 'Failed to analyze audio file',
          errorCode: ErrorCode.TRANSCRIPTION_INVALID_AUDIO
        }
      }

      // Determine if chunking is needed
      const needsChunking = duration > TRANSCRIPTION.CHUNK_BOUNDARY_SECONDS
      let transcript: string

      if (needsChunking) {
        transcript = await this.transcribeChunked(
          filePath, duration, language, apiKey, onProgress, localTempFiles, signal
        )
      } else {
        transcript = await this.transcribeSingle(
          filePath, language, apiKey, onProgress, signal
        )
      }

      onProgress({ percent: 100, phase: 'Complete' })

      return {
        success: true,
        transcript,
        duration,
        language: language === 'auto' ? undefined : language
      }
    } catch (error) {
      if (signal?.aborted) {
        return {
          success: false,
          error: 'Transcription was cancelled',
          errorCode: ErrorCode.TRANSCRIPTION_CANCELLED
        }
      }

      const message = error instanceof Error ? error.message : String(error)
      logger.error('Transcription failed', error instanceof Error ? error : undefined)

      // Map specific error types
      if (message.includes('401') || message.includes('Incorrect API key')) {
        return {
          success: false,
          error: 'Invalid API key',
          errorCode: ErrorCode.TRANSCRIPTION_INVALID_API_KEY
        }
      }

      if (message.includes('429') || message.includes('rate limit')) {
        return {
          success: false,
          error: 'Rate limited',
          errorCode: ErrorCode.TRANSCRIPTION_RATE_LIMITED
        }
      }

      if (message.includes('network') || message.includes('fetch failed')) {
        return {
          success: false,
          error: 'Network error',
          errorCode: ErrorCode.TRANSCRIPTION_NETWORK_ERROR
        }
      }

      return {
        success: false,
        error: message,
        errorCode: ErrorCode.TRANSCRIPTION_FAILED
      }
    } finally {
      // Clean up ALL temp files
      await this.cleanupTempFiles(localTempFiles)
    }
  }

  /**
   * Transcribe a single file (no chunking needed)
   */
  private async transcribeSingle(
    filePath: string,
    language: TranscriptionLanguage,
    apiKey: string,
    onProgress: (progress: TranscriptionProgress) => void,
    signal?: AbortSignal
  ): Promise<string> {
    onProgress({ percent: 10, phase: 'Sending to API' })

    const transcript = await withRetry(
      () => this.callTranscriptionApi(filePath, language, apiKey, signal),
      TRANSCRIPTION.MAX_RETRY_ATTEMPTS,
      signal
    )

    onProgress({ percent: 90, phase: 'Processing result' })

    return transcript
  }

  /**
   * Transcribe a file by splitting into chunks
   *
   * Splits file into chunks based on duration and byte calculations.
   * Each chunk has a 0.5s overlap at boundaries to prevent word truncation.
   */
  private async transcribeChunked(
    filePath: string,
    duration: number,
    language: TranscriptionLanguage,
    apiKey: string,
    onProgress: (progress: TranscriptionProgress) => void,
    tempFiles: Set<string>,
    signal?: AbortSignal
  ): Promise<string> {
    const chunkDuration = TRANSCRIPTION.CHUNK_BOUNDARY_SECONDS
    const overlap = TRANSCRIPTION.CHUNK_OVERLAP_SECONDS
    const totalChunks = Math.ceil(duration / chunkDuration)

    onProgress({
      percent: 5,
      phase: `Splitting into ${totalChunks} chunks`,
      totalChunks
    })

    // Read the full file
    const fileBuffer = await readFile(filePath)
    const ext = extname(filePath).slice(1).toLowerCase()
    const bytesPerSecond = fileBuffer.length / duration
    const transcriptParts: string[] = []

    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) {
        throw new Error('Aborted')
      }

      const chunkNum = i + 1

      // Calculate byte boundaries
      const startSeconds = i * chunkDuration - (i > 0 ? overlap : 0)
      const endSeconds = Math.min((i + 1) * chunkDuration + overlap, duration)
      const startByte = Math.max(0, Math.floor(startSeconds * bytesPerSecond))
      const endByte = Math.min(fileBuffer.length, Math.ceil(endSeconds * bytesPerSecond))

      // Write chunk to temp file
      const chunkPath = join(
        tmpdir(),
        `${TRANSCRIPTION.TEMP_PREFIX}${Date.now()}-${chunkNum}.${ext}`
      )
      const chunkBuffer = fileBuffer.subarray(startByte, endByte)
      await writeFile(chunkPath, chunkBuffer)
      tempFiles.add(chunkPath)
      this.tempFiles.add(chunkPath)

      // Progress update
      const progressBase = 10
      const progressRange = 80
      const chunkProgress = progressBase + (chunkNum / totalChunks) * progressRange
      const etaSeconds = ((totalChunks - chunkNum) / totalChunks) * duration * 0.1

      onProgress({
        percent: Math.round(chunkProgress),
        phase: `Processing chunk ${chunkNum} of ${totalChunks}`,
        currentChunk: chunkNum,
        totalChunks,
        etaSeconds: Math.round(etaSeconds)
      })

      // Transcribe the chunk
      const chunkTranscript = await withRetry(
        () => this.callTranscriptionApi(chunkPath, language, apiKey, signal),
        TRANSCRIPTION.MAX_RETRY_ATTEMPTS,
        signal
      )

      transcriptParts.push(chunkTranscript)
    }

    // Join chunks into continuous transcript
    return transcriptParts.join(' ')
  }

  /**
   * Call the OpenAI transcription API
   *
   * Uses native fetch() with FormData for multipart upload.
   * Tries primary model first, falls back to secondary on model-specific errors.
   */
  private async callTranscriptionApi(
    filePath: string,
    language: TranscriptionLanguage,
    apiKey: string,
    signal?: AbortSignal,
    model: string = TRANSCRIPTION.PRIMARY_MODEL
  ): Promise<string> {
    const fileBuffer = await readFile(filePath)
    const ext = extname(filePath).slice(1).toLowerCase()
    const mimeType = AUDIO_MIME_TYPES[ext] || 'audio/mpeg'

    // Build FormData
    const formData = new FormData()
    const blob = new Blob([fileBuffer], { type: mimeType })
    formData.append('file', blob, `audio.${ext}`)
    formData.append('model', model)
    formData.append('response_format', 'text')

    if (language !== 'auto') {
      formData.append('language', language)
    }

    // Make API call
    const response = await fetch(TRANSCRIPTION.OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData,
      signal
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')

      // Try fallback model on model-specific errors
      // 404 = model not found, 400 unsupported_format = format not supported by gpt-4o-transcribe
      if (model === TRANSCRIPTION.PRIMARY_MODEL &&
        (response.status === 404 ||
          (response.status === 400 && errorBody.includes('unsupported_format')))) {
        logger.warn('Primary model error, falling back', {
          model,
          fallback: TRANSCRIPTION.FALLBACK_MODEL,
          status: response.status
        })
        return this.callTranscriptionApi(
          filePath, language, apiKey, signal, TRANSCRIPTION.FALLBACK_MODEL
        )
      }

      throw new Error(
        `API error ${response.status}: ${errorBody || response.statusText}`
      )
    }

    const text = await response.text()
    return text.trim()
  }

  /**
   * Clean up temp files
   *
   * Best-effort cleanup -- logs errors but does not throw.
   */
  private async cleanupTempFiles(tempFiles: Set<string>): Promise<void> {
    for (const filePath of tempFiles) {
      try {
        await unlink(filePath)
        this.tempFiles.delete(filePath)
      } catch (error) {
        // ENOENT is fine (file already cleaned up)
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          logger.warn('Failed to clean up temp file', {
            filePath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }
    tempFiles.clear()
  }

}

/** Singleton instance */
export const transcriptionService = new TranscriptionService()

/** Factory function for testing */
export function createTranscriptionService(): TranscriptionService {
  return new TranscriptionService()
}
