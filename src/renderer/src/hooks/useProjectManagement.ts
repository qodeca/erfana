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

import { useEffect, useRef, useState } from 'react'
import type { IProjectTreeApi, FileNode } from '../interfaces/IProjectTreeApi'
import type { IUseProjectManagementOptions, IUseProjectManagementReturn } from '../interfaces/IProjectManagement'
import { useDialog } from '../components/Dialog'
import { showGlobalToast } from '../components/Toast/toastService'
import { TERMINAL } from '../components/ProjectTree/constants'
import {
  checkHasDirtyEditors,
  checkTerminalBusy,
  confirmProjectSwitch,
  interruptActiveTerminalIfAny,
  openProjectWithTokenGuard,
  closeProjectWithTokenGuard
} from '../components/ProjectTree/switchHelpers'

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

  // Load last project on mount
  useEffect(() => {
    let mounted = true

    const loadLastProject = async () => {
      try {
        setLoading(true)
        const lastPath = await api.file.getLastProjectPath()
        if (!mounted) return

        if (lastPath) {
          setProjectPath(lastPath)
          const fileTree = await api.file.readDirectory(lastPath)
          if (!mounted) return
          setFiles(fileTree)
          initialLoadCompleteRef.current = true
        }
      } catch (err) {
        // Silent fail as in original implementation
        console.error('Error loading last project:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadLastProject()
    return () => {
      mounted = false
    }
  }, [api.file])

  // Listen for external project changes (e.g., from menu bar, shortcuts)
  useEffect(() => {
    const unsubscribe = api.file.onProjectChanged(async (data) => {
      console.log('🌳 useProjectManagement: Project changed:', data)

      // Notify consumer to reset UI state
      try {
        options?.onProjectChanged?.(data.newPath ?? null)
      } catch (cbErr) {
        console.warn('onProjectChanged callback threw:', cbErr)
      }

      setError(null)

      if (data.newPath) {
        // New project opened externally
        setProjectPath(data.newPath)
        try {
          setLoading(true)
          const fileTree = await api.file.readDirectory(data.newPath)
          setFiles(fileTree)
          initialLoadCompleteRef.current = true
        } catch (err) {
          console.error('Error loading new project tree:', err)
          setError(err instanceof Error ? err.message : 'Failed to load project')
        } finally {
          setLoading(false)
        }
      } else {
        // Project closed externally
        setProjectPath(null)
        setFiles([])
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

      // Open project with race guard
      const openedPath = await openProjectWithTokenGuard(switchTokenRef, setProjectPath, setFiles)
      if (openedPath) {
        showGlobalToast({ type: 'success', title: 'Project Opened', message: openedPath })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open project'
      setError(message)
      console.error('Error opening project:', err)
      showGlobalToast({
        type: 'error',
        title: 'Open Project Failed',
        message: String(err instanceof Error ? err.message : err)
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

      // Close project with race guard (also clears expanded folders)
      const closed = await closeProjectWithTokenGuard(
        switchTokenRef,
        setProjectPath,
        setFiles,
        () => {} // expanded folders will be managed by ProjectTree
      )
      if (closed) {
        showGlobalToast({ type: 'info', title: 'Project Closed', message: 'Current project has been closed.' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to close project'
      setError(message)
      console.error('Error closing project:', err)
      showGlobalToast({
        type: 'error',
        title: 'Close Project Failed',
        message: String(err instanceof Error ? err.message : err)
      })
    } finally {
      setIsSwitchingProject(false)
    }
  }

  /**
   * Refresh the file tree
   *
   * Used by file operations to update the tree after making changes
   */
  const refreshFiles = async (): Promise<void> => {
    if (!projectPath) return
    try {
      const fileTree = await api.file.readDirectory(projectPath)
      setFiles(fileTree)
    } catch (err) {
      console.error('Error refreshing file tree:', err)
    }
  }

  return {
    projectPath,
    files,
    loading,
    error,
    isSwitchingProject,
    initialLoadComplete: initialLoadCompleteRef.current,
    handleOpenProject,
    handleCloseProject,
    refreshFiles
  }
}
