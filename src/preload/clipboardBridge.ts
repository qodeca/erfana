// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload clipboard bridge: the whole `window.api.clipboard` surface in its
 * own module, typed as {@link ClipboardBridge}. Backed by Electron's
 * main-process `clipboard`, never `navigator.clipboard`, so the sandbox stays on.
 *
 * @see Issue #203 - Central text-clipboard service
 */
import { ipcRenderer } from 'electron'
import { CLIPBOARD_CHANNELS } from '../shared/ipc/clipboard-channels'
import type { ClipboardBridge } from '../shared/ipc/clipboard-schema'

export const clipboardBridge: ClipboardBridge = {
  readText: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.readText),
  writeText: (text) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text)
}
