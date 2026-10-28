// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload quit bridge: the whole `window.api.quit` surface in its own module,
 * typed as {@link QuitBridge}. Main asks before a window closes or the app
 * quits; the renderer answers with one `send`.
 */
import { ipcRenderer } from 'electron'
import type { QuitBridge } from '../shared/ipc/quit-schema'
import { subscribe } from './ipcSubscribe'

export const quitBridge: QuitBridge = {
  onQuitRequested: (callback) => subscribe('quit:requested', callback),
  sendQuitResponse: (proceed) => {
    ipcRenderer.send('quit:confirmResponse', { proceed })
  }
}
