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
