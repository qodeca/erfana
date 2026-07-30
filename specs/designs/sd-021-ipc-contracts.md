<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-021 part 4 — IPC contracts: renderer bridge and MCP port (AC-1)

Part of the SD-021 set — index in [`sd-021-graph-architecture.md` §0](sd-021-graph-architecture.md). Covers **§7**. Worker protocol: [`sd-021-worker-contracts.md`](sd-021-worker-contracts.md) §8. Queries: [`sd-021-db-schema.md`](sd-021-db-schema.md) §6.5.

---

## 7. IPC contracts

### 7.0 Conventions that apply to every schema below

**Strictness (m4).** Zod strips unrecognised keys by default — safe, but not *correct* at a trust boundary. A renderer sending `matchmode: 'any'` (case typo) or `excludeSection: 12` (missing `Id`) would parse successfully, the key would be dropped, and `.default()` would supply `'all'`/`undefined` — so #28's sidebar silently returns zero rows under implicit AND, the exact bug §7.2 exists to fix, reachable by typo. `GraphSearchFiltersSchema` is worst: a dropped filter **widens** results rather than erroring.

- **Requests and filters use `z.strictObject`** — the inbound, typo-reachable direction.
- **Responses and events stay permissive** so main can add a field without breaking an older renderer during a partial upgrade.

**Two types per request (M14).** In Zod 4 `z.infer` aliases `z.output`, and `.default()` affects only the output type: the field is optional on **input** and required on **output**. Typing callers against `z.infer` would have forced #27/#28/#30 to write `{query, matchMode:'all', k:10, offset:0}` at every call site — defeating the defaults and hard-coding constants into the renderer instead of `GRAPH`. Every request therefore exports both:

```ts
export type GraphSearchRequestInput = z.input<typeof GraphSearchRequestSchema>
export type GraphSearchRequest      = z.output<typeof GraphSearchRequestSchema>  // "Resolved"
```

`GraphBridge` and `IGraphQueryService` are typed against **`…Input`**; `IGraphSearchService` against the **branded** resolved type and everything else downstream of `safeParse` against the resolved type. **The preload passes `request ?? {}`** for the four optional-argument bridge methods — `Schema.parse(undefined)` throws on a `z.object`, and revision 2 never said who substituted the empty object.

**Validated brand (S-[6]).** `IGraphSearchService.search` claimed to take an "already validated" request, but the resolved `z.output` type is structurally assignable *from* the input type, so parse-once, parse-twice and parse-never all typechecked and a hand-built literal (defaults filled, refinements skipped) satisfied it. The fix brands the validated form — `GraphSearchRequestValidated = GraphSearchRequest & { readonly [unique symbol]: true }`, minted only by `parseSearchRequest()` — and `IGraphSearchService.search` demands the brand, so **skipping the parse is now a compile error**. `IGraphQueryService` (typed against `…Input`) owns that single `parseSearchRequest` call; branding was chosen over "take the `z.output` type" because `z.output` proves only that an object is *shaped* like a resolved request, whereas the header's claim is that it is *validated* — only a value the parse funnel produced proves the refinements ran.

**Correlation (§7.9).** Request fields are `.optional()`; response, echo and event fields are **required**. Per D6 the two directions carry different schemas: **outbound / echo / response** ids are pattern-pinned (`GraphOutboundCorrelationIdSchema` = `/^idx-\d+-[0-9a-f]{12}$/`, `GraphOutboundJobIdSchema` = `/^job-.../`) because they always carry a main-minted value; **inbound request** ids are `GraphInboundCorrelationIdSchema` (`.min(1).max(128).refine(isModelSafeText)`) — bounded and model-safe but NOT pattern-pinned, because §7.9 lets a caller supply its own trace id, which the pattern would reject. Main echoes a supplied id when it still matches the outbound pattern, else mints one. Both `correlationId` (per request) and `jobId` (per reindex/DB-swap) appear wherever a job is in scope. The two patterns and `isModelSafeText` are hoisted to the shared leaf `graph-error-schema.ts`, so `src/shared/ipc/*` schemas and the main-side `graphCorrelation.ts` generator import the same source.

**Error codes (m5).** `z.enum(ErrorCode)` is valid in Zod 4 for an externally-declared TypeScript enum, and `z.nativeEnum` is deprecated — revision 2's "confirm the form and fall back" hedge is deleted as dead text. But `ErrorCode` is also **too broad**: only the graph/MCP subset is producible here, so a `WHISPER_*` code would validate on a graph channel and #27/#29 would get no exhaustive switch.

