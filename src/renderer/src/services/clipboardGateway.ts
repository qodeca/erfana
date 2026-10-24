// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer clipboard gateway: the one place `window.api.clipboard` is read.
 *
 * It forwards to the preload bridge with the same contract
 * ({@link ClipboardBridge}). Its caller is `services/textClipboard`, the single
 * chokepoint for clipboard transport errors (retry once, then a debounced
 * toast); copy and paste through that service, not through this gateway.
 */
import type { ClipboardBridge } from '../../../shared/ipc/clipboard-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): ClipboardBridge =>
  (window as unknown as { api: { clipboard: ClipboardBridge } }).api.clipboard

export const clipboardGateway: ClipboardBridge = {
  readText: (...args) => bridge().readText(...args),
  writeText: (...args) => bridge().writeText(...args)
}
