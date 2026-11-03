// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dedicated preload for a browser popup's host window (spec 025, 025-FR-011;
 * ADR 0011 decision 9; commit 18). The host renders the popup's read-only
 * origin strip; the page itself sits in a view below it and has no preload.
 *
 * It exposes `window.browserPopupApi` and nothing else – no `window.api`. The
 * registry admits this window (kind `browserPopup`) on the three
 * `browser-tab:popup*` request channels only (`channelAllowList.ts`).
 *
 * The channel names are written out, not imported: a value import shared
 * with another preload entry becomes a shared chunk a sandboxed preload
 * cannot require (`assertSelfContainedPreloads`). `browserPopup.test.ts` pins
 * them to `browser-tab-channels.ts`.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserPopupBridge } from '../shared/ipc/browser-popup-bridge-types'

/** `BROWSER_TAB_POPUP_CHANNELS` and `BROWSER_TAB_POPUP_EVENTS`, inlined. */
export const POPUP_PRELOAD_CHANNELS = {
  popupStrip: 'browser-tab:popupStrip',
  popupClose: 'browser-tab:popupClose',
  popupChanged: 'browser-tab:popupChanged'
} as const

export const browserPopupBridge: BrowserPopupBridge = {
  strip: () => ipcRenderer.invoke(POPUP_PRELOAD_CHANNELS.popupStrip, {}),
  close: () => ipcRenderer.invoke(POPUP_PRELOAD_CHANNELS.popupClose, {}),
  onChanged: (callback) => {
    // The payload is dropped: the host only learns that it must ask again.
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on(POPUP_PRELOAD_CHANNELS.popupChanged, listener)
    return () => {
      ipcRenderer.removeListener(POPUP_PRELOAD_CHANNELS.popupChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('browserPopupApi', browserPopupBridge)
