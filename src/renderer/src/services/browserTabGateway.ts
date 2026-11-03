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
  navigate: (...args) => bridge().navigate(...args),
  history: (...args) => bridge().history(...args),
  setBounds: (...args) => bridge().setBounds(...args),
  focusPage: (...args) => bridge().focusPage(...args),
  devTools: (...args) => bridge().devTools(...args),
  onState: (...args) => bridge().onState(...args),
  onTabAdded: (...args) => bridge().onTabAdded(...args),
  answerStrip: (...args) => bridge().answerStrip(...args),
  showDownload: (...args) => bridge().showDownload(...args),
  onStrip: (...args) => bridge().onStrip(...args),
  onNotice: (...args) => bridge().onNotice(...args),
  onBoundsApplied: (...args) => bridge().onBoundsApplied(...args)
}
