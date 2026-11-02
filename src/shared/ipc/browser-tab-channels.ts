// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser IPC channel names (spec 025, solution design § 8; naming
 * contracts "IPC channel names" and "IPC channel prefix").
 *
 * Prefix `browser-tab:`. The older `browser:` domain (`browser-channels.ts`)
 * belongs to "Open in default browser" and is unrelated.
 *
 * - **Requests** (renderer → main) go through `registry.ts`, so the identity
 *   gate and the per-window-kind channel allow-list apply; `invoke` unless the
 *   comment says `send`. A tab belongs to the window that created it; main
 *   refuses a request that names another window's tab.
 * - **Popup requests** come from a popup window's own renderer (window kind
 *   `browserPopup`), which may use only these three channels. The popup is
 *   identified by its sender, never by a payload field.
 * - **Events** (main → renderer) go only to the window that owns the tab.
 *
 * Page views have no preload and reach none of these channels.
 * @see src/shared/ipc/browser-tab-schema.ts for the payload shapes
 */

/** Renderer → main requests (`invoke` unless marked `send`). */
export const BROWSER_TAB_CHANNELS = {
  create: 'browser-tab:create',
  close: 'browser-tab:close',
  navigate: 'browser-tab:navigate',
  openLocalFile: 'browser-tab:openLocalFile',
  history: 'browser-tab:history',
  /** `send`: the page area's rectangle, with the preview's seq / ack protocol. */
  bounds: 'browser-tab:bounds',
  focusPage: 'browser-tab:focusPage',
  focusOrigin: 'browser-tab:focusOrigin',
  /** `send`: whether the tab's toolbar holds keyboard focus (for `appWindowBrowserKeys`). */
  toolbarFocus: 'browser-tab:toolbarFocus',
  find: 'browser-tab:find',
  stopFind: 'browser-tab:stopFind',
  zoom: 'browser-tab:zoom',
  widthPreset: 'browser-tab:widthPreset',
  devTools: 'browser-tab:devTools',
  openExternal: 'browser-tab:openExternal',
  pickMode: 'browser-tab:pickMode',
  refine: 'browser-tab:refine',
  closePick: 'browser-tab:closePick',
  writeCapture: 'browser-tab:writeCapture',
  discardCaptureFiles: 'browser-tab:discardCaptureFiles',
  targetStatus: 'browser-tab:targetStatus',
  answerStrip: 'browser-tab:answerStrip',
  contextAction: 'browser-tab:contextAction',
  certificate: 'browser-tab:certificate',
  clearData: 'browser-tab:clearData',
  forget: 'browser-tab:forget',
  suggest: 'browser-tab:suggest'
} as const

/** Requests from a popup window's renderer: the popup's strip only (ADR 0011 decision 9). */
export const BROWSER_TAB_POPUP_CHANNELS = {
  popupStrip: 'browser-tab:popupStrip',
  popupAnswer: 'browser-tab:popupAnswer',
  popupClose: 'browser-tab:popupClose'
} as const

/** Main → renderer events, sent only to the window that owns the tab. */
export const BROWSER_TAB_EVENTS = {
  state: 'browser-tab:state',
  focus: 'browser-tab:focus',
  forwardedKey: 'browser-tab:forwardedKey',
  pick: 'browser-tab:pick',
  strip: 'browser-tab:strip',
  /** A tab the page opened, created in main under the `page` source (§ 3.4). */
  tabAdded: 'browser-tab:tabAdded',
  contextMenu: 'browser-tab:contextMenu',
  notice: 'browser-tab:notice',
  findResult: 'browser-tab:findResult'
} as const

export type BrowserTabChannel = (typeof BROWSER_TAB_CHANNELS)[keyof typeof BROWSER_TAB_CHANNELS]
export type BrowserTabPopupChannel = (typeof BROWSER_TAB_POPUP_CHANNELS)[keyof typeof BROWSER_TAB_POPUP_CHANNELS]
export type BrowserTabEvent = (typeof BROWSER_TAB_EVENTS)[keyof typeof BROWSER_TAB_EVENTS]

/** The channel prefix every name above carries. */
export const BROWSER_TAB_PREFIX = 'browser-tab:'
