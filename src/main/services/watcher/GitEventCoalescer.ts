// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * GitEventCoalescer - Coalesces rapid git file events into single events
 *
 * Purpose: Prevents spam when git operations touch multiple files rapidly.
 * For example, `git add .` might trigger many .git/index changes in quick succession.
 *
 * Pattern: 150ms coalescing window - all events within window are merged into one.
 *
 * Event Types:
 * - 'index'  → .git/index (staging area)
 * - 'head'   → .git/HEAD (current branch/commit)
 * - 'refs'   → .git/refs/heads/* (branch pointers)
 * - 'fetch'  → .git/FETCH_HEAD (last fetch info)
 * - 'stash'  → .git/stash (stash ref)
 *
 * Usage:
 *   const coalescer = new GitEventCoalescer((eventType) => {
 *     // Handle coalesced event
 *   }, 150)
 *   coalescer.queueEvent('index')
 *   coalescer.queueEvent('index') // Coalesced with previous
 *   // After 150ms: callback fires once with 'git-changed'
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 */

import { logger } from '../LoggingService'
import type { GitEventType } from '../../../shared/ipc/git-watcher-schema'

/** Default event coalescing window in milliseconds */
const DEFAULT_COALESCE_WINDOW_MS = 150

/** Max consecutive callback errors before circuit breaker trips (Issue #74 review fix) */
const MAX_CALLBACK_ERRORS = 5

/**
 * Re-export so existing consumers (`GitWatcherService`, tests) keep working
 * after the lens-review #8 single-sourcing. The union is the same wire enum
 * the renderer parses – no hand-written duplicate to drift.
 */
export type { GitEventType }

/** Callback signature for coalesced git events */
export type GitEventCallback = (eventTypes: GitEventType[]) => void

/**
 * GitEventCoalescer
 *
 * Pure logic extraction - no side effects beyond timer management.
 * Coalesces rapid git file events within a configurable window.
 */
export class GitEventCoalescer {
  /** Set of event types received during current window */
  private pendingEvents: Set<GitEventType> = new Set()

  /** Debounce timer handle */
  private debounceTimer: NodeJS.Timeout | null = null

  /** Callback to invoke when coalescing window closes */
  private readonly callback: GitEventCallback

  /** Coalescing window duration in milliseconds */
  private readonly windowMs: number

  /** Whether the coalescer is disposed */
  private isDisposed = false

  /** Consecutive callback error count for circuit breaker (Issue #74 review fix) */
  private callbackErrorCount = 0

  /** Window start time for timing measurement (ADR-Spec003-002) */
  private windowStartTime: number | null = null

  /**
   * Create a new GitEventCoalescer
   *
   * @param callback - Function to call when coalescing window closes
   * @param windowMs - Coalescing window duration (default: 150ms)
   */
  constructor(callback: GitEventCallback, windowMs: number = DEFAULT_COALESCE_WINDOW_MS) {
    this.callback = callback
    this.windowMs = windowMs
  }

  /**
   * Queue a git event for coalescing
   *
   * Events received within the window are merged.
   * Window restarts on each new event (debounce pattern).
   *
   * @param eventType - Type of git event (index, head, refs, fetch, stash)
   */
  queueEvent(eventType: GitEventType): void {
    if (this.isDisposed) return

    // Start timing window on first event (ADR-Spec003-002)
    if (this.pendingEvents.size === 0) {
      this.windowStartTime = Date.now()
    }

    // Add to pending set (automatically deduplicates)
    this.pendingEvents.add(eventType)

    // Trace log for debugging event flow (ADR-Spec003-002)
    logger.trace('GitCoalescer: Event queued', {
      eventType,
      pendingCount: this.pendingEvents.size
    })

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.flush()
    }, this.windowMs)
  }

  /**
   * Check if there are pending events
   */
  hasPendingEvents(): boolean {
    return this.pendingEvents.size > 0
  }

  /**
   * Get count of pending event types
   */
  getPendingCount(): number {
    return this.pendingEvents.size
  }

  /**
   * Flush pending events immediately (bypasses timer)
   * Useful for testing or cleanup scenarios
   */
  flush(): void {
    if (this.isDisposed) return

    // Clear timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    // If we have events, invoke callback
    if (this.pendingEvents.size > 0) {
      const eventTypes = Array.from(this.pendingEvents)
      const windowMs = this.windowStartTime ? Date.now() - this.windowStartTime : 0
      this.pendingEvents.clear()
      this.windowStartTime = null

      // Debug log for coalesce completion (ADR-Spec003-002)
      logger.debug('GitCoalescer: Flushed', {
        eventTypes,
        count: eventTypes.length,
        windowMs
      })

      try {
        this.callback(eventTypes)
        // Reset error count on success (Issue #74 review fix)
        this.callbackErrorCount = 0
      } catch (error) {
        // Increment error count and log properly (Issue #74 review fix)
        this.callbackErrorCount++
        logger.error(
          'GitEventCoalescer: Callback error',
          error instanceof Error ? error : new Error(String(error)),
          { errorCount: this.callbackErrorCount, eventTypes }
        )

        // Circuit breaker: auto-dispose if too many consecutive errors
        if (this.callbackErrorCount >= MAX_CALLBACK_ERRORS) {
          logger.error('GitEventCoalescer: Circuit breaker tripped - too many consecutive errors, disposing', undefined, {
            errorCount: this.callbackErrorCount
          })
          this.dispose()
        }
      }
    }
  }

  /**
   * Clear pending events without invoking callback
   */
  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingEvents.clear()
  }

  /**
   * Dispose the coalescer
   * Clears timer and prevents further event processing
   */
  dispose(): void {
    this.clear()
    this.isDisposed = true
  }
}

/**
 * Convenience function to determine git event type from file path
 *
 * Cross-platform: Handles both Unix (/path/.git/index) and Windows (C:\path\.git\index) paths.
 * Windows drive letters are preserved after backslash normalization (C:/path/.git/index).
 *
 * @param filePath - Full path to git file that changed
 * @returns GitEventType or null if not a recognized git state file
 */
export function classifyGitPath(filePath: string): GitEventType | null {
  // Normalize backslashes to forward slashes for cross-platform compatibility
  // Examples: C:\project\.git\index → C:/project/.git/index
  //           /Users/dev/project/.git/HEAD → /Users/dev/project/.git/HEAD (unchanged)
  const normalizedPath = filePath.replace(/\\/g, '/')

  // Check each pattern in order of specificity
  if (normalizedPath.endsWith('/.git/index') || normalizedPath.endsWith('.git/index')) {
    return 'index'
  }
  if (normalizedPath.endsWith('/.git/HEAD') || normalizedPath.endsWith('.git/HEAD')) {
    return 'head'
  }
  if (normalizedPath.endsWith('/.git/FETCH_HEAD') || normalizedPath.endsWith('.git/FETCH_HEAD')) {
    return 'fetch'
  }
  if (normalizedPath.endsWith('/.git/stash') || normalizedPath.endsWith('.git/stash')) {
    return 'stash'
  }
  // refs/heads/ - branch files
  if (normalizedPath.includes('/.git/refs/heads/') || normalizedPath.includes('.git/refs/heads/')) {
    return 'refs'
  }

  return null
}
