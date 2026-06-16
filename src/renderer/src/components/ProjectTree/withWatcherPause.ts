// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Higher-Order Function: withWatcherPause
 *
 * Wraps file operations with directory watcher pause/resume logic
 * to prevent false-positive refresh events during internal operations.
 *
 * This utility eliminates the duplicate try-catch-finally pattern
 * that was repeated 5+ times throughout ProjectTree.tsx.
 *
 * @example
 * await withWatcherPause(projectPath, isInternalOperation, setLoading, async () => {
 *   await window.api.file.createFile(targetPath, fileName)
 *   await refreshProjectTree()
 * })
 */

import { logger } from '../../utils/logger'

export async function withWatcherPause<T>(
  projectPath: string | null,
  isInternalOperationRef: React.MutableRefObject<boolean>,
  setLoading: (loading: boolean) => void,
  operation: () => Promise<T>
): Promise<T> {
  try {
    setLoading(true)
    isInternalOperationRef.current = true

    // Pause watcher before operation
    if (projectPath) {
      await window.api.directoryWatch.pause(projectPath)
    }

    // Execute the operation
    const result = await operation()

    // Reset flag BEFORE resuming watcher to avoid race condition
    // where events fire between resume and flag reset
    isInternalOperationRef.current = false

    // Resume watcher after success
    if (projectPath) {
      await window.api.directoryWatch.resume(projectPath)
    }

    return result
  } catch (error) {
    // Resume watcher even on error
    if (projectPath) {
      try {
        await window.api.directoryWatch.resume(projectPath)
      } catch (resumeErr) {
        logger.error('Failed to resume directory watcher', resumeErr instanceof Error ? resumeErr : undefined)
      }
    }
    isInternalOperationRef.current = false

    // Re-throw the original error
    throw error
  } finally {
    setLoading(false)
  }
}
