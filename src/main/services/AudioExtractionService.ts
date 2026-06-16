// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Audio extraction service
 *
 * Wraps fluent-ffmpeg to extract audio from video files
 * and retrieve video metadata via ffprobe.
 *
 * @see Issue #110 – Video file import with audio extraction
 */
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import Ffmpeg from 'fluent-ffmpeg'
import { ffmpegPath, ffprobePath } from '../utils/mediaBinaries'
import { VIDEO_IMPORT, TRANSCRIPTION } from '../../shared/constants'
import { logger } from './LoggingService'

// Configure ffmpeg binary paths (resolved from the shared media-binaries util)
if (ffmpegPath) {
  Ffmpeg.setFfmpegPath(ffmpegPath)
}
if (ffprobePath) {
  Ffmpeg.setFfprobePath(ffprobePath)
}

/** Video metadata from ffprobe */
export interface VideoMetadata {
  /** Duration in seconds */
  durationSeconds: number
  /** Video resolution (e.g., "1920x1080") */
  resolution?: string
  /** Video codec (e.g., "h264") */
  videoCodec?: string
  /** Audio codec (e.g., "aac") */
  audioCodec?: string
}

/** Audio extraction result */
export interface ExtractionResult {
  /** Path to the extracted audio file */
  audioPath: string
  /** Duration in seconds */
  durationSeconds: number
}

/** Segmented extraction result – time-based MP3 chunks for long videos */
export interface SegmentedExtractionResult {
  /** Paths to extracted segment files (in order) */
  segmentPaths: string[]
  /** Total duration in seconds */
  durationSeconds: number
}

/** Progress callback type */
export type ExtractionProgressCallback = (percent: number) => void

/** Options for the shared ffmpeg extraction runner */
interface FfmpegExtractionOptions {
  inputPath: string
  outputPath: string
  startTime?: number
  duration?: number
  timeoutMs: number
  onProgress?: ExtractionProgressCallback
  signal?: AbortSignal
}

export class AudioExtractionService {
  /**
   * Check if ffmpeg is available
   */
  isAvailable(): boolean {
    return !!ffmpegPath && !!ffprobePath
  }

  /**
   * Check if a video file has an audio stream
   */
  async hasAudioStream(filePath: string): Promise<boolean> {
    const metadata = await this.probe(filePath)
    return metadata.streams.some((s: { codec_type?: string }) => s.codec_type === 'audio')
  }

  /**
   * Get video metadata via ffprobe
   */
  async getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    const metadata = await this.probe(filePath)

    const videoStream = metadata.streams.find(
      (s: { codec_type?: string }) => s.codec_type === 'video'
    )
    const audioStream = metadata.streams.find(
      (s: { codec_type?: string }) => s.codec_type === 'audio'
    )

    const durationSeconds = metadata.format?.duration ? Number(metadata.format.duration) : 0

