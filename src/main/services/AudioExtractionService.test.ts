// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * AudioExtractionService.test.ts
 *
 * Tests for the audio extraction service that wraps fluent-ffmpeg
 * to extract audio from video files and retrieve video metadata.
 *
 * @see Issue #110 - Video file import with audio extraction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

// =============================================================================
// Mock fluent-ffmpeg
// =============================================================================

// Track static method mocks
const mockSetFfmpegPath = vi.fn()
const mockSetFfprobePath = vi.fn()
const mockFfprobe = vi.fn()

// Track chainable instance method mocks
const mockNoVideo = vi.fn()
const mockAudioCodec = vi.fn()
const mockAudioBitrate = vi.fn()
const mockAudioFrequency = vi.fn()
const mockAudioChannels = vi.fn()
const mockFormat = vi.fn()
const mockSave = vi.fn()
const mockKill = vi.fn()
const mockOn = vi.fn()
const mockSetStartTime = vi.fn()
const mockDuration = vi.fn()

// The Ffmpeg constructor mock – returns a chainable object
const mockFfmpegInstance = {
  noVideo: mockNoVideo,
  audioCodec: mockAudioCodec,
  audioBitrate: mockAudioBitrate,
  audioFrequency: mockAudioFrequency,
  audioChannels: mockAudioChannels,
  format: mockFormat,
  on: mockOn,
  save: mockSave,
  kill: mockKill,
  setStartTime: mockSetStartTime,
  duration: mockDuration
}

// Make all chainable methods return the same instance
mockNoVideo.mockReturnValue(mockFfmpegInstance)
mockAudioCodec.mockReturnValue(mockFfmpegInstance)
mockAudioBitrate.mockReturnValue(mockFfmpegInstance)
mockAudioFrequency.mockReturnValue(mockFfmpegInstance)
mockAudioChannels.mockReturnValue(mockFfmpegInstance)
mockFormat.mockReturnValue(mockFfmpegInstance)
mockOn.mockReturnValue(mockFfmpegInstance)
mockSave.mockReturnValue(mockFfmpegInstance)
mockSetStartTime.mockReturnValue(mockFfmpegInstance)
mockDuration.mockReturnValue(mockFfmpegInstance)

// The constructor function itself
const MockFfmpeg = vi.fn(() => mockFfmpegInstance)

// Attach static methods
Object.assign(MockFfmpeg, {
  setFfmpegPath: mockSetFfmpegPath,
  setFfprobePath: mockSetFfprobePath,
  ffprobe: mockFfprobe
})

vi.mock('fluent-ffmpeg', () => ({
  default: MockFfmpeg
}))

// =============================================================================
// Mock the shared media-binaries resolver
// =============================================================================

vi.mock('../utils/mediaBinaries', () => ({
  ffmpegPath: '/path/to/ffmpeg',
  ffprobePath: '/path/to/ffprobe',
  mediaBinariesAvailable: () => true
}))

// =============================================================================
// Mock fs/promises (for unlink in cleanupTempFile and error handler)
// =============================================================================

