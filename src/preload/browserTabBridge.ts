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
  close: (tabId, byUser) => ipcRenderer.invoke(C.close, byUser === undefined ? { tabId } : { tabId, byUser }),
  onTabClosed: (callback) => subscribe(BROWSER_TAB_EVENTS.tabClosed, callback),
  onNewTabCommand: (callback) => subscribe(BROWSER_TAB_EVENTS.newTabCommand, callback),
  openExternal: (tabId, url) => ipcRenderer.invoke(C.openExternal, url === undefined ? { tabId } : { tabId, url }),
  navigate: (request) => ipcRenderer.invoke(C.navigate, request),
  openLocalFile: (tabId, filePath) => ipcRenderer.invoke(C.openLocalFile, { tabId, filePath }),
  history: (tabId, step) => ipcRenderer.invoke(C.history, { tabId, step }),
  setBounds: (request) => ipcRenderer.send(C.bounds, request),
  focusPage: (tabId) => ipcRenderer.invoke(C.focusPage, { tabId }),
  devTools: (tabId, inspectAt) =>
    ipcRenderer.invoke(C.devTools, inspectAt === undefined ? { tabId } : { tabId, inspectAt }),
  onState: (callback) => subscribe(BROWSER_TAB_EVENTS.state, callback),
  onTabAdded: (callback) => subscribe(BROWSER_TAB_EVENTS.tabAdded, callback),
  answerStrip: (request) => ipcRenderer.invoke(C.answerStrip, request),
  certificate: (request) => ipcRenderer.invoke(C.certificate, request),
  showDownload: (downloadId) => ipcRenderer.invoke(C.showDownload, { downloadId }),
  onStrip: (callback) => subscribe(BROWSER_TAB_EVENTS.strip, callback),
  onNotice: (callback) => subscribe(BROWSER_TAB_EVENTS.notice, callback),
  onBoundsApplied: (callback) => subscribe(BROWSER_TAB_EVENTS.boundsApplied, callback),
  focusOrigin: (tabId, from) => ipcRenderer.invoke(C.focusOrigin, { tabId, from }),
  toolbarFocus: (tabId, focused) => ipcRenderer.send(C.toolbarFocus, { tabId, focused }),
  onFocus: (callback) => subscribe(BROWSER_TAB_EVENTS.focus, callback),
  onForwardedKey: (callback) => subscribe(BROWSER_TAB_EVENTS.forwardedKey, callback),
  onPick: (callback) => subscribe(BROWSER_TAB_EVENTS.pick, callback),
  pickMode: (tabId, on) => ipcRenderer.invoke(C.pickMode, { tabId, on }),
  refine: (request) => ipcRenderer.invoke(C.refine, request),
  closePick: (request) => ipcRenderer.invoke(C.closePick, request),
  pickSurface: (tabId, captureId, surface) => ipcRenderer.invoke(C.pickSurface, { tabId, captureId, surface }),
  still: (tabId) => ipcRenderer.invoke(C.still, { tabId }),
  writeCapture: (request) => ipcRenderer.invoke(C.writeCapture, request),
  discardCaptureFiles: (tabId, captureId) => ipcRenderer.invoke(C.discardCaptureFiles, { tabId, captureId }),
  targetStatus: (terminalId) => ipcRenderer.invoke(C.targetStatus, { terminalId }),
  find: (request) => ipcRenderer.invoke(C.find, request),
  stopFind: (tabId) => ipcRenderer.invoke(C.stopFind, { tabId }),
  onFindResult: (callback) => subscribe(BROWSER_TAB_EVENTS.findResult, callback),
  zoom: (tabId, step) => ipcRenderer.invoke(C.zoom, { tabId, step }),
  widthPreset: (tabId, preset) => ipcRenderer.invoke(C.widthPreset, { tabId, preset }),
  clearData: (categories) => ipcRenderer.invoke(C.clearData, { categories }),
  forget: () => ipcRenderer.invoke(C.forget, {}),
  suggest: (prefix) => ipcRenderer.invoke(C.suggest, { prefix }),
  onContextMenu: (callback) => subscribe(BROWSER_TAB_EVENTS.contextMenu, callback),
  contextAction: (request) => ipcRenderer.invoke(C.contextAction, request),
  pageClipboard: () => ipcRenderer.invoke(C.pageClipboard, {})
}
