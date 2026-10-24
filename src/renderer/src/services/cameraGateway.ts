// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer camera gateway: the one place `window.api.camera` is read.
 *
 * Renderer code calls `cameraGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link CameraBridge}). Keeping the access in
 * one module gives the renderer a single seam to change or fake.
 */
import type { CameraBridge } from '../../../shared/ipc/camera-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): CameraBridge => (window as unknown as { api: { camera: CameraBridge } }).api.camera

export const cameraGateway: CameraBridge = {
  save: (...args) => bridge().save(...args)
}
