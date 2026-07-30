// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Graph engine IPC channel names
 *
 * Type-safe channel name constants for the R1 graph search engine (issue #21).
 * Using constants eliminates typos and enables refactoring across the
 * main/preload/renderer boundary.
 *
 * Contract-only for #21: no handler is registered against any of these names
 * yet — `registerGraphHandlers` lands with #26.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-ipc-contracts.md §7.1 - the normative channel list
 */

/**
 * Graph control channels (invoke/handle pattern).
 *
 * All seven are `invoke`. `EXPLAIN` exists because FR-032 needs per-term
 * context windows that a single 30-token `snippet()` cannot supply, and a
 * schema with no channel to reach it would have forced a channel edit later
 * (§12.5 deviation 8).
 */
export const GraphChannels = {
  /** Ranked full-text search over the indexed corpus */
  SEARCH: 'graph:search',
  /** Per-term "why this result?" breakdown for one section (FR-032) */
  EXPLAIN: 'graph:explain',
  /** Request a full or incremental reindex (idempotent) */
  REINDEX: 'graph:reindex',
  /** Cooperative, main-side cancellation — drains the queue, never aborts a write */
  CANCEL_REINDEX: 'graph:cancelReindex',
  /** Corpus counters for the Settings panel (FR-034) */
  GET_CORPUS_STATS: 'graph:getCorpusStats',
  /** One-shot pull of the current status snapshot */
  GET_STATUS: 'graph:getStatus',
  /** Front-load the open file(s) on the initial index pass (FR-049) */
  SET_PRIORITY_PATHS: 'graph:setPriorityPaths'
} as const

/**
 * Graph event channels (send/on pattern, main → renderer push).
 *
 * A single status channel — not separate progress/status channels — mirrors
 * `claude-status:changed`: FR-036/037/038 must land in one renderer commit.
 */
export const GraphEvents = {
  /** Status snapshot changed (snapshot or null when the indicator should hide) */
  STATUS_CHANGED: 'graph:statusChanged'
} as const

/**
 * Union types for channel-name validation.
 */
export type GraphChannel = (typeof GraphChannels)[keyof typeof GraphChannels]
export type GraphEvent = (typeof GraphEvents)[keyof typeof GraphEvents]
