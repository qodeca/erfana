// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Clipboard IPC Channel Names
 *
 * Type-safe channel name constants for the central text-clipboard service.
 * Using constants eliminates typos and enables refactoring.
 *
 * @see Issue #203 - Central text-clipboard service
 * @see docs/design/issue-203-clipboard-service.md
 */

/**
 * Clipboard request/response channels (ipcMain.handle / ipcRenderer.invoke).
 * Both channels are asynchronous (see design v2 — sync `sendSync` freezes the
 * renderer; Monaco's paste override can `await` the async read).
 */
export const CLIPBOARD_CHANNELS = {
  /** Read plain text from the OS clipboard (ipcMain.handle) → Promise<string> */
  readText: 'clipboard:readText',
  /** Write plain text to the OS clipboard (ipcMain.handle) → Promise<boolean> */
  writeText: 'clipboard:writeText'
} as const

/**
 * Union type of all clipboard channel names
 */
export type ClipboardChannel = (typeof CLIPBOARD_CHANNELS)[keyof typeof CLIPBOARD_CHANNELS]
