// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the graph index worker adapter
 *
 * The worker is the SOLE WRITER: better-sqlite3 is synchronous, and one
 * `integrity_check` or FTS insert batch on the main thread would stall PTY
 * drain and every IPC channel. There is deliberately **no in-process fallback**
 * — if the worker is unavailable, indexing stops and the engine reports it
 * while search continues from the read-only connection.
 *
 * Verb-only (ISP): streams and liveness arrive through injected sinks, so the
 * supervisor is the single owner of stream + liveness handling.
 *
 * @see GraphIndexWorkerAdapter for implementation (#23)
 * @see IGitStatusWorker for the shape this mirrors
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-db-contracts.md §5.5 - data-layer interfaces
 * @see specs/designs/sd-021-worker-contracts.md §8.3 - the fail-closed contract
 */
import type {
  GraphWorkerCloseRequest,
  GraphWorkerClosed,
  GraphWorkerIndexRequest,
  GraphWorkerIndexResult,
  GraphWorkerOpenRequest,
  GraphWorkerProgressMessage,
  GraphWorkerReady,
  GraphWorkerRebuildRequest
} from '../../shared/ipc/graph-worker-schema'

/**
 * Sinks injected at construction — the house DI idiom.
 *
 * Chosen over `on*(cb)` methods so {@link IGraphIndexWorker} stays verb-only.
 */
export interface GraphWorkerSinks {
  /**
   * Progress stream. Fenced on `switchVersion`, `sessionVersion` and
   * `jobVersion` like every other inbound message, but never routed through the
   * adapter's `pending` map — it is a stream, not a reply.
   */
  onProgress(msg: GraphWorkerProgressMessage): void

  /**
   * Worker exit. Fires for an **idle** worker death too, which is the NFR-008
   * case a pending-map-only design misses entirely.
   *
   * @param code - Process exit code; non-zero rejects all pending requests
   * @param sessionVersion - Incarnation that died, so a late exit cannot
   *                         invalidate a newer worker
   */
  onExit(code: number, sessionVersion: number): void
}

export interface IGraphIndexWorker {
  /**
   * Open the database: pragmas, checkpoint, SQLite/FTS5 gates, integrity check,
   * audits and the version gate. Rejects `GRAPH_DB_OPEN_FAILED` when a handle is
   * already held — it never lazily opens, because it must not guess a path.
   *
   * `GRAPH_DB_OPEN_FAILED` and not a dedicated already-open code: `GRAPH_ERROR_CODES`
   * is a closed set, and a worker replying with a code outside it fails
   * the adapter's `safeParse`, is dropped as `GRAPH_WORKER_PROTOCOL`, and leaves
   * this promise hanging to its `GRAPH.WORKER_OPEN_TIMEOUT`. §8.6 already routes
   * every writer-open fault to `GRAPH_DB_OPEN_FAILED`.
   */
  open(req: GraphWorkerOpenRequest): Promise<GraphWorkerReady>

  /**
   * Apply one batch of upserts/deletes in a single transaction. An `index`
   * arriving before a successful `open` is answered `GRAPH_DB_NOT_READY`.
   */
  index(req: GraphWorkerIndexRequest): Promise<GraphWorkerIndexResult>

  /** In-place `DROP` + recreate + stamp in one transaction. Never unlink/rename. */
  rebuild(req: GraphWorkerRebuildRequest): Promise<GraphWorkerReady>

  /**
   * Close the write handle so SQLite performs its final checkpoint-and-delete of
   * `-wal`/`-shm`. Bounded by a timeout; on expiry the worker is terminated,
   * because a leaked handle is worse than a lost worker.
   *
   * Resolves with the worker's `closed` reply ({@link GraphWorkerClosed}):
   * `checkpointed` tells the caller whether the final checkpoint completed, so a
   * refused checkpoint (WAL still growing) is observable rather than swallowed by
   * a `void`. The timeout-then-terminate path stays the FAILURE path.
   */
  close(req: GraphWorkerCloseRequest): Promise<GraphWorkerClosed>

  /** Terminate the worker thread and release resources. Safe to call repeatedly. */
  dispose(): Promise<void>

  /** True while the worker thread is alive and accepting requests. */
  isAlive(): boolean
}
