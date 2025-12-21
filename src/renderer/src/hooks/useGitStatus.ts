/**
 * Git Status Hook
 * ================
 * Manages git status refresh with debouncing, cooldown, and window focus handling
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGitStore } from '../stores/useGitStore'
import { GIT_STATUS } from '../components/ProjectTree/constants'
import type { GitStatusCounts, GitDisplayStatus } from '../../../shared/ipc/git-schema'
import { logger } from '../utils/logger'

// Use centralized constants
const { DEBOUNCE_DELAY, COOLDOWN_DURATION } = GIT_STATUS

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
    // Subscribe to Maps to trigger re-renders when status changes
    // Without this, getFileStatus/getFolderStatus are stable refs and won't trigger updates
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fileStatuses: _fileStatuses,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    folderStatuses: _folderStatuses,
  } = useGitStore()

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isWindowVisibleRef = useRef(true)
  // Track current project to ignore stale responses from old project requests
  const currentProjectRef = useRef<string | null>(null)
  // Track if a refresh is pending (blocked by cooldown)
  const pendingRefreshRef = useRef(false)

  /**
   * Core refresh function - calls IPC and updates store
   * @param bypassCooldown - Skip cooldown check (for initial load and manual refresh)
   */
  const executeRefresh = useCallback(
    async (bypassCooldown: boolean = false) => {
      if (!projectPath || !enabled) return

      // Capture project path for this request to detect stale responses
      const requestProjectPath = projectPath
      currentProjectRef.current = projectPath

      // Cooldown check (prevent excessive refreshes)
      if (!bypassCooldown) {
        const timeSinceLastRefresh = Date.now() - lastRefreshTime
        if (timeSinceLastRefresh < COOLDOWN_DURATION) {
          const remainingCooldown = COOLDOWN_DURATION - timeSinceLastRefresh

          // Always cancel existing pending refresh - latest request wins
          if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current)
          }

          // Schedule new refresh after cooldown expires
          pendingRefreshRef.current = true
          cooldownTimerRef.current = setTimeout(() => {
            cooldownTimerRef.current = null
            pendingRefreshRef.current = false
            // Re-check if still current project before executing
            if (currentProjectRef.current === projectPath) {
              executeRefresh(true) // Bypass cooldown for scheduled refresh
            }
          }, remainingCooldown)

          return
        }
      }

      // Clear any pending refresh since we're executing now
      pendingRefreshRef.current = false
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }

      try {
        setRefreshing(true)
        const response = await window.api.git.getStatus(requestProjectPath)

        // CRITICAL: Ignore response if project changed during request
        if (currentProjectRef.current !== requestProjectPath) {
          logger.info('[useGitStatus] Ignoring stale response for: ' + requestProjectPath)
          return
        }

        setStatus(response)
      } catch (err) {
        // Only set error if still current project
        if (currentProjectRef.current !== requestProjectPath) return

        logger.error('[useGitStatus] Refresh error', err instanceof Error ? err : undefined)
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
        // Only clear refreshing if still current project
        if (currentProjectRef.current === requestProjectPath) {
          setRefreshing(false)
        }
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

    // Clear old project's status before fetching new project
    // This prevents stale data from briefly showing during the fetch
    clear()

    // Initial load - bypass cooldown
    // Note: executeRefresh is intentionally omitted from deps to prevent re-creation loop.
    // This is safe because executeRefresh's identity changes only when its deps change,
    // but we only want to trigger on projectPath/enabled changes, not on every refresh.
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
      // Clear cooldown timer on unmount
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
      pendingRefreshRef.current = false
    }
  }, [projectPath, enabled, debouncedRefresh])

  // Subscribe to .git/index changes for external git operations (git add, checkout, reset, etc.)
  useEffect(() => {
    if (!projectPath || !enabled) return

    // Start watching .git/index file
    window.api.gitIndexWatch.start(projectPath).catch(err => {
      logger.warn('[useGitStatus] Failed to start git index watcher', { error: err })
    })

    // Listen for git index changes
    const unsubscribe = window.api.gitIndexWatch.onIndexChanged((data) => {
      // Only refresh if this is still the current project
      if (data.projectPath === projectPath && isWindowVisibleRef.current) {
        logger.info('[useGitStatus] Git index changed, triggering refresh')
        debouncedRefresh()
      }
    })

    return () => {
      unsubscribe()
      // Stop watching .git/index file
      window.api.gitIndexWatch.stop().catch(err => {
        logger.warn('[useGitStatus] Failed to stop git index watcher', { error: err })
      })
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
