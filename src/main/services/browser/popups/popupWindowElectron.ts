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
 * The host loads the renderer entry with the `#browser-popup` route and its
 * own minimal preload (`preload/browserPopup.js`, commit 18), which draws the
 * read-only origin strip above the page. It is sandboxed and has Erfana's dark
 * background, so the strip area never flashes white. The route is content,
 * not a trust signal: the renderer mounts the strip only when
 * `window.browserPopupApi` exists, which only that preload exposes.
 */
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, screen, WebContentsView, type WebContents } from 'electron'
import { registerAppWebContents } from '../../../ipc/appWebContents'
import { redactedLogError } from '../../../utils/redactUserInput'
import { logger } from '../../LoggingService'
import { BrowserCdpSession } from '../cdp/BrowserCdpSession'
import { electronPrintsSecurityWarnings } from '../cdp/cdpLogCollector'
import { enablePageDialogEvents } from '../dialogs/pageDialogs'
import type { PopupWindowFactory } from './BrowserPopups'
import type { PopupCdpLink, PopupContents, PopupHost, PopupPageView } from './BrowserPopupWindow'
import { POPUP_DEFAULT_CONTENT, type Size } from './windowFeatures'

/** Erfana's window background (`src/main/index.ts`), so the host never shows white. */
const POPUP_HOST_BACKGROUND = '#161312'

/**
 * The popup origin strip's height: `--space-20` (40px) in
 * `renderer/src/browserPopup/PopupStrip.css`, which must agree. The origin's
 * minimum width stays 0: the 320 px floor of `windowFeatures.ts` already fits
 * the badge word, a registrable domain and a port at `--text-sm`.
 */
export const POPUP_STRIP_HEIGHT_PX = 40
const POPUP_ORIGIN_MIN_WIDTH_PX = 0
/** The renderer route of the popup strip; `main.tsx` checks the preload, not this. */
export const POPUP_HOST_ROUTE = 'browser-popup'

/** Load the strip's renderer into a popup host: the dev server in development, else the bundled entry. */
function loadPopupHost(host: PopupHost): void {
  const window = host as unknown as BrowserWindow
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const loading =
    is.dev && devUrl
      ? window.loadURL(`${devUrl}#${POPUP_HOST_ROUTE}`)
      : window.loadFile(join(__dirname, '../renderer/index.html'), { hash: POPUP_HOST_ROUTE })
  loading.catch((error: unknown) => {
    logger.warn('Browser popup strip did not load', { error: redactedLogError(error)?.message ?? String(error) })
  })
  // The host shows only its own route: any other navigation is refused.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
}

/** Attach a popup-kind CDP session; a refused attach leaves the popup without one. */
function attachPopupCdp(contents: PopupContents): PopupCdpLink | null {
  const cdp = new BrowserCdpSession({ kind: 'popup', dropElectronSecurityWarnings: electronPrintsSecurityWarnings(!is.dev, process.env) })
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
        webPreferences: {
          preload: join(__dirname, '../preload/browserPopup.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      }) as unknown as PopupHost,
    createView: (contents) => new WebContentsView({ webContents: contents as unknown as WebContents }) as unknown as PopupPageView,
    registerHost: (host) => registerAppWebContents(host.webContents, 'browserPopup'),
    loadHost: loadPopupHost,
    attachCdp: attachPopupCdp
  }
}