```ts
export const GRAPH_ERROR_CODES = [ErrorCode.GRAPH_DB_OPEN_FAILED, /* … */] as const
export const GraphErrorCodeSchema = z.enum(GRAPH_ERROR_CODES)
```

The set is **26 codes**, not revision 2's 23: `GRAPH_DB_MOVED` (M24), `GRAPH_DB_DISK_FULL` and `GRAPH_INDEX_FILE_TOO_LARGE` (M20), and `GRAPH_WORKER_PROTOCOL` (B6) were added, and the phantom `GRAPH_DB_NOT_WRITABLE` was removed (m9). `GRAPH_INDEX_ALREADY_RUNNING` is the 26th (§7.5).

```ts
export const GraphErrorSchema = z.object({
  code: GraphErrorCodeSchema,
  atMs: z.number().int().nonnegative(),
  /** Project-relative path when the error is attributable to one file (M22). Never
   *  absolute — enforced by the same isConfinedRelativePath refine the priority-path
   *  list uses, because "never absolute" as a comment is not a constraint and this
   *  field is composed from a path the indexer was HANDED. */
  relativePath: z.string().max(1024).refine(isConfinedRelativePath).nullable().default(null)
})
```

### 7.1 `src/shared/ipc/graph-channels.ts`

```ts
export const GraphChannels = {
  SEARCH: 'graph:search',
  EXPLAIN: 'graph:explain',                 // FR-032 "why this result?" (M16)
  REINDEX: 'graph:reindex',
  CANCEL_REINDEX: 'graph:cancelReindex',
  GET_CORPUS_STATS: 'graph:getCorpusStats',
  GET_STATUS: 'graph:getStatus',
  SET_PRIORITY_PATHS: 'graph:setPriorityPaths'   // FR-049
} as const

export const GraphEvents = { STATUS_CHANGED: 'graph:statusChanged' } as const

export type GraphChannel = (typeof GraphChannels)[keyof typeof GraphChannels]
export type GraphEvent = (typeof GraphEvents)[keyof typeof GraphEvents]
```

All seven are `invoke`; the one event is a push. A single status channel (not separate progress/status channels) mirrors `claude-status:changed`: FR-036/037/038 must land in one renderer commit.

### 7.2 Search request

```ts
export const GraphMatchMode = z.enum(['all', 'any'])

// §7.0 base/leaf split. The filter/request SHAPES live in unrefined `*BaseSchema`
// objects; the renderer-facing leaves (`GraphSearchFiltersSchema`,
// `GraphSearchRequestSchema`) derive from them, and later joint refinements
// (`offset + k`, `modifiedAfterMs <= modifiedBeforeMs`) attach to the LEAVES.
// This is load-bearing: zod 4 throws on `.pick()`/`.omit()`/`.check()` applied to
// an object that carries a refinement, and §7.10's `GraphMcpToolArgsSchema`
// derives from the bases with `.pick()`/`.omit()`.

export const GraphSearchFiltersBaseSchema = z.strictObject({
  /**
   * Project-relative POSIX prefix. MUST end in '/' — 'doc' would otherwise match
   * documentation/ and doc-archive/ via the substr() prefix compare, silently and
   * with no error, and FR-031's folder-tree picker sends whatever label the node
   * yields. The transform is why z.input !== z.output here (M14/M17).
   */
  folder: z.string().max(1024)
    .transform((s) => (s.endsWith('/') ? s : `${s}/`))
    // Confinement runs AFTER the transform, so it validates the '/'-terminated
    // value that flows downstream: a trailing '/' is confined, a leading one is
    // not. It also rejects '' (the transform yields '/'), so B3's `.min(1)` is
    // redundant with confinement and is NOT added.
    .refine(isConfinedRelativePath).optional(),
  /** Lowercase, leading dot. 'md' / '.MD' / '*.md' previously returned zero rows
   *  with error:null — indistinguishable from a genuine no-match (M17). */
  fileType: z.string().regex(/^\.[a-z0-9]+$/).max(16).optional(),
  modifiedAfterMs: z.number().int().nonnegative().optional(),
  modifiedBeforeMs: z.number().int().nonnegative().optional(),
  /** Confined like every file path on the boundary (§9.5). */
  excludeFilePath: ConfinedRelativePathSchema(4096).optional(),
  /** AC-018: omit the CURRENT section, keeping sibling sections eligible. */
  excludeSectionId: z.number().int().positive().optional()
})
/** Renderer-facing leaf — currently the base verbatim; joint refinements attach here. */
export const GraphSearchFiltersSchema = GraphSearchFiltersBaseSchema

export const GraphSearchRequestBaseSchema = z.strictObject({
  query: z.string().trim().min(1).max(GRAPH.MAX_QUERY_LENGTH),
  /** 'all' = implicit AND (typed query). 'any' = OR, required for #28's passage
   *  queries, which return zero rows under AND. */
  matchMode: GraphMatchMode.default('all'),
  k: z.number().int().min(1).max(GRAPH.MAX_TOP_K).default(GRAPH.DEFAULT_TOP_K),
  /** Bounded by the probe cap so totalMatched/hasMore stay defined (§7.3). */
  offset: z.number().int().min(0).max(GRAPH.MAX_COUNT_PROBE - 1).default(0),
  /** False lets #26 skip highlight() entirely — §12.2's lazy fallback becomes a
   *  config change rather than a contract change (M16). */
  includeMatchedTerms: z.boolean().default(true),
  filters: GraphSearchFiltersSchema.optional(),
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
/** Renderer-facing leaf — currently the base verbatim; the `offset + k` joint bound attaches here. */
export const GraphSearchRequestSchema = GraphSearchRequestBaseSchema
```

