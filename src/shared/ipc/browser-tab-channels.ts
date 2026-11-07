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
  /** The held capture moved between the prompt-actions panel and the instruction dialog (commit 19). */
  pickSurface: 'browser-tab:pickSurface',
  /** The page as a still image, for a surface over the page area (ADR 0011, commit 19). */
  still: 'browser-tab:still',
  writeCapture: 'browser-tab:writeCapture',
  discardCaptureFiles: 'browser-tab:discardCaptureFiles',
  targetStatus: 'browser-tab:targetStatus',
  answerStrip: 'browser-tab:answerStrip',
  /** **Show in folder** on a finished download's notice (025-FR-020). */
  showDownload: 'browser-tab:showDownload',
  contextAction: 'browser-tab:contextAction',
  certificate: 'browser-tab:certificate',
  clearData: 'browser-tab:clearData',
  forget: 'browser-tab:forget',
  suggest: 'browser-tab:suggest',
  /** Whether a browser page wrote the clipboard's text: the terminal's paste guard (025-FR-009, S-17). */
  pageClipboard: 'browser-tab:pageClipboard'
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
  /** Main's answer to a `bounds` push that asked for an `ack`: what it did with the view (commit 16). */
  boundsApplied: 'browser-tab:boundsApplied',
  findResult: 'browser-tab:findResult',
  /** A tab main held is gone (closed by the user, the page, Forget or a teardown) – commit 18. */
  tabClosed: 'browser-tab:tabClosed',
  /** The app menu's **New browser tab** (025-FR-001), to the focused main window only – commit 18. */
  newTabCommand: 'browser-tab:newTabCommand'
} as const

/** Main → a popup's own host renderer: its committed address changed (commit 18). */
export const BROWSER_TAB_POPUP_EVENTS = {
  popupChanged: 'browser-tab:popupChanged'
} as const

export type BrowserTabChannel = (typeof BROWSER_TAB_CHANNELS)[keyof typeof BROWSER_TAB_CHANNELS]
export type BrowserTabPopupChannel = (typeof BROWSER_TAB_POPUP_CHANNELS)[keyof typeof BROWSER_TAB_POPUP_CHANNELS]
export type BrowserTabEvent = (typeof BROWSER_TAB_EVENTS)[keyof typeof BROWSER_TAB_EVENTS]

/** The channel prefix every name above carries. */
export const BROWSER_TAB_PREFIX = 'browser-tab:'
