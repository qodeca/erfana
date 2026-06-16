// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for TranscriptionService
 *
 * Comprehensive tests covering: single file, chunked file, retry on 429,
 * cancellation, temp cleanup, fallback model, progress calls, auth header,
 * language parameter, and frontmatter format.
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Mock fs/promises
// =============================================================================

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockUnlink = vi.fn()
const mockStatFn = vi.fn()

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
  stat: mockStatFn
}))

// =============================================================================
// Mock os
// =============================================================================

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual }
})

// =============================================================================
// Mock ApiKeyService
// =============================================================================

const mockGetKey = vi.fn()
const mockHasKey = vi.fn()

vi.mock('./ApiKeyService', () => ({
  apiKeyService: {
    getKey: mockGetKey,
    hasKey: mockHasKey
  }
}))

// =============================================================================
// Mock AudioMetadataService
// =============================================================================

const mockGetDuration = vi.fn()

vi.mock('./AudioMetadataService', () => ({
  audioMetadataService: {
    getDuration: mockGetDuration
  }
}))

// =============================================================================
// Mock LoggingService
// =============================================================================

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Mock shared modules
// =============================================================================

vi.mock('../../shared/constants', () => ({
  TRANSCRIPTION: {
    CHUNK_BOUNDARY_SECONDS: 480,
    CHUNK_OVERLAP_SECONDS: 0.5,
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_BASE_DELAY_MS: 10, // Reduced for tests
    RETRY_MAX_DELAY_MS: 50,
    API_TIMEOUT_MS: 300000,
    TEMP_PREFIX: 'erfana-transcription-chunk-',
    OPENAI_API_URL: 'https://api.openai.com/v1/audio/transcriptions',
    PRIMARY_MODEL: 'gpt-4o-transcribe',
    FALLBACK_MODEL: 'whisper-1',
    MAX_API_FILE_SIZE: 25 * 1024 * 1024
  }
}))

vi.mock('../../shared/errors', () => ({
  ErrorCode: {
    TRANSCRIPTION_NO_API_KEY: 'TRANSCRIPTION_NO_API_KEY',
    TRANSCRIPTION_INVALID_API_KEY: 'TRANSCRIPTION_INVALID_API_KEY',
    TRANSCRIPTION_API_ERROR: 'TRANSCRIPTION_API_ERROR',
    TRANSCRIPTION_RATE_LIMITED: 'TRANSCRIPTION_RATE_LIMITED',
    TRANSCRIPTION_NETWORK_ERROR: 'TRANSCRIPTION_NETWORK_ERROR',
    TRANSCRIPTION_CANCELLED: 'TRANSCRIPTION_CANCELLED',
    TRANSCRIPTION_INVALID_AUDIO: 'TRANSCRIPTION_INVALID_AUDIO',
    TRANSCRIPTION_CHUNK_FAILED: 'TRANSCRIPTION_CHUNK_FAILED',
    TRANSCRIPTION_TIMEOUT: 'TRANSCRIPTION_TIMEOUT',
    TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED'
  }
}))

// =============================================================================
// Mock global fetch
// =============================================================================

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// =============================================================================
// Tests
// =============================================================================

