// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `file-watch:*` channels: the watch on one open file, and the events main
 * sends when that file changes, is deleted or cannot be watched.
 */
import type { IpcAck } from './schema'

/** `file-watch:changed` and `file-watch:deleted` (main → window). */
export interface FileWatchEvent {
  filePath: string
}

/** `file-watch:error` (main → window). */
export interface FileWatchErrorEvent {
  filePath: string
  error: string
}

/** `file-watch:stats` and `directory-watch:get-stats`: watcher counters for diagnostics. */
export interface WatchStatsResponse {
  success: boolean
  stats?: unknown
  error?: string
}

/**
 * Shared contract for the preload `fileWatch` bridge.
 *
 * Implemented by `window.api.fileWatch` (preload, `fileWatchBridge.ts`) and
 * consumed by the renderer file-watch gateway. The event subscriptions return
 * their unsubscribe function.
 */
export interface FileWatchBridge {
  /** Not idempotent: main counts every start, so pair each with one stop (see `hooks/fileWatchSlot.ts`). */
  start(filePath: string): Promise<IpcAck>
  stop(filePath: string): Promise<IpcAck>
  stopAll(): Promise<IpcAck>
  /** Hold the watch while the app writes the file itself, so its own write is not reported. */
  pause(filePath: string): Promise<IpcAck>
  resume(filePath: string): Promise<IpcAck>
  getStats(): Promise<WatchStatsResponse>
  onFileChanged(callback: (data: FileWatchEvent) => void): () => void
  onFileDeleted(callback: (data: FileWatchEvent) => void): () => void
  onFileError(callback: (data: FileWatchErrorEvent) => void): () => void
}
