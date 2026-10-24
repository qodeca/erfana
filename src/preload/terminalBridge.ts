// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload terminal bridge: the whole `window.api.terminal` surface in its own
 * module, typed as {@link TerminalBridge} (the shared contract in
 * `terminal-schema.ts`). Channel names come from `terminal-channels.ts`.
 *
 * `resize`, `markClearComplete` and `ackOutput` are fire-and-forget `send`s; the rest of the
 * requests are `invoke` round-trips. Event subscriptions return the function
 * that removes the same listener.
 */
import { ipcRenderer } from 'electron'
import { TERMINAL_CHANNELS, TERMINAL_EVENTS } from '../shared/ipc/terminal-channels'
import type { TerminalBridge } from '../shared/ipc/terminal-schema'

/** Subscribe to a main-to-window event and hand back the unsubscribe function. */
function subscribe<T>(event: string, callback: (data: T) => void): () => void {
  const listener = (_event: unknown, data: T) => callback(data)
  ipcRenderer.on(event, listener)
  return () => {
    ipcRenderer.removeListener(event, listener)
  }
}

export const terminalBridge: TerminalBridge = {
  isAvailable: (terminalId) => ipcRenderer.invoke(TERMINAL_CHANNELS.isAvailable, terminalId),
  create: (config) => ipcRenderer.invoke(TERMINAL_CHANNELS.create, config),
  write: (terminalId, data) => ipcRenderer.invoke(TERMINAL_CHANNELS.write, { terminalId, data }),
  resize: (terminalId, cols, rows) => {
    ipcRenderer.send(TERMINAL_CHANNELS.resize, { terminalId, cols, rows })
  },
  kill: (terminalId) => ipcRenderer.invoke(TERMINAL_CHANNELS.kill, terminalId),
  getInfo: (terminalId) => ipcRenderer.invoke(TERMINAL_CHANNELS.getInfo, terminalId),
  list: () => ipcRenderer.invoke(TERMINAL_CHANNELS.list),
  getActivity: (terminalId) => ipcRenderer.invoke(TERMINAL_CHANNELS.getActivity, terminalId),
  onData: (callback) => subscribe(TERMINAL_EVENTS.data, callback),
  onExit: (callback) => subscribe(TERMINAL_EVENTS.exit, callback),
  onError: (callback) => subscribe(TERMINAL_EVENTS.error, callback),
  onClear: (callback) => subscribe(TERMINAL_EVENTS.clear, callback),
  markClearComplete: (terminalId) => {
    ipcRenderer.send(TERMINAL_CHANNELS.clearComplete, { terminalId })
  },
  ackOutput: (terminalId, chars) => {
    ipcRenderer.send(TERMINAL_CHANNELS.ackOutput, { terminalId, chars })
  },
  // No payload: main reads the OS state itself and gates on the sender
  getScreenReaderSupport: () => ipcRenderer.invoke(TERMINAL_CHANNELS.getScreenReaderSupport),
  onScreenReaderSupportChanged: (callback) => subscribe(TERMINAL_EVENTS.screenReaderSupportChanged, callback)
}
