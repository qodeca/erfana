// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Open in default browser" IPC channel names (issue #124, part 4).
 *
 * Its own domain on purpose (design part 4 §4.1):
 *
 * - not `shell:openExternal` – Markdown links feed arbitrary addresses into
 *   that one, so its allow-list must stay web-only;
 * - not `preview:` – the project tree uses this channel too, including when
 *   HTML execution is off.
 *
 * The request carries a file path, never an address. The channel is registered
 * globally and gated by `isTrustedSender` before its payload is read.
 *
 * @see src/shared/ipc/browser-schema.ts for the payload shapes
 * @see src/main/ipc/browser-handlers.ts for the gates
 */

/** Channel names for the open-in-browser flow (SCREAMING_SNAKE keys, as the other domains). */
export const BROWSER_CHANNELS = {
  /** renderer → main, `ipcMain.handle` → `BrowserOpenFileResponse`. */
  OPEN_FILE: 'browser:openFile'
} as const

/** Union of every browser channel name. */
export type BrowserChannel = (typeof BROWSER_CHANNELS)[keyof typeof BROWSER_CHANNELS]
