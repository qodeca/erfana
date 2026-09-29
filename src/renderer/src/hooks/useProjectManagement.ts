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
 * - Single-flight tree refresh with stale-result dropping (#208)
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
  createCoalescingRunner,
  type CoalescedRunInfo,
  type CoalescingRunner
} from '../../../shared/coalescingRunner'
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
  createCloseProjectErrorLog,
  isTreeReadCurrent,
  type TreeReadTicket
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

  // Tree-read guards (#208). Separate from switchTokenRef on purpose: that
  // token moves before the picker/confirm dialogs, and externally-initiated
  // changes (menu, shortcuts) never touch it.
  // Authoritative project for refresh reads; written only via beginRefreshScope.
  const projectPathRef = useRef<string | null>(null)
  // Refresh scope; bumped on every project open/switch/close.
  const refreshGenerationRef = useRef<number>(0)
  // Monotonic sequence handed to every tree read (listener and refresh) as it starts.
  const readSeqRef = useRef<number>(0)
  // Sequence of the last tree actually applied with setFiles.
  const appliedSeqRef = useRef<number>(0)
  // Single-flight runner for the current scope; replaced by beginRefreshScope.
  const refreshRunnerRef = useRef<CoalescingRunner<void> | null>(null)
  // Scope of the listener load still in flight, or null when there is none.
  const pendingLoadGenerationRef = useRef<number | null>(null)

  /** Open a new refresh scope: later results from older scopes are dropped. */
  const beginRefreshScope = (path: string | null): CoalescingRunner<void> => {
    refreshGenerationRef.current++
    projectPathRef.current = path
    const runner = createCoalescingRunner<void>()
    refreshRunnerRef.current = runner
    return runner
  }

  /**
   * The project-path setter handed to the open/close helpers: keeps the
   * authoritative ref in step with the state even if the project-changed event
   * never arrives. Opens a scope only on a real change, so it never
   * invalidates a load the listener already started for the same path.
   *
   * If the new scope supersedes a listener load still in flight, that load
   * had cleared the tree and will no longer show its result or clear the
   * spinner, and main may send no project-changed event at all (the same
   * project re-opened through a different path string is a no-op there). So
   * the tree is read once more through the new scope's runner. Only then:
   * on the normal open path the listener's own load is the only read.
   */
  const setProjectPathAndScope = (path: string | null): void => {
    if (projectPathRef.current !== path) {
      const supersedesPendingLoad = pendingLoadGenerationRef.current === refreshGenerationRef.current
      const runner = beginRefreshScope(path)
      if (path !== null && supersedesPendingLoad) {
        reloadSupersededTree(runner)
      } else {
        setLoading(false)
      }
    }
    setProjectPath(path)
  }

  /**
   * Replace a superseded listener load with one read in the current scope.
   * The spinner stays on until that read settles. Fire-and-forget: both
   * outcomes are handled, so no rejection can go unhandled.
   *
   * A failure here only logs (in runRefreshRead) – no error state, no toast –
   * on purpose: this path is rare, and the next watcher-driven or manual
   * refresh recovers the tree.
   */
  const reloadSupersededTree = (runner: CoalescingRunner<void>): void => {
    const generation = refreshGenerationRef.current
    const endSpinner = (): void => {
      if (generation === refreshGenerationRef.current) setLoading(false)
    }
    runner.run((info) => runRefreshRead(generation, info)).then(endSpinner, endSpinner)
  }

  const takeReadTicket = (generation: number): TreeReadTicket => ({
    generation,
    seq: ++readSeqRef.current
  })

  /** Show `tree` only if its read is current (never go backwards). */
  const applyTreeIfCurrent = (ticket: TreeReadTicket, tree: FileNode[]): boolean => {
    if (!isTreeReadCurrent(ticket, refreshGenerationRef.current, appliedSeqRef.current)) return false
    appliedSeqRef.current = ticket.seq
    setFiles(tree)
    return true
  }

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
        const newPath = data.newPath!
        // New scope first, before any state update or await: every older
        // read (listener or refresh) is from now on dropped when it lands.
        beginRefreshScope(newPath)
        const generation = refreshGenerationRef.current
        // New project opened externally
        // Clear old project files immediately before loading new ones
        setProjectPath(newPath)
        setFiles([]) // Clear tree to show empty state during transition
        const ticket = takeReadTicket(generation)
        pendingLoadGenerationRef.current = generation
        try {
          setLoading(true)
          const treeLoadStart = performance.now()
          const fileTree = await api.file.readDirectory(newPath)
          const treeLoadDuration = Math.round(performance.now() - treeLoadStart)
          if (generation !== refreshGenerationRef.current) {
            // A newer switch or close superseded this load: no tree, no toast.
            logger.info('[useProjectManagement] Stale project load dropped', { durationMs: treeLoadDuration, itemCount: fileTree.length })
            return
          }
          const applied = applyTreeIfCurrent(ticket, fileTree)
          logger.info('[useProjectManagement] File tree loaded', { durationMs: treeLoadDuration, itemCount: fileTree.length, applied })
          if (shouldMarkInitialLoadComplete(newPath, fileTree)) {
            initialLoadCompleteRef.current = true
          }
          // Show success toast after files are loaded
          showGlobalToast({
            type: 'success',
            title: 'Project Opened',
            message: createProjectOpenedMessage(newPath)
          })
        } catch (err) {
          if (generation !== refreshGenerationRef.current) {
            logger.debug('[useProjectManagement] Stale project load failed; ignored')
            return
          }
          logger.error(createNewProjectTreeErrorLog(), err instanceof Error ? err : undefined)
          setError(createLoadErrorMessage(err))
          showGlobalToast({
            type: 'error',
            title: 'Failed to Load Project',
            message: createLoadErrorMessage(err)
          })
        } finally {
          if (pendingLoadGenerationRef.current === generation) pendingLoadGenerationRef.current = null
          // A newer open owns the spinner once this load is superseded.
          if (generation === refreshGenerationRef.current) setLoading(false)
        }
      } else {
        // Project closed externally
        beginRefreshScope(null)
        setProjectPath(null)
        setFiles([])
        // Clears a spinner left by an open-load this close superseded.
        setLoading(false)
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
      await openProjectWithTokenGuard(switchTokenRef, setProjectPathAndScope)
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
      const closed = await closeProjectWithTokenGuard(switchTokenRef, setProjectPathAndScope)
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
   * One refresh read – the task the scope's runner executes (#208).
   *
   * Skips without IPC if the project changed or closed before the read could
   * start. The result is shown only if it is still current; `applied: false`
   * on the log line records a dropped stale result.
   */
  const runRefreshRead = async (generation: number, info: CoalescedRunInfo): Promise<void> => {
    if (generation !== refreshGenerationRef.current) {
      logger.debug('[useProjectManagement] File tree refresh skipped – project changed')
      return
    }
    const path = projectPathRef.current
    if (path === null || !shouldRefreshFiles(path)) return
    try {
      const ticket = takeReadTicket(generation)
      const refreshStart = performance.now()
      const fileTree = await api.file.readDirectory(path)
      const refreshDuration = Math.round(performance.now() - refreshStart)
      const applied = applyTreeIfCurrent(ticket, fileTree)
      logger.info('[useProjectManagement] File tree refreshed', {
        durationMs: refreshDuration,
        itemCount: fileTree.length,
        followUp: info.followUp,
        callers: info.callers,
        applied
      })
    } catch (err) {
      if (generation === refreshGenerationRef.current) {
        logger.error(createRefreshErrorLog(), err instanceof Error ? err : undefined)
      } else {
        logger.debug('[useProjectManagement] File tree refresh failed for a project no longer open')
      }
    }
  }

  /**
   * Refresh the file tree
   *
   * Used by file operations to update the tree after making changes.
   * Wrapped in useCallback to stabilize the reference and prevent
   * unnecessary re-renders of context consumers.
   *
   * Single-flight per project scope (#208): calls made while a read runs
   * share one follow-up read that starts after it, so a burst of watcher
   * events or file operations never stacks full-tree reads. Never rejects.
   */
  const refreshFiles = useCallback(async (): Promise<void> => {
    try {
      // projectPathRef is authoritative; the closure value only detects a
      // caller that belongs to a project that is no longer open.
      if (projectPath !== projectPathRef.current) {
        logger.debug('[useProjectManagement] File tree refresh skipped – stale caller')
        return
      }
      if (!shouldRefreshFiles(projectPathRef.current)) return
      const generation = refreshGenerationRef.current
      // Defensive: a non-null project path is only ever set by beginRefreshScope,
      // which installs a runner, so this fallback does not run today.
      const runner = (refreshRunnerRef.current ??= createCoalescingRunner<void>())
      await runner.run((info) => runRefreshRead(generation, info))
    } catch {
      // Contract backstop: refreshFiles never rejects, whatever the task did
      // (a throwing logger or setter included). Errors are logged in the task.
    }
    // runRefreshRead reads only refs, stable setters and api.file.
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
