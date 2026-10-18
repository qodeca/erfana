// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Session } from 'electron'
import { isTrustedAppUrl } from '../../ipc/senderValidation'

/**
 * The only thing the app's own pages ask the browser for: the camera preview in
 * the photo-capture dialog (`useCameraCapture` requests `video`, `audio: false`).
 * Clipboard goes through the main process and screen capture through
 * `desktopCapturer`, so neither needs a page-level permission.
 */
const CAMERA_MEDIA_TYPE = 'video'

interface PermissionQuery {
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
 * Allowed: `media` for video only, from the app's own top-level page. Everything
 * else is denied, including audio-capable media requests.
 */
export function isPermissionAllowed(query: PermissionQuery): boolean {
  if (!query.isMainFrame) return false
  if (!isTrustedAppUrl(query.requestingUrl)) return false
  if (query.permission !== 'media') return false
  return query.mediaTypes.length > 0 && query.mediaTypes.every((t) => t === CAMERA_MEDIA_TYPE)
}

/**
 * Install permission handlers on the default session (the one the main window
 * uses). Without them Electron grants every permission request.
 */
export function installDefaultSessionPermissions(defaultSession: Session): void {
  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes =
      'mediaTypes' in details && details.mediaTypes ? details.mediaTypes : []
    callback(
      isPermissionAllowed({
        permission,
        requestingUrl: details.requestingUrl,
        isMainFrame: details.isMainFrame,
        mediaTypes
      })
    )
  })

  defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const mediaType = details.mediaType
    return isPermissionAllowed({
      permission,
      requestingUrl: details.requestingUrl ?? requestingOrigin,
      isMainFrame: details.isMainFrame,
      mediaTypes: mediaType ? [mediaType] : []
    })
  })
}
