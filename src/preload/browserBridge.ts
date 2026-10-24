// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload "open in default browser" bridge (#124): `window.api.browser`, typed
 * as {@link BrowserBridge}. Sends a file path, never an address: main confines
 * it to the open project and launches the real path. Never rejects.
 */
import { ipcRenderer } from 'electron'
import { BROWSER_CHANNELS } from '../shared/ipc/browser-channels'
import type { BrowserBridge } from '../shared/ipc/browser-schema'

export const browserBridge: BrowserBridge = {
  openFile: (filePath) => ipcRenderer.invoke(BROWSER_CHANNELS.OPEN_FILE, { filePath })
}