const mockUnlink = vi.fn()
vi.mock('fs/promises', () => ({
  unlink: mockUnlink
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
// Mock shared constants
// =============================================================================

vi.mock('../../shared/constants', () => ({
  VIDEO_IMPORT: {
    SUPPORTED_EXTENSIONS: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'],
    EXTRACTION_TIMEOUT_MS: 5 * 60 * 1000,
    TEMP_PREFIX: 'erfana-video-audio-',
    AUDIO_OUTPUT_FORMAT: 'mp3',
    EXTRACTION_PROGRESS_WEIGHT: 0.2
  },
  TRANSCRIPTION: {
    CHUNK_BOUNDARY_SECONDS: 480
  }
}))

// =============================================================================
// Tests
// =============================================================================

describe('AudioExtractionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Restore chainable return values after clearing mocks
    mockNoVideo.mockReturnValue(mockFfmpegInstance)
    mockAudioCodec.mockReturnValue(mockFfmpegInstance)
    mockAudioBitrate.mockReturnValue(mockFfmpegInstance)
    mockAudioFrequency.mockReturnValue(mockFfmpegInstance)
    mockAudioChannels.mockReturnValue(mockFfmpegInstance)
    mockFormat.mockReturnValue(mockFfmpegInstance)
    mockOn.mockReturnValue(mockFfmpegInstance)
    mockSave.mockReturnValue(mockFfmpegInstance)
    mockSetStartTime.mockReturnValue(mockFfmpegInstance)
    mockDuration.mockReturnValue(mockFfmpegInstance)
    MockFfmpeg.mockReturnValue(mockFfmpegInstance)

    mockUnlink.mockResolvedValue(undefined)
  })

  // ===========================================================================
  // isAvailable
  // ===========================================================================

  describe('isAvailable', () => {
    it('should return true when ffmpegPath is set', async () => {
      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()
      expect(service.isAvailable()).toBe(true)
    })
  })

  // ===========================================================================
  // hasAudioStream
  // ===========================================================================

  describe('hasAudioStream', () => {
    it('should return true when streams contain an audio codec_type', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264' },
            { codec_type: 'audio', codec_name: 'aac' }
          ],
          format: { duration: '120' }
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const result = await service.hasAudioStream('/path/to/video.mp4')
      expect(result).toBe(true)
    })

    it('should return false when streams contain only video', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264' }
          ],
          format: { duration: '120' }
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const result = await service.hasAudioStream('/path/to/video.mp4')
      expect(result).toBe(false)
    })

    it('should return false when streams array is empty', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [],
          format: {}
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const result = await service.hasAudioStream('/path/to/silent.mp4')
      expect(result).toBe(false)
    })

    it('should reject when ffprobe returns an error', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(new Error('ffprobe failed'), null)
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(service.hasAudioStream('/path/to/corrupt.mp4')).rejects.toThrow('ffprobe failed')
    })
  })

  // ===========================================================================
  // getVideoMetadata
  // ===========================================================================

  describe('getVideoMetadata', () => {
    it('should return resolution, codecs, and duration from ffprobe data', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
            { codec_type: 'audio', codec_name: 'aac' }
          ],
          format: { duration: '300.5' }
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const metadata = await service.getVideoMetadata('/path/to/video.mp4')

      expect(metadata.durationSeconds).toBeCloseTo(300.5)
      expect(metadata.resolution).toBe('1920x1080')
      expect(metadata.videoCodec).toBe('h264')
      expect(metadata.audioCodec).toBe('aac')
    })

    it('should handle missing video stream gracefully', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'audio', codec_name: 'mp3' }
          ],
          format: { duration: '60' }
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const metadata = await service.getVideoMetadata('/path/to/audio-only.mp4')

      expect(metadata.durationSeconds).toBe(60)
      expect(metadata.resolution).toBeUndefined()
      expect(metadata.videoCodec).toBeUndefined()
      expect(metadata.audioCodec).toBe('mp3')
    })

    it('should handle missing audio stream gracefully', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 }
          ],
          format: { duration: '90' }
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const metadata = await service.getVideoMetadata('/path/to/silent.mp4')

      expect(metadata.resolution).toBe('3840x2160')
      expect(metadata.videoCodec).toBe('hevc')
      expect(metadata.audioCodec).toBeUndefined()
    })

    it('should return durationSeconds of 0 when format.duration is missing', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 640, height: 480 }
          ],
          format: {}
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const metadata = await service.getVideoMetadata('/path/to/video.mp4')

      expect(metadata.durationSeconds).toBe(0)
    })

    it('should handle video stream without width/height', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264' }
          ],
          format: { duration: '45' }
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const metadata = await service.getVideoMetadata('/path/to/video.mp4')

      expect(metadata.resolution).toBeUndefined()
      expect(metadata.videoCodec).toBe('h264')
    })

    it('should reject when ffprobe returns an error', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(new Error('Cannot read metadata'), null)
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(service.getVideoMetadata('/path/to/corrupt.mp4')).rejects.toThrow('Cannot read metadata')
    })
  })

  // ===========================================================================
  // extractAudio
  // ===========================================================================

  describe('extractAudio', () => {
    it('should create MP3 file and return extraction result', async () => {
      // Probe returns metadata for duration
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' }
          ],
          format: { duration: '180' }
        })
      })

      // Simulate ffmpeg 'end' event firing asynchronously
      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: () => void) {
        if (event === 'end') {
          Promise.resolve().then(() => handler())
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const result = await service.extractAudio('/path/to/video.mp4')

      expect(result.audioPath).toMatch(/\.mp3$/)
      expect(result.audioPath).toContain('erfana-video-audio-')
      expect(result.durationSeconds).toBe(180)
      expect(mockSave).toHaveBeenCalledWith(result.audioPath)
    })

    it('should call ffmpeg with correct audio settings for transcription', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: () => void) {
        if (event === 'end') {
          Promise.resolve().then(() => handler())
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.extractAudio('/path/to/video.mp4')

      expect(mockNoVideo).toHaveBeenCalled()
      expect(mockAudioCodec).toHaveBeenCalledWith('libmp3lame')
      expect(mockAudioBitrate).toHaveBeenCalledWith('64k')
      expect(mockAudioFrequency).toHaveBeenCalledWith(16000)
      expect(mockAudioChannels).toHaveBeenCalledWith(1)
      expect(mockFormat).toHaveBeenCalledWith('mp3')
    })

    it('should call progress callback with percent values', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      const progressValues: number[] = []

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (arg?: unknown) => void) {
        if (event === 'progress') {
          // Simulate progress events
          Promise.resolve().then(() => {
            handler({ percent: 25 })
            handler({ percent: 50 })
            handler({ percent: 75 })
          })
        }
        if (event === 'end') {
          Promise.resolve().then(() => Promise.resolve().then(() => handler()))
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.extractAudio('/path/to/video.mp4', (percent) => {
        progressValues.push(percent)
      })

      expect(progressValues).toContain(25)
      expect(progressValues).toContain(50)
      expect(progressValues).toContain(75)
    })

    it('should clamp progress to max 100', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      const progressValues: number[] = []

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (arg?: unknown) => void) {
        if (event === 'progress') {
          Promise.resolve().then(() => {
            handler({ percent: 120 }) // Over 100
          })
        }
        if (event === 'end') {
          Promise.resolve().then(() => Promise.resolve().then(() => handler()))
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.extractAudio('/path/to/video.mp4', (percent) => {
        progressValues.push(percent)
      })

      expect(progressValues.every(p => p <= 100)).toBe(true)
    })

    it('should handle abort signal by killing the command', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      const abortController = new AbortController()

      // Signal is already aborted before extraction
      abortController.abort()

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: () => void) {
        if (event === 'end') {
          Promise.resolve().then(() => handler())
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      // Start extraction with pre-aborted signal
      const promise = service.extractAudio('/path/to/video.mp4', undefined, abortController.signal)

      // Wait for the 'end' event to resolve
      await promise

      // kill should have been called with SIGKILL for the pre-aborted case
      expect(mockKill).toHaveBeenCalledWith('SIGKILL')
    })

    it('should clean up temp file on error', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (err?: Error) => void) {
        if (event === 'error') {
          Promise.resolve().then(() => handler(new Error('Encoding failed')))
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(service.extractAudio('/path/to/video.mp4')).rejects.toThrow('Encoding failed')

      // unlink should have been called to clean up
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('should throw when ffmpeg is not available', async () => {
      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      // Spy on isAvailable to return false
      vi.spyOn(service, 'isAvailable').mockReturnValue(false)

      await expect(service.extractAudio('/path/to/video.mp4')).rejects.toThrow(
        'ffmpeg is not available'
      )
    })

    it('should not call progress callback when percent is null or undefined', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      const onProgress = vi.fn()

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (arg?: unknown) => void) {
        if (event === 'progress') {
          Promise.resolve().then(() => {
            handler({ percent: null })
            handler({ percent: undefined })
            handler({})
            handler({ percent: 50 }) // Only this one should trigger callback
          })
        }
        if (event === 'end') {
          Promise.resolve().then(() => Promise.resolve().then(() => handler()))
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.extractAudio('/path/to/video.mp4', onProgress)

      expect(onProgress).toHaveBeenCalledTimes(1)
      expect(onProgress).toHaveBeenCalledWith(50)
    })

    it('should reject with timeout error when extraction exceeds timeout', async () => {
      vi.useFakeTimers()

      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      // Don't fire 'end' or 'error' – simulate a hung ffmpeg process
      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance) {
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const promise = service.extractAudio('/path/to/video.mp4')

      // Attach rejection handler immediately to prevent unhandled rejection
      const resultPromise = expect(promise).rejects.toThrow('Audio extraction timed out')

      // Advance past the timeout (5 minutes)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)

      await resultPromise
      expect(mockKill).toHaveBeenCalledWith('SIGKILL')

      vi.useRealTimers()
    })

    it('should reject with cancellation error when abort fires mid-extraction', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      const abortController = new AbortController()

      // When 'error' is registered, store the handler so we can simulate ffmpeg crash after kill
      let errorHandler: ((err: Error) => void) | undefined

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (err?: Error) => void) {
        if (event === 'error') {
          errorHandler = handler as (err: Error) => void
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const promise = service.extractAudio('/path/to/video.mp4', undefined, abortController.signal)

      // Flush microtasks so extractAudio reaches the point where the abort listener is registered
      // (it awaits getVideoMetadata internally before setting up the ffmpeg command)
      await Promise.resolve()
      await Promise.resolve()

      // Simulate: user aborts, which kills ffmpeg, which triggers error event
      abortController.abort()
      expect(mockKill).toHaveBeenCalledWith('SIGKILL')

      // Simulate ffmpeg error event after being killed
      errorHandler?.(new Error('ffmpeg was killed with signal SIGKILL'))

      await expect(promise).rejects.toThrow('Audio extraction cancelled')
    })
  })

  // ===========================================================================
  // cleanupTempFile
  // ===========================================================================

  describe('cleanupTempFile', () => {
    it('should delete the temp file', async () => {
      mockUnlink.mockResolvedValue(undefined)

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const tempPath = `${tmpdir()}/erfana-video-audio-abc.mp3`
      await service.cleanupTempFile(tempPath)

      expect(mockUnlink).toHaveBeenCalledWith(tempPath)
    })

    it('should handle missing file gracefully without throwing', async () => {
      mockUnlink.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const tempPath = `${tmpdir()}/erfana-video-audio-missing.mp3`
      // Should not throw
      await expect(
        service.cleanupTempFile(tempPath)
      ).resolves.toBeUndefined()

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('erfana-video-audio-missing.mp3')
      )
    })

    it('should log a warning on cleanup failure', async () => {
      mockUnlink.mockRejectedValue(new Error('Permission denied'))

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.cleanupTempFile(`${tmpdir()}/erfana-video-audio-locked.mp3`)

      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should refuse to delete files outside tmpdir', async () => {
      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.cleanupTempFile('/home/user/important-file.wav')

      expect(mockUnlink).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Refusing to delete non-temp file')
      )
    })

    it('should refuse to delete files without expected prefix', async () => {
      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.cleanupTempFile(`${tmpdir()}/some-other-file.wav`)

      expect(mockUnlink).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Refusing to delete non-temp file')
      )
    })
  })

  // ===========================================================================
  // extractAudioSegments
  // ===========================================================================

  describe('extractAudioSegments', () => {
    it('should produce a single segment for short video (<480s)', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' }
          ],
          format: { duration: '300' }
        })
      })

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: () => void) {
        if (event === 'end') {
          Promise.resolve().then(() => handler())
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const result = await service.extractAudioSegments('/path/to/short.mp4')

      expect(result.segmentPaths).toHaveLength(1)
      expect(result.durationSeconds).toBe(300)
      expect(result.segmentPaths[0]).toContain('erfana-video-audio-')
      expect(result.segmentPaths[0]).toContain('-seg0.mp3')
    })

    it('should produce multiple segments for long video (>480s)', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
            { codec_type: 'audio', codec_name: 'aac' }
          ],
          format: { duration: '960' }
        })
      })

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: () => void) {
        if (event === 'end') {
          Promise.resolve().then(() => handler())
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const result = await service.extractAudioSegments('/path/to/long.mp4')

      // 960 / 480 = 2 segments
      expect(result.segmentPaths).toHaveLength(2)
      expect(result.durationSeconds).toBe(960)
      expect(mockSetStartTime).toHaveBeenCalledWith(0)
      expect(mockSetStartTime).toHaveBeenCalledWith(480)
    })

    it('should report progress across segments', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '960' }
        })
      })

      const progressValues: number[] = []

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: () => void) {
        if (event === 'end') {
          Promise.resolve().then(() => handler())
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.extractAudioSegments('/path/to/long.mp4', undefined, (percent) => {
        progressValues.push(percent)
      })

      // Should end at 100%
      expect(progressValues[progressValues.length - 1]).toBe(100)
    })

    it('should abort and skip remaining segments when signal fires', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '1440' } // 3 segments
        })
      })

      const abortController = new AbortController()
      let segmentCount = 0

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: () => void) {
        if (event === 'end') {
          Promise.resolve().then(() => {
            segmentCount++
            if (segmentCount === 1) {
              // Abort after first segment completes
              abortController.abort()
            }
            handler()
          })
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(
        service.extractAudioSegments('/path/to/long.mp4', undefined, undefined, abortController.signal)
      ).rejects.toThrow('Audio extraction cancelled')

      // Should have cleaned up the first segment file
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('should clean up segment files on error', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '960' }
        })
      })

      let ffmpegCallCount = 0
      MockFfmpeg.mockImplementation(() => {
        ffmpegCallCount++
        const currentCall = ffmpegCallCount
        const instance = { ...mockFfmpegInstance }

        // Override 'on' for this specific instance
        instance.on = vi.fn().mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (err?: Error) => void) {
          if (currentCall === 1 && event === 'end') {
            Promise.resolve().then(() => handler())
          }
          if (currentCall === 2 && event === 'error') {
            Promise.resolve().then(() => handler(new Error('ffmpeg crashed')))
          }
          return this
        }) as typeof mockOn

        // Ensure all chainable methods return this instance
        for (const method of ['noVideo', 'audioCodec', 'audioBitrate', 'audioFrequency', 'audioChannels', 'format', 'save', 'setStartTime', 'duration'] as const) {
          (instance as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn().mockReturnValue(instance)
        }
        instance.kill = vi.fn()

        return instance
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(
        service.extractAudioSegments('/path/to/long.mp4')
      ).rejects.toThrow('ffmpeg crashed')

      // Should clean up the first segment that was created
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('should throw when ffmpeg is not available', async () => {
      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()
      vi.spyOn(service, 'isAvailable').mockReturnValue(false)

      await expect(
        service.extractAudioSegments('/path/to/video.mp4')
      ).rejects.toThrow('ffmpeg is not available')
    })

    it('should throw when duration probe fails', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(new Error('Cannot read file'), null)
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(
        service.extractAudioSegments('/path/to/corrupt.mp4')
      ).rejects.toThrow('Failed to get video duration for segmented extraction')
    })

    it('should throw when video duration is zero', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' }
          ],
          format: { duration: '0' }
        })
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(
        service.extractAudioSegments('/path/to/zero-duration.mp4')
      ).rejects.toThrow('Video duration is zero or negative; cannot extract segments')
    })
  })

  // ===========================================================================
  // cleanupTempFiles (batch)
  // ===========================================================================

  describe('cleanupTempFiles', () => {
    it('should clean up multiple temp files', async () => {
      mockUnlink.mockResolvedValue(undefined)

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const paths = [
        `${tmpdir()}/erfana-video-audio-a.mp3`,
        `${tmpdir()}/erfana-video-audio-b.mp3`
      ]
      await service.cleanupTempFiles(paths)

      expect(mockUnlink).toHaveBeenCalledTimes(2)
    })

    it('should handle empty array gracefully', async () => {
      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await expect(service.cleanupTempFiles([])).resolves.toBeUndefined()
      expect(mockUnlink).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Factory function
  // ===========================================================================

  describe('createAudioExtractionService factory', () => {
    it('should create an AudioExtractionService instance', async () => {
      const { createAudioExtractionService, AudioExtractionService } = await import('./AudioExtractionService')
      const service = createAudioExtractionService()
      expect(service).toBeInstanceOf(AudioExtractionService)
    })

    it('should create independent instances', async () => {
      const { createAudioExtractionService } = await import('./AudioExtractionService')
      const service1 = createAudioExtractionService()
      const service2 = createAudioExtractionService()
      expect(service1).not.toBe(service2)
    })
  })

  // ===========================================================================
  // Singleton
  // ===========================================================================

  describe('singleton', () => {
    it('should export singleton audioExtractionService', async () => {
      const { audioExtractionService, AudioExtractionService } = await import('./AudioExtractionService')
      expect(audioExtractionService).toBeInstanceOf(AudioExtractionService)
      expect(typeof audioExtractionService.extractAudio).toBe('function')
      expect(typeof audioExtractionService.hasAudioStream).toBe('function')
      expect(typeof audioExtractionService.getVideoMetadata).toBe('function')
      expect(typeof audioExtractionService.cleanupTempFile).toBe('function')
    })
  })
})
