// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * AudioConverter.test.ts
 *
 * Tests for audio file converter (MP3, WAV, M4A).
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'

// Mock validateFileForImport, keep formatDuration real
vi.mock('../../../utils/fileUtils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    validateFileForImport: vi.fn()
  }
})

// Import after mocking
import { validateFileForImport } from '../../../utils/fileUtils'
import { AudioConverter, createAudioConverter } from './AudioConverter'

const mockedValidateFileForImport = vi.mocked(validateFileForImport)

describe('AudioConverter', () => {
  // Mock dependencies
  const mockTranscriptionService = {
    transcribe: vi.fn()
  }
  const mockAudioMetadataService = {
    getDuration: vi.fn()
  }

  let converter: AudioConverter

  beforeEach(() => {
    vi.clearAllMocks()
    converter = new AudioConverter(mockTranscriptionService, mockAudioMetadataService)

    // Default successful responses
    mockAudioMetadataService.getDuration.mockResolvedValue(120.5)
    mockTranscriptionService.transcribe.mockResolvedValue({
      success: true,
      transcript: 'Hello, this is a transcription.',
      duration: 120.5,
      language: 'en'
    })
  })

  // ===========================================================================
  // Properties
  // ===========================================================================

  describe('properties', () => {
    it('should support all 5 audio extensions', () => {
      expect(converter.supportedExtensions).toEqual(['mp3', 'wav', 'm4a', 'ogg', 'flac'])
    })

    it('should require conversion', () => {
      expect(converter.requiresConversion).toBe(true)
    })

    it('should have audio category', () => {
      expect(converter.category).toBe('audio')
    })
  })

  // ===========================================================================
  // validate
  // ===========================================================================

  describe('validate', () => {
    it('should delegate to validateFileForImport', async () => {
      const mockResult = {
        valid: true,
        sizeInMB: 5,
        fileName: 'recording.mp3'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/recording.mp3')

      expect(mockedValidateFileForImport).toHaveBeenCalledWith('/path/to/recording.mp3')
      expect(result).toEqual(mockResult)
    })

    it('should pass through validation errors', async () => {
      mockedValidateFileForImport.mockResolvedValue({
        valid: false,
        error: ErrorCode.IMPORT_FILE_NOT_FOUND,
        sizeInMB: 0,
        fileName: 'missing.mp3'
      })

      const result = await converter.validate('/path/to/missing.mp3')

      expect(result.valid).toBe(false)
      expect(result.error).toBe(ErrorCode.IMPORT_FILE_NOT_FOUND)
    })
  })

  // ===========================================================================
  // convert
  // ===========================================================================

  describe('convert', () => {
    it('should return success with markdown content', async () => {
      const result = await converter.convert('/path/to/recording.mp3')

      expect(result.success).toBe(true)
      expect(result.content).toBeDefined()
      expect(result.content).toContain('Hello, this is a transcription.')
    })

    it('should include YAML frontmatter', async () => {
      const result = await converter.convert('/path/to/recording.mp3')

      expect(result.content).toContain('---')
      expect(result.content).toContain('source: "recording.mp3"')
      expect(result.content).toContain('duration: "2:00"')
      expect(result.content).toContain('language: en')
      expect(result.content).toContain('transcription_backend: openai')
      expect(result.content).toContain('date:')
    })

    it('should format duration as MM:SS', async () => {
      mockAudioMetadataService.getDuration.mockResolvedValue(330)

      const result = await converter.convert('/path/to/recording.mp3')

      expect(result.content).toContain('duration: "5:30"')
    })

    it('should pad seconds with zero', async () => {
      mockAudioMetadataService.getDuration.mockResolvedValue(65)

      const result = await converter.convert('/path/to/short.mp3')

      expect(result.content).toContain('duration: "1:05"')
    })

    it('should return error when duration extraction fails', async () => {
      mockAudioMetadataService.getDuration.mockRejectedValue(
        new Error('Invalid audio')
      )

      const result = await converter.convert('/path/to/corrupt.mp3')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.TRANSCRIPTION_INVALID_AUDIO)
    })

    it('should return error when transcription fails', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        error: 'No API key',
        errorCode: 'TRANSCRIPTION_NO_API_KEY'
      })

      const result = await converter.convert('/path/to/recording.mp3')

      expect(result.success).toBe(false)
      expect(result.error).toBe('No API key')
    })

    it('should call transcribe with auto language in batch mode', async () => {
      await converter.convert('/path/to/recording.mp3')

      expect(mockTranscriptionService.transcribe).toHaveBeenCalledWith(
        '/path/to/recording.mp3',
        'auto',
        expect.any(Function)
      )
    })

    it('should handle empty transcript', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: '',
        duration: 10
      })

      const result = await converter.convert('/path/to/silent.mp3')

      // Empty transcript still counts as conversion failure
      expect(result.success).toBe(false)
    })
  })

  // ===========================================================================
  // Factory
  // ===========================================================================

  describe('createAudioConverter factory', () => {
    it('should create an AudioConverter instance', () => {
      const instance = createAudioConverter(
        mockTranscriptionService,
        mockAudioMetadataService
      )

      expect(instance).toBeInstanceOf(AudioConverter)
      expect(instance.supportedExtensions).toEqual(['mp3', 'wav', 'm4a', 'ogg', 'flac'])
    })

    it('should create independent instances', () => {
      const instance1 = createAudioConverter(
        mockTranscriptionService,
        mockAudioMetadataService
      )
      const instance2 = createAudioConverter(
        mockTranscriptionService,
        mockAudioMetadataService
      )

      expect(instance1).not.toBe(instance2)
    })
  })
})