**Passage budget.** `MAX_QUERY_LENGTH` is 4096, not 512, because #28 sends a passage. `GraphSearchService` reduces it to at most `GRAPH.MAX_QUERY_TERMS` (24) tokens by the single normative pipeline in §9 row 11 — revision 2 specified it twice, inconsistently, in two files.

**Debounce and supersede (M18).** The contract, not #27's UI, owns the rate bound: callers issue at most one search per `GRAPH.SEARCH_DEBOUNCE_MS` (120 ms) per surface, and **a newer `correlationId` for the same surface abandons the older result** — main drops the superseded response rather than racing it into the store. Without this, a search-as-you-type panel at ~10 keystrokes/s puts 10 synchronous SQLite invocations per second onto the process that also owns node-pty and every IPC channel.

**Performance trigger, restated in main-process terms.** Revision 2 nominated "p95 > 4 ms = 25 % of the 16 ms frame budget". That mis-frames the risk: the frame budget belongs to the **renderer**, and this code runs on **main**, where blocking shows up as input lag and terminal stutter, not dropped frames. The real budget is **synchronous main-thread occupancy per search: p95 < 4 ms and worst case < 16 ms**, measured with `perf_hooks.monitorEventLoopDelay`, over the **whole handler** (both §6.5 phases plus mapping), not the canonical query in isolation. Owner #31.

### 7.3 Search response

```ts
export const GraphTermOffsetSchema = z.object({
  /** Offset into the SENTINEL-STRIPPED snippet, or into heading. Never the source file. */
  start: z.number().int().nonnegative(),
  length: z.number().int().positive()
})

export const GraphMatchedTermSchema = z.object({
  /** The marked DOCUMENT token, as it appears in the snippet or heading — NOT the
   *  query term. Phase 2 issues one snippet()/highlight() with the whole multi-term
   *  :match, so FTS5 says a token matched but never WHICH query term marked it;
   *  deriving the query form needs a Porter implementation agreeing exactly with
   *  SQLite's, and is ambiguous when two terms share a stem. Exact query-form
   *  attribution comes from graph:explain, which runs one marked read per term. */
  term: z.string(),
  column: z.enum(['heading', 'text']),
  /** Renamed from `occurrences`, which had two plausible meanings an order of
   *  magnitude apart and no JSDoc (M16). Always === offsets.length. */
  occurrencesInSnippet: z.number().int().nonnegative(),
  /** True count in the whole section; null unless the caller used graph:explain. */
  occurrencesInSection: z.number().int().nonnegative().nullable().default(null),
  offsets: z.array(GraphTermOffsetSchema)
})

export const GraphSearchResultSchema = z.object({
  sectionId: z.number().int().positive(),
  filePath: z.string(),          // project-relative, NFC display form (§6.2)
  heading: z.string(),
  headingPath: z.string(),
  headingSlug: z.string(),
  headingLevel: z.number().int().min(0).max(6),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** Sentinel-stripped. Spans live in matchedTerms[].offsets — no HTML crosses IPC. */
  snippet: z.string(),
  /** True when the 30-token window omitted part of the section, so the UI can label
   *  a partial view and not read `offsets: []` as "term absent" (M16). Derived from
   *  the char(4) (EOT) truncation marker: a printable '…' is ambiguous with a section
   *  whose own prose ends in an ellipsis, and survives the C0/C1 strip into the MCP
   *  payload. EOT sits in the same C0 range as the char(2)/char(3) sentinels. */
  snippetTruncated: z.boolean(),
  /** Raw FTS5 bm25(): NEGATIVE, ascending = most relevant. Never render as a percentage. */
  score: z.number(),
  matchedTerms: z.array(GraphMatchedTermSchema)
})

export const GraphSearchResponseSchema = z.object({
  results: z.array(GraphSearchResultSchema),
  /** Rows returned by §6.5 phase 1, bounded by GRAPH.MAX_COUNT_PROBE. */
  totalMatched: z.number().int().nonnegative(),
  totalMatchedCapped: z.boolean(),
  hasMore: z.boolean(),
  offset: z.number().int().nonnegative(),
  k: z.number().int().positive(),
  /** Covers BOTH phases of §6.5 plus result mapping — the whole handler, not one query. */
  queryDurationMs: z.number().nonnegative(),
  degraded: z.boolean(),
  error: GraphErrorSchema.nullable(),
  correlationId: GraphOutboundCorrelationIdSchema
})
```

