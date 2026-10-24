// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The event subscription every preload bridge hands the renderer.
 *
 * The listener drops the `IpcRendererEvent`, so the page sees only the payload.
 * The unsubscribe removes that same listener and is braced so it returns
 * nothing: `removeListener` returns `ipcRenderer` itself, which must never reach
 * the page.
 */
import { ipcRenderer } from 'electron'

/** Subscribe to a main-to-window event and hand back the unsubscribe function. */
export function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: unknown, data: T): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}
