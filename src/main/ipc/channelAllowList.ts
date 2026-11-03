// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which global IPC channels each kind of Erfana window may use (spec 025,
 * 025-NFR-001; solution design § 8; panel findings S7 and A16; ADR 0011
 * decision 9).
 *
 * The identity gate (`appWebContents.ts`) says WHO is sending: one of
 * Erfana's own windows. This list says WHAT that window may ask for. Without
 * it every registered window could reach every handler, so a browser popup
 * host – a window that sits next to an untrusted page – would hold the same
 * IPC surface as the main window.
 *
 * - `main` – every channel except the popup ones, which only a popup host
 *   may send (they are answered for the sending popup, never for a payload
 *   field).
 * - `screenshotOverlay` – exactly what the overlay sends on the global
 *   `ipcMain` today: `logging:log`. Its selection channels are frame-scoped
 *   (`webContents.ipc`) and never reach the registry.
 * - `browserPopup` – the `browser-tab:popup*` channels only.
 *
 * An unknown kind is refused (fail closed).
 */
import { BROWSER_TAB_POPUP_CHANNELS } from '../../shared/ipc/browser-tab-channels'
import type { AppWindowKind } from './appWebContents'

/** The popup channels' common prefix; any channel under it is popup-only. */
export const POPUP_CHANNEL_PREFIX = 'browser-tab:popup'

/** The global channels the screenshot overlay windows send (`src/preload/screenshotOverlay.ts`). */
export const SCREENSHOT_OVERLAY_CHANNELS: ReadonlySet<string> = new Set(['logging:log'])

/** The channels a browser popup host may send. */
export const BROWSER_POPUP_CHANNELS: ReadonlySet<string> = new Set(Object.values(BROWSER_TAB_POPUP_CHANNELS))

/** True when a window of `kind` may use `channel`. */
export function isChannelAllowedForKind(kind: AppWindowKind, channel: string): boolean {
  switch (kind) {
    case 'main':
      return !channel.startsWith(POPUP_CHANNEL_PREFIX)
    case 'screenshotOverlay':
      return SCREENSHOT_OVERLAY_CHANNELS.has(channel)
    case 'browserPopup':
      return BROWSER_POPUP_CHANNELS.has(channel)
    default:
      return false
  }
}
