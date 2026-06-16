// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Audio Metadata Service
 *
 * Lightweight audio file metadata extraction using the music-metadata
 * npm package. Extracts duration, format, bitrate, and validates
 * audio files without requiring ffmpeg.
 *
 * Supports: MP3 (ID3v1/v2, MPEG frames), WAV (RIFF/PCM), M4A (MP4 container), OGG, FLAC
 *
 * @see Issue #75 - Media import with transcription
 */
import { parseFile } from 'music-metadata'
import { stat, access } from 'fs/promises'
import { extname } from 'path'
import { ErrorCode } from '../../shared/errors'
import { TRANSCRIPTION } from '../../shared/constants'
import { logger } from './LoggingService'

/**
 * Audio format information
 */
export interface AudioFormat {
  /** File extension (without dot) */
  extension: string
  /** MIME type */
  mimeType: string
  /** Bitrate in kbps */
  bitrate?: number
  /** Sample rate in Hz */
  sampleRate?: number
  /** Number of channels */
  channels?: number
}

/**
 * Audio validation result
 */
export interface AudioValidationResult {
  /** Whether the file is valid audio */
  valid: boolean
  /** Error message if invalid */
  error?: string
  /** Error code if invalid */
  errorCode?: ErrorCode
  /** Audio format details */
  format?: AudioFormat
  /** Duration in seconds */
  durationSeconds?: number
  /** File size in megabytes */
  sizeInMB: number
}

/**
 * Audio Metadata Service Interface
 */
interface IAudioMetadataService {
  /** Get audio duration in seconds */
  getDuration(filePath: string): Promise<number>
  /** Get audio format information */
  getFormat(filePath: string): Promise<AudioFormat>
  /** Validate an audio file */
  validate(filePath: string): Promise<AudioValidationResult>
}

/** MIME type mapping for supported extensions */
const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac'
}

/**
 * Audio Metadata Service Implementation
 *
 * Uses music-metadata package for parsing audio headers.
 * Pure JavaScript -- no native dependencies.
 */
class AudioMetadataService implements IAudioMetadataService {
  /**
   * Get audio duration in seconds
   *
   * @param filePath - Absolute path to the audio file
   * @returns Duration in seconds
   * @throws Error if file cannot be parsed
   */
  async getDuration(filePath: string): Promise<number> {
    try {
      const metadata = await parseFile(filePath, { duration: true })
      const duration = metadata.format.duration

      if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('Could not determine audio duration')
      }

      return duration
    } catch (error) {
      logger.error('Failed to get audio duration', error instanceof Error ? error : undefined)
      throw error
    }
  }

  /**
   * Get audio format information
   *
   * @param filePath - Absolute path to the audio file
   * @returns Audio format details
   */
  async getFormat(filePath: string): Promise<AudioFormat> {
    try {
      const metadata = await parseFile(filePath, { duration: true })
      const ext = extname(filePath).slice(1).toLowerCase()

      return {
        extension: ext,
        mimeType: MIME_TYPES[ext] || `audio/${ext}`,
        bitrate: metadata.format.bitrate
          ? Math.round(metadata.format.bitrate / 1000)
          : undefined,
        sampleRate: metadata.format.sampleRate,
        channels: metadata.format.numberOfChannels
      }
    } catch (error) {
      logger.error('Failed to get audio format', error instanceof Error ? error : undefined)
      throw error
    }
  }

  /**
   * Validate an audio file for transcription
   *
   * Checks:
   * - File exists and is accessible
   * - File has a supported extension
   * - File can be parsed as audio
   * - Duration is determinable
   *
   * @param filePath - Absolute path to the audio file
   * @returns Validation result with format and duration info
   */
  async validate(filePath: string): Promise<AudioValidationResult> {
    // Check file exists
    try {
      await access(filePath)
    } catch {
      return {
        valid: false,
        error: 'Audio file not found',
        errorCode: ErrorCode.IMPORT_FILE_NOT_FOUND,
        sizeInMB: 0
      }
    }

    // Get file size
    let sizeInMB: number
    try {
      const stats = await stat(filePath)
      sizeInMB = stats.size / (1024 * 1024)
    } catch {
      return {
        valid: false,
        error: 'Cannot read audio file',
        errorCode: ErrorCode.IMPORT_FILE_UNREADABLE,
        sizeInMB: 0
      }
    }

    // Check extension
    const ext = extname(filePath).slice(1).toLowerCase()
    const supportedExtensions: readonly string[] = TRANSCRIPTION.SUPPORTED_EXTENSIONS
    if (!supportedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `Unsupported audio format: .${ext}. Supported: MP3, WAV, M4A, OGG, FLAC.`,
        errorCode: ErrorCode.TRANSCRIPTION_INVALID_AUDIO,
        sizeInMB
      }
    }

    // Parse audio metadata
    try {
      const metadata = await parseFile(filePath, { duration: true })
      const duration = metadata.format.duration

      if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
        return {
          valid: false,
          error: 'Could not determine audio duration. File may be corrupted.',
          errorCode: ErrorCode.TRANSCRIPTION_INVALID_AUDIO,
          sizeInMB
        }
      }

      const format: AudioFormat = {
        extension: ext,
        mimeType: MIME_TYPES[ext] || `audio/${ext}`,
        bitrate: metadata.format.bitrate
          ? Math.round(metadata.format.bitrate / 1000)
          : undefined,
        sampleRate: metadata.format.sampleRate,
        channels: metadata.format.numberOfChannels
      }

      return {
        valid: true,
        format,
        durationSeconds: duration,
        sizeInMB
      }
    } catch (error) {
      logger.error('Audio validation failed', error instanceof Error ? error : undefined)
      return {
        valid: false,
        error: 'Invalid audio file. File may be corrupted or not a valid audio format.',
        errorCode: ErrorCode.TRANSCRIPTION_INVALID_AUDIO,
        sizeInMB
      }
    }
  }
}

/** Singleton instance */
export const audioMetadataService = new AudioMetadataService()

/** Factory function for testing */
export function createAudioMetadataService(): AudioMetadataService {
  return new AudioMetadataService()
}
