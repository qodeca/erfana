// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * File-watch IPC channel names for the freshness capability (#478, plan § 3.3).
 *
 * Subscriptions are named by a per-subscribe `watchId`, never by path, and
 * every event carries that id. The path-counted channels this replaced
 * (plan step S16) are gone; the pause keeps the name it had beside them,
 * `file-watch:pauseWatch`.
 *
 * Payload shapes: `file-watch-schema.ts`.
 */
export const FILE_WATCH_CHANNELS = {
  /** R→M invoke, confined + sender-gated: start following a file (`SubscribeRequest` → `SubscribeReply`). */
  subscribe: 'file-watch:subscribe',
  /** R→M invoke: stop one subscription (`{ watchId }` → `IpcAck`; a foreign or unknown id is a no-op ack). */
  unsubscribe: 'file-watch:unsubscribe',
  /** R→M invoke: pause one subscription for an own save (`{ watchId }` → `IpcAck`; auto-resumes after `pauseMaxMs`). */
  pauseWatch: 'file-watch:pauseWatch',
  /** R→M invoke: resume it (`{ watchId }` → `{ success, missed }`). */
  resumeWatch: 'file-watch:resumeWatch',
  /** R→M invoke, confined + sender-gated: is the file still the version named? */
  probe: 'file-watch:probe',
  /** R→M invoke, confined + sender-gated: the classified text read. */
  readText: 'file-watch:readText',
  /** R→M invoke, confined (`access: 'change'`) + sender-gated: the checked text write. */
  writeText: 'file-watch:writeText',
  /** R→M invoke: watcher counters for diagnostics. */
  stats: 'file-watch:stats',
  /** M→owning window: an event for one subscription (`FileWatchSubscriptionEvent`). */
  event: 'file-watch:event',
  /** M→app windows: check every tracker (`{ reason: 'resume' }`). */
  check: 'file-watch:check',
} as const

/** Union of the freshness file-watch channel names. */
export type FileWatchChannel = (typeof FILE_WATCH_CHANNELS)[keyof typeof FILE_WATCH_CHANNELS]
