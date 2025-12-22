/**
 * Zod schemas for git watcher IPC events and payloads
 *
 * Defines event types, state change events, and watcher status
 * @see GitWatcherService.ts - main process git watcher implementation
 * @see Issue #74 - real-time git status refresh
 */
import { z } from 'zod'

/**
 * Git event types that trigger status updates
 *
 * - 'index': Changes to .git/index (staging area modifications)
 * - 'head': Changes to .git/HEAD (branch switches, commits)
 * - 'refs': Changes to .git/refs/ (new branches, tags, remote updates)
 * - 'fetch': Changes from git fetch operations
 * - 'stash': Changes to .git/refs/stash (stash push/pop)
 */
export const GitEventTypeSchema = z.enum(['index', 'head', 'refs', 'fetch', 'stash'])
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
  timestamp: z.number()
})
export type GitStateChangeEvent = z.infer<typeof GitStateChangeEventSchema>

/**
 * Git watcher state machine states
 *
 * - 'stopped': Watcher is not running
 * - 'starting': Watcher is initializing
 * - 'watching': Watcher is actively monitoring .git directory
 * - 'error': Watcher encountered an error
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
