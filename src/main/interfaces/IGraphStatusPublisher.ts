// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the graph status publisher
 *
 * Substitutable in tests, mirroring the claude-status emit-sink precedent
 * (`new ClaudeStatusService({ emit: emitToWebContents })`).
 *
 * @see GraphStatusPublisher for implementation (#29)
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-ipc-contracts.md §7.6 - the push-rate contract
 */
import type { GraphStatusChangePayload } from '../../shared/ipc/graph-schema'

export interface IGraphStatusPublisher {
  /**
   * Coalesce and broadcast a status snapshot to every window.
   *
   * The rate bound is a MIN interval AND-ed with a change predicate: emit when
   * `elapsed >= GRAPH.STATUS_PUSH_MIN_INTERVAL_MS` **and** (a file was processed
   * **or** the state changed), capped at `GRAPH.MAX_STATUS_PUSH_RATE_HZ`. An OR
   * would give the combined rate no ceiling at all. State transitions and
   * terminal snapshots emit immediately and are never dropped.
   *
   * The payload is re-validated with `safeParse` immediately before `send`.
   *
   * @param payload - Snapshot envelope, or `{ snapshot: null }` to hide the indicator
   */
  publish(payload: GraphStatusChangePayload): void

  /** Stop any pending coalesce timer and release listeners. Idempotent. */
  dispose(): void
}
