// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * watchNotifier - delivering one watcher event to the windows that subscribed.
 *
 * Extracted from `FileWatcherService` so the service keeps only the decisions
 * (is the service disposing, does the session token still match, is this a
 * "your watch is dead" message that must bypass that token) and not the
 * Electron plumbing underneath them. It also keeps the service under the
 * project's 500-line ceiling (issue #70).
 */
import { BrowserWindow } from 'electron'
import type { SubscriberCounter } from './SubscriberCounter'

/**
 * Send `data` on `channel` to every subscribing window that still exists.
 *
 * Destroyed windows are skipped and send failures are swallowed: this runs on
 * shutdown paths where a webContents can disappear between the lookup and the
 * send, and a watcher notification is never worth crashing the main process.
 *
 * @param onSendError - reported for genuine failures only; a send to a window
 *                      that was destroyed mid-call is expected, not an error
 */
export function sendToSubscribers(
  subscribers: SubscriberCounter,
  channel: string,
  data: Record<string, unknown>,
  onSendError: (message: string) => void
): void {
  const windows = BrowserWindow.getAllWindows()

  for (const webContentsId of subscribers.ids()) {
    const window = windows.find(w => w.webContents.id === webContentsId)
    if (!window || window.isDestroyed()) continue

    try {
      window.webContents.send(channel, data)
    } catch (error) {
      if (error instanceof Error && !error.message.includes('destroyed')) {
        onSendError(`⚠️  Error sending to webContents: ${error.message}`)
      }
    }
  }
}
