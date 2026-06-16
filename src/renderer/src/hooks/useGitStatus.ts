// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Status Hook
 * ================
 * Manages git status refresh with debouncing, cooldown, and window focus handling.
 *
 * Uses unified git watcher API (gitWatcher) for real-time monitoring of:
 * - .git/index (staging area changes)
 * - .git/HEAD (branch switches, commits)
 * - .git/refs/ (branches, tags, remote updates)
 * - .git/refs/stash (stash operations)
 *
 * Also subscribes to git polling as a fallback for missed file watcher events.
 *
 * @see Issue #74 - real-time git status refresh
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGitStore } from '../stores/useGitStore'
import { useGlobalSettingsStore } from '../stores/useGlobalSettingsStore'
import { GIT_STATUS } from '../components/ProjectTree/constants'
import type { GitStatusCounts, GitDisplayStatus } from '../../../shared/ipc/git-schema'
import type { GitStateChangeEvent, GitPollTriggeredEvent } from '../../../shared/ipc/git-watcher-schema'
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
    // Note: lastRefreshTime accessed via getState() in executeRefresh (Issue #74 review fix)
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
  // Stable ref for executeRefresh to avoid stale closure issues (Issue #74 review fix)
  const executeRefreshRef = useRef<(bypassCooldown?: boolean) => Promise<void>>()
  // Track previous polling settings to detect changes (Issue #74 review fix)
  const prevPollingSettingsRef = useRef<{ enabled?: boolean; interval?: number }>({})

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
      // Use getState() to avoid stale closure capturing lastRefreshTime (Issue #74 review fix)
      if (!bypassCooldown) {
        const currentLastRefresh = useGitStore.getState().lastRefreshTime
        const timeSinceLastRefresh = Date.now() - currentLastRefresh
        if (timeSinceLastRefresh < COOLDOWN_DURATION) {
          const remainingCooldown = COOLDOWN_DURATION - timeSinceLastRefresh

          // Cooldown block log (promoted to info – low volume, high diagnostic value)
          logger.info('[useGitStatus] Cooldown blocked refresh', {
            remainingMs: remainingCooldown,
            timeSinceLastRefresh
          })

          // Always cancel existing pending refresh - latest request wins
          if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current)
          }

          // Schedule new refresh after cooldown expires
          // Use ref to avoid stale closure (Issue #74 review fix)
          pendingRefreshRef.current = true
          cooldownTimerRef.current = setTimeout(() => {
            cooldownTimerRef.current = null
            pendingRefreshRef.current = false
            // Re-check if still current project before executing
            if (currentProjectRef.current === projectPath) {
              executeRefreshRef.current?.(true) // Bypass cooldown for scheduled refresh
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
        const startTime = performance.now() // Timing (ADR-Spec003-002)
        const response = await window.api.git.getStatus(requestProjectPath)

        // CRITICAL: Ignore response if project changed during request
        if (currentProjectRef.current !== requestProjectPath) {
          logger.info('[useGitStatus] Ignoring stale response', { requestProjectPath })
          return
        }

        // Debug log with timing (ADR-Spec003-002)
        logger.debug('[useGitStatus] Refresh completed', {
          projectPath: requestProjectPath,
          isGitRepo: response.isGitRepo,
          latencyMs: Math.round(performance.now() - startTime),
          fileCount: response.files?.length ?? 0
        })

        setStatus(response)

        // Store update confirmation (moved from useGitStore to preserve store purity)
        logger.debug('[useGitStatus] Store updated', {
          branch: response.branch,
          fileCount: response.files?.length ?? 0,
          truncated: response.truncated
        })
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
    // Note: lastRefreshTime removed - now using getState() inside callback (Issue #74 review fix)
    [projectPath, enabled, setRefreshing, setStatus]
  )

  // Keep ref updated with latest executeRefresh (Issue #74 review fix)
  executeRefreshRef.current = executeRefresh

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
    logger.info('[useGitStatus] Manual refresh triggered')
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
    // Use ref to get latest executeRefresh without adding to deps (Issue #74 review fix)
    executeRefreshRef.current?.(true)
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

  // Subscribe to git state changes (index, HEAD, refs, fetch, stash)
  // Uses unified gitWatcher API for comprehensive git event monitoring
  useEffect(() => {
    if (!projectPath || !enabled) return

    // Start watching .git directory for all git-related changes
    logger.info('[useGitStatus] Git watcher start requested', { projectPath })
    window.api.gitWatcher.start(projectPath).catch(err => {
      logger.warn('[useGitStatus] Failed to start git watcher', { error: err })
    })

    // Listen for git state changes
    const unsubscribeWatcher = window.api.gitWatcher.onStateChanged((event: GitStateChangeEvent) => {
      // Only refresh if window is visible to avoid unnecessary work
      if (isWindowVisibleRef.current) {
        // Log with correlation ID for tracing (ADR-Spec003-002)
        logger.info('[useGitStatus] Git state changed', {
          eventTypes: event.eventTypes,
          projectPath: event.projectPath,
          correlationId: event.correlationId
        })
        debouncedRefresh()
      } else {
        // Trace log when skipping due to hidden window (ADR-Spec003-002)
        logger.trace('[useGitStatus] Skipping refresh - window hidden', {
          correlationId: event.correlationId
        })
      }
    })

    return () => {
      unsubscribeWatcher()
      // Stop watching .git directory
      window.api.gitWatcher.stop().catch(err => {
        logger.warn('[useGitStatus] Failed to stop git watcher', { error: err })
      })
    }
  }, [projectPath, enabled, debouncedRefresh])

  // Subscribe to git polling as fallback for missed file watcher events
  // Polling catches changes that file watchers may miss (e.g., network-mounted repos)
  useEffect(() => {
    if (!projectPath || !enabled) return

    // Start polling for git status updates
    window.api.gitPolling.start(projectPath).catch(err => {
      logger.warn('[useGitStatus] Failed to start git polling', { error: err })
    })

    // Listen for poll-triggered events
    const unsubscribePolling = window.api.gitPolling.onPollTriggered((event: GitPollTriggeredEvent) => {
      // Only refresh if window is visible
      if (isWindowVisibleRef.current) {
        // Debug log with reason for tracing (ADR-Spec003-002)
        logger.debug('[useGitStatus] Git poll triggered', {
          timestamp: event.timestamp,
          reason: event.reason
        })
        debouncedRefresh()
      } else {
        // Trace log when skipping due to hidden window (ADR-Spec003-002)
        logger.trace('[useGitStatus] Skipping poll refresh - window hidden', {
          reason: event.reason
        })
      }
    })

    return () => {
      unsubscribePolling()
      // Stop polling
      window.api.gitPolling.stop().catch(err => {
        logger.warn('[useGitStatus] Failed to stop git polling', { error: err })
      })
    }
  }, [projectPath, enabled, debouncedRefresh])

  // Apply global settings changes to polling service
  // When user changes polling settings in the UI, apply them to the running service
  // Uses ref instead of closure variables to avoid React StrictMode issues (Issue #74 review fix)
  useEffect(() => {
    if (!projectPath || !enabled) return

    // Subscribe to settings store for gitStatus changes
    const unsubscribe = useGlobalSettingsStore.subscribe((state) => {
      const gitStatus = state.settings?.gitStatus
      if (!gitStatus) return

      const prev = prevPollingSettingsRef.current

      // Check if relevant settings have changed
      const pollingEnabledChanged = prev.enabled !== undefined && prev.enabled !== gitStatus.pollingEnabled
      const pollingIntervalChanged = prev.interval !== undefined && prev.interval !== gitStatus.pollingInterval

      // Update ref with current values
      prevPollingSettingsRef.current = {
        enabled: gitStatus.pollingEnabled,
        interval: gitStatus.pollingInterval,
      }

      // Apply changes to polling service
      if (pollingEnabledChanged) {
        window.api.gitPolling.setEnabled(gitStatus.pollingEnabled).catch((err) => {
          logger.warn('[useGitStatus] Failed to update polling enabled state', { error: err })
        })
      }

      if (pollingIntervalChanged) {
        window.api.gitPolling.setInterval(gitStatus.pollingInterval).catch((err) => {
          logger.warn('[useGitStatus] Failed to update polling interval', { error: err })
        })
      }
    })

    return () => {
      unsubscribe()
      // Reset ref on cleanup to avoid stale state on re-mount
      prevPollingSettingsRef.current = {}
    }
  }, [projectPath, enabled])

  // Window visibility handling - pause refreshes when window hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = !document.hidden
      isWindowVisibleRef.current = visible
      logger.debug('[useGitStatus] Window visibility changed', { visible, action: visible ? 'refresh' : 'pause' })

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
