// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer logging gateway: the one place `window.api.logging` is read.
 *
 * Renderer code calls `loggingGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link LoggingBridge}). Log through
 * `utils/logger`, which also covers the screenshot-overlay window (it has no
 * `window.api`); this gateway is its transport.
 */
import type { LoggingBridge } from '../../../shared/ipc/logging-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): LoggingBridge => (window as unknown as { api: { logging: LoggingBridge } }).api.logging

export const loggingGateway: LoggingBridge = {
  log: (...args) => bridge().log(...args),
  getLevel: (...args) => bridge().getLevel(...args),
  getLogsDir: (...args) => bridge().getLogsDir(...args),
  openLogsFolder: (...args) => bridge().openLogsFolder(...args)
}
