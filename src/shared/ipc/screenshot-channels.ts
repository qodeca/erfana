// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Screenshot IPC channel constants and overlay-route helpers.
 *
 * Centralises the IPC channel names and the URL-hash routing the overlay
 * BrowserWindow uses to identify which display it covers. Co-located with
 * the project's existing channel-constant pattern (`clipboard-channels.ts`,
 * `transcription-channels.ts`, `import-channels.ts`) so future contributors
 * find them via the same convention.
 *
 * @see Issue #164 (lens-review F[32]) - removes magic strings duplicated
 * across `ScreenshotOverlayWindow.ts` and the renderer's main entry.
 */

/**
 * Hash route prefix used by the overlay BrowserWindow to tell the renderer
 * entry to mount `ScreenshotOverlay` instead of the main `App`. The
 * renderer compares `window.location.hash` against this prefix at mount
 * time. `buildOverlayHash(displayId)` produces the full hash; the prefix
 * exists for the prefix-match the renderer entry performs.
 */
export const OVERLAY_ROUTE_HASH_PREFIX = '#overlay/screenshot'

/**
 * Build the URL hash a single overlay BrowserWindow should load. The
 * `displayId` is read by the overlay component and included in the
 * `screenshot:areaSelected` payload so main knows which display to crop.
 */
export function buildOverlayHash(displayId: number): string {
  return `overlay/screenshot?displayId=${displayId}`
}

/**
 * Build the full overlay URL the main process passes to `loadURL` in dev
 * mode. In production the main process uses `loadFile` with `hash:` instead.
 */
export function buildDevOverlayUrl(baseUrl: string, displayId: number): string {
  return `${baseUrl}/#${buildOverlayHash(displayId)}`
}

/**
 * IPC channel names used by the area-select overlay flow.
 *
 * `enumerateWindows`, `getDisplays`, `capture`, and `getCapabilities` are
 * the main public channels (registered globally in `screenshot-handlers.ts`).
 *
 * `areaSelected` and `areaCancelled` are scoped to the overlay window's
 * lifetime — they're attached and detached by `AreaSelectOverlay.selectArea()`
 * via the frame-scoped `webContents.mainFrame.ipc.on` API. They're NOT
 * registered in the global handler.
 */
export const SCREENSHOT_CHANNELS = {
  CAPTURE: 'screenshot:capture',
  GET_DISPLAYS: 'screenshot:getDisplays',
  GET_CAPABILITIES: 'screenshot:getCapabilities',
  ENUMERATE_WINDOWS: 'screenshot:enumerateWindows',
  AREA_SELECTED: 'screenshot:areaSelected',
  AREA_CANCELLED: 'screenshot:areaCancelled'
} as const
