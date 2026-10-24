// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload camera bridge: the whole `window.api.camera` surface in its own
 * module, typed as {@link CameraBridge}. Saves webcam photos captured through
 * the MediaDevices API to the temp directory.
 *
 * @see Spec #014 - Camera photo capture specification
 */
import { ipcRenderer } from 'electron'
import type { CameraBridge } from '../shared/ipc/camera-schema'

export const cameraBridge: CameraBridge = {
  save: (request) => ipcRenderer.invoke('camera:save', request)
}