**Probe skip (m6).** When `offset === 0 && results.length < k`, `totalMatched` is exactly `results.length`: phase 1 is capped at `k + 1` instead of `MAX_COUNT_PROBE`, `totalMatchedCapped = false`, `hasMore = false`. Revision 2 walked up to 1000 matching rows unconditionally — every match in the corpus when fewer than 1000 exist — for the majority of real searches.

The handler **never throws**: failure returns `{results: [], error: {…}, degraded: true}`. Zero surviving query terms short-circuits to an empty result set **without touching SQLite**.

### 7.4 Explain (M16)

FR-032 requires matched terms *with context snippets* — plural, per term. One 30-token `snippet()` window cannot supply that, and §12.2's own contingency ("compute `matchedTerms` lazily on expansion") had no request flag and no channel, so executing the documented fallback would have required editing `graph-schema.ts` and adding a channel — exactly the reopen #21 exists to prevent.

```ts
export const GraphExplainRequestSchema = z.strictObject({
  sectionId: z.number().int().positive(),
  query: z.string().trim().min(1).max(GRAPH.MAX_QUERY_LENGTH),
  matchMode: GraphMatchMode.default('all'),
  correlationId: GraphInboundCorrelationIdSchema.optional()
})

export const GraphExplainResponseSchema = z.object({
  sectionId: z.number().int().positive(),
  /** One window per term occurrence, not one per result. */
  windows: z.array(z.object({
    term: z.string(),
    column: z.enum(['heading', 'text']),
    text: z.string(),                       // sentinel-stripped context
    offsets: z.array(GraphTermOffsetSchema)
  })),
  occurrencesInSection: z.record(z.string(), z.number().int().nonnegative()),
  error: GraphErrorSchema.nullable(),
  correlationId: GraphOutboundCorrelationIdSchema
})
```

Backed by `GRAPH_QUERIES.explain` (§6.4).

### 7.5 Reindex, cancel, corpus stats, status, priority paths

