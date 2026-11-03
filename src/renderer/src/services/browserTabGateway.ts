// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer built-in browser tab gateway (spec 025, § 8): the one place
 * `window.api.browserTab` is read.
 *
 * Renderer code calls `browserTabGateway.<method>`, which forwards to the
 * preload bridge with the same contract ({@link BrowserTabBridge}).
 *
 * `setBounds` carries the page's visibility, so it keeps a single owner:
 * `services/browser/browserViewBounds.ts`, whose visibility half only the
 * native-view guard (`services/preview/OverlayGuardService.ts`) drives.
 */
import type { BrowserTabBridge } from '../../../shared/ipc/browser-tab-bridge-types'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): BrowserTabBridge => (window as unknown as { api: { browserTab: BrowserTabBridge } }).api.browserTab

export const browserTabGateway: BrowserTabBridge = {
  create: (...args) => bridge().create(...args),
  close: (...args) => bridge().close(...args),
  onTabClosed: (...args) => bridge().onTabClosed(...args),
  onNewTabCommand: (...args) => bridge().onNewTabCommand(...args),
  openExternal: (...args) => bridge().openExternal(...args),
  navigate: (...args) => bridge().navigate(...args),
  openLocalFile: (...args) => bridge().openLocalFile(...args),
  history: (...args) => bridge().history(...args),
  setBounds: (...args) => bridge().setBounds(...args),
  focusPage: (...args) => bridge().focusPage(...args),
  devTools: (...args) => bridge().devTools(...args),
  onState: (...args) => bridge().onState(...args),
  onTabAdded: (...args) => bridge().onTabAdded(...args),
  answerStrip: (...args) => bridge().answerStrip(...args),
  certificate: (...args) => bridge().certificate(...args),
  showDownload: (...args) => bridge().showDownload(...args),
  onStrip: (...args) => bridge().onStrip(...args),
  onNotice: (...args) => bridge().onNotice(...args),
  onBoundsApplied: (...args) => bridge().onBoundsApplied(...args),
  focusOrigin: (...args) => bridge().focusOrigin(...args),
  toolbarFocus: (...args) => bridge().toolbarFocus(...args),
  onFocus: (...args) => bridge().onFocus(...args),
  onForwardedKey: (...args) => bridge().onForwardedKey(...args),
  onPick: (...args) => bridge().onPick(...args),
  pickMode: (...args) => bridge().pickMode(...args),
  refine: (...args) => bridge().refine(...args),
  closePick: (...args) => bridge().closePick(...args),
  pickSurface: (...args) => bridge().pickSurface(...args),
  still: (...args) => bridge().still(...args),
  writeCapture: (...args) => bridge().writeCapture(...args),
  discardCaptureFiles: (...args) => bridge().discardCaptureFiles(...args),
  targetStatus: (...args) => bridge().targetStatus(...args),
  find: (...args) => bridge().find(...args),
  stopFind: (...args) => bridge().stopFind(...args),
  onFindResult: (...args) => bridge().onFindResult(...args),
  zoom: (...args) => bridge().zoom(...args),
  widthPreset: (...args) => bridge().widthPreset(...args),
  clearData: (...args) => bridge().clearData(...args),
  forget: (...args) => bridge().forget(...args),
  suggest: (...args) => bridge().suggest(...args),
  onContextMenu: (...args) => bridge().onContextMenu(...args),
  contextAction: (...args) => bridge().contextAction(...args)
}
