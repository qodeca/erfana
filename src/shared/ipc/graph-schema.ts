// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schemas for the graph engine renderer boundary (issue #21).
 *
 * Contract-only: no handler validates against these yet (#26 registers them).
 *
 * **Module layering.** This file is the entry point for the whole renderer
 * boundary and re-exports the two modules split out of it, so every consumer
 * keeps a single import path:
 *
 * - `graph-error-schema.ts` — leaf: `GRAPH_ERROR_CODES`, `GraphErrorSchema`,
 *   `isConfinedRelativePath`. Imports nothing else from this layer.
 * - `graph-status-schema.ts` — the FR-036/037/038 status surface (§4.2 split).
 *
 * The direction is one-way (error ← status ← this file) and must stay that way:
 * a value re-export in both directions is an ESM cycle, and the re-exported
 * module is evaluated first, so the schemas built from `GraphErrorSchema` would
 * throw a temporal-dead-zone `ReferenceError` at import time.
 *
 * Three conventions apply throughout and are load-bearing (§7.0):
 *
 * 1. **Requests and filters use `z.strictObject`.** Zod strips unrecognised keys
 *    by default, so `matchmode` (case typo) or `excludeSection` (missing `Id`)
 *    would parse, be dropped, and silently fall back to a default. On
 *    {@link GraphSearchFiltersSchema} a dropped filter *widens* results.
 * 2. **Responses and events stay permissive**, so main can add a field without
 *    breaking an older renderer during a partial upgrade.
 * 3. **Every defaulted request exports two types.** `.default()` affects only
 *    the output type, so callers type against `…Input` and everything
 *    downstream of `safeParse` against the resolved `…Request`.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-ipc-contracts.md §7 - the normative contract
 */
import { z } from 'zod'
import { GRAPH } from '../graph-constants'
import {
  GraphErrorCodeSchema,
  GraphErrorSchema,
  isConfinedRelativePath
} from './graph-error-schema'
import type {
  GraphStatusChangePayload,
  GraphStatusResponse
} from './graph-status-schema'

// ─── re-exports (single import path for the boundary) ────────────────────────

export {
  GRAPH_ERROR_CODES,
  GraphErrorCodeSchema,
  GraphErrorSchema,
  isConfinedRelativePath
} from './graph-error-schema'
export type { GraphError, GraphErrorCode } from './graph-error-schema'

export {
  GraphBreakerState,
  GraphIndexState,
  GraphProgressSchema,
  GraphRecentSkipSchema,
  GraphStatusChangePayloadSchema,
  GraphStatusDot,
  GraphStatusResponseSchema,
  GraphStatusSnapshotSchema
} from './graph-status-schema'
export type {
  GraphProgress,
  GraphRecentSkip,
  GraphStatusChangePayload,
  GraphStatusResponse,
  GraphStatusSnapshot
} from './graph-status-schema'

// ─── search ──────────────────────────────────────────────────────────────────

/** `'all'` = implicit AND (typed query); `'any'` = OR, required for passage queries. */
export const GraphMatchMode = z.enum(['all', 'any'])
export type GraphMatchMode = z.infer<typeof GraphMatchMode>

export const GraphSearchFiltersSchema = z.strictObject({
  /**
   * Project-relative POSIX prefix, terminated with `/` by the transform.
   * `'doc'` would otherwise match `documentation/` and `doc-archive/` through
   * the `substr()` prefix compare, silently and with no error — and FR-031's
   * folder picker sends whatever label the tree node yields.
   */
  folder: z
    .string()
    .max(1024)
    .transform((s) => (s.endsWith('/') ? s : `${s}/`))
    .optional(),
  /** Lowercase, leading dot. `'md'` / `'.MD'` / `'*.md'` are rejected rather than
   *  returning zero rows with `error: null`, which is indistinguishable from a
   *  genuine no-match. */
  fileType: z
    .string()
    .regex(/^\.[a-z0-9]+$/)
    .max(16)
    .optional(),
  modifiedAfterMs: z.number().int().nonnegative().optional(),
  modifiedBeforeMs: z.number().int().nonnegative().optional(),
  excludeFilePath: z.string().max(4096).optional(),
  /** AC-018: omit the CURRENT section, keeping sibling sections eligible. */
  excludeSectionId: z.number().int().positive().optional()
})
export type GraphSearchFiltersInput = z.input<typeof GraphSearchFiltersSchema>
export type GraphSearchFilters = z.output<typeof GraphSearchFiltersSchema>

export const GraphSearchRequestSchema = z.strictObject({
  /** Up to `GRAPH.MAX_QUERY_LENGTH` — the related sidebar sends a whole passage,
   *  which the search service reduces to `GRAPH.MAX_QUERY_TERMS` tokens. */
  query: z.string().trim().min(1).max(GRAPH.MAX_QUERY_LENGTH),
  matchMode: GraphMatchMode.default('all'),
  k: z.number().int().min(1).max(GRAPH.MAX_TOP_K).default(GRAPH.DEFAULT_TOP_K),
  /** Bounded by the probe cap so `totalMatched` / `hasMore` stay defined. */
  offset: z.number().int().min(0).max(GRAPH.MAX_COUNT_PROBE - 1).default(0),
  /** False lets the search service skip `highlight()` entirely, so the lazy
   *  `matchedTerms` contingency is a config change, not a contract change. */
  includeMatchedTerms: z.boolean().default(true),
  filters: GraphSearchFiltersSchema.optional(),
  /** Optional inbound, required outbound: main echoes a supplied id or mints one. */
  correlationId: z.string().min(1).optional()
})
export type GraphSearchRequestInput = z.input<typeof GraphSearchRequestSchema>
export type GraphSearchRequest = z.output<typeof GraphSearchRequestSchema>

export const GraphTermOffsetSchema = z.object({
  /** Offset into the sentinel-stripped snippet or heading. Never the source file. */
  start: z.number().int().nonnegative(),
  length: z.number().int().positive()
})
export type GraphTermOffset = z.output<typeof GraphTermOffsetSchema>

export const GraphMatchedTermSchema = z.object({
  /**
   * The marked **document** token, as it appears in the snippet or heading —
   * not the query term.
   *
   * The porter tokenizer stems both sides, so `'indexing'` matches the query
   * `'index'`; and phase 2 issues ONE `snippet()`/`highlight()` with the whole
   * multi-term `:match`, which tells us *that* a token matched but never *which*
   * query term produced the mark. Recovering the query form would take a Porter
   * implementation agreeing exactly with SQLite's, and is ambiguous anyway when
   * two query terms share a stem. Exact query-form attribution is available from
   * `graph:explain`, which runs per term.
   */
  term: z.string(),
  column: z.enum(['heading', 'text']),
  /** Always === `offsets.length`. Named for the snippet so it cannot be read as
   *  a whole-section count, which is an order of magnitude different. */
  occurrencesInSnippet: z.number().int().nonnegative(),
  /** True count in the whole section; null unless the caller used `graph:explain`. */
  occurrencesInSection: z.number().int().nonnegative().nullable().default(null),
  offsets: z.array(GraphTermOffsetSchema)
})
export type GraphMatchedTerm = z.output<typeof GraphMatchedTermSchema>

export const GraphSearchResultSchema = z.object({
  sectionId: z.number().int().positive(),
  /** Project-relative, NFC display form. */
  filePath: z.string(),
  heading: z.string(),
  headingPath: z.string(),
  headingSlug: z.string(),
  /** 1..6; 0 marks a pre-heading preamble. */
  headingLevel: z.number().int().min(0).max(6),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** Sentinel-stripped. Spans live in `matchedTerms[].offsets` — no HTML crosses IPC. */
  snippet: z.string(),
  /** True when the 30-token window omitted part of the section, so the UI can
   *  label a partial view instead of reading `offsets: []` as "term absent".
   *  Derived from the `char(4)` truncation marker, which the same C0/C1 strip
   *  that removes the `char(2)`/`char(3)` sentinels removes here. */
  snippetTruncated: z.boolean(),
  /** Raw FTS5 `bm25()`: NEGATIVE, ascending = most relevant. Never a percentage. */
  score: z.number(),
  matchedTerms: z.array(GraphMatchedTermSchema)
})
export type GraphSearchResult = z.output<typeof GraphSearchResultSchema>

export const GraphSearchResponseSchema = z.object({
  results: z.array(GraphSearchResultSchema),
  /** Rows returned by the ranking phase, bounded by `GRAPH.MAX_COUNT_PROBE`. */
  totalMatched: z.number().int().nonnegative(),
  totalMatchedCapped: z.boolean(),
  hasMore: z.boolean(),
  offset: z.number().int().nonnegative(),
  k: z.number().int().positive(),
  /** Covers both query phases plus result mapping — the whole handler. */
  queryDurationMs: z.number().nonnegative(),
  degraded: z.boolean(),
  error: GraphErrorSchema.nullable(),
  correlationId: z.string().min(1)
})
export type GraphSearchResponse = z.output<typeof GraphSearchResponseSchema>

// ─── explain (FR-032) ────────────────────────────────────────────────────────

export const GraphExplainRequestSchema = z.strictObject({
  sectionId: z.number().int().positive(),
  query: z.string().trim().min(1).max(GRAPH.MAX_QUERY_LENGTH),
  matchMode: GraphMatchMode.default('all'),
  correlationId: z.string().min(1).optional()
})
export type GraphExplainRequestInput = z.input<typeof GraphExplainRequestSchema>
export type GraphExplainRequest = z.output<typeof GraphExplainRequestSchema>

export const GraphExplainWindowSchema = z.object({
  /** The QUERY term: explain runs one marked read per term, so unlike
   *  {@link GraphMatchedTermSchema} the attribution here is exact. */
  term: z.string(),
  column: z.enum(['heading', 'text']),
  /** Sentinel-stripped context around one occurrence. */
  text: z.string(),
  offsets: z.array(GraphTermOffsetSchema)
})
export type GraphExplainWindow = z.output<typeof GraphExplainWindowSchema>

export const GraphExplainResponseSchema = z.object({
  sectionId: z.number().int().positive(),
  /** One window per term occurrence, not one per result. */
  windows: z.array(GraphExplainWindowSchema),
  occurrencesInSection: z.record(z.string(), z.number().int().nonnegative()),
  error: GraphErrorSchema.nullable(),
  correlationId: z.string().min(1)
})
export type GraphExplainResponse = z.output<typeof GraphExplainResponseSchema>

// ─── reindex and cancel ──────────────────────────────────────────────────────

export const GraphReindexMode = z.enum(['full', 'incremental'])
export type GraphReindexMode = z.infer<typeof GraphReindexMode>

export const GraphReindexReason = z.enum([
  'user',
  'corruption',
  'schema-mismatch',
  'overflow-reconcile'
])
export type GraphReindexReason = z.infer<typeof GraphReindexReason>

export const GraphReindexRequestSchema = z.strictObject({
  mode: GraphReindexMode.default('full'),
  reason: GraphReindexReason.default('user'),
  correlationId: z.string().min(1).optional()
})
export type GraphReindexRequestInput = z.input<typeof GraphReindexRequestSchema>
export type GraphReindexRequest = z.output<typeof GraphReindexRequestSchema>

export const GraphReindexResponseSchema = z.object({
  accepted: z.boolean(),
  jobId: z.string().min(1).nullable(),
  /** `GRAPH_INDEX_ALREADY_RUNNING` when a job is live — reindex is idempotent,
   *  and `jobId` then names the RUNNING job so the caller can follow it. */
  rejectedCode: GraphErrorCodeSchema.nullable(),
  correlationId: z.string().min(1)
})
export type GraphReindexResponse = z.output<typeof GraphReindexResponseSchema>

/**
 * Cancellation is cooperative and main-side: better-sqlite3 cannot be
 * interrupted, so the in-flight batch always finishes and draining the queue is
 * the only lever. There is deliberately no `cancel` worker verb.
 */
export const GraphCancelReindexRequestSchema = z.strictObject({
  correlationId: z.string().min(1).optional()
})
export type GraphCancelReindexRequestInput = z.input<typeof GraphCancelReindexRequestSchema>
export type GraphCancelReindexRequest = z.output<typeof GraphCancelReindexRequestSchema>

export const GraphCancelReindexResponseSchema = z.object({
  /** False when no job was running. */
  cancelled: z.boolean(),
  droppedBatches: z.number().int().nonnegative(),
  inFlightAllowedToFinish: z.boolean(),
  correlationId: z.string().min(1)
})
export type GraphCancelReindexResponse = z.output<typeof GraphCancelReindexResponseSchema>

// ─── corpus stats ────────────────────────────────────────────────────────────

export const GraphCorpusStatsRequestSchema = z.strictObject({
  correlationId: z.string().min(1).optional()
})
export type GraphCorpusStatsRequestInput = z.input<typeof GraphCorpusStatsRequestSchema>
export type GraphCorpusStatsRequest = z.output<typeof GraphCorpusStatsRequestSchema>

export const GraphCorpusStatsSchema = z.object({
  fileCount: z.number().int().nonnegative(),
  /** Section ROWS. */
  sectionCount: z.number().int().nonnegative(),
  /** Summed over section ROWS — a duplicated body counts once per referencing section. */
  wordCount: z.number().int().nonnegative(),
  /** `contents` ROWS (distinct bodies). */
  uniqueContentCount: z.number().int().nonnegative(),
  /** Files skipped by the last full pass. */
  skippedFileCount: z.number().int().nonnegative(),
  lastIndexedAtMs: z.number().int().nonnegative().nullable(),
  /** NOT nullable: `GRAPH_QUERIES.corpusStats` returns NULL here on an unstamped
   *  `graph_meta`, and that case must be mapped to an error rather than parsed. */
  schemaVersion: z.number().int().positive(),
  /** An enum rather than `z.literal('beta')`, so the freeze is a value change
   *  rather than a breaking wire change. */
  schemaStability: z.enum(['beta', 'stable']),
  dbSizeBytes: z.number().int().nonnegative().nullable()
})
export type GraphCorpusStats = z.output<typeof GraphCorpusStatsSchema>

/**
 * Envelope, not a bare `null`: the Settings panel must be able to tell "no
 * project" from "reader down" from "the query threw", or it picks no
 * `ERROR_MESSAGES` entry and renders an unexplained blank.
 */
export const GraphCorpusStatsResponseSchema = z.object({
  stats: GraphCorpusStatsSchema.nullable(),
  error: GraphErrorSchema.nullable(),
  correlationId: z.string().min(1)
})
export type GraphCorpusStatsResponse = z.output<typeof GraphCorpusStatsResponseSchema>

// ─── status ──────────────────────────────────────────────────────────────────

/** The request stays here with its request siblings; the snapshot, progress and
 *  response payloads live in `graph-status-schema.ts` and are re-exported above. */
export const GraphStatusRequestSchema = z.strictObject({
  correlationId: z.string().min(1).optional()
})
export type GraphStatusRequestInput = z.input<typeof GraphStatusRequestSchema>
export type GraphStatusRequest = z.output<typeof GraphStatusRequestSchema>

// ─── priority paths (FR-049) ─────────────────────────────────────────────────

export const GraphPriorityPathsRequestSchema = z.strictObject({
  paths: z
    .array(z.string().max(4096).refine(isConfinedRelativePath, {
      message: 'path must be project-relative and free of ".." segments'
    }))
    .max(GRAPH.MAX_PRIORITY_PATHS),
  correlationId: z.string().min(1).optional()
})
export type GraphPriorityPathsRequestInput = z.input<typeof GraphPriorityPathsRequestSchema>
export type GraphPriorityPathsRequest = z.output<typeof GraphPriorityPathsRequestSchema>

export const GraphPriorityPathsResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  correlationId: z.string().min(1)
})
export type GraphPriorityPathsResponse = z.output<typeof GraphPriorityPathsResponseSchema>