```ts
export const GraphReindexMode = z.enum(['full', 'incremental'])
export const GraphReindexReason =
  z.enum(['user', 'corruption', 'schema-mismatch', 'overflow-reconcile'])

export const GraphReindexRequestSchema = z.strictObject({
  mode: GraphReindexMode.default('full'),
  reason: GraphReindexReason.default('user'),
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export const GraphReindexResponseSchema = z.object({
  accepted: z.boolean(),
  jobId: GraphOutboundJobIdSchema.nullable(),
  /** GRAPH_INDEX_ALREADY_RUNNING when a job is live — reindex is IDEMPOTENT, and
   *  jobId then names the RUNNING job so the caller can follow it (m9). */
  rejectedCode: GraphErrorCodeSchema.nullable(),
  correlationId: GraphOutboundCorrelationIdSchema
})

/** Cooperative and MAIN-SIDE: better-sqlite3 cannot be interrupted, so the in-flight
 *  batch finishes and draining the queue is the only lever. No 'cancel' worker verb. */
export const GraphCancelReindexRequestSchema = z.strictObject({
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export const GraphCancelReindexResponseSchema = z.object({
  cancelled: z.boolean(),              // false when no job was running (m9)
  droppedBatches: z.number().int().nonnegative(),
  inFlightAllowedToFinish: z.boolean(),
  correlationId: GraphOutboundCorrelationIdSchema
})

export const GraphCorpusStatsRequestSchema = z.strictObject({
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export const GraphCorpusStatsSchema = z.object({
  fileCount: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),      // section ROWS
  wordCount: z.number().int().nonnegative(),         // summed over section ROWS (m2)
  uniqueContentCount: z.number().int().nonnegative(),// contents ROWS
  skippedFileCount: z.number().int().nonnegative(),  // last full pass (§6.3)
  lastIndexedAtMs: z.number().int().nonnegative().nullable(),
  schemaVersion: z.number().int().positive(),
  /** Relaxed from z.literal('beta') so the freeze is not itself a breaking change (m4). */
  schemaStability: z.enum(['beta', 'stable']),
  dbSizeBytes: z.number().int().nonnegative().nullable()
})

/** M15: bare `null` gave #29 no way to tell "no project" from "reader down" from
 *  "the query threw", so it could pick no ERROR_MESSAGES entry and rendered an
 *  unexplained blank — the exact failure §9 row 13 was written to prevent. */
export const GraphCorpusStatsResponseSchema = z.object({
  stats: GraphCorpusStatsSchema.nullable(),
  error: GraphErrorSchema.nullable(),
  correlationId: GraphOutboundCorrelationIdSchema
})

export const GraphStatusRequestSchema = z.strictObject({
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export const GraphStatusResponseSchema = z.object({
  snapshot: GraphStatusSnapshotSchema.nullable(),
  error: GraphErrorSchema.nullable(),
  correlationId: GraphOutboundCorrelationIdSchema
})

export const GraphPriorityPathsRequestSchema = z.strictObject({
  /** Project-relative; absolute paths and any '..' segment are rejected (§9.5). */
  paths: z.array(z.string().max(4096).refine(isConfinedRelativePath)).max(GRAPH.MAX_PRIORITY_PATHS),
  correlationId: GraphInboundCorrelationIdSchema.optional()
})
export const GraphPriorityPathsResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  correlationId: GraphOutboundCorrelationIdSchema
})
```

### 7.6 Status snapshot and push

```ts
/** Six members — `error` deleted: every plausible producer is routed elsewhere by a
 *  contract that says so in words (§8.6). */
export const GraphIndexState =
  z.enum(['uninitialized', 'opening', 'ready', 'indexing', 'degraded', 'disabled'])
export const GraphStatusDot = z.enum(['grey', 'green', 'yellow', 'red'])
export const GraphBreakerState = z.enum(['closed', 'open', 'half-open'])

export const GraphProgressSchema = z.object({
  jobId: GraphOutboundJobIdSchema,
  processedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  skippedFiles: z.number().int().nonnegative(),
  // Project-relative, bounded by the ONE status-surface ceiling; IPC-payload
  // only, never logged raw (§9.6). `truncatable`: #29 truncates at a BYTE
  // boundary, so a severed trailing `..` must not blank the snapshot (§9.5).
  currentFilePath:
    ConfinedRelativePathSchema(GRAPH.MAX_STATUS_PATH_LENGTH, { truncatable: true }).nullable(),
  startedAtMs: z.number().int().nonnegative()
})

export const GraphStatusSnapshotSchema = z.object({
  /** Absolute by design — the only absolute path on this boundary — so
   *  deliberately NOT confined; confinement would reject every real payload. */
  projectPath: z.string().max(4096).nullable(),
  state: GraphIndexState,
  dot: GraphStatusDot,
  /** Orthogonal to `state`: a stale index is degraded+true, a down reader is
   *  degraded+false. Without it FR-037/038 cannot render the difference. */
  searchAvailable: z.boolean(),
  progress: GraphProgressSchema.nullable(),
  queueDepth: z.number().int().nonnegative(),
  queuedFilePaths: z.array(
    ConfinedRelativePathSchema(GRAPH.MAX_STATUS_PATH_LENGTH, { truncatable: true })
  ).max(GRAPH.MAX_QUEUE_PREVIEW),  // FR-038, m7
  /** Bounded per-file skip surface, so GRAPH_INDEX_PARSE_FAILED has somewhere to
   *  go other than thrashing `lastError` across a 10k-file pass (m9). */
  recentSkips: z.array(z.object({
    code: GraphErrorCodeSchema,
    relativePath: ConfinedRelativePathSchema(GRAPH.MAX_STATUS_PATH_LENGTH, { truncatable: true })
  })).max(GRAPH.MAX_RECENT_SKIPS),
  stale: z.boolean(),
  lastError: GraphErrorSchema.nullable(),
  lastIndexedAtMs: z.number().int().nonnegative().nullable(),
  lastIndexDurationMs: z.number().nonnegative().nullable(),
  schemaVersion: z.number().int().positive().nullable(),
  /** §9.10 / E5: the rebuild budget must be SHOWN with its count and reason, and
   *  three graph_meta keys hold it — so the snapshot has to carry it or Settings
   *  has no wire. Read via GRAPH_QUERIES.rebuildBudget. Optional, not defaulted:
   *  absent means "not read yet", which must not render as "never rebuilt". The
   *  reason is bounded TEXT, not GraphReindexReason — the source column carries
   *  no CHECK, and a strict enum would fail the WHOLE snapshot's safeParse on one
   *  unexpected token, blanking the indicator that exists to report the fault. */
  autoRebuildCount: z.number().int().nonnegative().optional(),
  lastAutoRebuildReason: z.string().max(64).nullable().optional(),
  /** M28 diagnostics — every field the UI shows must be recoverable from a log
   *  bundle, and these four fully determine whether a search can return rows. */
  generation: z.string().nullable(),
  sessionVersion: z.number().int().nonnegative(),
  restartAttempts: z.number().int().nonnegative(),
  breakerState: GraphBreakerState,
  /** C8: non-null when a checkpoint was refused and the WAL is growing. */
  walSizeBytes: z.number().int().nonnegative().nullable()
})

/** correlationId lives on the ENVELOPE, not the snapshot, so a hide-the-indicator
 *  event (snapshot: null) still carries one (M15). */
export const GraphStatusChangePayloadSchema = z.object({
  snapshot: GraphStatusSnapshotSchema.nullable(),
  correlationId: GraphOutboundCorrelationIdSchema,
  jobId: GraphOutboundJobIdSchema.nullable()
})
```

