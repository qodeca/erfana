/**
 * Git Status Hook
 * ================
 * Manages git status refresh with debouncing, cooldown, and window focus handling
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGitStore } from '../stores/useGitStore'
import type { GitStatusCounts, GitDisplayStatus } from '../../../shared/ipc/git-schema'

// Configuration constants
const DEBOUNCE_DELAY = 1000 // 1s - wait for rapid file changes to settle
const COOLDOWN_DURATION = 2000 // 2s - prevent excessive refreshes (reduced from 5s for better UX)

interface UseGitStatusOptions {
  projectPath: string | null
  enabled?: boolean
}

interface UseGitStatusReturn {
  // Status data
  isGitRepo: boolean
  branch: string | null
  isDetached: boolean
  counts: GitStatusCounts
  truncated: boolean
  error: string | null

  // Refresh state
  isRefreshing: boolean

  // Actions
  getFileStatus: (path: string) => GitDisplayStatus | undefined
  getFolderStatus: (path: string) => GitDisplayStatus | undefined
  refresh: () => void // Manual refresh
}

/**
 * Hook to manage git status refresh for a project
 *
 * @param options.projectPath - Current project path
 * @param options.enabled - Enable git status tracking (default: true)
 * @returns Git status data and actions
 */
export function useGitStatus({
  projectPath,
  enabled = true,
}: UseGitStatusOptions): UseGitStatusReturn {
  const {
    isGitRepo,
    branch,
    isDetached,
    counts,
    truncated,
    error,
    isRefreshing,
    setStatus,
    setRefreshing,
    getFileStatus,
    getFolderStatus,
    clear,
    lastRefreshTime,
  } = useGitStore()

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isWindowVisibleRef = useRef(true)

  /**
   * Core refresh function - calls IPC and updates store
   * @param bypassCooldown - Skip cooldown check (for initial load and manual refresh)
   */
  const executeRefresh = useCallback(
    async (bypassCooldown: boolean = false) => {
      if (!projectPath || !enabled) return

      // Cooldown check (prevent excessive refreshes)
      if (!bypassCooldown) {
        const timeSinceLastRefresh = Date.now() - lastRefreshTime
        if (timeSinceLastRefresh < COOLDOWN_DURATION) {
          console.log('[useGitStatus] Skipping refresh - cooldown active')
          return
        }
      }

      try {
        setRefreshing(true)
        const response = await window.api.git.getStatus(projectPath)
        setStatus(response)
      } catch (err) {
        console.error('[useGitStatus] Refresh error:', err)
        setStatus({
          isGitRepo: false,
          branch: null,
          isDetached: false,
          files: [],
          counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
          truncated: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        setRefreshing(false)
      }
    },
    [projectPath, enabled, lastRefreshTime, setRefreshing, setStatus]
  )

  /**
   * Debounced refresh for file watcher events
   * Delays refresh by DEBOUNCE_DELAY to batch rapid changes
   */
  const debouncedRefresh = useCallback(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Set new timer
    debounceTimerRef.current = setTimeout(() => {
      executeRefresh(false) // Respect cooldown
    }, DEBOUNCE_DELAY)
  }, [executeRefresh])

  /**
   * Manual refresh - bypasses cooldown
   * Used for user-initiated refreshes (refresh button)
   */
  const manualRefresh = useCallback(() => {
    executeRefresh(true) // Bypass cooldown
  }, [executeRefresh])

  // Initial load when project changes
  useEffect(() => {
    if (!projectPath || !enabled) {
      clear()
      return
    }

    // Initial load - bypass cooldown
    // Note: executeRefresh is intentionally omitted from deps to prevent re-creation loop
    executeRefresh(true)
  }, [projectPath, enabled, clear])

  // Subscribe to directory changes for auto-refresh
  useEffect(() => {
    if (!projectPath || !enabled) return

    const unsubscribe = window.api.directoryWatch.onDirectoryChanged(() => {
      // Only refresh if window is visible
      if (isWindowVisibleRef.current) {
        debouncedRefresh()
      }
    })

    return () => {
      unsubscribe()
      // Clear debounce timer on unmount
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [projectPath, enabled, debouncedRefresh])

  // Window visibility handling - pause refreshes when window hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      isWindowVisibleRef.current = !document.hidden

      // Refresh when window becomes visible (catch up on missed changes)
      if (!document.hidden && projectPath && enabled) {
        executeRefresh(false) // Respect cooldown
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [projectPath, enabled, executeRefresh])

  return {
    // Status data
    isGitRepo,
    branch,
    isDetached,
    counts,
    truncated,
    error,

    // Refresh state
    isRefreshing,

    // Actions
    getFileStatus,
    getFolderStatus,
    refresh: manualRefresh,
  }
}
