// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic for useDirectoryWatcher Hook
 *
 * Extracted for unit testing without React rendering.
 * All functions are pure - no side effects, deterministic outputs.
 */

/**
 * Determines if the directory watcher should be started
 *
 * @param projectPath - Current project path (null if no project)
 * @param initialLoadComplete - Whether initial load is complete
 * @returns true if watcher should start, false otherwise
 */
export function shouldStartWatcher(
  projectPath: string | null,
  initialLoadComplete: boolean
): boolean {
  if (!projectPath) return false
  if (!initialLoadComplete) return false
  return true
}

/**
 * Determines if a directory change event should be handled
 *
 * A catch-up refresh always passes: it reports external changes the watcher
 * dropped during a pause, not the internal operation's own events, and may
 * land while the next operation has already set the flag (#210).
 *
 * @param isInternalOperation - Whether change is from internal operation
 * @param isCatchUp - Whether the event is a catch-up refresh from the main process
 * @returns true if change should trigger refresh, false otherwise
 */
export function shouldHandleDirectoryChange(
  isInternalOperation: boolean,
  isCatchUp = false
): boolean {
  return isCatchUp || !isInternalOperation
}

/**
 * Determines if a directory change can have changed the project tree
 *
 * Only a batch the main process marks `structural: false` – content edits and
 * nothing else – leaves the tree as it is. A catch-up refresh always counts,
 * and so does an event without the flag, so an older sender still refreshes.
 *
 * @param data - The `directory-watch:changed` payload
 * @returns true if the tree must be re-read, false for a content-only batch
 */
export function isStructuralDirectoryChange(data: { structural?: boolean; catchUp?: boolean }): boolean {
  return data.catchUp === true || data.structural !== false
}

/**
 * How long to wait before the debounced tree refresh fires
 *
 * A trailing debounce capped by a max wait: each event restarts the delay, but
 * never past `maxWaitMs` after the first event of the burst.
 *
 * @param burstStartedAt - When the first event of the pending burst arrived
 * @param now - The current time, same clock
 * @returns Delay in ms, never negative
 */
export function getRefreshDelay(
  burstStartedAt: number,
  now: number,
  debounceMs: number,
  maxWaitMs: number
): number {
  return Math.max(0, Math.min(debounceMs, burstStartedAt + maxWaitMs - now))
}

/**
 * The max wait for the next tree refresh: at least `floorMs`, and at least
 * twice as long as the last refresh took. On a project whose tree read takes
 * seconds a 1 s cap would start the next full read as soon as the last one
 * ended, keeping disk and CPU busy without pause (the #208 concern); this keeps
 * the tree at most about two reads behind and the reader idle half the time.
 *
 * @param floorMs - The configured max wait
 * @param lastRefreshMs - How long the last refresh took (0 before the first)
 */
export function getMaxWait(floorMs: number, lastRefreshMs: number): number {
  return Math.max(floorMs, 2 * lastRefreshMs)
}

/**
 * Creates a log message for directory changes
 *
 * @param eventCount - Number of file system events
 * @returns Formatted log message
 */
export function createDirectoryChangeMessage(eventCount: number): string {
  return `📁 Directory changed, refreshing project tree... (${eventCount} events)`
}

/**
 * Creates an error message for directory watch failures
 *
 * @returns Formatted error message
 */
export function createWatcherErrorMessage(): string {
  return 'Failed to start directory watch:'
}

/**
 * Creates a directory error log message
 *
 * @returns Log message prefix
 */
export function createDirectoryErrorMessage(): string {
  return 'Directory watch error:'
}