**Push rate — MIN, not MAX (m7).** Emit when `elapsed ≥ GRAPH.STATUS_PUSH_MIN_INTERVAL_MS` **AND** (a file was processed **or** the state changed). Revision 2's `OR` gave the combined rate no ceiling: at 2000 files/s — plausible, since NFR-002 is a floor — that is 40 pushes/s, each composed, `safeParse`d, structure-cloned, broadcast to every window and committed into React, with `queuedFilePaths` uncapped in string length at ~80 KB/snapshot ≈ 3 MB/s arriving precisely when the machine is saturated. `GRAPH.MAX_STATUS_PUSH_RATE_HZ` (10) is the stated ceiling; element length is capped at `GRAPH.MAX_STATUS_PATH_LENGTH`. State transitions and terminal snapshots still emit immediately and are never dropped. AC-011's "at least every 50 files" holds because a file-processed tick always accompanies the interval.

**One ceiling for relative paths on the status surface (M6).** Revision 3 bounded `currentFilePath` at 4096 and `queuedFilePaths` / `recentSkips[].relativePath` / `GraphError.relativePath` at 1024, which made a 1025–4096-character path clear the worker boundary (`GraphWorkerSkipSchema.path`, `GraphWorkerProgressSchema.currentFilePath` — both 4096, both **absolute**, correctly so) and then fail `GraphStatusSnapshotSchema` **as a whole** — blanking the indicator whose job is to report the skip, exactly the failure mode `lastAutoRebuildReason` above is worded to avoid. Resolved with `GRAPH.MAX_STATUS_PATH_LENGTH` (1024) applied to all four relative-path fields. `projectPath` keeps 4096: it is absolute, one per snapshot, and truncating a project root misnames it. **The producer truncates.** `GraphStatusPublisher` (#29) projects worker-absolute → project-relative and truncates to the bound; the zod `.max()` is a backstop, never the enforcement point, because over-length must be impossible by construction rather than rejected at the boundary.

**Truncation-safe confinement (§9.5).** The three status paths are also confined — `ConfinedRelativePathSchema` refuses absolutes, `..`, NTFS ADS colons and Windows reserved device basenames — but with the `truncatable` variant (`isConfinedTruncatedPath`). #29 truncates at a **byte** boundary, which can sever a segment into a spurious trailing `..`; under strict confinement that lone artefact would fail the whole snapshot and blank the panel over a cosmetic trim — the very failure mode the backstop exists to avoid. The truncatable predicate keeps every structural guard and every **non-final** traversal segment (so `../secret`, `a/../../x` and `../..` are still rejected) but exempts the **final** segment from the `..` check, because that is the one a byte-truncation can corrupt. This keeps the schema a genuine backstop rather than a landmine; the alternative (contracting #29 to truncate on a segment boundary) would make the schema reject legitimate producer output on any naive future edit.

Delivered via `broadcastToAllWindows` (`ipcBroadcast.ts:26`) — one project per process, so every window shows the same state. Re-validated with `safeParse` immediately before `send`, mirroring `claude-status-handlers.ts:90-103`.

### 7.7 `GraphBridge`

```ts
export interface GraphBridge {
  search(request: GraphSearchRequestInput): Promise<GraphSearchResponse>
  explain(request: GraphExplainRequestInput): Promise<GraphExplainResponse>
  reindex(request?: GraphReindexRequestInput): Promise<GraphReindexResponse>
  cancelReindex(request?: GraphCancelReindexRequestInput): Promise<GraphCancelReindexResponse>
  getCorpusStats(request?: GraphCorpusStatsRequestInput): Promise<GraphCorpusStatsResponse>
  getStatus(request?: GraphStatusRequestInput): Promise<GraphStatusResponse>
  setPriorityPaths(request: GraphPriorityPathsRequestInput): Promise<GraphPriorityPathsResponse>
  onStatusChanged(cb: (payload: GraphStatusChangePayload) => void): () => void
}
```

Every method has a named request **and** response schema; no bare `null` returns and no inline anonymous types remain. `src/preload/index.d.ts` gets one line: `graph: GraphBridge`.

### 7.8 Handler contract (`src/main/ipc/graph-handlers.ts`, #26)

```ts
export function registerGraphHandlers(
  engine?: IGraphEngineService          // optional; defaults to createGraphEngineService()
): { service: IGraphEngineService; dispose: () => Promise<void> }
```

Optional-with-default is what makes returning `service` meaningful (`claude-status-handlers.ts:167-172`). Handlers take `(event, arg: unknown)`; **`isTrustedSender` is IMPORTED** from `senderValidation.ts:35`, never re-implemented; `safeParse` never `parse`; no handler throws; `dispose()` removes one handler per `GraphChannels` value. Registered in the `src/main/index.ts:276-300` block.

### 7.9 Correlation policy and contract evolution (m4)

`correlationId` optional inbound, required outbound; main echoes or mints. **Direction split (D6):** outbound/echo/response fields are pattern-pinned to the main-minted shape (`GraphOutboundCorrelationIdSchema` / `GraphOutboundJobIdSchema`); inbound request fields are `GraphInboundCorrelationIdSchema` (`.min(1).max(128).refine(isModelSafeText)`) — bounded and model-safe, not pattern-pinned, since the pattern matches only main-minted ids and a caller may supply its own. `jobId` accompanies it whenever a reindex or DB swap is in scope. `generateGraphCorrelationId()` = `` `idx-${Date.now()}-${randomBytes(6).toString('hex')}` `` (48 bits CSPRNG); `generateGraphJobId()` = `` `job-${Date.now()}-${randomBytes(6).toString('hex')}` ``. The two patterns live in `graph-error-schema.ts` (the shared leaf), re-exported from `graphCorrelation.ts`.

**Evolution rule** — revision 2 versioned the on-disk schema, the worker session and the MCP contract but said nothing about how #26–#32 may extend a wire payload:

1. A new **response or event** field must be `.optional()` or `.default()`.
2. A new **request** field must be `.optional()` — `strictObject` means an older main would otherwise reject a newer renderer.
3. Any field **removal** or type **narrowing** requires a **new channel name**; the old channel is kept for one release.
4. `schemaStability` is `z.enum(['beta','stable'])`, so the freeze is a value change rather than a breaking wire change.

### 7.10 MCP port and tool contracts (B7)

Revision 2 named `GraphPortRequestSchema`/`GraphPortResponseSchema` in prose and defined neither. Four gaps #30 would hit immediately, all closed here.

```ts
/** main ↔ utilityProcess over MessageChannelMain. `requestId` renamed to
 *  correlationId — it was the one boundary leaving the main process and used a
 *  different identifier from every other payload, breaking §7.9 there. */
// Inbound port REQUESTS use GraphInboundCorrelationIdSchema (bounded + model-safe);
// port RESPONSES use GraphOutboundCorrelationIdSchema (pattern-pinned) — D6.
export const GraphPortRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('graph:search'), correlationId: GraphInboundCorrelationIdSchema,
    /** Fenced like a worker message: one port spans arbitrary project switches (M7). */
    switchVersion: z.number().int().nonnegative(),
    payload: GraphMcpToolArgsSchema }),
  /** FR-044: complete pending requests before shutdown. */
  z.strictObject({ kind: z.literal('graph:drain'), correlationId: GraphInboundCorrelationIdSchema })
])

export const GraphPortResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('graph:search:result'), correlationId: GraphOutboundCorrelationIdSchema,
    payload: GraphMcpToolResultSchema }),
  z.strictObject({ kind: z.literal('graph:search:error'), correlationId: GraphOutboundCorrelationIdSchema,
    code: GraphErrorCodeSchema }),
  /** FR-042 backpressure needs a SIGNAL, or the peer cannot tell throttled from hung. */
  z.strictObject({ kind: z.literal('graph:throttled'), correlationId: GraphOutboundCorrelationIdSchema,
    retryAfterMs: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('graph:drained'), correlationId: GraphOutboundCorrelationIdSchema,
    completed: z.number().int().nonnegative() })
])
```

**Model-facing tool input.** Reusing `GraphSearchRequestSchema` verbatim would have handed `registerTool` a shape containing `correlationId`, `offset` and `excludeSectionId` — a DB-internal integer no model can know — while MCP requires a valid `inputSchema` that servers MUST validate.

```ts
// Derived from the unrefined BASE object, not the renderer leaf: zod 4 throws on
// `.pick()`/`.omit()` applied to an object that carries a refinement, and the
// leaves are where later joint bounds (`offset + k`, `modifiedAfterMs <=
// modifiedBeforeMs`) attach. See §7.0's base/leaf split.
export const GraphMcpToolArgsSchema = GraphSearchRequestBaseSchema
  .pick({ query: true, k: true, filters: true })
  .extend({
    k: z.number().int().min(1).max(MCP.MAX_TOP_K).default(GRAPH.DEFAULT_TOP_K),
    filters: GraphSearchFiltersBaseSchema.omit({ excludeSectionId: true }).optional()
  })

// JSON-Schema: convert with `z.toJSONSchema(GraphMcpToolArgsSchema, { io: 'input' })`.
// The default and `{ io: 'output' }` forms throw (`Transforms cannot be represented
// in JSON Schema`) on the inherited `filters.folder` transform; `io:'input'` both
// avoids that and yields `required: ["query"]`. Refinements are likewise NOT
// representable in JSON Schema, so later joint bounds are absent from the published
// `inputSchema` — zod-side validation, not the published schema, enforces them.

/** Declared as the tool's outputSchema. The untrusted-data envelope, control-char
 *  stripping and byte caps that wrap it are contracted in §9.4 (B1). */
/** The strip and the payload caps are EXPRESSED here, not just described:
 *  a schema that documents an obligation it cannot fail is a comment. McpText =
 *  z.string().max(MCP.MAX_RESULT_BYTES).refine(isModelSafeText) — the refine
 *  rejects C0 except tab/newline and all of C1 (which carry ANSI escapes and
 *  Erfana's char(2)/char(3)/char(4) snippet sentinels), AND the model-facing
 *  smuggling vectors: unpaired surrogates, bidi controls (U+202A–U+202E,
 *  U+2066–U+2069) and the Unicode tag block (U+E0000–U+E007F, an invisible ASCII
 *  mirror a model still reads). isModelSafeText scans by CODE POINT, so a tag
 *  char arriving as a surrogate pair is caught. The .max() is a CHARACTER
 *  backstop; #30 still measures the serialised byte size. */
// filePath is the one result field that is ALSO a path, so it is confined on top
// of the sentinel/bounds check (project-relative, no `..`, no ADS colon, no
// reserved device name): McpFilePath = ConfinedRelativePathSchema(MAX_RESULT_BYTES)
// .refine(isModelSafeText). This makes the "never absolute" clause enforceable
// at the external-client boundary. heading/snippet are free text, not paths.
export const GraphMcpToolResultSchema = z.object({
  // Pinned to the exact literal (S-[14]), not `.min(1)`: a truncated, localised or
  // tampered guardrail must not validate. #30 still owns emitting it once, first,
  // per response — the literal pins the VALUE, not the ordering.
  untrustedContentNotice: z.literal(MCP.UNTRUSTED_NOTICE),
  results: z.array(z.object({
    filePath: McpFilePath, heading: McpText, snippet: McpText, score: z.number()
  })).max(MCP.MAX_TOP_K),
  truncated: z.boolean()
})
```

`MCP.MAX_TOP_K` (20) is deliberately lower than the renderer's 100, and `offset` is not exposed at all: every MCP request lands on the synchronous main-thread reader from **outside** the trust boundary, so the cheapest bound is the request shape itself.
