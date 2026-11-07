// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Session, WebContents } from 'electron'
import { isTrustedAppWebContents } from '../../ipc/senderValidation'

/**
 * The only thing the app's own pages ask the browser for: the camera preview in
 * the photo-capture dialog (`useCameraCapture` requests `video`, `audio: false`).
 * Clipboard goes through the main process and screen capture through
 * `desktopCapturer`, so neither needs a page-level permission.
 */
const CAMERA_MEDIA_TYPE = 'video'

interface PermissionQuery {
  /**
   * The `webContents` asking. Must be one of Erfana's own registered windows:
   * a browser tab that loaded the renderer entry carries the same URL but not
   * the same identity (spec 025, 025-NFR-001). `null` – which Electron passes
   * for some checks, e.g. cross-origin sub-frames – is never trusted.
   */
  webContents: WebContents | null
  permission: string
  /** URL of the frame asking (full URL, not just an origin). */
  requestingUrl: string | undefined
  isMainFrame: boolean
  /** Media kinds being asked for; empty or unknown kinds are never allowed. */
  mediaTypes: readonly string[]
}

/**
 * Allow/deny decision shared by the request and check handlers.
 *
 * Allowed: `media` for video only, from the top-level page of one of the app's
 * own windows – identity and the renderer URL both required. Everything else is
 * denied, including audio-capable media requests.
 */
export function isPermissionAllowed(query: PermissionQuery): boolean {
  if (!query.isMainFrame) return false
  if (!isTrustedAppWebContents(query.webContents, query.requestingUrl)) return false
  if (query.permission !== 'media') return false
  return query.mediaTypes.length > 0 && query.mediaTypes.every((t) => t === CAMERA_MEDIA_TYPE)
}

/**
 * Install permission handlers on the default session (the one the main window
 * uses). Without them Electron grants every permission request.
 */
export function installDefaultSessionPermissions(defaultSession: Session): void {
  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes =
      'mediaTypes' in details && details.mediaTypes ? details.mediaTypes : []
    callback(
      isPermissionAllowed({
        webContents,
        permission,
        requestingUrl: details.requestingUrl,
        isMainFrame: details.isMainFrame,
        mediaTypes
      })
    )
  })

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const mediaType = details.mediaType
    return isPermissionAllowed({
      webContents,
      permission,
      requestingUrl: details.requestingUrl ?? requestingOrigin,
      isMainFrame: details.isMainFrame,
      mediaTypes: mediaType ? [mediaType] : []
    })
  })
}
