import { execFile } from 'child_process'
import { screen } from 'electron'
import { access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { SCREENSHOT } from '../../shared/constants'
import { ErrorCode } from '../../shared/errors'
import type { ScreenshotMode, ScreenshotCaptureResponse, DisplayInfo } from '../../shared/ipc/screenshot-schema'
import { logger } from './LoggingService'

/**
 * Screenshot Service
 *
 * Handles screenshot capture using macOS screencapture command.
 * Supports three capture modes: screen, window, and area selection.
 *
 * Security considerations:
 * - Uses execFile (not exec!) to prevent command injection
 * - Uses absolute path to screencapture binary
 * - Only available on macOS
 *
 * @see Issue #86 - screenshot capture for terminal panel
 */
class ScreenshotService {
  /**
   * Delay before checking if file exists (filesystem sync)
   */
  private static readonly FILE_CHECK_DELAY_MS = 50

  /**
   * Get all available displays for multi-monitor support
   *
   * @returns Array of display information
   * @see Issue #86 enhancement - multi-monitor support
   */
  getDisplays(): DisplayInfo[] {
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id

    return displays.map((display, index) => ({
      id: display.id,
      label: display.label || `Display ${index + 1}`,
      isPrimary: display.id === primaryId,
      bounds: display.bounds
    }))
  }

  /**
   * Capture a screenshot using macOS screencapture
   *
   * @param mode - Capture mode: 'screen', 'window', or 'area'
   * @param displayId - Optional display ID for 'screen' mode (maps to -D flag)
   * @returns Capture result with file path or error
   */
  async capture(mode: ScreenshotMode, displayId?: number): Promise<ScreenshotCaptureResponse> {
    // Check platform
    if (process.platform !== 'darwin') {
      return {
        success: false,
        error: 'Screenshot capture is only available on macOS',
        errorCode: ErrorCode.SCREENSHOT_NOT_SUPPORTED
      }
    }

    // Generate temp file path with timestamp
    const filePath = join(
      tmpdir(),
      `${SCREENSHOT.TEMP_PREFIX}${Date.now()}${SCREENSHOT.FILE_EXTENSION}`
    )

    // Build args based on mode (and optional displayId for screen mode)
    const args = this.buildArgs(mode, filePath, displayId)

    logger.debug('Starting screenshot capture', { mode, filePath })

    try {
      await this.executeCapture(args)

      // Wait for filesystem sync
      await this.sleep(ScreenshotService.FILE_CHECK_DELAY_MS)

      // Check if file exists (user may have cancelled)
      const exists = await this.fileExists(filePath)
      if (!exists) {
        logger.debug('Screenshot cancelled - file not created')
        return {
          success: false,
          errorCode: ErrorCode.SCREENSHOT_CANCELLED
        }
      }

      logger.info('Screenshot captured successfully', { filePath })
      return {
        success: true,
        filePath
      }
    } catch (error) {
      return this.handleError(error)
    }
  }

  /**
   * Build command arguments based on capture mode
   *
   * @param mode - Capture mode
   * @param filePath - Output file path
   * @param displayId - Optional display ID for screen mode (maps to -D flag)
   * @returns Array of command arguments
   */
  private buildArgs(mode: ScreenshotMode, filePath: string, displayId?: number): string[] {
    // -x: No sound
    // -o: In window mode, exclude window shadow
    // -i: Interactive mode (enables window/area selection)
    // -w: Window capture mode (with -i)
    // -s: Selection mode (with -i) - this is the default for -i, so we omit it for area
    // -D: Display number (1-based index for screencapture)

    // For screen mode with specific display
    if (mode === 'screen' && displayId !== undefined) {
      // Need to find display index (1-based for screencapture -D flag)
      const displays = screen.getAllDisplays()
      const displayIndex = displays.findIndex((d) => d.id === displayId) + 1
      if (displayIndex > 0) {
        return ['-x', '-D', String(displayIndex), filePath]
      }
      // Fall through to default screen capture if display not found
    }

    switch (mode) {
      case 'screen':
        // Capture primary display silently
        return ['-x', filePath]
      case 'window':
        // Interactive window selection (space to toggle window mode)
        return ['-x', '-o', '-i', '-w', filePath]
      case 'area':
        // Interactive area selection (draw rectangle)
        return ['-x', '-i', '-s', filePath]
    }
  }

  /**
   * Execute screencapture command
   *
   * @param args - Command arguments
   * @returns Promise that resolves when capture completes
   */
  private executeCapture(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        SCREENSHOT.BINARY_PATH,
        args,
        { timeout: SCREENSHOT.TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (error) {
            // Exit code 1 can mean cancelled OR permission denied
            // We check file existence later to distinguish
            if (error.killed) {
              reject(new Error('timeout'))
            } else if (stderr.includes('cannot capture')) {
              reject(new Error('permission_denied'))
            } else if (error.code === 1) {
              // Exit code 1 is ambiguous - could be cancelled or error
              // Resolve and let file existence check handle it
              resolve()
            } else {
              reject(error)
            }
          } else {
            resolve()
          }
        }
      )

      // Handle process errors
      child.on('error', (err) => {
        reject(err)
      })
    })
  }

  /**
   * Check if file exists
   *
   * @param filePath - Path to check
   * @returns true if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Handle capture errors and return appropriate response
   *
   * @param error - Error from capture attempt
   * @returns Error response with appropriate code
   */
  private handleError(error: unknown): ScreenshotCaptureResponse {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (errorMessage === 'timeout') {
      logger.warn('Screenshot capture timed out')
      return {
        success: false,
        error: 'Screenshot capture timed out',
        errorCode: ErrorCode.SCREENSHOT_TIMEOUT
      }
    }

    if (errorMessage === 'permission_denied') {
      logger.warn('Screenshot permission denied')
      return {
        success: false,
        error: 'Screen recording permission required',
        errorCode: ErrorCode.SCREENSHOT_PERMISSION_DENIED
      }
    }

    logger.error('Screenshot capture failed', error instanceof Error ? error : undefined)
    return {
      success: false,
      error: errorMessage,
      errorCode: ErrorCode.SCREENSHOT_FAILED
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// Singleton instance
export const screenshotService = new ScreenshotService()
