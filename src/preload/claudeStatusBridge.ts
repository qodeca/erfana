// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload Claude-status bridge (#216): the whole `window.api.claudeStatus`
 * surface in its own module, typed as {@link ClaudeStatusBridge} (the shared
 * contract in `claude-status-schema.ts`). Channel names come from
 * `claude-status-channels.ts`.
 *
 * `register` / `unregister` / `nudge` carry a `terminalId` only: the PTY pid is
 * resolved main-side and never sent (security §10).
 */
import { ipcRenderer } from 'electron'
import { ClaudeStatusChannels, ClaudeStatusEvents } from '../shared/ipc/claude-status-channels'
import type { ClaudeStatusBridge } from '../shared/ipc/claude-status-schema'
import { subscribe } from './ipcSubscribe'

export const claudeStatusBridge: ClaudeStatusBridge = {
  register: (terminalId) => ipcRenderer.invoke(ClaudeStatusChannels.REGISTER, { terminalId }),
  unregister: (terminalId) => ipcRenderer.invoke(ClaudeStatusChannels.UNREGISTER, { terminalId }),
  nudge: (terminalId) => ipcRenderer.invoke(ClaudeStatusChannels.NUDGE, { terminalId }),
  onChanged: (callback) => subscribe(ClaudeStatusEvents.CHANGED, callback)
}
