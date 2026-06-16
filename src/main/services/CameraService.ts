// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { CAMERA } from '../../shared/constants'
import { ErrorCode } from '../../shared/errors'
import { logger } from './LoggingService'

/**
 * Camera save result
 */
interface CameraSaveResult {
  filePath?: string
  error?: string
  errorCode?: string
}

/**
 * Camera Service Interface
 *
 * Defines the public API for camera photo save functionality.
 * Follows the interface pattern established by ScreenshotService.
 *
 * @see Spec #014 - camera photo capture specification
 */
interface ICameraService {
  /**
   * Save a camera photo from data URL to temp file
   *
   * @param dataUrl - Base64-encoded JPEG data URL
   * @param timestamp - Optional timestamp for filename (uses current time if not provided)
   * @returns Result with file path on success, error on failure
   */
  save(dataUrl: string, timestamp?: number): Promise<CameraSaveResult>
}

/**
 * Camera Service
 *
 * Handles saving camera photos from the renderer process to temporary files.
 * Photos are captured via MediaDevices API in the renderer, converted to
 * base64 JPEG, and sent to main process for saving.
 *
 * Security considerations:
 * - Validates data URL format before processing
 * - Writes to system temp directory only
 * - No shell command execution (pure Node.js file operations)
 *
 * @see Spec #014 - camera photo capture specification
 */
class CameraService implements ICameraService {
  /**
   * Data URL prefix for JPEG images
   */
  private static readonly DATA_URL_PREFIX = 'data:image/jpeg;base64,'

  /**
   * Maximum allowed data URL size (20MB)
   * Prevents memory exhaustion from extremely large payloads.
   * A 4K JPEG at 92% quality is typically 2-5MB, so 20MB is generous.
   */
  private static readonly MAX_DATA_URL_SIZE = 20 * 1024 * 1024

  /**
   * Save a camera photo from data URL to temp file
   *
   * @param dataUrl - Base64-encoded JPEG data URL
   * @param timestamp - Optional timestamp for filename (uses current time if not provided)
   * @returns Result with file path on success, error on failure
   */
  async save(dataUrl: string, timestamp?: number): Promise<CameraSaveResult> {
    // Validate data URL format
    if (!dataUrl.startsWith(CameraService.DATA_URL_PREFIX)) {
      logger.warn('Camera save: invalid data URL format')
      return {
        error: 'Invalid photo data format',
        errorCode: ErrorCode.CAMERA_INVALID_DATA
      }
    }

    // Validate data URL size to prevent memory exhaustion
    if (dataUrl.length > CameraService.MAX_DATA_URL_SIZE) {
      logger.warn('Camera save: data URL too large', {
        size: dataUrl.length,
        maxSize: CameraService.MAX_DATA_URL_SIZE
      })
      return {
        error: 'Photo data too large',
        errorCode: ErrorCode.CAMERA_INVALID_DATA
      }
    }

    try {
      // Extract base64 data (remove prefix)
      const base64Data = dataUrl.slice(CameraService.DATA_URL_PREFIX.length)

      // Convert to Buffer
      const buffer = Buffer.from(base64Data, 'base64')

      // Generate filename with timestamp
      const ts = timestamp ?? Date.now()
      const date = new Date(ts)
      const filename = this.formatFilename(date)

      // Write to temp directory
      const filePath = join(tmpdir(), filename)

      logger.debug('Camera save: writing photo', { filePath, size: buffer.length })

      await writeFile(filePath, buffer)

      logger.info('Camera photo saved successfully', { filePath })

      return { filePath }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Camera save failed', error instanceof Error ? error : undefined)

      return {
        error: errorMessage,
        errorCode: ErrorCode.CAMERA_SAVE_FAILED
      }
    }
  }

  /**
   * Format filename from date
   *
   * Format: camera-YYYY-MM-DD-HHMMSS.jpg
   *
   * @param date - Date to format
   * @returns Formatted filename
   */
  private formatFilename(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')

    return `${CAMERA.TEMP_PREFIX}${year}-${month}-${day}-${hours}${minutes}${seconds}${CAMERA.FILE_EXTENSION}`
  }
}

// Singleton instance
export const cameraService = new CameraService()
