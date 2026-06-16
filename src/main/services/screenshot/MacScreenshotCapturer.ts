// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Mac screenshot capturer.
 *
 * Uses the native /usr/sbin/screencapture binary. This is the implementation
 * that shipped pre-#164 — extracting it from `ScreenshotService` lets the
 * dispatcher pick this strategy on macOS while keeping the well-tested
 * behaviour intact (familiar OS marquee, native window picker, system
 * "screen recording" permission prompt).
 *
 * Security considerations:
 * - Uses `execFile` (not `exec`) to prevent command injection.
 * - Uses an absolute path to the binary (`SCREENSHOT.BINARY_PATH`).
 * - The argv list contains only the temp file path we generate ourselves
 *   plus literal flag strings — no user input is interpolated.
 *
 * @see Issue #86 - original macOS screenshot capture
 * @see Issue #164 - extracted behind `IScreenshotCapturer` for cross-platform parity
 * @see Issue #164 Phase 3 - collapsed to single `capture(request)` method.
 */

import { execFile } from 'child_process'
import { screen } from 'electron'
import { SCREENSHOT } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type {
  ScreenshotCapabilities,
  ScreenshotCaptureRequest,
  ScreenshotCaptureResponse,
  WindowSource
} from '../../../shared/ipc/screenshot-schema'
import { logger } from '../LoggingService'
import { fileExists, generateScreenshotPath, sleep } from './sharedHelpers'
import type { IScreenshotCapturer } from './types'

export class MacScreenshotCapturer implements IScreenshotCapturer {
  getCapabilities(): ScreenshotCapabilities {
    return { supported: true, hasNativeWindowPicker: true, areaCaptureMode: 'native' }
  }

  /**
   * macOS uses screencapture's native `-iw` picker instead of an in-app
   * thumbnail grid, so window enumeration is intentionally a no-op here.
   * The dispatcher tags this with `availability: 'native-picker'` so the
   * renderer doesn't open the picker dialog at all.
   */
  async enumerateWindowsRaw(): Promise<WindowSource[]> {
    return []
  }

  async capture(request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse> {
    switch (request.mode) {
      case 'screen':
        return this.runCapture('screen', this.buildScreenArgs(request.displayId))
      case 'window-native':
        // macOS uses the native `-iw` picker; the OS resolves the target
        // window inside the binary call, so no `windowId` is needed.
        return this.runCapture('window-native', this.buildWindowArgs())
      case 'window':
        // `'window'` is the Windows-only desktopCapturer variant — macOS
        // never accepts a pre-selected window id (#164 round-2 F#10 / D4).
        logger.warn('MacScreenshotCapturer received window-mode request — rejected')
        return {
          success: false,
          error: 'Window-id capture is not supported on macOS; use window-native instead',
          errorCode: ErrorCode.SCREENSHOT_NOT_SUPPORTED
        }
      case 'area':
        return this.runCapture('area', this.buildAreaArgs())
      default: {
        // Exhaustiveness guard (#164 round-2 F#24): a future mode without a
        // case here is a type error rather than a silent fall-through.
        const _exhaustive: never = request
        void _exhaustive
        return {
          success: false,
          error: 'Unsupported capture mode',
          errorCode: ErrorCode.SCREENSHOT_NOT_SUPPORTED
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private buildScreenArgs(displayId?: number): (filePath: string) => string[] {
    return (filePath) => {
      // -x: silent.
      // -R x,y,w,h: capture the rectangle in canonical screen coordinates.
      //
      // We resolve the display's bounds and pass `-R` instead of `-D <index>`
      // (#164 lens-review F[14]). The `-D` flag indexes into CoreGraphics's
      // `CGGetActiveDisplayList`, whose order is NOT contractually identical
      // to `screen.getAllDisplays()`. Apple has been known to reshuffle CG
      // display IDs on wake from sleep with external monitors; on a
      // multi-monitor Mac, the wrong display could be captured. `-R` uses
      // canonical bounds (which the Electron screen API does guarantee),
      // sidestepping the ordering question entirely.
      if (displayId !== undefined) {
        const display = screen.getAllDisplays().find((d) => d.id === displayId)
        if (display) {
          const { x, y, width, height } = display.bounds
          return ['-x', '-R', `${x},${y},${width},${height}`, filePath]
        }
      }
      return ['-x', filePath]
    }
  }

  private buildWindowArgs(): (filePath: string) => string[] {
    // -o: exclude window shadow. -i: interactive. -w: window mode.
    return (filePath) => ['-x', '-o', '-i', '-w', filePath]
  }

  private buildAreaArgs(): (filePath: string) => string[] {
    // -i -s: interactive area selection (drag rectangle).
    return (filePath) => ['-x', '-i', '-s', filePath]
  }

  private async runCapture(
    mode: 'screen' | 'window-native' | 'area',
    buildArgs: (filePath: string) => string[]
  ): Promise<ScreenshotCaptureResponse> {
    const filePath = generateScreenshotPath()
    const args = buildArgs(filePath)

    logger.debug('Starting screenshot capture', { mode, filePath })

    try {
      await this.executeCapture(args)
      await sleep(SCREENSHOT.FILE_CHECK_DELAY_MS)

      const exists = await fileExists(filePath)
      if (!exists) {
        logger.debug('Screenshot cancelled - file not created')
        return {
          success: false,
          errorCode: ErrorCode.SCREENSHOT_CANCELLED
        }
      }

      logger.info('Screenshot captured successfully', { filePath })
      return { success: true, filePath }
    } catch (error) {
      return this.handleError(error)
    }
  }

  private executeCapture(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        SCREENSHOT.BINARY_PATH,
        args,
        { timeout: SCREENSHOT.TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (error) {
            if (error.killed) {
              reject(new Error('timeout'))
            } else if (stderr.includes('cannot capture')) {
              reject(new Error('permission_denied'))
            } else if (error.code === 1) {
              // Exit code 1 is ambiguous (cancel vs error) - let the file
              // existence check disambiguate after the promise resolves.
              resolve()
            } else {
              reject(error)
            }
          } else {
            resolve()
          }
        }
      )

      child.on('error', (err) => {
        reject(err)
      })
    })
  }

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
}
