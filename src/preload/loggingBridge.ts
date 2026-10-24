// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload logging bridge: the whole `window.api.logging` surface in its own
 * module, typed as {@link LoggingBridge}. `log` is a one-way `send`, for speed;
 * the rest are `invoke` round-trips.
 */
import { ipcRenderer } from 'electron'
import type { LoggingBridge } from '../shared/ipc/logging-schema'

export const loggingBridge: LoggingBridge = {
  log: (entry) => ipcRenderer.send('logging:log', entry),
  getLevel: () => ipcRenderer.invoke('logging:getLevel'),
  getLogsDir: () => ipcRenderer.invoke('logging:getLogsDir'),
  openLogsFolder: () => ipcRenderer.invoke('logging:openLogsFolder')
}