    return {
      durationSeconds,
      resolution:
        videoStream?.width && videoStream?.height
          ? `${videoStream.width}x${videoStream.height}`
          : undefined,
      videoCodec: videoStream?.codec_name || undefined,
      audioCodec: audioStream?.codec_name || undefined
    }
  }

  /**
   * Extract audio from a video file to a temp MP3 file
   *
   * Extracts 16 kHz mono MP3 at 64 kbps – optimized for speech transcription.
   * The libmp3lame encoder is bundled with ffmpeg-static.
   *
   * @param filePath - Path to the video file
   * @param onProgress - Progress callback (0-100)
   * @param signal - AbortSignal for cancellation
   * @returns Extraction result with path to temp audio file
   */
  async extractAudio(
    filePath: string,
    onProgress?: ExtractionProgressCallback,
    signal?: AbortSignal
  ): Promise<ExtractionResult> {
    if (!this.isAvailable()) {
      throw new Error('ffmpeg is not available')
    }

    const outputPath = join(
      tmpdir(),
      `${VIDEO_IMPORT.TEMP_PREFIX}${randomUUID()}.${VIDEO_IMPORT.AUDIO_OUTPUT_FORMAT}`
    )

    // Get duration first for progress reporting
    let durationSeconds = 0
    try {
      const metadata = await this.getVideoMetadata(filePath)
      durationSeconds = metadata.durationSeconds
    } catch {
      // Duration unknown – progress will be approximate
    }

    await this.runFfmpegExtraction({
      inputPath: filePath,
      outputPath,
      timeoutMs: VIDEO_IMPORT.EXTRACTION_TIMEOUT_MS,
      onProgress,
      signal
    })

    return { audioPath: outputPath, durationSeconds }
  }

  /**
   * Extract audio from a video file as time-based MP3 segments
   *
   * Uses ffmpeg's -ss/-t flags to produce frame-aligned MP3 chunks,
   * avoiding the corrupt-audio problem of byte-stream slicing.
   *
   * @param filePath - Path to the video file
   * @param segmentSeconds - Duration of each segment (default: CHUNK_BOUNDARY_SECONDS)
   * @param onProgress - Progress callback (0-100) across all segments
   * @param signal - AbortSignal for cancellation
   * @returns Segmented extraction result with paths and total duration
   */
  async extractAudioSegments(
    filePath: string,
    segmentSeconds: number = TRANSCRIPTION.CHUNK_BOUNDARY_SECONDS,
    onProgress?: ExtractionProgressCallback,
    signal?: AbortSignal
  ): Promise<SegmentedExtractionResult> {
    if (!this.isAvailable()) {
      throw new Error('ffmpeg is not available')
    }

    // Probe duration first
    let durationSeconds = 0
    try {
      const metadata = await this.getVideoMetadata(filePath)
      durationSeconds = metadata.durationSeconds
    } catch {
      throw new Error('Failed to get video duration for segmented extraction')
    }

    if (durationSeconds <= 0) {
      throw new Error('Video duration is zero or negative; cannot extract segments')
    }

    const segmentCount = Math.ceil(durationSeconds / segmentSeconds)
    const segmentPaths: string[] = []

    try {
      for (let i = 0; i < segmentCount; i++) {
        if (signal?.aborted) {
          throw new Error('Audio extraction cancelled')
        }

        const startTime = i * segmentSeconds
        const outputPath = join(
          tmpdir(),
          `${VIDEO_IMPORT.TEMP_PREFIX}${randomUUID()}-seg${i}.${VIDEO_IMPORT.AUDIO_OUTPUT_FORMAT}`
        )

        await this.extractSegment(filePath, outputPath, startTime, segmentSeconds, (percent) => {
          if (onProgress) {
            const segmentProgress = (i + percent / 100) / segmentCount * 100
            onProgress(Math.min(segmentProgress, 100))
          }
        }, signal)

        segmentPaths.push(outputPath)
      }

      if (onProgress) {
        onProgress(100)
      }

      return { segmentPaths, durationSeconds }
    } catch (error) {
      // Clean up any segments created so far on error
      await this.cleanupTempFiles(segmentPaths)
      throw error
    }
  }

  /**
   * Extract a single audio segment using ffmpeg -ss/-t
   */
  private extractSegment(
    filePath: string,
    outputPath: string,
    startTime: number,
    segmentDuration: number,
    onProgress?: ExtractionProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    return this.runFfmpegExtraction({
      inputPath: filePath,
      outputPath,
      startTime,
      duration: segmentDuration,
      timeoutMs: Math.max(60_000, segmentDuration * 1000),
      onProgress,
      signal
    })
  }

  /**
   * Shared ffmpeg extraction runner
   *
   * Consolidates the common ffmpeg audio extraction logic used by both
   * extractAudio (full-file) and extractSegment (time-slice).
   */
  private runFfmpegExtraction(options: FfmpegExtractionOptions): Promise<void> {
    const { inputPath, outputPath, startTime, duration, timeoutMs, onProgress, signal } = options

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const settle = (fn: typeof resolve | typeof reject, value?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        if (value) {
          ;(fn as (v: unknown) => void)(value)
        } else {
          ;(fn as () => void)()
        }
      }

      // Audio encoding – must match VIDEO_IMPORT.AUDIO_OUTPUT_FORMAT ('mp3')
      const command = Ffmpeg(inputPath)

      if (startTime != null) {
        command.setStartTime(startTime)
      }
      if (duration != null) {
        command.duration(duration)
      }

      command
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('64k')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('mp3')
        .on('progress', (progress: { percent?: number }) => {
          if (onProgress && progress.percent != null) {
            onProgress(Math.min(progress.percent, 100))
          }
        })
        .on('end', () => {
          settle(resolve)
        })
        .on('error', async (err: Error) => {
          try {
            await unlink(outputPath)
          } catch {
            // File may not exist yet
          }
          if (signal?.aborted) {
            settle(reject, new Error('Audio extraction cancelled'))
          } else {
            settle(reject, err)
          }
        })
        .save(outputPath)

      // Handle abort signal
      let onAbort: (() => void) | undefined
      if (signal) {
        onAbort = (): void => {
          command.kill('SIGKILL')
        }
        if (signal.aborted) {
          command.kill('SIGKILL')
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }

      // Timeout safety
      const timeout = setTimeout(() => {
        command.kill('SIGKILL')
        settle(reject, new Error('Audio extraction timed out'))
      }, timeoutMs)
    })
  }

  /**
   * Clean up multiple temporary files (batch cleanup)
   */
  async cleanupTempFiles(filePaths: string[]): Promise<void> {
    for (const fp of filePaths) {
      await this.cleanupTempFile(fp)
    }
  }

  /**
   * Clean up a temporary extracted audio file
   */
  async cleanupTempFile(filePath: string): Promise<void> {
    // Guard: only delete files within tmpdir with expected prefix (defense in depth)
    const tempDir = tmpdir()
    if (!filePath.startsWith(tempDir) || !basename(filePath).startsWith(VIDEO_IMPORT.TEMP_PREFIX)) {
      logger.warn(`Refusing to delete non-temp file: ${filePath}`)
      return
    }

    try {
      await unlink(filePath)
    } catch {
      logger.warn(`Failed to clean up temp file: ${filePath}`)
    }
  }

  /**
   * Probe a file with ffprobe (returns raw ffprobe data)
   */
  private probe(filePath: string): Promise<Ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      Ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }
}

/** Factory function */
export function createAudioExtractionService(): AudioExtractionService {
  return new AudioExtractionService()
}

/** Singleton instance */
export const audioExtractionService = createAudioExtractionService()
