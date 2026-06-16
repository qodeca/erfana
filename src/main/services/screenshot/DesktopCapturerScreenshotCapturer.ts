// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Cross-platform screenshot capturer powered by Electron's `desktopCapturer`.
 *
 * Primary target is Windows (Phase 3 of the Windows enablement plan).
 *
 * Mode strategies:
 * - `screen`: enumerate `types: ['screen']` sources, match by `display_id`,
 *   write the thumbnail PNG. Thumbnail size = display bounds × `scaleFactor`,
 *   so the result is full physical resolution.
 * - `window`: enumerate `types: ['window']` sources, find the matching
 *   `DesktopCapturerSource.id`, write the thumbnail PNG. Thumbnail size is
 *   intentionally generous (8192×8192) — Electron caps it at the window's
 *   true size, so we get full resolution without knowing it in advance.
 * - `area`: spawn the area-select overlay window, await the selection
 *   rectangle, capture the chosen display, crop with `nativeImage.crop()`.
 *
 * Security considerations:
 * - No shell or argv injection surface — every IPC path used here is the
 *   Electron API, not a spawned process.
 * - Window ids and display ids are validated against fresh enumerations from
 *   the OS, not trusted as-passed from the renderer.
 * - Generated PNGs land in `os.tmpdir()` with timestamped names, identical
 *   to the macOS path. The user only ever sees paths they triggered.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 * @see Issue #164 Phase 3 - collapsed to single `capture(request)` method.
 */

import { desktopCapturer, nativeImage, screen, type Display } from 'electron'
import { writeFile } from 'fs/promises'
import { WINDOW_PICKER } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type {
  ScreenshotCapabilities,
  ScreenshotCaptureRequest,
  ScreenshotCaptureResponse,
  WindowSource
} from '../../../shared/ipc/screenshot-schema'
import { logger } from '../LoggingService'
import { generateScreenshotPath, resolveDisplay } from './sharedHelpers'
import { AreaSelectOverlay } from './ScreenshotOverlayWindow'
import type { IScreenshotCapturer } from './types'

export class DesktopCapturerScreenshotCapturer implements IScreenshotCapturer {
  /**
   * `overlay` is injectable so tests can pass a stub and avoid spinning up
   * BrowserWindow / fs in unit tests. Production constructs a fresh
   * {@link AreaSelectOverlay} per capturer (#164 round-2 F#25 — retire the
   * module-level singleton that previously fought the class refactor).
   */
  constructor(private readonly overlay: AreaSelectOverlay = new AreaSelectOverlay()) {}

  getCapabilities(): ScreenshotCapabilities {
    return { supported: true, hasNativeWindowPicker: false, areaCaptureMode: 'overlay' }
  }

