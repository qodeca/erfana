// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the graph search service
 *
 * Owns **all** SQL composition and the FTS5 sanitiser, and is the **only**
 * caller of `IGraphReadConnection`. `search` demands a
 * {@link GraphSearchRequestValidated} — the branded form minted only by
 * `parseSearchRequest`. That makes the "already validated" claim the compiler's
 * job rather than a comment: a request that has not been through `safeParse`
 * (even a hand-built literal with every default filled in, which would satisfy
 * the plain `z.output` type yet skip `trim()`, the `folder` transform and every
 * refine) is not assignable, so **no-parse is a compile error** (S-[6]).
 * `IGraphQueryService` owns the single parse on the way in from IPC.
 *
 * Every method is synchronous. Reads run on the main thread deliberately — a
 * worker round-trip would cost more than the query and would serialise search
 * behind indexing batches — so the budget is main-thread occupancy,
 * p95 < 4 ms / worst case < 16 ms, measured with `perf_hooks.monitorEventLoopDelay`.
 *
 * @see GraphSearchService for implementation (#26)
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-graph-architecture.md §4.4 - interfaces
 */
import type {
  GraphCorpusStatsResponse,
  GraphExplainRequest,
  GraphExplainResponse,
  GraphSearchRequestValidated,
  GraphSearchResponse
} from '../../shared/ipc/graph-schema'

/**
 * Both ids travel together on every payload and every log line.
 *
 * `jobId` is optional because a plain search has no parent job; a batch or a DB
 * swap always does.
 */
export interface GraphTraceIds {
  correlationId: string
  jobId?: string
}

export interface IGraphSearchService {
  /**
   * Two-phase ranked search inside one read transaction.
   *
   * Never throws: failure returns `{ results: [], error, degraded: true }`.
   * A query whose terms all survive sanitisation reaches SQLite; one that
   * reduces to zero terms short-circuits to an empty result set **without
   * touching SQLite**, which is why `GRAPH_SEARCH_QUERY_INVALID` is unreachable
   * from user input.
   *
   * Takes the branded {@link GraphSearchRequestValidated}: the request must have
   * passed `parseSearchRequest`, so this method can never be handed an unvalidated
   * shape.
   */
  search(req: GraphSearchRequestValidated, ids: GraphTraceIds): GraphSearchResponse

  /** Per-term windows and exact per-section counts for one section (FR-032). */
  explain(req: GraphExplainRequest, ids: GraphTraceIds): GraphExplainResponse

  /**
   * Corpus counters from the READER, so the Settings panel still renders in the
   * `degraded`/`disabled` states where search remains enabled. `dbSizeBytes` is
   * `stat()`ed main-side rather than read from SQLite.
   */
  getCorpusStats(ids: GraphTraceIds): GraphCorpusStatsResponse
}
