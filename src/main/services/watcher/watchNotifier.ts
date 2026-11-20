// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * watchNotifier - delivering one watch event to each subscription it is for.
 *
 * Extracted from `FileWatcherService` so the service keeps only the decisions
 * (which subscriptions hear an event) and not the plumbing underneath:
 *
 * - a window subscription gets `file-watch:event` with its `watchId`, never a
 *   path (#478, plan decision 6);
 * - an in-process owner gets its callback (decision 8).
 */
import { BrowserWindow } from 'electron'
import { FILE_WATCH_CHANNELS } from '../../../shared/ipc/file-watch-channels'
import type { WatchEvent } from '../../../shared/freshness/freshnessTypes'
import type { EntryEvent, WatchSubscription } from './watchTypes'

/**
 * Deliver `event` to every subscription in `subs`.
 *
 * Destroyed windows are skipped and send failures are swallowed: this runs on
 * shutdown paths where a webContents can disappear between the lookup and the
 * send, and a watcher notification is never worth crashing the main process.
 * An in-process owner whose callback throws is reported the same way.
 *
 * @param onSendError - reported for genuine failures only; a send to a window
 *                      that was destroyed mid-call is expected, not an error
 */
export function deliverEvent(
  subs: Iterable<WatchSubscription>,
  event: EntryEvent,
  onSendError: (message: string) => void
): void {
  const windows = BrowserWindow.getAllWindows()

  for (const sub of subs) {
    const { owner } = sub
    if (owner.kind === 'process') {
      try {
        owner.onEvent(withId(sub.watchId, event))
      } catch (error) {
        onSendError(`⚠️  Watch owner callback failed: ${error instanceof Error ? error.name : 'unknown'}`)
      }
      continue
    }
    sendTo(windows, owner.webContentsId, FILE_WATCH_CHANNELS.event, withId(sub.watchId, event), onSendError)
  }
}

/** Send `data` to every app window (the `file-watch:check` broadcast, decision 22). */
export function broadcastToWindows(channel: string, data: unknown, onSendError: (message: string) => void): void {
  for (const window of BrowserWindow.getAllWindows()) {
    sendTo([window], window.webContents.id, channel, data, onSendError)
  }
}

function withId(watchId: string, event: EntryEvent): WatchEvent {
  if (event.kind === 'ended') return { watchId, kind: 'ended', reason: event.reason }
  return { watchId, ...event }
}

function sendTo(
  windows: readonly BrowserWindow[],
  webContentsId: number,
  channel: string,
  data: unknown,
  onSendError: (message: string) => void
): void {
  const window = windows.find(w => w.webContents.id === webContentsId)
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send(channel, data)
  } catch (error) {
    if (error instanceof Error && !error.message.includes('destroyed')) {
      onSendError(`⚠️  Error sending to webContents: ${error.message}`)
    }
  }
}
