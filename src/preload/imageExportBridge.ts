// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload image-export bridge of the app window (#73): `window.api.imageExport`,
 * typed as {@link ImageExportBridge}. (`imageExport.ts` is the other side: the
 * preload of the hidden rasterize window.)
 *
 * Sends a path and a target; gets back a small structured result. No image
 * bytes cross this bridge in either direction – the main process reads the
 * file fresh from disk and writes or copies the output itself. Never rejects:
 * failures arrive as the `success: false` branch.
 */
import { ipcRenderer } from 'electron'
import { IMAGE_EXPORT_CHANNELS } from '../shared/ipc/image-export-channels'
import type { ImageExportBridge } from '../shared/ipc/image-export-schema'

export const imageExportBridge: ImageExportBridge = {
  run: (request) => ipcRenderer.invoke(IMAGE_EXPORT_CHANNELS.RUN, request)
}
