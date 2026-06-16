// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain } from 'electron'
import { cameraService } from '../services/CameraService'
import {
  CameraSaveRequestSchema,
  type CameraSaveResponse
} from '../../shared/ipc/camera-schema'
import { ErrorCode } from '../../shared/errors'
import { logger } from '../services/LoggingService'

/**
 * Register camera capture IPC handlers
 *
 * Channels:
 * - camera:save - Save captured photo to temp file
 *
 * @see Spec #014 - camera photo capture specification
 */
export function registerCameraHandlers(): void {
  /**
   * Save camera photo
   *
   * Receives base64-encoded JPEG data URL from renderer and saves to temp file.
   *
   * @param request - { dataUrl: string, timestamp?: number }
   * @returns Save result with file path or error
   */
  ipcMain.handle(
    'camera:save',
    async (_event, request: unknown): Promise<CameraSaveResponse> => {
      // Validate request schema
      const parseResult = CameraSaveRequestSchema.safeParse(request)

      if (!parseResult.success) {
        logger.error('Camera save validation error', parseResult.error)
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.issues[0]?.message,
          errorCode: ErrorCode.CAMERA_INVALID_DATA
        }
      }

      try {
        const { dataUrl, timestamp } = parseResult.data
        const result = await cameraService.save(dataUrl, timestamp)

        if (result.error) {
          return {
            success: false,
            error: result.error,
            errorCode: result.errorCode
          }
        }

        return {
          success: true,
          filePath: result.filePath
        }
      } catch (error) {
        logger.error('Camera save handler error', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: ErrorCode.CAMERA_SAVE_FAILED
        }
      }
    }
  )
}
