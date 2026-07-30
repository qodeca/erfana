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
  ConfinedRelativePathSchema,
  GraphErrorCodeSchema,
  GraphErrorSchema,
  GraphInboundCorrelationIdSchema,
  GraphOutboundCorrelationIdSchema,
  GraphOutboundJobIdSchema,
  isConfinedRelativePath
} from './graph-error-schema'
import type {
  GraphStatusChangePayload,
  GraphStatusResponse
} from './graph-status-schema'

// ─── re-exports (single import path for the boundary) ────────────────────────

export {
  ConfinedRelativePathSchema,
  GRAPH_CORRELATION_ID_PATTERN,
  GRAPH_ERROR_CODES,
  GRAPH_JOB_ID_PATTERN,
  GraphErrorCodeSchema,
  GraphErrorSchema,
  GraphGenerationSchema,
  GraphInboundCorrelationIdSchema,
  GraphOutboundCorrelationIdSchema,
  GraphOutboundJobIdSchema,
  isConfinedRelativePath,
  isConfinedTruncatedPath,
  isModelSafeText
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

/**
 * Unrefined base object for the search filters — the derivation root (§7.0).
 *
 * A base/leaf split, because zod 4 **throws** on `.pick()`/`.omit()`/`.check()`
 * applied to an object schema that carries a refinement
 * (`".pick() cannot be used on object schemas containing refinements"`). The MCP
 * args schema derives its filter set with `.omit({ excludeSectionId })`, so the
 * shape it derives from must stay refinement-free. Any joint filter refinement
 * (e.g. a `modifiedAfterMs <= modifiedBeforeMs` bound) therefore attaches to the
 * LEAF export {@link GraphSearchFiltersSchema}, never to this base — that way the
 * `.omit()` keeps working.
 */
export const GraphSearchFiltersBaseSchema = z.strictObject({
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
    // Refine AFTER the transform, so confinement validates the value that flows
    // downstream (the `/`-terminated form): a trailing `/` is confined, a
    // leading one is not. This also rejects `''` — the transform turns it into
    // `'/'`, which `isConfinedRelativePath` refuses — so B3's proposed `.min(1)`
    // is redundant with confinement and is deliberately NOT added.
    .refine(isConfinedRelativePath, {
      message: 'folder must be a project-relative path with no ".." segment'
    })
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
  excludeFilePath: ConfinedRelativePathSchema(4096).optional(),
  /** AC-018: omit the CURRENT section, keeping sibling sections eligible. */
  excludeSectionId: z.number().int().positive().optional()
})

/**
 * True when the `modified*` bounds are ordered, i.e. `modifiedAfterMs <=
 * modifiedBeforeMs`. An absent bound disables the check on that side.
 *
 * Shared so the identical joint refinement can attach to BOTH filter leaves — the
 * renderer {@link GraphSearchFiltersSchema} and the MCP args' omitted filter set
 * — without either duplicating the predicate or attaching it to
 * {@link GraphSearchFiltersBaseSchema} (which the MCP `.omit()` derivation would
 * then refuse to derive from). The two bounds are independent on the base, so an
 * inverted range (`after > before`) parses and silently returns nothing.
 */
export function isAscendingModifiedRange(f: {
  modifiedAfterMs?: number
  modifiedBeforeMs?: number
}): boolean {
  return (
    f.modifiedAfterMs === undefined ||
    f.modifiedBeforeMs === undefined ||
    f.modifiedAfterMs <= f.modifiedBeforeMs
  )
}

/** Path + message for the {@link isAscendingModifiedRange} refine, shared by both leaves. */
export const MODIFIED_RANGE_REFINE = {
  path: ['modifiedAfterMs'],
  message: 'modifiedAfterMs must be <= modifiedBeforeMs'
}

/**
 * Renderer-facing filters leaf. The base plus the joint
 * `modifiedAfterMs <= modifiedBeforeMs` refinement — attached HERE rather than on
 * {@link GraphSearchFiltersBaseSchema} so the MCP `.omit()` derivation (which zod
 * 4 refuses on a refined object) still survives.
 */
export const GraphSearchFiltersSchema = GraphSearchFiltersBaseSchema.refine(
  isAscendingModifiedRange,
  MODIFIED_RANGE_REFINE
)
export type GraphSearchFiltersInput = z.input<typeof GraphSearchFiltersSchema>
export type GraphSearchFilters = z.output<typeof GraphSearchFiltersSchema>

/**
 * Unrefined base object for the search request — the derivation root (§7.0).
 *
 * Same base/leaf reason as {@link GraphSearchFiltersBaseSchema}: the MCP args
 * schema derives with `.pick({ query, k, filters })`, which zod 4 refuses on a
 * refined object. A joint request refinement (e.g. an `offset + k` probe bound)
 * attaches to the LEAF export {@link GraphSearchRequestSchema}, never here.
 */
export const GraphSearchRequestBaseSchema = z.strictObject({
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
  /** Optional inbound, required outbound: main echoes a supplied id or mints one.
   *  Inbound is bounded + model-safe but NOT pattern-pinned (D6) — a caller may
   *  supply its own trace id, which need not match the main-minted shape. */
  correlationId: GraphInboundCorrelationIdSchema.optional()
})

/**
 * Renderer-facing request leaf. The base plus the joint `offset + k` probe bound,
 * attached HERE rather than on {@link GraphSearchRequestBaseSchema} so the MCP
 * `.pick()` derivation (which zod 4 refuses on a refined object) still survives.
 *
 * `offset` and `k` cap independently on the base (`k <= GRAPH.MAX_TOP_K`, `offset
 * <= GRAPH.MAX_COUNT_PROBE - 1`), so `offset: 999, k: 100` would ask for rows
 * 999–1098 from a probe capped at `GRAPH.MAX_COUNT_PROBE` (1000) — the last page
 * returns one row while `hasMore` reads false. The refine binds the two so the
 * slice contract `rows.slice(offset, offset + k)` holds against a probe of
 * `min(GRAPH.MAX_COUNT_PROBE, offset + k + 1)` (see `IGraphReadConnection`'s
 * `probeLimit`). The refine runs on the resolved output, so both fields carry
 * their defaults.
 */
export const GraphSearchRequestSchema = GraphSearchRequestBaseSchema.refine(
  (r) => r.offset + r.k <= GRAPH.MAX_COUNT_PROBE,
  {
    path: ['offset'],
    message: 'offset + k must not exceed GRAPH.MAX_COUNT_PROBE (the count-probe cap)'
  }
)
export type GraphSearchRequestInput = z.input<typeof GraphSearchRequestSchema>
export type GraphSearchRequest = z.output<typeof GraphSearchRequestSchema>

/** Unforgeable brand: minted only by {@link parseSearchRequest}, never exported,
 *  so it cannot be spelled by a hand-built object literal. */
declare const searchRequestValidated: unique symbol

/**
 * A search request that has provably passed `safeParse`.
 *
 * `IGraphSearchService.search` demands this type, so the compiler — not a
 * comment — enforces its header's "already validated" claim. A plain
 * {@link GraphSearchRequest} (or a hand-built literal that merely *looks* resolved)
 * is not assignable, so **skipping the parse is a compile error** (S-[6]).
 *
 * Branding rather than "take the `z.output` type" (the other option in the plan)
 * because `z.output` proves only that the object is SHAPED like a resolved
 * request — a literal with every field populated bypasses `trim()`, the
 * `folder` transform and every refine yet still typechecks. Only a value the parse
 * funnel produced proves the refinements ran, which is what "validated" means on
 * a security boundary.
 */
export type GraphSearchRequestValidated = GraphSearchRequest & {
  readonly [searchRequestValidated]: true
}

/**
 * The sole producer of {@link GraphSearchRequestValidated}: it parses (throwing on
 * invalid input, like every other `.parse` at this boundary) and re-tags the
 * result with the brand. `IGraphQueryService` owns this single call on the way in
 * from IPC; everything downstream takes the branded type.
 *
 * Contract-only for #21: `GraphEngineService` (#23/#26) wires it.
 */
export function parseSearchRequest(input: unknown): GraphSearchRequestValidated {
  return GraphSearchRequestSchema.parse(input) as GraphSearchRequestValidated
}

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
  /** Bounded like the status snapshot's path/text siblings (`MAX_STATUS_PATH_LENGTH`):
   *  the response was the one payload that bounded no string, in contrast to the
   *  status surface which caps every path and array ([#29]). */
  heading: z.string().max(GRAPH.MAX_STATUS_PATH_LENGTH),
  headingPath: z.string().max(GRAPH.MAX_STATUS_PATH_LENGTH),
  headingSlug: z.string(),
  /** 1..6; 0 marks a pre-heading preamble. */
  headingLevel: z.number().int().min(0).max(6),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** Sentinel-stripped. Spans live in `matchedTerms[].offsets` — no HTML crosses IPC.
   *  Bounded like its status siblings ([#29]). */
  snippet: z.string().max(GRAPH.MAX_STATUS_PATH_LENGTH),
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
  /** Bounded at `GRAPH.MAX_TOP_K`: `k` caps the page, so a response carrying more
   *  results than the renderer's own ceiling is malformed. Matches the status
   *  snapshot's discipline of bounding every array ([#29]). */
  results: z.array(GraphSearchResultSchema).max(GRAPH.MAX_TOP_K),
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
  correlationId: GraphOutboundCorrelationIdSchema
})
export type GraphSearchResponse = z.output<typeof GraphSearchResponseSchema>

// ─── explain (FR-032) ────────────────────────────────────────────────────────

export const GraphExplainRequestSchema = z.strictObject({
  sectionId: z.number().int().positive(),
  query: z.string().trim().min(1).max(GRAPH.MAX_QUERY_LENGTH),
  matchMode: GraphMatchMode.default('all'),
  correlationId: GraphInboundCorrelationIdSchema.optional()
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
  correlationId: GraphOutboundCorrelationIdSchema
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
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export type GraphReindexRequestInput = z.input<typeof GraphReindexRequestSchema>
export type GraphReindexRequest = z.output<typeof GraphReindexRequestSchema>

export const GraphReindexResponseSchema = z.object({
  accepted: z.boolean(),
  jobId: GraphOutboundJobIdSchema.nullable(),
  /** `GRAPH_INDEX_ALREADY_RUNNING` when a job is live — reindex is idempotent,
   *  and `jobId` then names the RUNNING job so the caller can follow it. */
  rejectedCode: GraphErrorCodeSchema.nullable(),
  correlationId: GraphOutboundCorrelationIdSchema
})
export type GraphReindexResponse = z.output<typeof GraphReindexResponseSchema>

/**
 * Cancellation is cooperative and main-side: better-sqlite3 cannot be
 * interrupted, so the in-flight batch always finishes and draining the queue is
 * the only lever. There is deliberately no `cancel` worker verb.
 */
export const GraphCancelReindexRequestSchema = z.strictObject({
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export type GraphCancelReindexRequestInput = z.input<typeof GraphCancelReindexRequestSchema>
export type GraphCancelReindexRequest = z.output<typeof GraphCancelReindexRequestSchema>

export const GraphCancelReindexResponseSchema = z.object({
  /** False when no job was running. */
  cancelled: z.boolean(),
  droppedBatches: z.number().int().nonnegative(),
  inFlightAllowedToFinish: z.boolean(),
  correlationId: GraphOutboundCorrelationIdSchema
})
export type GraphCancelReindexResponse = z.output<typeof GraphCancelReindexResponseSchema>

// ─── corpus stats ────────────────────────────────────────────────────────────

export const GraphCorpusStatsRequestSchema = z.strictObject({
  correlationId: GraphInboundCorrelationIdSchema.optional()
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
  correlationId: GraphOutboundCorrelationIdSchema
})
export type GraphCorpusStatsResponse = z.output<typeof GraphCorpusStatsResponseSchema>

// ─── status ──────────────────────────────────────────────────────────────────

/** The request stays here with its request siblings; the snapshot, progress and
 *  response payloads live in `graph-status-schema.ts` and are re-exported above. */
export const GraphStatusRequestSchema = z.strictObject({
  correlationId: GraphInboundCorrelationIdSchema.optional()
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
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export type GraphPriorityPathsRequestInput = z.input<typeof GraphPriorityPathsRequestSchema>
export type GraphPriorityPathsRequest = z.output<typeof GraphPriorityPathsRequestSchema>

export const GraphPriorityPathsResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  correlationId: GraphOutboundCorrelationIdSchema
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
