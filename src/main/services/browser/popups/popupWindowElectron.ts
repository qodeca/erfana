// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Electron half of a browser popup window (spec 025, 025-FR-011; ADR
 * 0011 decision 9): the host `BrowserWindow`, the page view that adopts the
 * popup's `webContents`, the host's registration as an Erfana window of kind
 * `browserPopup`, the popup-kind CDP session and the work area. Kept apart
 * from `BrowserPopupWindow.ts` so the policy there is tested without
 * Electron.
 *
 * The host loads nothing yet: the popup's own renderer (origin strip, prompt
 * rows, minimal preload) arrives with the browser UI in commit 18. It is
 * sandboxed, has no preload and Erfana's dark background, so the strip area
 * (0 px until then) never flashes white.
 */
import { BrowserWindow, screen, WebContentsView, type WebContents } from 'electron'
import { registerAppWebContents } from '../../../ipc/appWebContents'
import { redactedLogError } from '../../../utils/redactUserInput'
import { logger } from '../../LoggingService'
import { BrowserCdpSession } from '../cdp/BrowserCdpSession'
import { enablePageDialogEvents } from '../dialogs/pageDialogs'
import type { PopupWindowFactory } from './BrowserPopups'
import type { PopupCdpLink, PopupContents, PopupHost, PopupPageView } from './BrowserPopupWindow'
import { POPUP_DEFAULT_CONTENT, type Size } from './windowFeatures'

/** Erfana's window background (`src/main/index.ts`), so the host never shows white. */
const POPUP_HOST_BACKGROUND = '#161312'

/** The popup strip's height and the origin's minimum width, until the popup's renderer measures them (commit 18). */
const POPUP_STRIP_HEIGHT_PX = 0
const POPUP_ORIGIN_MIN_WIDTH_PX = 0

/** Attach a popup-kind CDP session; a refused attach leaves the popup without one. */
function attachPopupCdp(contents: PopupContents): PopupCdpLink | null {
  const cdp = new BrowserCdpSession({ kind: 'popup' })
  try {
    cdp.attach(contents as unknown as WebContents)
  } catch (error) {
    logger.warn('Browser popup opened without a CDP session', { error: redactedLogError(error)?.message ?? String(error) })
    return null
  }
  cdp.hangProbe.setVisible(true)
  void enablePageDialogEvents(cdp)
  return { detach: () => cdp.detach() }
}

/** The work area of the screen `windowId` is on, or the primary screen's. */
function workAreaOf(windowId: number | null): Size {
  const window = windowId === null ? null : BrowserWindow.fromId(windowId)
  const display = window === null || window.isDestroyed() ? screen.getPrimaryDisplay() : screen.getDisplayMatching(window.getBounds())
  return { width: display.workArea.width, height: display.workArea.height }
}

/** The popup window factory; `windowIdOf` names the window of the tab that opened the popup. */
export function electronPopupWindows(windowIdOf: (tabId: string) => number | null): PopupWindowFactory {
  return {
    stripHeight: POPUP_STRIP_HEIGHT_PX,
    originMinWidth: POPUP_ORIGIN_MIN_WIDTH_PX,
    workArea: (tabId) => workAreaOf(windowIdOf(tabId)),
    createHost: ({ contentSize, title }) =>
      new BrowserWindow({
        width: contentSize.width || POPUP_DEFAULT_CONTENT.width,
        height: contentSize.height || POPUP_DEFAULT_CONTENT.height,
        useContentSize: true,
        show: false,
        title,
        backgroundColor: POPUP_HOST_BACKGROUND,
        autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
      }) as unknown as PopupHost,
    createView: (contents) => new WebContentsView({ webContents: contents as unknown as WebContents }) as unknown as PopupPageView,
    registerHost: (host) => registerAppWebContents(host.webContents, 'browserPopup'),
    attachCdp: attachPopupCdp
  }
}
