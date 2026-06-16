// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for AudioMetadataService
 *
 * Tests audio metadata extraction, duration detection, format parsing,
 * and file validation.
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// =============================================================================
// Mock music-metadata
// =============================================================================

const mockParseFile = vi.fn()

vi.mock('music-metadata', () => ({
  parseFile: mockParseFile
}))

// =============================================================================
// Mock fs/promises
// =============================================================================

const mockStat = vi.fn()
const mockAccess = vi.fn()

vi.mock('fs/promises', () => ({
  stat: mockStat,
  access: mockAccess
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

vi.mock('../../shared/errors', () => ({
  ErrorCode: {
    IMPORT_FILE_NOT_FOUND: 'IMPORT_FILE_NOT_FOUND',
    IMPORT_FILE_UNREADABLE: 'IMPORT_FILE_UNREADABLE',
    TRANSCRIPTION_INVALID_AUDIO: 'TRANSCRIPTION_INVALID_AUDIO'
  }
}))

vi.mock('../../shared/constants', () => ({
  TRANSCRIPTION: {
    SUPPORTED_EXTENSIONS: ['mp3', 'wav', 'm4a', 'ogg', 'flac']
  }
}))

// =============================================================================
// Tests
// =============================================================================

describe('AudioMetadataService', () => {
  const mockMetadata = {
    format: {
      duration: 120.5,
      bitrate: 192000,
      sampleRate: 44100,
      numberOfChannels: 2
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockParseFile.mockResolvedValue(mockMetadata)
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 5 * 1024 * 1024 }) // 5MB
  })

  // ===========================================================================
  // getDuration tests
  // ===========================================================================

  describe('getDuration', () => {
    it('should return duration in seconds', async () => {
      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const duration = await service.getDuration('/path/to/audio.mp3')

      expect(duration).toBe(120.5)
      expect(mockParseFile).toHaveBeenCalledWith('/path/to/audio.mp3', { duration: true })
    })

    it('should throw when duration is undefined', async () => {
      mockParseFile.mockResolvedValue({
        format: { duration: undefined }
      })

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      await expect(service.getDuration('/path/to/audio.mp3')).rejects.toThrow(
        'Could not determine audio duration'
      )
    })

    it('should throw when duration is NaN', async () => {
      mockParseFile.mockResolvedValue({
        format: { duration: NaN }
      })

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      await expect(service.getDuration('/path/to/audio.mp3')).rejects.toThrow(
        'Could not determine audio duration'
      )
    })

    it('should throw when duration is Infinity', async () => {
      mockParseFile.mockResolvedValue({
        format: { duration: Infinity }
      })

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      await expect(service.getDuration('/path/to/audio.mp3')).rejects.toThrow(
        'Could not determine audio duration'
      )
    })

    it('should throw when duration is zero', async () => {
      mockParseFile.mockResolvedValue({
        format: { duration: 0 }
      })

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      await expect(service.getDuration('/path/to/audio.mp3')).rejects.toThrow(
        'Could not determine audio duration'
      )
    })

    it('should throw when parseFile fails', async () => {
      mockParseFile.mockRejectedValue(new Error('Invalid file'))

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      await expect(service.getDuration('/path/to/corrupt.mp3')).rejects.toThrow('Invalid file')
    })
  })

  // ===========================================================================
  // getFormat tests
  // ===========================================================================

  describe('getFormat', () => {
    it('should return format for MP3 file', async () => {
      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const format = await service.getFormat('/path/to/audio.mp3')

      expect(format.extension).toBe('mp3')
      expect(format.mimeType).toBe('audio/mpeg')
      expect(format.bitrate).toBe(192)
      expect(format.sampleRate).toBe(44100)
      expect(format.channels).toBe(2)
      expect(mockParseFile).toHaveBeenCalledWith('/path/to/audio.mp3', { duration: true })
    })

    it('should return format for WAV file', async () => {
      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const format = await service.getFormat('/path/to/audio.wav')

      expect(format.extension).toBe('wav')
      expect(format.mimeType).toBe('audio/wav')
    })

    it('should return format for M4A file', async () => {
      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const format = await service.getFormat('/path/to/audio.m4a')

      expect(format.extension).toBe('m4a')
      expect(format.mimeType).toBe('audio/mp4')
    })

    it('should handle missing bitrate', async () => {
      mockParseFile.mockResolvedValue({
        format: {
          duration: 60,
          sampleRate: 44100,
          numberOfChannels: 1
        }
      })

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const format = await service.getFormat('/path/to/audio.mp3')

      expect(format.bitrate).toBeUndefined()
    })

    it('should throw when parseFile fails', async () => {
      mockParseFile.mockRejectedValue(new Error('Corrupt file'))

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      await expect(service.getFormat('/path/to/corrupt.mp3')).rejects.toThrow('Corrupt file')
    })
  })

  // ===========================================================================
  // validate tests
  // ===========================================================================

  describe('validate', () => {
    it('should validate a valid MP3 file', async () => {
      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/audio.mp3')

      expect(result.valid).toBe(true)
      expect(result.durationSeconds).toBe(120.5)
      expect(result.sizeInMB).toBeCloseTo(5)
      expect(result.format).toBeDefined()
      expect(result.format?.extension).toBe('mp3')
    })

    it('should return error for non-existent file', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/missing.mp3')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('IMPORT_FILE_NOT_FOUND')
      expect(result.sizeInMB).toBe(0)
    })

    it('should return error for unreadable file', async () => {
      mockStat.mockRejectedValue(new Error('Permission denied'))

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/locked.mp3')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('IMPORT_FILE_UNREADABLE')
    })

    it('should return error for unsupported extension', async () => {
      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/audio.aif')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_INVALID_AUDIO')
      expect(result.error).toContain('Unsupported audio format')
    })

    it('should return error for corrupt audio', async () => {
      mockParseFile.mockRejectedValue(new Error('Invalid audio data'))

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/corrupt.mp3')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_INVALID_AUDIO')
      expect(result.error).toContain('Invalid audio file')
    })

    it('should return error when duration is undetermined', async () => {
      mockParseFile.mockResolvedValue({
        format: { duration: undefined }
      })

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/noduration.mp3')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_INVALID_AUDIO')
      expect(result.error).toContain('Could not determine audio duration')
    })

    it('should return error when duration is NaN', async () => {
      mockParseFile.mockResolvedValue({
        format: { duration: NaN }
      })

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/corrupt.mp3')

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('TRANSCRIPTION_INVALID_AUDIO')
      expect(result.error).toContain('Could not determine audio duration')
    })

    it('should calculate sizeInMB correctly', async () => {
      mockStat.mockResolvedValue({ size: 10 * 1024 * 1024 }) // 10MB

      const { createAudioMetadataService } = await import('./AudioMetadataService')
      const service = createAudioMetadataService()

      const result = await service.validate('/path/to/audio.mp3')

      expect(result.sizeInMB).toBeCloseTo(10)
    })
  })

  // ===========================================================================
  // Singleton pattern
  // ===========================================================================

  describe('singleton', () => {
    it('should export singleton instance', async () => {
      const { audioMetadataService } = await import('./AudioMetadataService')

      expect(audioMetadataService).toBeDefined()
      expect(typeof audioMetadataService.getDuration).toBe('function')
      expect(typeof audioMetadataService.getFormat).toBe('function')
      expect(typeof audioMetadataService.validate).toBe('function')
    })
  })
})