  /**
   * Return the unbounded set of capturable windows with full-size thumbnails.
   * The dispatcher applies pagination (`WINDOW_PICKER.MAX_SOURCES`) and the
   * `includeThumbnails: false` opt-out, keeping policy in one place
   * (#164 round-2 F#8).
   */
  async enumerateWindowsRaw(): Promise<WindowSource[]> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: WINDOW_PICKER.THUMB_WIDTH, height: WINDOW_PICKER.THUMB_HEIGHT },
        fetchWindowIcons: false
      })

      // Drop empty thumbnails before returning so the dispatcher cap doesn't
      // count placeholder windows.
      return sources
        .filter((source) => !source.thumbnail.isEmpty())
        .map((source) => {
          const { width, height } = source.thumbnail.getSize()
          return {
            id: source.id,
            name: source.name || 'Untitled window',
            thumbnailDataUrl: source.thumbnail.toDataURL(),
            width,
            height
          }
        })
    } catch (error) {
      logger.error('Failed to enumerate windows', error instanceof Error ? error : undefined)
      return []
    }
  }

  capture(request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse> {
    switch (request.mode) {
      case 'screen':
        return this.captureScreen(request.displayId)
      case 'window':
        return this.captureWindow(request.windowId)
      case 'window-native':
        // `'window-native'` is the macOS-only variant; the desktopCapturer
        // backend never receives one because the renderer only sends it when
        // `hasNativeWindowPicker` is true (#164 round-2 D4).
        logger.warn('DesktopCapturerScreenshotCapturer received window-native — rejected')
        return Promise.resolve({
          success: false,
          error: 'window-native capture is macOS-only',
          errorCode: ErrorCode.SCREENSHOT_NOT_SUPPORTED
        })
      case 'area':
        return this.captureArea()
      default: {
        // Exhaustiveness guard (#164 round-2 F#24).
        const _exhaustive: never = request
        void _exhaustive
        return Promise.resolve({
          success: false,
          error: 'Unsupported capture mode',
          errorCode: ErrorCode.SCREENSHOT_NOT_SUPPORTED
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // Per-mode implementations (private)
  // -----------------------------------------------------------------------

  private async captureScreen(displayId?: number): Promise<ScreenshotCaptureResponse> {
    const display = resolveDisplay(displayId)
    if (!display) {
      logger.warn('Display not found for screen capture', { displayId })
      return {
        success: false,
        error: 'Display not found',
        errorCode: ErrorCode.SCREENSHOT_DISPLAY_NOT_FOUND
      }
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: this.physicalSize(display)
      })

      const source = this.matchScreenSource(sources, display)
      if (!source) {
        logger.warn('No matching screen source for display', { displayId: display.id })
        return {
          success: false,
          error: 'Display source not found',
          errorCode: ErrorCode.SCREENSHOT_DISPLAY_NOT_FOUND
        }
      }

      return this.writeImage(source.thumbnail.toPNG())
    } catch (error) {
      return this.handleError(error)
    }
  }

  private async captureWindow(windowId: string): Promise<ScreenshotCaptureResponse> {
    // `windowId` is now required by the schema (#164 round-2 D4) so the
    // runtime "missing windowId" branch is unreachable and has been removed.
    try {
      // Cap the thumbnail at the physical size of the largest attached
      // display. We don't know which display the target window lives on
      // until after the fetch, so we cap optimistically — Electron internally
      // clamps to the window's actual size anyway, but bounding the request
      // prevents pathological 8K×8K allocations on multi-4K Windows setups
      // (#164 lens-review F[28]). The cap is `max(width × scaleFactor)` over
      // all displays so a HiDPI 5K monitor isn't down-scaled.
      const cap = this.maxPhysicalDisplaySize()
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: cap
      })

      const source = sources.find((s) => s.id === windowId)
      if (!source) {
        logger.warn('Selected window no longer exists', { windowId })
        return {
          success: false,
          error: 'Selected window no longer exists',
          errorCode: ErrorCode.SCREENSHOT_WINDOW_NOT_FOUND
        }
      }

      if (source.thumbnail.isEmpty()) {
        logger.warn('Selected window thumbnail is empty', { windowId })
        return {
          success: false,
          error: 'Selected window could not be captured',
          errorCode: ErrorCode.SCREENSHOT_FAILED
        }
      }

      return this.writeImage(source.thumbnail.toPNG())
    } catch (error) {
      return this.handleError(error)
    }
  }

  private async captureArea(): Promise<ScreenshotCaptureResponse> {
    let selection
    try {
      selection = await this.overlay.selectArea()
    } catch (error) {
      logger.error('Area-select overlay failed', error instanceof Error ? error : undefined)
      return {
        success: false,
        error: 'Could not open the screenshot overlay',
        errorCode: ErrorCode.SCREENSHOT_OVERLAY_FAILED
      }
    }

    if (!selection) {
      logger.debug('Area selection cancelled by user')
      return { success: false, errorCode: ErrorCode.SCREENSHOT_CANCELLED }
    }

    const display = resolveDisplay(selection.displayId)
    if (!display) {
      logger.warn('Display vanished between area-select and capture', { displayId: selection.displayId })
      return {
        success: false,
        error: 'Display no longer available',
        errorCode: ErrorCode.SCREENSHOT_DISPLAY_NOT_FOUND
      }
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: this.physicalSize(display)
      })

      const source = this.matchScreenSource(sources, display)
      if (!source) {
        return {
          success: false,
          error: 'Display source not found',
          errorCode: ErrorCode.SCREENSHOT_DISPLAY_NOT_FOUND
        }
      }

      // selection.{x,y,width,height} are CSS pixels in the overlay viewport;
      // multiply by scaleFactor to land in the source thumbnail's pixel space.
      const sf = display.scaleFactor
      const rect = {
        x: Math.round(selection.x * sf),
        y: Math.round(selection.y * sf),
        width: Math.round(selection.width * sf),
        height: Math.round(selection.height * sf)
      }

      const cropped = source.thumbnail.crop(rect)
      if (cropped.isEmpty()) {
        logger.warn('Cropped area resulted in empty image', { rect })
        return {
          success: false,
          error: 'Selection produced an empty image',
          errorCode: ErrorCode.SCREENSHOT_FAILED
        }
      }

      return this.writeImage(cropped.toPNG())
    } catch (error) {
      return this.handleError(error)
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private physicalSize(display: Display): { width: number; height: number } {
    return {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  }

  /**
   * Largest physical pixel size across all attached displays. Used to cap
   * `captureWindow`'s `thumbnailSize` so a 4K×4K device doesn't request
   * 8K×8K (#164 F[28]). Post `app.whenReady` Electron's `screen.getAllDisplays`
   * is guaranteed to return at least the primary display, so a defensive
   * fallback would be unreachable (#164 round-2 F#29 — round-1 left an
   * under-capping 4096×4096 fallback that would have silently downscaled a
   * 5K monitor).
   */
  private maxPhysicalDisplaySize(): { width: number; height: number } {
    const displays = screen.getAllDisplays()
    let width = 0
    let height = 0
    for (const display of displays) {
      const physical = this.physicalSize(display)
      if (physical.width > width) width = physical.width
      if (physical.height > height) height = physical.height
    }
    return { width, height }
  }

  private matchScreenSource(
    sources: Electron.DesktopCapturerSource[],
    display: Display
  ): Electron.DesktopCapturerSource | undefined {
    const exact = sources.find((s) => s.display_id === String(display.id))
    if (exact) return exact
    if (sources.length === 1) return sources[0]
    return undefined
  }

  private async writeImage(buffer: Buffer): Promise<ScreenshotCaptureResponse> {
    if (buffer.length === 0) {
      logger.warn('desktopCapturer produced an empty PNG buffer')
      return {
        success: false,
        error: 'Capture produced an empty image',
        errorCode: ErrorCode.SCREENSHOT_FAILED
      }
    }

    const filePath = generateScreenshotPath()
    try {
      await writeFile(filePath, buffer)
      nativeImage.createFromBuffer(buffer)
      logger.info('Screenshot captured successfully', { filePath })
      return { success: true, filePath }
    } catch (error) {
      logger.error('Failed to write screenshot to disk', error instanceof Error ? error : undefined)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write screenshot',
        errorCode: ErrorCode.SCREENSHOT_FAILED
      }
    }
  }

  private handleError(error: unknown): ScreenshotCaptureResponse {
    logger.error('Screenshot capture failed', error instanceof Error ? error : undefined)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: ErrorCode.SCREENSHOT_FAILED
    }
  }
}
