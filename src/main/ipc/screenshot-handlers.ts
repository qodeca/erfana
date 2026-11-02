// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { IpcMainInvokeEvent } from 'electron'
import { createScreenshotService, type IScreenshotService } from '../services/ScreenshotService'
import { SCREENSHOT_CHANNELS } from '../../shared/ipc/screenshot-channels'
import {
  EnumerateWindowsRequestSchema,
  ScreenshotCaptureRequestSchema,
  type ScreenshotCaptureResponse,
  type GetDisplaysResponse,
  type EnumerateWindowsResponse,
  type ScreenshotCapabilities,
  type ScreenRecordingPermission
} from '../../shared/ipc/screenshot-schema'
import { logger } from '../services/LoggingService'
import { registerHandle } from './registry'
import { isTrustedSender } from './senderValidation'

/**
 * Verify a public screenshot IPC came from the main renderer's top-level
 * frame (#164 round-2 F#40). Sub-frames, the per-display overlay windows,
 * and any unexpected origin are rejected.
 *
 * Delegates to the shared {@link isTrustedSender} (spec 025 commit 1): the
 * sender must be a registered Erfana window, and its URL must be the exact
 * renderer entry. The overlays are registered windows, but they load the entry
 * with a route hash, so the exact-URL rule still keeps them out of these
 * channels.
 */
function validateMainRendererSender(event: IpcMainInvokeEvent): boolean {
  return isTrustedSender(event)
}

/**
 * Register screenshot capture IPC handlers.
 *
 * Channels:
 * - `screenshot:capture` — capture screenshot with the specified mode.
 * - `screenshot:getDisplays` — get available displays for multi-monitor support.
 * - `screenshot:getCapabilities` — describe what the running platform can do
 *   (used by the renderer hook to decide whether to render the UI).
 * - `screenshot:enumerateWindows` — list capturable windows for the picker
 *   (desktopCapturer backend only; macOS returns an empty list).
 *
 * Note: the area-select overlay listens on its own dedicated frame-scoped
 * channels (`screenshot:areaSelected`, `screenshot:areaCancelled`) attached
 * per-capture by `AreaSelectOverlay.selectArea()`. They're intentionally
 * not registered here — keeping them scoped to one selection prevents stale
 * listeners from accumulating and limits the IPC blast radius
 * (#164 lens-review F[5]/F[6]).
 *
 * The service is injected so tests can pass a stub. The default production
 * service is built from `createScreenshotService()` which picks the right
 * `IScreenshotCapturer` for `process.platform` (#164 F[8]).
 */
export function registerScreenshotHandlers(
  service: IScreenshotService = createScreenshotService()
): void {
  registerHandle(SCREENSHOT_CHANNELS.GET_DISPLAYS, async (event): Promise<GetDisplaysResponse> => {
    if (!validateMainRendererSender(event)) {
      logger.warn('Rejected screenshot:getDisplays from untrusted sender', {
        url: event.senderFrame?.url
      })
      return { displays: [] }
    }
    try {
      return { displays: service.getDisplays() }
    } catch (error) {
      logger.error('Failed to get displays', error instanceof Error ? error : undefined)
      return { displays: [] }
    }
  })

  registerHandle(
    SCREENSHOT_CHANNELS.GET_CAPABILITIES,
    async (event): Promise<ScreenshotCapabilities> => {
      if (!validateMainRendererSender(event)) {
        logger.warn('Rejected screenshot:getCapabilities from untrusted sender', {
          url: event.senderFrame?.url
        })
        return { supported: false, hasNativeWindowPicker: false, areaCaptureMode: 'unsupported' }
      }
      // #164 round-2 F#32: wrap in try/catch so a capturer throw can't crash
      // the IPC handler and freeze the renderer mid-mount.
      try {
        return service.getCapabilities()
      } catch (error) {
        logger.error('getCapabilities failed', error instanceof Error ? error : undefined)
        return { supported: false, hasNativeWindowPicker: false, areaCaptureMode: 'unsupported' }
      }
    }
  )

  registerHandle(
    SCREENSHOT_CHANNELS.GET_SCREEN_PERMISSION,
    async (event): Promise<ScreenRecordingPermission> => {
      if (!validateMainRendererSender(event)) {
        logger.warn('Rejected screenshot:getScreenPermission from untrusted sender', {
          url: event.senderFrame?.url
        })
        return 'unknown'
      }
      try {
        return service.getScreenRecordingPermission()
      } catch (error) {
        logger.error(
          'getScreenRecordingPermission failed',
          error instanceof Error ? error : undefined
        )
        return 'unknown'
      }
    }
  )

  registerHandle(
    SCREENSHOT_CHANNELS.ENUMERATE_WINDOWS,
    async (event, request: unknown): Promise<EnumerateWindowsResponse> => {
      if (!validateMainRendererSender(event)) {
        logger.warn('Rejected screenshot:enumerateWindows from untrusted sender', {
          url: event.senderFrame?.url
        })
        return { sources: [], truncated: false, availability: 'unsupported' }
      }
      // `request` is optional — legacy callers passed nothing. A malformed
      // request is an error, not a no-op (#164 round-2 F#12 — pre-round-2
      // we silently fell through to defaults, masking schema regressions).
      if (request !== undefined) {
        const parsed = EnumerateWindowsRequestSchema.safeParse(request)
        if (!parsed.success) {
          logger.error(`enumerateWindows validation failed: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
          return { sources: [], truncated: false, availability: 'unsupported' }
        }
        try {
          return await service.enumerateWindows(parsed.data)
        } catch (error) {
          logger.error('Failed to enumerate windows', error instanceof Error ? error : undefined)
          return { sources: [], truncated: false, availability: 'unsupported' }
        }
      }
      try {
        return await service.enumerateWindows(undefined)
      } catch (error) {
        logger.error('Failed to enumerate windows', error instanceof Error ? error : undefined)
        return { sources: [], truncated: false, availability: 'unsupported' }
      }
    }
  )

  registerHandle(
    SCREENSHOT_CHANNELS.CAPTURE,
    async (event, request: unknown): Promise<ScreenshotCaptureResponse> => {
      if (!validateMainRendererSender(event)) {
        logger.warn('Rejected screenshot:capture from untrusted sender', {
          url: event.senderFrame?.url
        })
        return {
          success: false,
          error: 'Rejected by sender validation',
          errorCode: 'SCREENSHOT_FAILED'
        }
      }
      const parseResult = ScreenshotCaptureRequestSchema.safeParse(request)
      if (!parseResult.success) {
        logger.error('Screenshot capture validation error', parseResult.error)
        // #164 round-2 F#9: use the Zod-literal `'SCREENSHOT_FAILED'` rather
        // than `ErrorCode.SCREENSHOT_FAILED` so the response always matches
        // `ScreenshotErrorCodeSchema` even if the cross-package enum drifts.
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.issues[0]?.message,
          errorCode: 'SCREENSHOT_FAILED'
        }
      }

      try {
        return await service.capture(parseResult.data)
      } catch (error) {
        logger.error('Screenshot capture handler error', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: 'SCREENSHOT_FAILED'
        }
      }
    }
  )
}