describe('TranscriptionService', () => {
  const onProgress = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKey.mockResolvedValue('sk-test-key')
    mockGetDuration.mockResolvedValue(60) // 1 minute (no chunking)
    mockReadFile.mockResolvedValue(Buffer.from('audio data'))
    mockWriteFile.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockStatFn.mockResolvedValue({ size: 1024 })

    // Default successful API response
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('Hello, this is a test transcription.')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Single file transcription
  // ===========================================================================

  describe('single file transcription', () => {
    it('should transcribe a short audio file', async () => {
      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe(
        '/path/to/audio.mp3', 'en', onProgress
      )

      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Hello, this is a test transcription.')
      expect(result.duration).toBe(60)
    })

    it('should pass language to API', async () => {
      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/audio.mp3', 'pl', onProgress)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, options] = mockFetch.mock.calls[0]
      const formData = options.body as FormData
      expect(formData.get('language')).toBe('pl')
    })

    it('should not send language parameter when set to auto', async () => {
      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/audio.mp3', 'auto', onProgress)

      const [, options] = mockFetch.mock.calls[0]
      const formData = options.body as FormData
      expect(formData.get('language')).toBeNull()
    })

    it('should send auth header with API key', async () => {
      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers).toEqual({
        'Authorization': 'Bearer sk-test-key'
      })
    })

    it('should use primary model by default', async () => {
      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      const [, options] = mockFetch.mock.calls[0]
      const formData = options.body as FormData
      expect(formData.get('model')).toBe('gpt-4o-transcribe')
    })
  })

  // ===========================================================================
  // Progress callback
  // ===========================================================================

  describe('progress calls', () => {
    it('should report progress during single file transcription', async () => {
      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      // Should report at least: Preparing (0%), Analyzing (5%), Sending (10%), Processing (90%), Complete (100%)
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 0, phase: 'Preparing' })
      )
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 5, phase: 'Analyzing audio' })
      )
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 100, phase: 'Complete' })
      )
    })

    it('should report chunk progress during chunked transcription', async () => {
      mockGetDuration.mockResolvedValue(960) // 16 minutes, 2 chunks

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/long-audio.mp3', 'en', onProgress)

      // Should report chunk progress
      const chunkProgressCalls = onProgress.mock.calls.filter(
        (call) => call[0].currentChunk !== undefined
      )
      expect(chunkProgressCalls.length).toBeGreaterThanOrEqual(2)
      expect(chunkProgressCalls[0][0].currentChunk).toBe(1)
      expect(chunkProgressCalls[0][0].totalChunks).toBe(2)
    })
  })

  // ===========================================================================
  // Chunked transcription
  // ===========================================================================

  describe('chunked file', () => {
    it('should chunk files longer than 8 minutes', async () => {
      mockGetDuration.mockResolvedValue(960) // 16 minutes
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024) // 10MB
      mockReadFile.mockResolvedValue(largeBuffer)

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/long.mp3', 'en', onProgress)

      // Should have 2 chunks (960 / 480 = 2)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should join chunks without gaps', async () => {
      mockGetDuration.mockResolvedValue(960) // 2 chunks

      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(callCount === 1 ? 'Part one.' : 'Part two.')
        })
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/long.mp3', 'en', onProgress)

      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Part one. Part two.')
    })

    it('should write temp chunk files and clean them up', async () => {
      mockGetDuration.mockResolvedValue(960) // 2 chunks

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/long.mp3', 'en', onProgress)

      // Should have written 2 temp files
      expect(mockWriteFile).toHaveBeenCalledTimes(2)
      for (const call of mockWriteFile.mock.calls) {
        expect(call[0]).toMatch(/erfana-transcription-chunk-/)
      }

      // Should have cleaned up 2 temp files
      expect(mockUnlink).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // Retry logic
  // ===========================================================================

  describe('retry on 429', () => {
    it('should retry on rate limit (429)', async () => {
      mockGetDuration.mockResolvedValue(960) // Force chunking to trigger withRetry
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            text: () => Promise.resolve('rate limit exceeded')
          })
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('Transcribed text.')
        })
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/long.mp3', 'en', onProgress)

      // First call fails with 429, second succeeds (for first chunk)
      // Then second chunk succeeds on first try
      expect(result.success).toBe(true)
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    it('should retry on rate limit error for single file (under chunk boundary)', async () => {
      // Duration is well below CHUNK_BOUNDARY_SECONDS (480) → takes transcribeSingle path
      mockGetDuration.mockResolvedValue(60)

      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            text: () => Promise.resolve('rate limit exceeded')
          })
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('Single file transcription.')
        })
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/short.mp3', 'en', onProgress)

      // First attempt fails with 429, second attempt succeeds
      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Single file transcription.')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should not retry on auth error (401) for single file', async () => {
      // Duration is well below CHUNK_BOUNDARY_SECONDS (480) → takes transcribeSingle path
      mockGetDuration.mockResolvedValue(60)

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Incorrect API key provided')
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/short.mp3', 'en', onProgress)

      // Auth errors are not retryable – API must be called exactly once
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_INVALID_API_KEY')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Cancellation
  // ===========================================================================

  describe('cancellation', () => {
    it('should respect AbortSignal', async () => {
      const controller = new AbortController()
      controller.abort()

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe(
        '/path/to/audio.mp3', 'en', onProgress, controller.signal
      )

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_CANCELLED')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should clean up temp files on cancellation', async () => {
      mockGetDuration.mockResolvedValue(960) // Force chunking

      const controller = new AbortController()
      let chunkCount = 0
      mockFetch.mockImplementation(() => {
        chunkCount++
        if (chunkCount === 1) {
          // Abort after first chunk
          controller.abort()
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('Part one.')
          })
        }
        return Promise.reject(new Error('Aborted'))
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe(
        '/path/to/long.mp3', 'en', onProgress, controller.signal
      )

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_CANCELLED')
      // Temp files should be cleaned up
      expect(mockUnlink).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Temp file cleanup
  // ===========================================================================

  describe('temp cleanup', () => {
    it('should clean temp files after success', async () => {
      mockGetDuration.mockResolvedValue(960) // 2 chunks

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      await service.transcribe('/path/to/long.mp3', 'en', onProgress)

      expect(mockUnlink).toHaveBeenCalledTimes(2)
    })

    it('should clean temp files after failure', async () => {
      mockGetDuration.mockResolvedValue(960) // 2 chunks

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Incorrect API key')
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/long.mp3', 'en', onProgress)

      expect(result.success).toBe(false)
      // Temp files should still be cleaned up (written before first API call fails)
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('should handle ENOENT gracefully during cleanup', async () => {
      mockGetDuration.mockResolvedValue(960)
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      mockUnlink.mockRejectedValue(error)

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      // Should not throw despite cleanup failure
      const result = await service.transcribe('/path/to/long.mp3', 'en', onProgress)
      expect(result.success).toBe(true)
    })
  })

  // ===========================================================================
  // Fallback model
  // ===========================================================================

  describe('fallback model', () => {
    it('should fall back to whisper-1 on 400 unsupported_format', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: () => Promise.resolve('{"error":{"message":"This model does not support the format you provided.","type":"invalid_request_error","code":"unsupported_format"}}')
          })
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('Fallback transcription from unsupported format.')
        })
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/audio.wav', 'en', onProgress)

      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Fallback transcription from unsupported format.')
      // First call with primary model, second with fallback
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const secondFormData = mockFetch.mock.calls[1][1].body as FormData
      expect(secondFormData.get('model')).toBe('whisper-1')
    })

    it('should fall back to whisper-1 when primary model returns 404', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: () => Promise.resolve('Model not found')
          })
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('Fallback transcription.')
        })
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      expect(result.success).toBe(true)
      expect(result.transcript).toBe('Fallback transcription.')
      // First call with primary model, second with fallback
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const secondFormData = mockFetch.mock.calls[1][1].body as FormData
      expect(secondFormData.get('model')).toBe('whisper-1')
    })
  })

  // ===========================================================================
  // Error handling
  // ===========================================================================

  describe('error handling', () => {
    it('should return error when no API key', async () => {
      mockGetKey.mockResolvedValue(null)

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_NO_API_KEY')
    })

    it('should return error for invalid audio file', async () => {
      mockGetDuration.mockRejectedValue(new Error('Not audio'))

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/corrupt.mp3', 'en', onProgress)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_INVALID_AUDIO')
    })

    it('should return TRANSCRIPTION_INVALID_API_KEY for 401 responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Incorrect API key provided')
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_INVALID_API_KEY')
    })

    it('should return TRANSCRIPTION_FAILED for generic API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error')
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.errorCode).toBe('TRANSCRIPTION_FAILED')
    })

    it('should return error when both primary and fallback models fail', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // Primary model returns 404 → triggers fallback
          return Promise.resolve({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: () => Promise.resolve('Model not found')
          })
        }
        // Fallback model returns 400 (non-retryable)
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve('Invalid request')
        })
      })

      const { createTranscriptionService } = await import('./TranscriptionService')
      const service = createTranscriptionService()

      const result = await service.transcribe('/path/to/audio.mp3', 'en', onProgress)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_FAILED')
      // 1 primary (404) → 1 fallback (400, non-retryable)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // Singleton pattern
  // ===========================================================================

  describe('singleton', () => {
    it('should export singleton instance', async () => {
      const { transcriptionService } = await import('./TranscriptionService')

      expect(transcriptionService).toBeDefined()
      expect(typeof transcriptionService.transcribe).toBe('function')
    })
  })
})
