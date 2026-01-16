import { ipcMain } from 'electron'
import { screenshotService } from '../services/ScreenshotService'
import {
  ScreenshotCaptureRequestSchema,
  type ScreenshotCaptureResponse,
  type GetDisplaysResponse
} from '../../shared/ipc/screenshot-schema'
import { ErrorCode } from '../../shared/errors'
import { logger } from '../services/LoggingService'

/**
 * Register screenshot capture IPC handlers
 *
 * Channels:
 * - screenshot:capture - Capture screenshot with specified mode
 * - screenshot:getDisplays - Get available displays for multi-monitor support
 *
 * @see Issue #86 - screenshot capture for terminal panel
 */
export function registerScreenshotHandlers(): void {
  /**
   * Get available displays for multi-monitor support
   *
   * @returns Array of display information
   * @see Issue #86 enhancement - multi-monitor support
   */
  ipcMain.handle('screenshot:getDisplays', async (): Promise<GetDisplaysResponse> => {
    try {
      return { displays: screenshotService.getDisplays() }
    } catch (error) {
      logger.error('Failed to get displays', error instanceof Error ? error : undefined)
      return { displays: [] }
    }
  })

  /**
   * Capture screenshot
   *
   * Uses macOS screencapture command with the specified mode.
   *
   * @param request - { mode: 'screen' | 'window' | 'area', displayId?: number }
   * @returns Capture result with file path or error
   */
  ipcMain.handle(
    'screenshot:capture',
    async (_event, request: unknown): Promise<ScreenshotCaptureResponse> => {
      // Validate request schema
      const parseResult = ScreenshotCaptureRequestSchema.safeParse(request)

      if (!parseResult.success) {
        logger.error('Screenshot capture validation error', parseResult.error)
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.issues[0]?.message,
          errorCode: ErrorCode.SCREENSHOT_FAILED
        }
      }

      try {
        const { mode, displayId } = parseResult.data
        return await screenshotService.capture(mode, displayId)
      } catch (error) {
        logger.error('Screenshot capture handler error', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: ErrorCode.SCREENSHOT_FAILED
        }
      }
    }
  )
}
