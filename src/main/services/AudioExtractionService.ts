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
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'
import { VIDEO_IMPORT } from '../../shared/constants'
import { logger } from './LoggingService'

// Configure ffmpeg binary paths
if (ffmpegPath) {
  Ffmpeg.setFfmpegPath(ffmpegPath)
}
if (ffprobePath?.path) {
  Ffmpeg.setFfprobePath(ffprobePath.path)
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

/** Progress callback type */
export type ExtractionProgressCallback = (percent: number) => void

export class AudioExtractionService {
  /**
   * Check if ffmpeg is available
   */
  isAvailable(): boolean {
    return !!ffmpegPath && !!ffprobePath?.path
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
   * Extract audio from a video file to a temp WAV file
   *
   * Extracts 16kHz mono WAV – smaller files, optimized for speech transcription.
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

    return new Promise<ExtractionResult>((resolve, reject) => {
      let settled = false

      const settle = (fn: typeof resolve | typeof reject, value: ExtractionResult | Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        ;(fn as (v: unknown) => void)(value)
      }

      const command = Ffmpeg(filePath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .on('progress', (progress: { percent?: number }) => {
          if (onProgress && progress.percent != null) {
            onProgress(Math.min(progress.percent, 100))
          }
        })
        .on('end', () => {
          settle(resolve, { audioPath: outputPath, durationSeconds })
        })
        .on('error', async (err: Error) => {
          // Clean up temp file on error
          try {
            await unlink(outputPath)
          } catch {
            // File may not exist yet
          }
          // Distinguish cancellation from other errors
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
      }, VIDEO_IMPORT.EXTRACTION_TIMEOUT_MS)
    })
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
