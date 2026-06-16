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
 * @param isInternalOperation - Whether change is from internal operation
 * @returns true if change should trigger refresh, false otherwise
 */
export function shouldHandleDirectoryChange(isInternalOperation: boolean): boolean {
  return !isInternalOperation
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
