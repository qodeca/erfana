// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the graph search service
 *
 * Owns **all** SQL composition and the FTS5 sanitiser, and is the **only**
 * caller of `IGraphReadConnection`. Takes RESOLVED (`z.output`) requests: by
 * this point the handler has already run `safeParse`, so every default is
 * materialised and no field is optional-by-omission.
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
  GraphSearchRequest,
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
   */
  search(req: GraphSearchRequest, ids: GraphTraceIds): GraphSearchResponse

  /** Per-term windows and exact per-section counts for one section (FR-032). */
  explain(req: GraphExplainRequest, ids: GraphTraceIds): GraphExplainResponse

  /**
   * Corpus counters from the READER, so the Settings panel still renders in the
   * `degraded`/`disabled` states where search remains enabled. `dbSizeBytes` is
   * `stat()`ed main-side rather than read from SQLite.
   */
  getCorpusStats(ids: GraphTraceIds): GraphCorpusStatsResponse
}
