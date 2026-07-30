// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the graph engine's query surface
 *
 * Consumed by `graph-handlers.ts` (#26). Parameters are `z.input` types, so a
 * caller may omit every defaulted field and the resolution happens once, at the
 * `safeParse` boundary, rather than being hard-coded at each call site.
 *
 * Follows Interface Segregation Principle: the IPC handler needs the seven
 * verbs and nothing else — no lifecycle, no disposal.
 *
 * @see GraphEngineService for implementation (#23)
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-graph-architecture.md §4.4 - interfaces
 */
import type {
  GraphCancelReindexRequestInput,
  GraphCancelReindexResponse,
  GraphCorpusStatsRequestInput,
  GraphCorpusStatsResponse,
  GraphExplainRequestInput,
  GraphExplainResponse,
  GraphPriorityPathsRequestInput,
  GraphPriorityPathsResponse,
  GraphReindexRequestInput,
  GraphReindexResponse,
  GraphSearchRequestInput,
  GraphSearchResponse,
  GraphStatusRequestInput,
  GraphStatusResponse
} from '../../shared/ipc/graph-schema'
import type { IGraphProjectLifecycle } from './IGraphProjectLifecycle'

export interface IGraphQueryService {
  /** Ranked full-text search. Never throws — failure returns `degraded: true`. */
  search(request: GraphSearchRequestInput): Promise<GraphSearchResponse>

  /** Per-term context windows for one section (FR-032). */
  explain(request: GraphExplainRequestInput): Promise<GraphExplainResponse>

  /**
   * Request a reindex. Idempotent: when a job is already live the response
   * carries `GRAPH_INDEX_ALREADY_RUNNING` and `jobId` names the RUNNING job.
   */
  reindex(request?: GraphReindexRequestInput): Promise<GraphReindexResponse>

  /**
   * Cooperative cancellation. Sets the cancel flag, bumps `jobVersion` and
   * drains the queue on the caller's turn — it never enters the operation
   * queue, which would put it behind the job it cancels.
   */
  cancelReindex(request?: GraphCancelReindexRequestInput): Promise<GraphCancelReindexResponse>

  /** Corpus counters, served from the READER so they survive `degraded`/`disabled`. */
  getCorpusStats(request?: GraphCorpusStatsRequestInput): Promise<GraphCorpusStatsResponse>

  /** One-shot pull of the current status snapshot. */
  getStatus(request?: GraphStatusRequestInput): Promise<GraphStatusResponse>

  /** Front-load the open file(s) on the initial index pass (FR-049). */
  setPriorityPaths(request: GraphPriorityPathsRequestInput): Promise<GraphPriorityPathsResponse>
}

/**
 * The full engine surface: the query verbs plus the project-switch hook.
 *
 * `GraphEngineService` owns the operation queue, the switch/session/job fences
 * and id minting, and **delegates everything else**. It holds no
 * `better-sqlite3` handle, composes no SQL, reads no files, registers no
 * `ipcMain` handler and decides no user-facing copy.
 */
export interface IGraphEngineService extends IGraphQueryService, IGraphProjectLifecycle {
  dispose(): Promise<void>
}
