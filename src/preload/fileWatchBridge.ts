// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload file-watch bridge: the whole `window.api.fileWatch` surface in its
 * own module, typed as {@link FileWatchBridge} (the shared contract in
 * `file-watch-schema.ts`).
 */
import { ipcRenderer } from 'electron'
import type { FileWatchBridge } from '../shared/ipc/file-watch-schema'
import { subscribe } from './ipcSubscribe'

export const fileWatchBridge: FileWatchBridge = {
  start: (filePath) => ipcRenderer.invoke('file-watch:start', filePath),
  stop: (filePath) => ipcRenderer.invoke('file-watch:stop', filePath),
  stopAll: () => ipcRenderer.invoke('file-watch:stopAll'),
  pause: (filePath) => ipcRenderer.invoke('file-watch:pause', filePath),
  resume: (filePath) => ipcRenderer.invoke('file-watch:resume', filePath),
  getStats: () => ipcRenderer.invoke('file-watch:stats'),
  onFileChanged: (callback) => subscribe('file-watch:changed', callback),
  onFileDeleted: (callback) => subscribe('file-watch:deleted', callback),
  onFileError: (callback) => subscribe('file-watch:error', callback)
}
