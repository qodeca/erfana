// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Audio Converter
 *
 * IConverter implementation for audio files (MP3, WAV, M4A).
 * Delegates to TranscriptionService for audio-to-text conversion
 * and AudioMetadataService for metadata extraction.
 *
 * Note: The primary transcription path goes through the dedicated
 * transcription:import IPC channel which supports progress reporting.
 * This convert() method is for headless/batch usage without progress.
 *
 * @see Issue #75 - Media import with transcription
 */
import { basename } from 'path'
import { ErrorCode } from '../../../../shared/errors'
import { validateFileForImport, formatDuration } from '../../../utils/fileUtils'
import type {
  IConverter,
  ITranscriptionServiceLike,
  ValidationResult,
  ConversionResult,
  FileTypeCategory
} from '../types'

/** Interface for AudioMetadataService dependency */
interface IAudioMetadataServiceLike {
  getDuration(filePath: string): Promise<number>
}

/**
 * Audio Converter
 *
 * Converts audio files to markdown with YAML frontmatter containing
 * source path, duration, date, language, and transcription backend.
 */
export class AudioConverter implements IConverter {
  readonly supportedExtensions = ['mp3', 'wav', 'm4a', 'ogg', 'flac']
  readonly requiresConversion = true
  readonly category: FileTypeCategory = 'audio'

  constructor(
    private transcriptionService: ITranscriptionServiceLike,
    private audioMetadataService: IAudioMetadataServiceLike
  ) {}

  /**
   * Validate an audio file before conversion
   *
   * Uses shared validation logic for file existence and size checks.
   */
  async validate(filePath: string): Promise<ValidationResult> {
    return validateFileForImport(filePath)
  }

  /**
   * Convert audio to markdown with transcription
   *
   * This is the headless/batch path without progress reporting.
   * For interactive use with progress, use transcription:import IPC channel.
   *
   * @param filePath - Absolute path to the audio file
   * @returns Conversion result with markdown content or error
   */
  async convert(filePath: string, backend: string = 'openai'): Promise<ConversionResult> {
    // Get duration for frontmatter
    let duration: number
    try {
      duration = await this.audioMetadataService.getDuration(filePath)
    } catch {
      return {
        success: false,
        error: 'Failed to analyze audio file',
        errorCode: ErrorCode.TRANSCRIPTION_INVALID_AUDIO
      }
    }

    // Transcribe audio (no progress reporting in batch mode)
    const result = await this.transcriptionService.transcribe(
      filePath,
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
      duration,
      result.language || 'auto',
      result.transcript,
      backend
    )

    return {
      success: true,
      content: markdown
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
    backend: string = 'openai'
  ): string {
    const fileName = basename(filePath)
    const durationFormatted = formatDuration(durationSeconds)
    const date = new Date().toISOString()

    return [
      '---',
      `source: "${fileName}"`,
      `duration: "${durationFormatted}"`,
      `date: "${date}"`,
      `language: ${language}`,
      `transcription_backend: ${backend}`,
      '---',
      '',
      transcript,
      ''
    ].join('\n')
  }
}

/**
 * Factory function for AudioConverter
 */
export function createAudioConverter(
  transcriptionService: ITranscriptionServiceLike,
  audioMetadataService: IAudioMetadataServiceLike
): AudioConverter {
  return new AudioConverter(transcriptionService, audioMetadataService)
}