// ─── preload bridge ──────────────────────────────────────────────────────────

/**
 * Shared contract for the preload graph bridge (`window.api.graph`).
 *
 * Single source of truth consumed by both the preload implementation and the
 * renderer typing, mirroring {@link ClaudeStatusBridge}. Parameters are `…Input`
 * types so callers may omit every defaulted field; the four optional-argument
 * methods are passed `request ?? {}` by the preload, because `parse(undefined)`
 * throws on a `z.object`.
 *
 * Not wired in #21 — the bridge lands with #26.
 */
export interface GraphBridge {
  search(request: GraphSearchRequestInput): Promise<GraphSearchResponse>
  explain(request: GraphExplainRequestInput): Promise<GraphExplainResponse>
  reindex(request?: GraphReindexRequestInput): Promise<GraphReindexResponse>
  cancelReindex(request?: GraphCancelReindexRequestInput): Promise<GraphCancelReindexResponse>
  getCorpusStats(request?: GraphCorpusStatsRequestInput): Promise<GraphCorpusStatsResponse>
  getStatus(request?: GraphStatusRequestInput): Promise<GraphStatusResponse>
  setPriorityPaths(request: GraphPriorityPathsRequestInput): Promise<GraphPriorityPathsResponse>
  /** Subscribe to status pushes; returns an unsubscribe. */
  onStatusChanged(cb: (payload: GraphStatusChangePayload) => void): () => void
}
