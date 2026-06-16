// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schemas for git watcher IPC events and payloads
 *
 * Defines event types, state change events, and watcher status
 * @see GitWatcherService.ts - main process git watcher implementation
 * @see Issue #74 - real-time git status refresh
 */
import { z } from 'zod'

/**
 * Git event types that trigger status updates.
 *
 * Single source of truth for both producer (main / GitWatcherService) and
 * consumer (renderer Zod parsing): the type is `z.infer`-derived so it cannot
 * drift from the wire schema. The legacy hand-written union in
 * `GitEventCoalescer.ts` was removed (lens review #8).
 *
 * - 'index': Changes to .git/index (staging area modifications)
 * - 'head': Changes to .git/HEAD (branch switches, commits)
 * - 'refs': Changes to .git/refs/ (new branches, tags, remote updates)
 * - 'fetch': Changes from git fetch operations
 * - 'stash': Changes to .git/refs/stash (stash push/pop)
 * - 'repo': The .git path itself appeared or disappeared (git init / clone
 *           into an open folder, or .git removal). Broadcast-only – never
 *           queued through GitEventCoalescer, only emitted from
 *           RepoPresenceWatcher's debounced transition handler.
 *
 * Note on channel reuse: `git:state-changed` carries both file-content events
 * (the first five types) and presence events ('repo'). The sole renderer
 * consumer treats them identically (it calls a debounced refresh and lets
 * `getStatus` re-derive `isGitRepo`), so a dedicated channel would be
 * over-engineering. If a future consumer must distinguish presence from
 * content, prefer a typed `presence?: 'added' | 'removed'` field on the
 * payload over enriching this enum further.
 */
export const GitEventTypeSchema = z.enum(['index', 'head', 'refs', 'fetch', 'stash', 'repo'])
export type GitEventType = z.infer<typeof GitEventTypeSchema>

/**
 * Git state change event emitted when git-related files change
 * Sent via IPC 'git:state-changed' channel from GitWatcherService
 */
export const GitStateChangeEventSchema = z.object({
  /** Path to the project root */
  projectPath: z.string(),
  /** Types of git state that changed (coalesced from multiple events) */
  eventTypes: z.array(GitEventTypeSchema),
  /** Unix timestamp (ms) when the event was detected */
  timestamp: z.number(),
  /**
   * Correlation ID for tracing a refresh cycle across components
   * Format: git-{timestamp}-{random} (e.g., git-1703270400000-abc123)
   *
   * Uses .optional() (not .nullable()) because the field may be absent entirely
   * in older payloads, rather than being present with a null value.
   * This differs from fields like watchedPath which are always present but may be null.
   *
   * @see ADR-Spec003-002 - Git status logging strategy
   */
  correlationId: z.string().optional()
})
export type GitStateChangeEvent = z.infer<typeof GitStateChangeEventSchema>

/**
 * Git watcher state machine states
 *
 * - 'stopped': Watcher is not running
 * - 'starting': Watcher is initializing (reserved for future use)
 * - 'watching': Watcher is actively monitoring .git directory
 * - 'error': Watcher encountered an error (reserved for future use)
 *
 * Note: Currently only 'stopped' and 'watching' are used.
 * 'starting' and 'error' are reserved for future state machine enhancements.
 * (Issue #74 review - documented unused states)
 */
export const GitWatcherStateSchema = z.enum(['stopped', 'starting', 'watching', 'error'])
export type GitWatcherState = z.infer<typeof GitWatcherStateSchema>

/**
 * Git watcher status for health monitoring and debugging
 */
export const GitWatcherStatusSchema = z.object({
  /** Current state of the watcher */
  state: GitWatcherStateSchema,
  /** Path being watched (null if not watching) */
  watchedPath: z.string().nullable(),
  /** Timestamp of last event received (null if no events yet) */
  lastEventTimestamp: z.number().nullable(),
  /** Error message if state is 'error' (null otherwise) */
  error: z.string().nullable()
})
export type GitWatcherStatus = z.infer<typeof GitWatcherStatusSchema>

/**
 * Git poll triggered event emitted when polling interval fires
 * Used for fallback status updates when file watching misses changes
 * Sent via IPC 'git:poll-triggered' channel from GitPollingService
 */
export const GitPollTriggeredEventSchema = z.object({
  /** Path to the project root */
  projectPath: z.string(),
  /** Unix timestamp (ms) when the poll was triggered */
  timestamp: z.number(),
  /** Reason for triggering the refresh */
  reason: z.enum(['index_changed', 'no_watcher'])
})
export type GitPollTriggeredEvent = z.infer<typeof GitPollTriggeredEventSchema>

/**
 * Metrics for git polling service
 *
 * Moved to shared schema to avoid circular dependency between
 * IGitPollingService interface and GitPollingService implementation.
 */
export interface GitPollingMetrics {
  /** Number of times polling triggered a refresh */
  pollingRefreshCount: number
  /** Number of times polling was skipped (watcher active or no index change) */
  pollingSkippedCount: number
  /** Timestamp of last poll */
  lastPollTimestamp: number
  /** Timestamp of last refresh */
  lastRefreshTimestamp: number
}
