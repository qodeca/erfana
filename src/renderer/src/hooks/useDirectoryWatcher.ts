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
 * Uses ref pattern for callbacks to prevent watcher stop/start cycling.
 * The effect only re-runs when projectPath or initialLoadComplete change,
 * not when callback references change (which happens on every render).
 *
 * @param projectPath - Current project path to watch (null if no project open)
 * @param initialLoadComplete - Flag to prevent watching before initial load
 * @param isInternalOperationRef - Ref to check if change is from internal operation
 * @param onRefresh - Callback to refresh project tree on external changes
 * @param onError - Callback when project folder is deleted or errors occur
 */

import { useEffect, useRef } from 'react'
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
  // Store callbacks in refs to avoid effect re-runs on reference changes.
  // This prevents Chokidar watcher stop/start cycling on every render.
  const onRefreshRef = useRef(onRefresh)
  const onProjectDeletedRef = useRef(onProjectDeleted)
  const onErrorRef = useRef(onError)

  // Keep refs up to date with latest callbacks
  onRefreshRef.current = onRefresh
  onProjectDeletedRef.current = onProjectDeleted
  onErrorRef.current = onError

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
        onRefreshRef.current()
      } else {
        logger.debug('[RENDERER] Directory change skipped (internal operation)')
      }
    })

    // Listen for project deletion
    const unsubscribeDeleted = window.api.directoryWatch.onProjectDeleted(() => {
      onProjectDeletedRef.current()
    })

    // Listen for errors
    const unsubscribeError = window.api.directoryWatch.onDirectoryError((data) => {
      logger.error(createDirectoryErrorMessage(), undefined, { error: data.error })
      onErrorRef.current(data.error)
    })

    // Cleanup on unmount or when project changes
    return () => {
      window.api.directoryWatch.stop(projectPath as string)
      unsubscribeChanged()
      unsubscribeDeleted()
      unsubscribeError()
    }
  }, [projectPath, initialLoadComplete, isInternalOperationRef])
}
