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
import { VIDEO_IMPORT } from '../../../../shared/constants'
import { validateFileForImport, formatDuration } from '../../../utils/fileUtils'
import type {
  IConverter,
  ITranscriptionServiceLike,
  ValidationResult,
  ConversionResult,
  FileTypeCategory
} from '../types'
import type { VideoMetadata, ExtractionResult } from '../../AudioExtractionService'

/** Interface for AudioExtractionService dependency */
interface IAudioExtractionServiceLike {
  isAvailable(): boolean
  hasAudioStream(filePath: string): Promise<boolean>
  extractAudio(
    filePath: string,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<ExtractionResult>
  getVideoMetadata(filePath: string): Promise<VideoMetadata>
  cleanupTempFile(filePath: string): Promise<void>
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
  async convert(filePath: string): Promise<ConversionResult> {
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

    // Extract audio to temp file
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
      // Transcribe the extracted audio (no progress reporting in batch mode)
      const result = await this.transcriptionService.transcribe(
        extraction.audioPath,
        'auto',
        () => { /* no-op progress in batch mode */ }
      )

      if (!result.success || !result.transcript) {
        return {
          success: false,
          error: result.error || 'Transcription failed',
          errorCode: result.errorCode
            ? (result.errorCode as ErrorCode)
            : ErrorCode.IMPORT_CONVERSION_FAILED
        }
      }

      // Format as markdown with YAML frontmatter
      const markdown = this.formatMarkdown(
        filePath,
        videoMetadata?.durationSeconds ?? extraction.durationSeconds,
        result.language || 'auto',
        result.transcript,
        videoMetadata?.resolution,
        videoMetadata?.videoCodec
      )

      return {
        success: true,
        content: markdown
      }
    } finally {
      // Always clean up the temp audio file
      await this.audioExtractionService.cleanupTempFile(extraction.audioPath)
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
    videoCodec?: string
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
      `transcription_backend: openai`
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
