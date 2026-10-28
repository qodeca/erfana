// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer "open in default browser" gateway: the one place
 * `window.api.browser` is read.
 *
 * Renderer code calls `browserGateway.openFile`, which forwards to the preload
 * bridge with the same contract ({@link BrowserBridge}). Keeping the access in
 * one module gives the renderer a single seam to change or fake.
 */
import type { BrowserBridge } from '../../../shared/ipc/browser-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): BrowserBridge => (window as unknown as { api: { browser: BrowserBridge } }).api.browser

export const browserGateway: BrowserBridge = {
  openFile: (...args) => bridge().openFile(...args)
}
