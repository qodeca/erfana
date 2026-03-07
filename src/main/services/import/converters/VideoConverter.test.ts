/**
 * VideoConverter.test.ts
 *
 * Tests for the video file converter (MP4, MOV, AVI, MKV, etc.).
 * Extracts audio via AudioExtractionService then transcribes via TranscriptionService.
 *
 * @see Issue #110 - Video file import with audio extraction
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
import { VideoConverter, createVideoConverter } from './VideoConverter'

const mockedValidateFileForImport = vi.mocked(validateFileForImport)

describe('VideoConverter', () => {
  // Mock dependencies
  const mockTranscriptionService = {
    transcribe: vi.fn()
  }

  const mockAudioExtractionService = {
    isAvailable: vi.fn(),
    hasAudioStream: vi.fn(),
    extractAudio: vi.fn(),
    getVideoMetadata: vi.fn(),
    cleanupTempFile: vi.fn()
  }

  let converter: VideoConverter

  beforeEach(() => {
    vi.clearAllMocks()
    converter = new VideoConverter(mockTranscriptionService, mockAudioExtractionService)

    // Default successful responses
    mockAudioExtractionService.isAvailable.mockReturnValue(true)
    mockAudioExtractionService.hasAudioStream.mockResolvedValue(true)
    mockAudioExtractionService.getVideoMetadata.mockResolvedValue({
      durationSeconds: 180,
      resolution: '1920x1080',
      videoCodec: 'h264',
      audioCodec: 'aac'
    })
    mockAudioExtractionService.extractAudio.mockResolvedValue({
      audioPath: '/tmp/erfana-video-audio-test.wav',
      durationSeconds: 180
    })
    mockAudioExtractionService.cleanupTempFile.mockResolvedValue(undefined)
    mockTranscriptionService.transcribe.mockResolvedValue({
      success: true,
      transcript: 'Hello, this is a video transcription.',
      duration: 180,
      language: 'en'
    })
  })

  // ===========================================================================
  // Properties
  // ===========================================================================

  describe('properties', () => {
    it('should support all 7 video extensions', () => {
      expect(converter.supportedExtensions).toEqual(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'])
    })

    it('should require conversion', () => {
      expect(converter.requiresConversion).toBe(true)
    })

    it('should have video category', () => {
      expect(converter.category).toBe('video')
    })
  })

  // ===========================================================================
  // validate
  // ===========================================================================

  describe('validate', () => {
    it('should delegate to validateFileForImport', async () => {
      const mockResult = {
        valid: true,
        sizeInMB: 150,
        fileName: 'recording.mp4'
      }
      mockedValidateFileForImport.mockResolvedValue(mockResult)

      const result = await converter.validate('/path/to/recording.mp4')

      expect(mockedValidateFileForImport).toHaveBeenCalledWith('/path/to/recording.mp4')
      expect(result).toEqual(mockResult)
    })

    it('should pass through validation errors', async () => {
      mockedValidateFileForImport.mockResolvedValue({
        valid: false,
        error: ErrorCode.IMPORT_FILE_NOT_FOUND,
        sizeInMB: 0,
        fileName: 'missing.mp4'
      })

      const result = await converter.validate('/path/to/missing.mp4')

      expect(result.valid).toBe(false)
      expect(result.error).toBe(ErrorCode.IMPORT_FILE_NOT_FOUND)
    })
  })

  // ===========================================================================
  // convert – error paths
  // ===========================================================================

  describe('convert – ffmpeg unavailable', () => {
    it('should return ffmpeg unavailable error when extraction service not available', async () => {
      mockAudioExtractionService.isAvailable.mockReturnValue(false)

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.VIDEO_FFMPEG_UNAVAILABLE)
      expect(result.error).toContain('ffmpeg')
    })
  })

  describe('convert – no audio track', () => {
    it('should return no-audio error when video has no audio stream', async () => {
      mockAudioExtractionService.hasAudioStream.mockResolvedValue(false)

      const result = await converter.convert('/path/to/silent.mp4')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.VIDEO_NO_AUDIO_TRACK)
      expect(result.error).toContain('audio')
    })

    it('should return extraction failed error when hasAudioStream throws', async () => {
      mockAudioExtractionService.hasAudioStream.mockRejectedValue(
        new Error('Cannot analyze file')
      )

      const result = await converter.convert('/path/to/corrupt.mp4')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.VIDEO_EXTRACTION_FAILED)
    })
  })

  describe('convert – extraction failure', () => {
    it('should return extraction failed error when extractAudio throws', async () => {
      mockAudioExtractionService.extractAudio.mockRejectedValue(
        new Error('ffmpeg process crashed')
      )

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.VIDEO_EXTRACTION_FAILED)
      expect(result.error).toContain('extract audio')
    })

    it('should clean up temp file even when extraction fails to produce a file', async () => {
      // extractAudio rejects so no temp file path is available to clean up
      mockAudioExtractionService.extractAudio.mockRejectedValue(
        new Error('Extraction error')
      )

      await converter.convert('/path/to/video.mp4')

      // cleanupTempFile should NOT be called since we never got a temp path
      expect(mockAudioExtractionService.cleanupTempFile).not.toHaveBeenCalled()
    })
  })

  describe('convert – transcription failure', () => {
    it('should return error when transcription fails', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        error: 'No API key configured',
        errorCode: 'TRANSCRIPTION_NO_API_KEY'
      })

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(false)
      expect(result.error).toBe('No API key configured')
    })

    it('should clean up temp file on transcription failure', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        error: 'Rate limited'
      })

      await converter.convert('/path/to/video.mp4')

      expect(mockAudioExtractionService.cleanupTempFile).toHaveBeenCalledWith(
        '/tmp/erfana-video-audio-test.wav'
      )
    })

    it('should return error when transcript is empty', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: '',
        duration: 180
      })

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(false)
    })
  })

  // ===========================================================================
  // convert – success path
  // ===========================================================================

  describe('convert – success', () => {
    it('should return success with markdown content', async () => {
      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(true)
      expect(result.content).toBeDefined()
      expect(result.content).toContain('Hello, this is a video transcription.')
    })

    it('should include YAML frontmatter with required fields', async () => {
      const result = await converter.convert('/path/to/recording.mp4')

      expect(result.content).toContain('---')
      expect(result.content).toContain('source: "recording.mp4"')
      expect(result.content).toContain('type: video')
      expect(result.content).toContain('language: en')
      expect(result.content).toContain('transcription_backend: openai')
      expect(result.content).toContain('date:')
    })

    it('should include video metadata (resolution and codec) in frontmatter', async () => {
      const result = await converter.convert('/path/to/video.mp4')

      expect(result.content).toContain('resolution: "1920x1080"')
      expect(result.content).toContain('video_codec: "h264"')
    })

    it('should format duration as MM:SS', async () => {
      const result = await converter.convert('/path/to/video.mp4')

      // 180 seconds = 3:00
      expect(result.content).toContain('duration: "3:00"')
    })

    it('should pad duration seconds with zero', async () => {
      mockAudioExtractionService.getVideoMetadata.mockResolvedValue({
        durationSeconds: 125,
        resolution: '1280x720',
        videoCodec: 'h264',
        audioCodec: 'aac'
      })
      mockAudioExtractionService.extractAudio.mockResolvedValue({
        audioPath: '/tmp/erfana-video-audio-test.wav',
        durationSeconds: 125
      })

      const result = await converter.convert('/path/to/video.mp4')

      // 125 seconds = 2:05
      expect(result.content).toContain('duration: "2:05"')
    })

    it('should clean up temp file on success', async () => {
      await converter.convert('/path/to/video.mp4')

      expect(mockAudioExtractionService.cleanupTempFile).toHaveBeenCalledWith(
        '/tmp/erfana-video-audio-test.wav'
      )
    })

    it('should call transcribe with auto language and temp audio path', async () => {
      await converter.convert('/path/to/video.mp4')

      expect(mockTranscriptionService.transcribe).toHaveBeenCalledWith(
        '/tmp/erfana-video-audio-test.wav',
        'auto',
        expect.any(Function)
      )
    })

    it('should use extraction duration when video metadata duration is preferred', async () => {
      // When metadata is available, it takes precedence via videoMetadata.durationSeconds
      mockAudioExtractionService.getVideoMetadata.mockResolvedValue({
        durationSeconds: 200,
        resolution: '1920x1080',
        videoCodec: 'h264',
        audioCodec: 'aac'
      })
      mockAudioExtractionService.extractAudio.mockResolvedValue({
        audioPath: '/tmp/erfana-video-audio-test.wav',
        durationSeconds: 195 // slightly different from metadata
      })

      const result = await converter.convert('/path/to/video.mp4')

      // Should use videoMetadata.durationSeconds (200) = 3:20
      expect(result.content).toContain('duration: "3:20"')
    })
  })

  // ===========================================================================
  // convert – video metadata best-effort
  // ===========================================================================

  describe('convert – video metadata best-effort', () => {
    it('should omit resolution and codec when getVideoMetadata fails', async () => {
      mockAudioExtractionService.getVideoMetadata.mockRejectedValue(
        new Error('Cannot read metadata')
      )

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(true)
      expect(result.content).not.toContain('resolution:')
      expect(result.content).not.toContain('video_codec:')
    })

    it('should fall back to extraction duration when metadata is unavailable', async () => {
      mockAudioExtractionService.getVideoMetadata.mockRejectedValue(
        new Error('Cannot read metadata')
      )
      mockAudioExtractionService.extractAudio.mockResolvedValue({
        audioPath: '/tmp/erfana-video-audio-test.wav',
        durationSeconds: 240
      })

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(true)
      // 240 seconds = 4:00
      expect(result.content).toContain('duration: "4:00"')
    })

    it('should still include source and type when metadata is unavailable', async () => {
      mockAudioExtractionService.getVideoMetadata.mockRejectedValue(
        new Error('Cannot read metadata')
      )

      const result = await converter.convert('/path/to/myvideo.mov')

      expect(result.success).toBe(true)
      expect(result.content).toContain('source: "myvideo.mov"')
      expect(result.content).toContain('type: video')
    })
  })

  // ===========================================================================
  // Factory
  // ===========================================================================

  describe('createVideoConverter factory', () => {
    it('should create a VideoConverter instance', () => {
      const instance = createVideoConverter(mockTranscriptionService, mockAudioExtractionService)
      expect(instance).toBeInstanceOf(VideoConverter)
    })

    it('should have correct properties', () => {
      const instance = createVideoConverter(mockTranscriptionService, mockAudioExtractionService)
      expect(instance.supportedExtensions).toEqual(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'])
      expect(instance.category).toBe('video')
      expect(instance.requiresConversion).toBe(true)
    })

    it('should create independent instances', () => {
      const instance1 = createVideoConverter(mockTranscriptionService, mockAudioExtractionService)
      const instance2 = createVideoConverter(mockTranscriptionService, mockAudioExtractionService)
      expect(instance1).not.toBe(instance2)
    })
  })
})
