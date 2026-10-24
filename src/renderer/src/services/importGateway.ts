// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer import gateway: the one place `window.api.import` is read.
 *
 * Renderer code calls `importGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link ImportBridge}). Keeping the access in
 * one module gives the renderer a single seam to change or fake.
 */
import type { ImportBridge } from '../../../shared/ipc/import-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): ImportBridge => (window as unknown as { api: { import: ImportBridge } }).api.import

export const importGateway: ImportBridge = {
  selectFile: (...args) => bridge().selectFile(...args),
  validate: (...args) => bridge().validate(...args),
  process: (...args) => bridge().process(...args),
  getSupportedExtensions: (...args) => bridge().getSupportedExtensions(...args),
  isSupported: (...args) => bridge().isSupported(...args),
  documentImport: (...args) => bridge().documentImport(...args),
  cancelDocument: (...args) => bridge().cancelDocument(...args),
  getDocumentExtensions: (...args) => bridge().getDocumentExtensions(...args),
  toolStatus: (...args) => bridge().toolStatus(...args),
  onDocumentProgress: (...args) => bridge().onDocumentProgress(...args),
  onDependenciesReady: (...args) => bridge().onDependenciesReady(...args)
}
