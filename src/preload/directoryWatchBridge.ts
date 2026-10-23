// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload directory-watch bridge: the whole `window.api.directoryWatch`
 * surface in its own module, typed as {@link DirectoryWatchBridge} (the shared
 * contract in `directory-watch-schema.ts`).
 */
import { ipcRenderer } from 'electron'
import type { DirectoryWatchBridge } from '../shared/ipc/directory-watch-schema'
import { subscribe } from './ipcSubscribe'

export const directoryWatchBridge: DirectoryWatchBridge = {
  start: (dirPath) => ipcRenderer.invoke('directory-watch:start', dirPath),
  stop: (dirPath) => ipcRenderer.invoke('directory-watch:stop', dirPath),
  stopAll: () => ipcRenderer.invoke('directory-watch:stop-all'),
  pause: (dirPath) => ipcRenderer.invoke('directory-watch:pause', dirPath),
  resume: (dirPath) => ipcRenderer.invoke('directory-watch:resume', dirPath),
  getStats: () => ipcRenderer.invoke('directory-watch:get-stats'),
  onDirectoryChanged: (callback) => subscribe('directory-watch:changed', callback),
  onProjectDeleted: (callback) => subscribe('directory-watch:project-deleted', callback),
  onDirectoryError: (callback) => subscribe('directory-watch:error', callback)
}
