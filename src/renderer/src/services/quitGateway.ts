// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer quit gateway: the one place `window.api.quit` is read.
 *
 * Renderer code calls `quitGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link QuitBridge}). Keeping the access in one
 * module gives the renderer a single seam to change or fake.
 */
import type { QuitBridge } from '../../../shared/ipc/quit-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): QuitBridge => (window as unknown as { api: { quit: QuitBridge } }).api.quit

export const quitGateway: QuitBridge = {
  onQuitRequested: (...args) => bridge().onQuitRequested(...args),
  sendQuitResponse: (...args) => bridge().sendQuitResponse(...args)
}
