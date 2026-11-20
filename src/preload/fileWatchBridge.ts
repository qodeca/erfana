// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload file-watch bridge: the whole `window.api.fileWatch` surface in its
 * own module, typed as {@link FileWatchBridge} (the shared contract in
 * `file-watch-schema.ts`, channel names in `file-watch-channels.ts`).
 */
import { ipcRenderer } from 'electron'
import { FILE_WATCH_CHANNELS } from '../shared/ipc/file-watch-channels'
import type { FileWatchBridge } from '../shared/ipc/file-watch-schema'
import { subscribe } from './ipcSubscribe'

export const fileWatchBridge: FileWatchBridge = {
  subscribe: (request) => ipcRenderer.invoke(FILE_WATCH_CHANNELS.subscribe, request),
  unsubscribe: (request) => ipcRenderer.invoke(FILE_WATCH_CHANNELS.unsubscribe, request),
  pauseWatch: (request) => ipcRenderer.invoke(FILE_WATCH_CHANNELS.pauseWatch, request),
  resumeWatch: (request) => ipcRenderer.invoke(FILE_WATCH_CHANNELS.resumeWatch, request),
  probe: (request) => ipcRenderer.invoke(FILE_WATCH_CHANNELS.probe, request),
  readText: (request) => ipcRenderer.invoke(FILE_WATCH_CHANNELS.readText, request),
  writeText: (request) => ipcRenderer.invoke(FILE_WATCH_CHANNELS.writeText, request),
  getStats: () => ipcRenderer.invoke(FILE_WATCH_CHANNELS.stats),
  onEvent: (callback) => subscribe(FILE_WATCH_CHANNELS.event, callback),
  onCheck: (callback) => subscribe(FILE_WATCH_CHANNELS.check, callback)
}
