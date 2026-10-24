// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer system gateway: the one place `window.api.system` is read.
 *
 * Renderer code calls `systemGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link SystemBridge}). Keeping the access in
 * one module gives the renderer a single seam to change or fake.
 */
import type { SystemBridge } from '../../../shared/ipc/system-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): SystemBridge => (window as unknown as { api: { system: SystemBridge } }).api.system

export const systemGateway: SystemBridge = {
  openScreenRecordingSettings: (...args) => bridge().openScreenRecordingSettings(...args),
  relaunchApp: (...args) => bridge().relaunchApp(...args)
}
