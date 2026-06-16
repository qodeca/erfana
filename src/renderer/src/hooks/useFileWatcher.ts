// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * Normalizes line endings to LF for cross-platform content comparison.
 */
function normalizeLF(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

/**
 * Determines whether a file-watch change event is an echo of our own save.
 *
 * Compares the on-disk content against a set of recently saved contents.
 * Uses a Set to handle rapid successive saves where multiple echoes may
 * be in flight simultaneously (e.g., autosave at t=0 and t=2s, echo for
 * t=0 arrives at t=2.5s after the ref was already updated for t=2s).
 *
 * @param onDiskContent - Content read from disk after watcher fired
 * @param pendingSavedContents - Set of content strings from recent saves
 * @returns true if the change is a self-save echo that should be ignored
 */
export function isEchoEvent(
  onDiskContent: string,
  pendingSavedContents: Set<string>
): boolean {
  if (pendingSavedContents.size === 0) return false
  const normalized = normalizeLF(onDiskContent)
  for (const saved of pendingSavedContents) {
    if (normalized === normalizeLF(saved)) return true
  }
  return false
}

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
  /** Notify that a save completed with the given content (for self-save echo detection) */
  notifySaveComplete: (savedContent: string) => void
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

  // Mirror hasLocalChanges as a ref to avoid stale closure issues in handleExternalChange.
  // React state updates are batched – the ref always reflects the current value.
  const hasLocalChangesRef = useRef(hasLocalChanges)
  useEffect(() => {
    hasLocalChangesRef.current = hasLocalChanges
  }, [hasLocalChanges])

  // Content strings from recent saves – used to detect self-save echo events.
  // A Set handles rapid successive saves where multiple echoes may be in flight.
  // Cleared on: reload, keepLocal, file switch (useEffect cleanup), and after echo match.
  const pendingSavedContentsRef = useRef<Set<string>>(new Set())

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
   * Reload file content from disk.
   *
   * @param prefetchedContent - If provided, uses this content instead of reading from disk.
   *   Used internally by handleExternalChange to avoid a double read.
   */
  const reloadFromDisk = useCallback(async (prefetchedContent?: string) => {
    if (!filePath) return

    setIsReloading(true)
    try {
      const content = prefetchedContent ?? await window.api.file.readFile(filePath)
      onContentUpdate(content)
      pendingSavedContentsRef.current.clear() // Disk content is now authoritative
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
    pendingSavedContentsRef.current.clear() // User accepted divergence
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
   * Notify the hook that a save completed with the given content.
   * Stores the content for self-save echo detection.
   */
  const notifySaveComplete = useCallback((savedContent: string) => {
    pendingSavedContentsRef.current.add(savedContent)
  }, [])

  /**
   * Handle external file change event.
   *
   * Uses three layers of defense against the autosave race condition (#124):
   * 1. isSavingRef – drops events while save is in progress
   * 2. Content comparison – detects self-save echoes via isEchoEvent
   * 3. hasLocalChangesRef – always-current value (no stale closure)
   *
   * Reads the file once and passes prefetched content to reloadFromDisk
   * to avoid a double-read timing gap.
   */
  const handleExternalChange = useCallback(async () => {
    logger.info('External change detected for file', { filePath })

    // Guard 1: Ignore if we're currently saving
    if (isSavingRef.current) {
      logger.debug('Ignoring external change (save in progress)')
      return
    }

    if (!filePath) return

    // Guard 2: Read file and compare with last saved content
    try {
      const diskContent = await window.api.file.readFile(filePath)

      // Self-save echo detection: disk matches a recently saved content → drop
      if (isEchoEvent(diskContent, pendingSavedContentsRef.current)) {
        logger.debug('Ignoring self-save echo (content matches a recent save)')
        // Remove the matched entry; keep others for pending echoes from rapid saves
        const normalized = normalizeLF(diskContent)
        for (const saved of pendingSavedContentsRef.current) {
          if (normalizeLF(saved) === normalized) {
            pendingSavedContentsRef.current.delete(saved)
            break
          }
        }
        return
      }

      // Genuine external change – decide based on local changes (via ref, not closure)
      if (hasLocalChangesRef.current) {
        logger.warn('Local changes detected, showing conflict notification')
        setExternalChangeDetected(true)
      } else {
        // Safe to auto-reload with prefetched content (single read)
        logger.info('No local changes, auto-reloading')
        await reloadFromDisk(diskContent)
      }
    } catch (error) {
      logger.error(
        'Error reading file for change detection',
        error instanceof Error ? error : undefined
      )
      // Fallback: decide without content comparison
      if (hasLocalChangesRef.current) {
        setExternalChangeDetected(true)
      } else {
        await reloadFromDisk()
      }
    }
  }, [filePath, reloadFromDisk])

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
      pendingSavedContentsRef.current.clear() // Clear on file switch
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
    unmarkSaving,
    notifySaveComplete
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
