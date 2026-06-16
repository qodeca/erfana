// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Watcher IPC Channel Names
 *
 * Type-safe channel name constants for git watcher IPC communication.
 * Using constants eliminates typos and enables refactoring.
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 * @see ADR-Spec003-003 - Typed channel names
 */

/**
 * Git watcher control channels (invoke/handle pattern)
 */
export const GitWatcherChannels = {
  /** Start watching git directory for a project */
  START: 'git-watcher:start',
  /** Stop watching git directory */
  STOP: 'git-watcher:stop',
  /** Get current watcher status */
  STATUS: 'git-watcher:status',
  /** Health check endpoint */
  HEALTH: 'git-status:health'
} as const

/**
 * Git watcher event channels (send/on pattern)
 */
export const GitWatcherEvents = {
  /** Git state changed event (from watcher) */
  STATE_CHANGED: 'git:state-changed',
  /** Poll triggered event (from polling) */
  POLL_TRIGGERED: 'git:poll-triggered'
} as const

/**
 * Git polling control channels (invoke/handle pattern)
 */
export const GitPollingChannels = {
  /** Start polling for a project */
  START: 'git-polling:start',
  /** Stop polling */
  STOP: 'git-polling:stop',
  /** Set polling interval */
  SET_INTERVAL: 'git-polling:set-interval',
  /** Enable or disable polling */
  SET_ENABLED: 'git-polling:set-enabled'
} as const

/**
 * All git status related channels (union type for validation)
 */
export type GitWatcherChannel = (typeof GitWatcherChannels)[keyof typeof GitWatcherChannels]
export type GitWatcherEvent = (typeof GitWatcherEvents)[keyof typeof GitWatcherEvents]
export type GitPollingChannel = (typeof GitPollingChannels)[keyof typeof GitPollingChannels]
