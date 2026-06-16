// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useProjectManagement Hook
 *
 * Encapsulates project lifecycle operations: loading, switching, and closing.
 *
 * Responsibilities:
 * - Load last project on mount
 * - Listen for external project changes (from other parts of the app)
 * - Handle project opening with dirty editor + terminal activity checks
 * - Handle project closing with confirmations
 * - Token-based race guards for async operations
 * - Error handling and user notifications
 *
 * Extracted from ProjectTree.tsx (lines 102-332, ~230 lines)
 * Complexity reduction: Uses switchHelpers for cleaner control flow
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IProjectTreeApi, FileNode } from '../interfaces/IProjectTreeApi'
import type { IUseProjectManagementOptions, IUseProjectManagementReturn } from '../interfaces/IProjectManagement'
import { useDialog } from '../components/Dialog'
import { showGlobalToast } from '../components/Toast/toastService'
import { TERMINAL } from '../components/ProjectTree/constants'
import { logger } from '../utils/logger'
import {
  checkHasDirtyEditors,
  checkTerminalBusy,
  confirmProjectSwitch,
  interruptActiveTerminalIfAny,
  openProjectWithTokenGuard,
  closeProjectWithTokenGuard
} from '../components/ProjectTree/switchHelpers'
import {
  shouldOpenExternalProject,
  shouldMarkInitialLoadComplete,
  shouldRefreshFiles,
  createProjectOpenedMessage,
  createProjectClosedMessage,
  createOpenErrorMessage,
  createCloseErrorMessage,
  createLoadErrorMessage,
  formatErrorForState,
  createProjectChangedLogMessage,
  createCallbackWarningMessage,
  createNewProjectTreeErrorLog,
  createRefreshErrorLog,
  createOpenProjectErrorLog,
  createCloseProjectErrorLog
} from './useProjectManagement.logic'

/**
 * Hook for managing project lifecycle
 *
 * @param options - Optional configuration and callbacks
 * @returns Project state and operations
 */
