/**
 * File Watcher Hook for Markdown Editor
 *
 * Monitors a file for external changes and deletion.
 * Handles conflict detection when local changes exist.
 *
 * @module useFileWatcher
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { logger } from '../utils/logger'

/** Duration to show reload indicator in milliseconds */
const INDICATOR_DURATION_MS = 1000

/**
 * File watcher state
 */
export interface FileWatcherState {
  /** Whether an external change was detected while file has local modifications */
  externalChangeDetected: boolean
  /** Whether the file was deleted externally */
  isFileDeleted: boolean
  /** Whether the file is currently being reloaded from disk */
  isReloading: boolean
}

/**
 * File watcher actions
 */
export interface FileWatcherActions {
  /** Reload file content from disk */
  reloadFromDisk: () => Promise<void>
  /** Keep local version and dismiss conflict notification */
  keepLocal: () => void
  /** Dismiss external change notification without action */
  dismissConflict: () => void
  /** Clear the file deleted state (e.g., after saving) */
  clearDeletedState: () => void
  /** Mark that a save operation is starting (prevents race conditions) */
  markSaving: () => void
  /** Mark that a save operation has ended */
  unmarkSaving: () => void
}

/**
 * Return type for useFileWatcher hook
 */
export type UseFileWatcherReturn = FileWatcherState & FileWatcherActions

/**
 * Configuration for useFileWatcher hook
 * @remarks Renamed from UseFileWatcherConfig for codebase consistency
 */
export interface UseFileWatcherOptions {
  /** Path of the file to watch */
  filePath: string | null
  /** Whether the file has unsaved local modifications */
  hasLocalChanges: boolean
  /** Callback when file content should be updated */
  onContentUpdate: (content: string) => void
  /** Callback when file is reloaded (for state updates) */
  onReload?: () => void
}

/**
 * @deprecated Use UseFileWatcherOptions instead
 */
export type UseFileWatcherConfig = UseFileWatcherOptions

/**
 * Hook for watching file changes and handling conflicts.
 *
 * Monitors a file for external changes (modifications and deletions).
 * When local changes exist and external change is detected, shows
 * a conflict notification. Otherwise, auto-reloads the file.
 *
 * @param options - Configuration options
 * @returns File watcher state and actions
 *
 * @example
 * ```tsx
 * function Editor({ filePath, content, setContent }) {
 *   const [isModified, setIsModified] = useState(false)
 *
 *   const {
 *     externalChangeDetected,
 *     isFileDeleted,
 *     reloadFromDisk,
 *     keepLocal,
 *     dismissConflict,
 *     markSaving,
 *     unmarkSaving
 *   } = useFileWatcher({
 *     filePath,
 *     hasLocalChanges: isModified,
 *     onContentUpdate: (newContent) => {
 *       setContent(newContent)
 *       setIsModified(false)
 *     }
 *   })
 *
 *   const handleSave = async () => {
 *     markSaving()
 *     try {
 *       await saveFile(content)
 *     } finally {
 *       unmarkSaving()
 *     }
 *   }
 *
 *   return (
 *     <div>
 *       {externalChangeDetected && (
 *         <ConflictNotification
 *           onReload={reloadFromDisk}
 *           onKeepLocal={keepLocal}
 *           onDismiss={dismissConflict}
 *         />
 *       )}
 *       {isFileDeleted && <DeletedWarning />}
 *       <textarea value={content} />
 *     </div>
 *   )
 * }
 * ```
 */
