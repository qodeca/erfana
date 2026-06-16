// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import { DIRECTORY_WATCHER } from '../components/ProjectTree/constants'
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

  // Debounce timer for refresh callbacks – consumer-side throttle for
  // bursts of 'directory-watch:changed' broadcasts (multi-file edits, save
  // storms, formatters). Mirrors the useGitStatus.debouncedRefresh pattern.
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Guard: Should we start the watcher?
    if (!shouldStartWatcher(projectPath, initialLoadComplete)) {
      return
    }

    // Start watching the project directory
    window.api.directoryWatch.start(projectPath as string).catch((err) => {
      logger.error(createWatcherErrorMessage(), err instanceof Error ? err : undefined)
    })

    // Listen for directory changes – debounce the refresh so a burst of
    // broadcasts (one editor save + one external tool write + one git op,
    // or N files rewritten by a formatter) collapses to a single tree
    // re-list. Without this, every broadcast triggered a recursive IPC
    // walk of the project directory.
    const unsubscribeChanged = window.api.directoryWatch.onDirectoryChanged((data) => {
      // Only refresh if not during our own internal operations
      if (!shouldHandleDirectoryChange(isInternalOperationRef.current)) {
        logger.debug('[RENDERER] Directory change skipped (internal operation)')
        return
      }
      logger.info(createDirectoryChangeMessage(data.eventCount))
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        onRefreshRef.current()
      }, DIRECTORY_WATCHER.DEBOUNCE_DELAY)
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
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [projectPath, initialLoadComplete, isInternalOperationRef])
}
