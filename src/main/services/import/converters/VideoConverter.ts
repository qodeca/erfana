// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Video Converter
 *
 * IConverter implementation for video files (MP4, MOV, AVI, MKV, etc.).
 * Extracts audio using AudioExtractionService, then delegates to
 * TranscriptionService for audio-to-text conversion.
 *
 * Note: The primary transcription path goes through the dedicated
 * transcription:import IPC channel which supports progress reporting.
 * This convert() method is for headless/batch usage without progress.
 *
 * @see Issue #110 - Video file import with audio extraction
 */
import { basename } from 'path'
import { ErrorCode } from '../../../../shared/errors'
import { VIDEO_IMPORT, TRANSCRIPTION } from '../../../../shared/constants'
import { validateFileForImport, formatDuration } from '../../../utils/fileUtils'
import type {
  IConverter,
  ITranscriptionServiceLike,
  ValidationResult,
  ConversionResult,
  FileTypeCategory
} from '../types'
import type { VideoMetadata, ExtractionResult, SegmentedExtractionResult } from '../../AudioExtractionService'

/** Interface for AudioExtractionService dependency */
interface IAudioExtractionServiceLike {
  isAvailable(): boolean
  hasAudioStream(filePath: string): Promise<boolean>
  extractAudio(
    filePath: string,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<ExtractionResult>
  extractAudioSegments(
    filePath: string,
    segmentSeconds?: number,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<SegmentedExtractionResult>
  getVideoMetadata(filePath: string): Promise<VideoMetadata>
  cleanupTempFile(filePath: string): Promise<void>
  cleanupTempFiles(filePaths: string[]): Promise<void>
}

/**
 * Video Converter
 *
 * Converts video files to markdown with YAML frontmatter containing
 * source path, duration, date, language, resolution, video codec,
 * and transcription backend.
 */
export class VideoConverter implements IConverter {
  readonly supportedExtensions = [...VIDEO_IMPORT.SUPPORTED_EXTENSIONS]
  readonly requiresConversion = true
  readonly category: FileTypeCategory = 'video'

  constructor(
    private transcriptionService: ITranscriptionServiceLike,
    private audioExtractionService: IAudioExtractionServiceLike
  ) {}

  /**
   * Validate a video file before conversion
   *
   * Uses shared validation logic for file existence and size checks.
   */
  async validate(filePath: string): Promise<ValidationResult> {
    return validateFileForImport(filePath)
  }

  /**
   * Convert video to markdown with transcription
   *
   * This is the headless/batch path without progress reporting.
   * For interactive use with progress, use transcription:import IPC channel.
   *
   * @param filePath - Absolute path to the video file
   * @returns Conversion result with markdown content or error
   */
  async convert(filePath: string, backend: string = 'openai'): Promise<ConversionResult> {
    // Check ffmpeg availability
    if (!this.audioExtractionService.isAvailable()) {
      return {
        success: false,
        error: 'Video import requires ffmpeg which is not available.',
        errorCode: ErrorCode.VIDEO_FFMPEG_UNAVAILABLE
      }
    }

    // Check for audio stream
    let hasAudio: boolean
    try {
      hasAudio = await this.audioExtractionService.hasAudioStream(filePath)
    } catch {
      return {
        success: false,
        error: 'Failed to analyze video file',
        errorCode: ErrorCode.VIDEO_EXTRACTION_FAILED
      }
    }

    if (!hasAudio) {
      return {
        success: false,
        error: 'This video file contains no audio track to transcribe.',
        errorCode: ErrorCode.VIDEO_NO_AUDIO_TRACK
      }
    }

    // Get video metadata for frontmatter (best-effort)
    let videoMetadata: VideoMetadata | undefined
    try {
      videoMetadata = await this.audioExtractionService.getVideoMetadata(filePath)
    } catch {
      // Metadata is optional – continue without it
    }

    // Choose extraction strategy based on duration
    const durationSeconds = videoMetadata?.durationSeconds ?? 0
    const isLongVideo = durationSeconds > TRANSCRIPTION.CHUNK_BOUNDARY_SECONDS

    if (isLongVideo) {
      return this.convertLongVideo(filePath, durationSeconds, videoMetadata, backend)
    }

    return this.convertShortVideo(filePath, videoMetadata, backend)
  }

  /**
   * Convert a short video (<=8 min) – single extraction + single transcription
   */
  private async convertShortVideo(
    filePath: string,
    videoMetadata?: VideoMetadata,
    backend: string = 'openai'
  ): Promise<ConversionResult> {
    let extraction: ExtractionResult
    try {
      extraction = await this.audioExtractionService.extractAudio(
        filePath,
        () => { /* no-op progress in batch mode */ }
      )
    } catch {
      return {
        success: false,
        error: 'Failed to extract audio from video file.',
        errorCode: ErrorCode.VIDEO_EXTRACTION_FAILED
      }
    }

    try {
      const result = await this.transcriptionService.transcribe(
        extraction.audioPath,
        'auto',
        () => { /* no-op progress in batch mode */ }
      )

      if (!result.success || !result.transcript) {
        return this.mapTranscriptionError(result.error, result.errorCode)
      }

      const markdown = this.formatMarkdown(
        filePath,
        videoMetadata?.durationSeconds ?? extraction.durationSeconds,
        result.language || 'auto',
        result.transcript,
        videoMetadata?.resolution,
        videoMetadata?.videoCodec,
        backend
      )

      return { success: true, content: markdown }
    } finally {
      await this.audioExtractionService.cleanupTempFile(extraction.audioPath)
    }
  }

  /**
   * Convert a long video (>8 min) – segmented extraction + per-segment transcription
   */
  private async convertLongVideo(
    filePath: string,
    durationSeconds: number,
    videoMetadata?: VideoMetadata,
    backend: string = 'openai'
  ): Promise<ConversionResult> {
    let segmented: SegmentedExtractionResult
    try {
      segmented = await this.audioExtractionService.extractAudioSegments(
        filePath,
        undefined,
        () => { /* no-op progress in batch mode */ }
      )
    } catch {
      return {
        success: false,
        error: 'Failed to extract audio from video file.',
        errorCode: ErrorCode.VIDEO_EXTRACTION_FAILED
      }
    }

    try {
      const transcriptParts: string[] = []
      let detectedLanguage: string | undefined

      for (const segmentPath of segmented.segmentPaths) {
        const result = await this.transcriptionService.transcribe(
          segmentPath,
          'auto',
          () => { /* no-op progress in batch mode */ }
        )

        if (!result.success || !result.transcript) {
          return this.mapTranscriptionError(result.error, result.errorCode)
        }

        transcriptParts.push(result.transcript)
        if (!detectedLanguage && result.language) {
          detectedLanguage = result.language
        }
      }

      const transcript = transcriptParts.join(' ')
      const markdown = this.formatMarkdown(
        filePath,
        durationSeconds,
        detectedLanguage || 'auto',
        transcript,
        videoMetadata?.resolution,
        videoMetadata?.videoCodec,
        backend
      )

      return { success: true, content: markdown }
    } finally {
      await this.audioExtractionService.cleanupTempFiles(segmented.segmentPaths)
    }
  }

  /**
   * Map transcription error to ConversionResult
   */
  private mapTranscriptionError(error?: string, errorCode?: string): ConversionResult {
    const knownErrorCodes = Object.values(ErrorCode) as string[]
    const resolvedErrorCode =
      errorCode && knownErrorCodes.includes(errorCode)
        ? (errorCode as ErrorCode)
        : ErrorCode.IMPORT_CONVERSION_FAILED
    return {
      success: false,
      error: error || 'Transcription failed',
      errorCode: resolvedErrorCode
    }
  }

  /**
   * Format transcription as markdown with YAML frontmatter
   */
  private formatMarkdown(
    filePath: string,
    durationSeconds: number,
    language: string,
    transcript: string,
    resolution?: string,
    videoCodec?: string,
    backend: string = 'openai'
  ): string {
    const fileName = basename(filePath)
    const durationFormatted = formatDuration(durationSeconds)
    const date = new Date().toISOString()

    const lines = [
      '---',
      `source: "${fileName}"`,
      `type: video`,
      `duration: "${durationFormatted}"`,
      `date: "${date}"`,
      `language: ${language}`,
      `transcription_backend: ${backend}`
    ]

    if (resolution) {
      lines.push(`resolution: "${resolution}"`)
    }

    if (videoCodec) {
      lines.push(`video_codec: "${videoCodec}"`)
    }

    lines.push('---', '', transcript, '')

    return lines.join('\n')
  }

}

/**
 * Factory function for VideoConverter
 */
export function createVideoConverter(
  transcriptionService: ITranscriptionServiceLike,
  audioExtractionService: IAudioExtractionServiceLike
): VideoConverter {
  return new VideoConverter(transcriptionService, audioExtractionService)
}
