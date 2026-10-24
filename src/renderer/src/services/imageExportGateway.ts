// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer image-export gateway: the one place `window.api.imageExport` is read.
 *
 * Renderer code calls `imageExportGateway.run`, which forwards to the preload
 * bridge with the same contract ({@link ImageExportBridge}). Keeping the access
 * in one module gives the renderer a single seam to change or fake.
 */
import type { ImageExportBridge } from '../../../shared/ipc/image-export-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): ImageExportBridge =>
  (window as unknown as { api: { imageExport: ImageExportBridge } }).api.imageExport

export const imageExportGateway: ImageExportBridge = {
  run: (...args) => bridge().run(...args)
}
