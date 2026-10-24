// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer directory-watch gateway: the one place `window.api.directoryWatch`
 * is read.
 *
 * Renderer code calls `directoryWatchGateway.<method>`, which forwards to the
 * preload bridge with the same contract ({@link DirectoryWatchBridge}). Keeping
 * the access in one module gives the renderer a single seam to change or fake.
 */
import type { DirectoryWatchBridge } from '../../../shared/ipc/directory-watch-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): DirectoryWatchBridge =>
  (window as unknown as { api: { directoryWatch: DirectoryWatchBridge } }).api.directoryWatch

export const directoryWatchGateway: DirectoryWatchBridge = {
  start: (...args) => bridge().start(...args),
  stop: (...args) => bridge().stop(...args),
  stopAll: (...args) => bridge().stopAll(...args),
  pause: (...args) => bridge().pause(...args),
  resume: (...args) => bridge().resume(...args),
  getStats: (...args) => bridge().getStats(...args),
  onDirectoryChanged: (...args) => bridge().onDirectoryChanged(...args),
  onProjectDeleted: (...args) => bridge().onProjectDeleted(...args),
  onDirectoryError: (...args) => bridge().onDirectoryError(...args)
}