export function useFileWatcher(options: UseFileWatcherOptions): UseFileWatcherReturn {
  const { filePath, hasLocalChanges, onContentUpdate, onReload } = options

  const [externalChangeDetected, setExternalChangeDetected] = useState(false)
  const [isFileDeleted, setIsFileDeleted] = useState(false)
  const [isReloading, setIsReloading] = useState(false)

  // Track save operations to prevent race conditions
  // Exposed via markSaving/unmarkSaving so parent component can coordinate saves
  const isSavingRef = useRef(false)

  /**
   * Mark that a save operation is starting.
   * Call this before saving to prevent race conditions with file watcher.
   */
  const markSaving = useCallback(() => {
    isSavingRef.current = true
  }, [])

  /**
   * Mark that a save operation has ended.
   * Call this after saving completes (in finally block).
   */
  const unmarkSaving = useCallback(() => {
    isSavingRef.current = false
  }, [])

  /**
   * Reload file content from disk
   */
  const reloadFromDisk = useCallback(async () => {
    if (!filePath) return

    setIsReloading(true)
    try {
      const content = await window.api.file.readFile(filePath)
      onContentUpdate(content)
      setExternalChangeDetected(false)
      setIsFileDeleted(false)
      onReload?.()
      logger.info('File reloaded successfully', { filePath })

      // Show reload indicator briefly
      setTimeout(() => setIsReloading(false), INDICATOR_DURATION_MS)
    } catch (error) {
      logger.error('Error reloading file', error instanceof Error ? error : undefined)
      setIsReloading(false)
    }
  }, [filePath, onContentUpdate, onReload])

  /**
   * Keep local version and dismiss conflict notification
   */
  const keepLocal = useCallback(() => {
    logger.info('User chose to keep local version')
    setExternalChangeDetected(false)
  }, [])

  /**
   * Dismiss conflict notification without action
   */
  const dismissConflict = useCallback(() => {
    setExternalChangeDetected(false)
  }, [])

  /**
   * Clear the file deleted state
   */
  const clearDeletedState = useCallback(() => {
    setIsFileDeleted(false)
  }, [])

  /**
   * Handle external file change event
   */
  const handleExternalChange = useCallback(async () => {
    logger.info('External change detected for file', { filePath })

    // Ignore if we're currently saving (race condition prevention)
    if (isSavingRef.current) {
      logger.debug('Ignoring external change (save in progress)')
      return
    }

    // Check if file has unsaved changes
    if (!hasLocalChanges) {
      // Safe to auto-reload
      logger.info('No local changes, auto-reloading')
      await reloadFromDisk()
    } else {
      // Has unsaved changes - show conflict notification
      logger.warn('Local changes detected, showing conflict notification')
      setExternalChangeDetected(true)
    }
  }, [hasLocalChanges, reloadFromDisk, filePath])

  /**
   * Handle file deletion event
   */
  const handleFileDeleted = useCallback(() => {
    logger.warn('File deleted externally', { filePath })
    setIsFileDeleted(true)
    setExternalChangeDetected(false) // Clear conflict notification if shown
  }, [filePath])

  // Set up file watching
  useEffect(() => {
    if (!filePath) return

    logger.info('Starting watch for file', { filePath })

    // Start watching
    window.api.fileWatch.start(filePath).then((result) => {
      if (!result.success) {
        logger.error('Failed to start watching file', undefined, { error: result.error })
      }
    })

    // Set up event listeners
    const unsubscribeChanged = window.api.fileWatch.onFileChanged((data) => {
      if (data.filePath === filePath) {
        handleExternalChange()
      }
    })

    const unsubscribeDeleted = window.api.fileWatch.onFileDeleted((data) => {
      if (data.filePath === filePath) {
        handleFileDeleted()
      }
    })

    const unsubscribeError = window.api.fileWatch.onFileError((data) => {
      if (data.filePath === filePath) {
        logger.error('File watch error', undefined, { error: data.error })
      }
    })

    // Cleanup on unmount or file change
    return () => {
      logger.info('Stopping watch for file', { filePath })
      window.api.fileWatch.stop(filePath)
      unsubscribeChanged()
      unsubscribeDeleted()
      unsubscribeError()
    }
  }, [filePath, handleExternalChange, handleFileDeleted])

  return {
    // State
    externalChangeDetected,
    isFileDeleted,
    isReloading,
    // Actions
    reloadFromDisk,
    keepLocal,
    dismissConflict,
    clearDeletedState,
    markSaving,
    unmarkSaving
  }
}

/**
 * Pause/resume helpers for use during save operations
 */
export interface FileSaveGuard {
  /** Pause file watching before save */
  pauseWatch: () => Promise<void>
  /** Resume file watching after save */
  resumeWatch: () => Promise<void>
}

/**
 * Creates a save guard for pausing file watching during save operations
 *
 * @param filePath - Path of the file being saved
 * @returns Save guard functions
 *
 * @example
 * ```ts
 * const guard = createFileSaveGuard(filePath)
 *
 * async function handleSave() {
 *   await guard.pauseWatch()
 *   try {
 *     await saveFile(content)
 *   } finally {
 *     await guard.resumeWatch()
 *   }
 * }
 * ```
 */
export function createFileSaveGuard(filePath: string): FileSaveGuard {
  return {
    pauseWatch: async () => {
      await window.api.fileWatch.pause(filePath)
    },
    resumeWatch: async () => {
      await window.api.fileWatch.resume(filePath)
    }
  }
}
