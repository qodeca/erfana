// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload bridge for the built-in browser's tabs (spec 025, § 8, commit 7):
 * the whole `window.api.browserTab` surface, typed as {@link BrowserTabBridge}.
 * Channel names come from `browser-tab-channels.ts`; main validates every
 * payload. The page views themselves have no preload and never see this.
 */
import { ipcRenderer } from 'electron'
import { BROWSER_TAB_CHANNELS, BROWSER_TAB_EVENTS } from '../shared/ipc/browser-tab-channels'
import type { BrowserTabBridge } from '../shared/ipc/browser-tab-bridge-types'
import { subscribe } from './ipcSubscribe'

const C = BROWSER_TAB_CHANNELS

export const browserTabBridge: BrowserTabBridge = {
  create: (panelId) => ipcRenderer.invoke(C.create, { panelId }),
  close: (tabId) => ipcRenderer.invoke(C.close, { tabId }),
  navigate: (request) => ipcRenderer.invoke(C.navigate, request),
  history: (tabId, step) => ipcRenderer.invoke(C.history, { tabId, step }),
  setBounds: (request) => ipcRenderer.send(C.bounds, request),
  focusPage: (tabId) => ipcRenderer.invoke(C.focusPage, { tabId }),
  devTools: (tabId, inspectAt) =>
    ipcRenderer.invoke(C.devTools, inspectAt === undefined ? { tabId } : { tabId, inspectAt }),
  onState: (callback) => subscribe(BROWSER_TAB_EVENTS.state, callback),
  onTabAdded: (callback) => subscribe(BROWSER_TAB_EVENTS.tabAdded, callback)
}