export function useProjectManagement(
  options?: IUseProjectManagementOptions
): IUseProjectManagementReturn {
  // Use provided API or default to window.api
  const api: IProjectTreeApi = (options?.api ?? (window.api as unknown as IProjectTreeApi))
  const { showConfirm } = useDialog()

  // Project state
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [files, setFiles] = useState<FileNode[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isSwitchingProject, setIsSwitchingProject] = useState<boolean>(false)
  const initialLoadCompleteRef = useRef<boolean>(false)
  const switchTokenRef = useRef<number>(0)

  // Load last project on mount - DISABLED
  // Now shows welcome screen with recent projects instead of auto-loading
  useEffect(() => {
    // Mark initial load as complete immediately (no auto-load)
    initialLoadCompleteRef.current = true
    setLoading(false)
  }, [])

  // Listen for external project changes (e.g., from menu bar, shortcuts)
  useEffect(() => {
    const unsubscribe = api.file.onProjectChanged(async (data) => {
      logger.info(createProjectChangedLogMessage(data))

      // Notify consumer to reset UI state
      try {
        options?.onProjectChanged?.(data.newPath ?? null)
      } catch (cbErr) {
        logger.warn(createCallbackWarningMessage(cbErr))
      }

      setError(null)

      if (shouldOpenExternalProject(data.newPath)) {
        // New project opened externally
        // Clear old project files immediately before loading new ones
        setProjectPath(data.newPath)
        setFiles([]) // Clear tree to show empty state during transition
        try {
          setLoading(true)
          const treeLoadStart = performance.now()
          const fileTree = await api.file.readDirectory(data.newPath!)
          const treeLoadDuration = Math.round(performance.now() - treeLoadStart)
          logger.info('[useProjectManagement] File tree loaded', { durationMs: treeLoadDuration, itemCount: fileTree.length })
          setFiles(fileTree)
          if (shouldMarkInitialLoadComplete(data.newPath, fileTree)) {
            initialLoadCompleteRef.current = true
          }
          // Show success toast after files are loaded
          showGlobalToast({
            type: 'success',
            title: 'Project Opened',
            message: createProjectOpenedMessage(data.newPath!)
          })
        } catch (err) {
          logger.error(createNewProjectTreeErrorLog(), err instanceof Error ? err : undefined)
          setError(createLoadErrorMessage(err))
          showGlobalToast({
            type: 'error',
            title: 'Failed to Load Project',
            message: createLoadErrorMessage(err)
          })
        } finally {
          setLoading(false)
        }
      } else {
        // Project closed externally
        setProjectPath(null)
        setFiles([])
        showGlobalToast({
          type: 'info',
          title: 'Project Closed',
          message: createProjectClosedMessage()
        })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [api.file, options])

  /**
   * Open a new project
   *
   * Flow:
   * 1. Check for unsaved editors and terminal activity
   * 2. Request confirmation if needed
   * 3. Interrupt terminal if busy
   * 4. Open project with race guard
   * 5. Show success toast
   */
  const handleOpenProject = async (): Promise<void> => {
    try {
      setIsSwitchingProject(true)
      setError(null)

      // Check for unsaved changes and terminal activity in parallel
      const [hasDirty, terminalBusy] = await Promise.all([
        checkHasDirtyEditors(),
        checkTerminalBusy(TERMINAL.RECENT_ACTIVITY_WINDOW)
      ])

      // Ask for confirmation if needed
      const confirmed = await confirmProjectSwitch(hasDirty, terminalBusy, 'switch', showConfirm)
      if (!confirmed) {
        return
      }

      // Gracefully interrupt terminal if it was busy
      if (terminalBusy) {
        await interruptActiveTerminalIfAny()
      }

      // Open project with race guard (files will be loaded by IPC event)
      // Success toast will be shown by IPC listener after files load
      await openProjectWithTokenGuard(switchTokenRef, setProjectPath)
    } catch (err) {
      setError(formatErrorForState(err))
      logger.error(createOpenProjectErrorLog(), err instanceof Error ? err : undefined)
      showGlobalToast({
        type: 'error',
        title: 'Open Project Failed',
        message: createOpenErrorMessage(err)
      })
    } finally {
      setIsSwitchingProject(false)
    }
  }

  /**
   * Close the current project
   *
   * Flow:
   * 1. Check for unsaved editors and terminal activity
   * 2. Request confirmation if needed
   * 3. Interrupt terminal if busy
   * 4. Close project with race guard
   * 5. Show info toast
   */
  const handleCloseProject = async (): Promise<void> => {
    try {
      setIsSwitchingProject(true)
      setError(null)

      // Check for unsaved changes and terminal activity in parallel
      const [hasDirty, terminalBusy] = await Promise.all([
        checkHasDirtyEditors(),
        checkTerminalBusy(TERMINAL.RECENT_ACTIVITY_WINDOW)
      ])

      // Ask for confirmation if needed
      const confirmed = await confirmProjectSwitch(hasDirty, terminalBusy, 'close', showConfirm)
      if (!confirmed) {
        return
      }

      // Gracefully interrupt terminal if it was busy
      if (terminalBusy) {
        await interruptActiveTerminalIfAny()
      }

      // Close project with race guard (files and UI state cleared by IPC event)
      const closed = await closeProjectWithTokenGuard(switchTokenRef, setProjectPath)
      if (closed) {
        // Success toast will be shown by IPC listener after state is cleared
        // No toast needed here to avoid duplicate
      }
    } catch (err) {
      setError(formatErrorForState(err))
      logger.error(createCloseProjectErrorLog(), err instanceof Error ? err : undefined)
      showGlobalToast({
        type: 'error',
        title: 'Close Project Failed',
        message: createCloseErrorMessage(err)
      })
    } finally {
      setIsSwitchingProject(false)
    }
  }

  /**
   * Open a project by direct path (for recent projects)
   *
   * Flow:
   * 1. Check for unsaved editors and terminal activity
   * 2. Request confirmation if needed
   * 3. Interrupt terminal if busy
   * 4. Open project directly by path (no file picker dialog)
   *
   * @param projectPath - Path to the project folder
   * @returns true if project was opened, false if cancelled by user
   */
  const handleOpenProjectByPath = async (projectPath: string): Promise<boolean> => {
    try {
      setIsSwitchingProject(true)
      setError(null)

      // Check for unsaved changes and terminal activity in parallel
      const [hasDirty, terminalBusy] = await Promise.all([
        checkHasDirtyEditors(),
        checkTerminalBusy(TERMINAL.RECENT_ACTIVITY_WINDOW)
      ])

      // Ask for confirmation if needed
      const confirmed = await confirmProjectSwitch(hasDirty, terminalBusy, 'switch', showConfirm)
      if (!confirmed) {
        return false
      }

      // Gracefully interrupt terminal if it was busy
      if (terminalBusy) {
        await interruptActiveTerminalIfAny()
      }

      // Open project directly by path (files will be loaded by IPC event)
      // Success toast will be shown by IPC listener after files load
      await api.file.openProjectByPath(projectPath)
      return true
    } catch (err) {
      setError(formatErrorForState(err))
      logger.error(createOpenProjectErrorLog(), err instanceof Error ? err : undefined)
      // Re-throw to allow caller-specific handling (e.g., stale project removal)
      throw err
    } finally {
      setIsSwitchingProject(false)
    }
  }

  /**
   * Refresh the file tree
   *
   * Used by file operations to update the tree after making changes.
   * Wrapped in useCallback to stabilize the reference and prevent
   * unnecessary re-renders of context consumers.
   */
  const refreshFiles = useCallback(async (): Promise<void> => {
    if (!shouldRefreshFiles(projectPath)) return
    try {
      const refreshStart = performance.now()
      const fileTree = await api.file.readDirectory(projectPath!)
      const refreshDuration = Math.round(performance.now() - refreshStart)
      logger.info('[useProjectManagement] File tree refreshed', { durationMs: refreshDuration, itemCount: fileTree.length })
      setFiles(fileTree)
    } catch (err) {
      logger.error(createRefreshErrorLog(), err instanceof Error ? err : undefined)
    }
  }, [projectPath, api.file])

  return {
    projectPath,
    files,
    loading,
    error,
    isSwitchingProject,
    initialLoadComplete: initialLoadCompleteRef.current,
    handleOpenProject,
    handleCloseProject,
    handleOpenProjectByPath,
    refreshFiles
  }
}
