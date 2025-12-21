/**
 * useDirectoryWatcher Hook
 *
 * Manages directory watching lifecycle for file system auto-refresh.
 * Extracted from ProjectTree to follow Single Responsibility Principle.
 *
 * Responsibilities:
 * - Start/stop directory watching
 * - Listen for directory change events
 * - Listen for project deletion events
 * - Listen for watcher error events
 * - Cleanup on unmount or project change
 *
 * @param projectPath - Current project path to watch (null if no project open)
 * @param initialLoadComplete - Flag to prevent watching before initial load
 * @param isInternalOperationRef - Ref to check if change is from internal operation
 * @param onRefresh - Callback to refresh project tree on external changes
 * @param onError - Callback when project folder is deleted or errors occur
 */

import { useEffect } from 'react'
import {
  shouldStartWatcher,
  shouldHandleDirectoryChange,
  createDirectoryChangeMessage,
  createWatcherErrorMessage,
  createDirectoryErrorMessage
} from './useDirectoryWatcher.logic'
import { logger } from '../utils/logger'

interface UseDirectoryWatcherOptions {
  projectPath: string | null
  initialLoadComplete: boolean
  isInternalOperationRef: React.MutableRefObject<boolean>
  onRefresh: () => void
  onProjectDeleted: () => void
  onError: (error: string) => void
}

export function useDirectoryWatcher({
  projectPath,
  initialLoadComplete,
  isInternalOperationRef,
  onRefresh,
  onProjectDeleted,
  onError
}: UseDirectoryWatcherOptions): void {
  useEffect(() => {
    // Guard: Should we start the watcher?
    if (!shouldStartWatcher(projectPath, initialLoadComplete)) {
      return
    }

    // Start watching the project directory
    window.api.directoryWatch.start(projectPath as string).catch((err) => {
      logger.error(createWatcherErrorMessage(), err instanceof Error ? err : undefined)
    })

    // Listen for directory changes
    const unsubscribeChanged = window.api.directoryWatch.onDirectoryChanged((data) => {
      // Only refresh if not during our own internal operations
      if (shouldHandleDirectoryChange(isInternalOperationRef.current)) {
        logger.info(createDirectoryChangeMessage(data.eventCount))
        onRefresh()
      }
    })

    // Listen for project deletion
    const unsubscribeDeleted = window.api.directoryWatch.onProjectDeleted(() => {
      onProjectDeleted()
    })

    // Listen for errors
    const unsubscribeError = window.api.directoryWatch.onDirectoryError((data) => {
      logger.error(createDirectoryErrorMessage(), undefined, { error: data.error })
      onError(data.error)
    })

    // Cleanup on unmount or when project changes
    return () => {
      window.api.directoryWatch.stop(projectPath as string)
      unsubscribeChanged()
      unsubscribeDeleted()
      unsubscribeError()
    }
  }, [projectPath, initialLoadComplete, isInternalOperationRef, onRefresh, onProjectDeleted, onError])
}
