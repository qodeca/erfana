// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer file-watch gateway: the one place `window.api.fileWatch` is read.
 *
 * Renderer code calls `fileWatchGateway.<method>`, which forwards to the
 * preload bridge with the same contract ({@link FileWatchBridge}). Keeping the
 * access in one module gives the renderer a single seam to change or fake.
 */
import type { FileWatchBridge } from '../../../shared/ipc/file-watch-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): FileWatchBridge =>
  (window as unknown as { api: { fileWatch: FileWatchBridge } }).api.fileWatch

export const fileWatchGateway: FileWatchBridge = {
  start: (...args) => bridge().start(...args),
  stop: (...args) => bridge().stop(...args),
  stopAll: (...args) => bridge().stopAll(...args),
  pause: (...args) => bridge().pause(...args),
  resume: (...args) => bridge().resume(...args),
  getStats: (...args) => bridge().getStats(...args),
  onFileChanged: (...args) => bridge().onFileChanged(...args),
  onFileDeleted: (...args) => bridge().onFileDeleted(...args),
  onFileError: (...args) => bridge().onFileError(...args)
}
