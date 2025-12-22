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
 * @see BRS-003 - Real-time git status refresh specification
 */

/** Default event coalescing window in milliseconds */
const DEFAULT_COALESCE_WINDOW_MS = 150

/** Git event types that can trigger state changes */
export type GitEventType = 'index' | 'head' | 'refs' | 'fetch' | 'stash'

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

    // Add to pending set (automatically deduplicates)
    this.pendingEvents.add(eventType)

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
      this.pendingEvents.clear()

      try {
        this.callback(eventTypes)
      } catch (error) {
        // Suppress errors to prevent breaking coalescer, but log for debugging
        if (typeof console !== 'undefined') {
          console.debug('GitEventCoalescer: Callback error suppressed', error)
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
 * @param filePath - Full path to git file that changed
 * @returns GitEventType or null if not a recognized git state file
 */
export function classifyGitPath(filePath: string): GitEventType | null {
  // Normalize path separators for cross-platform compatibility
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
