// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload system bridge: the whole `window.api.system` surface in its own
 * module, typed as {@link SystemBridge}. Channel names come from
 * `system-channels.ts`; both handlers are sender-gated main-side.
 */
import { ipcRenderer } from 'electron'
import { SYSTEM_CHANNELS } from '../shared/ipc/system-channels'
import type { SystemBridge } from '../shared/ipc/system-schema'

export const systemBridge: SystemBridge = {
  openScreenRecordingSettings: () =>
    ipcRenderer.invoke(SYSTEM_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS),
  relaunchApp: () => ipcRenderer.invoke(SYSTEM_CHANNELS.RELAUNCH_APP)
}
