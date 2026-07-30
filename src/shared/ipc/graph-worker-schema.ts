// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schemas for the graph index-worker protocol (issue #21).
 *
 * `safeParse` at this boundary is mandatory **in both directions**: the worker
 * is the only component that writes to disk. The adapter parses every inbound
 * message and drops (with a `warn`) anything that fails; the worker parses every
 * request and replies `{ type: 'error', code: GRAPH_WORKER_PROTOCOL }` rather
 * than acting on a malformed one.
 *
 * Contract-only for #21: no worker is spawned and no adapter exists yet (#23).
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-worker-contracts.md §8.2 - the normative message union
 * @see specs/designs/sd-021-worker-contracts.md §8.8 - phase durations
 */
import { z } from 'zod'
import { GRAPH } from '../graph-constants'
import {
  ConfinedRelativePathSchema,
  GraphErrorCodeSchema,
  GraphGenerationSchema,
  GraphOutboundCorrelationIdSchema,
  GraphOutboundJobIdSchema,
  GraphReindexMode,
  GraphReindexReason
} from './graph-schema'

// ─── phase durations (§8.8) ──────────────────────────────────────────────────

/**
 * Frozen phase list. A 40-minute reindex must be answerable from a log bundle
 * with "where did it go?", so every phase carries a duration on `ready` and on
 * every `result`, and also emits a `<phase>DurationMs` field on its own log line.
 */
export const GRAPH_PHASES = [
  'open',
  'integrity_check',
  'audit',
  'rebuild',
  'discover',
  'read',
  'parse',
  'hash',
  'write_txn',
  'fts_merge',
  'search'
] as const
export type GraphPhase = (typeof GRAPH_PHASES)[number]

/** Partial — a message reports only the phases it actually ran. */
export const GraphPhaseDurationsSchema = z.partialRecord(
  z.enum(GRAPH_PHASES),
  z.number().nonnegative()
)
export type GraphPhaseDurations = z.output<typeof GraphPhaseDurationsSchema>

// ─── envelope ────────────────────────────────────────────────────────────────

/**
 * Present on EVERY message in both directions — fences and tracing travel
 * together. Spread into each union member rather than nested, so
 * `z.discriminatedUnion` can still see the `type` literal at the top level.
 *
 * The envelope carries TWO fences, `switchVersion` and `sessionVersion`.
 * `jobVersion` is a third fence but is **per-message**, declared only on the
 * job-scoped members (`index`, `result`, `progress`); see
 * {@link GraphWorkerMessageSchema} for the rule that follows from that. `jobId`
 * is a correlation string, not a version, and cannot serve either purpose.
 */
const GraphWorkerEnvelope = {
  /** Request-reply correlation key for the adapter's `pending` map. */
  id: z.number().int().positive(),
  /** Project fence — mirrors `DirectoryWatcherService.switchVersion`. */
  switchVersion: z.number().int().nonnegative(),
  /** Worker-incarnation fence — bumped on every respawn. */
  sessionVersion: z.number().int().nonnegative(),
  /** Batch/request scope (NFR-011). Main mints every id on this in-process
   *  boundary and the worker echoes it verbatim, so both directions carry the
   *  main-minted shape — hence the pattern, not the looser inbound form (D6). */
  correlationId: GraphOutboundCorrelationIdSchema,
  /** Parent scope: one reindex or DB swap spans ~200 batches. */
  jobId: GraphOutboundJobIdSchema
}

// ─── main → worker ───────────────────────────────────────────────────────────

/**
 * Every main → worker shape is `z.strictObject`, unlike the renderer's response
 * schemas.
 *
 * The permissiveness argument on the renderer boundary — main may add a field
 * without breaking an older renderer mid-upgrade — has no analogue here: the
 * worker ships inside the same binary as its caller, so there is no version skew
 * to tolerate. What a plain `z.object` buys instead is silence: `jobVersion`
 * mis-cased as `jobversion` would be stripped, the request would parse, and the
 * fence that stops a cancelled job's batch from landing would be gone with
 * nothing logged. The sole writer to disk is not the boundary to be lenient at.
 */
export const GraphWorkerBatchEntrySchema = z.strictObject({
  /** Project-relative, NFC. The worker derives `path_key` itself. Confined
   *  because a batch is the write path into the index: an absolute or `..`
   *  entry here is a read-into-index primitive. */
  path: ConfinedRelativePathSchema(4096),
  op: z.enum(['upsert', 'delete', 'deleteSubtree'])
})
export type GraphWorkerBatchEntry = z.output<typeof GraphWorkerBatchEntrySchema>

export const GraphWorkerOpenRequestSchema = z.strictObject({
  ...GraphWorkerEnvelope,
  type: z.literal('open'),
  /** Absolute path to `graph.db`. Bounded like every other path on this
   *  boundary; the real confinement is the §9.5 `realpath` check main-side. */
  dbPath: z.string().min(1).max(4096),
  projectPath: z.string().min(1).max(4096),
  expectedSchemaVersion: z.number().int().positive()
})
export type GraphWorkerOpenRequest = z.output<typeof GraphWorkerOpenRequestSchema>

export const GraphWorkerIndexRequestSchema = z.strictObject({
  ...GraphWorkerEnvelope,
  type: z.literal('index'),
  /** Monotonic job fence — bumped on cancel and on each new reindex, so a
   *  cancelled job's in-flight result cannot drive the next job's accumulator. */
  jobVersion: z.number().int().nonnegative(),
  mode: GraphReindexMode,
  batch: z.array(GraphWorkerBatchEntrySchema).max(GRAPH.MAX_BATCH_SIZE)
})
export type GraphWorkerIndexRequest = z.output<typeof GraphWorkerIndexRequestSchema>

export const GraphWorkerRebuildRequestSchema = z.strictObject({
  ...GraphWorkerEnvelope,
  type: z.literal('rebuild'),
  reason: GraphReindexReason
})
export type GraphWorkerRebuildRequest = z.output<typeof GraphWorkerRebuildRequestSchema>

/** Carries an `id` like every other request: it is awaited with a timeout. */
export const GraphWorkerCloseRequestSchema = z.strictObject({
  ...GraphWorkerEnvelope,
  type: z.literal('close')
})
export type GraphWorkerCloseRequest = z.output<typeof GraphWorkerCloseRequestSchema>

export const GraphWorkerRequestSchema = z.discriminatedUnion('type', [
  GraphWorkerOpenRequestSchema,
  GraphWorkerIndexRequestSchema,
  GraphWorkerRebuildRequestSchema,
  GraphWorkerCloseRequestSchema
])
export type GraphWorkerRequest = z.output<typeof GraphWorkerRequestSchema>

// ─── worker → main ───────────────────────────────────────────────────────────

/** Per-file failure, carried back so counters and quarantine are driven main-side. */
export const GraphWorkerSkipSchema = z.object({
  /**
   * ABSOLUTE — the worker's own view, hence the 4096 ceiling. Main projects it
   * to project-relative and truncates to `GRAPH.MAX_STATUS_PATH_LENGTH` before
   * it becomes `GraphRecentSkip.relativePath` (#29).
   *
   * Deliberately NOT `ConfinedRelativePathSchema`: this path is absolute by
   * design, so confining it would reject every real payload. Confinement is
   * applied downstream, on the projected `relativePath`.
   */
  path: z.string().min(1).max(4096),
  /** `GRAPH_INDEX_FILE_UNREADABLE` | `_FILE_TOO_LARGE` | `_PARSE_FAILED`. */
  code: GraphErrorCodeSchema
})
export type GraphWorkerSkip = z.output<typeof GraphWorkerSkipSchema>

/**
 * Shaped in full because it feeds `GraphProgress.skippedFiles` and
 * `corpus_stats.skipped_file_count` — leaving it undefined would have had #23,
 * #25 and #32 each invent their own.
 */
export const GraphWorkerIndexResultSchema = z.object({
  ...GraphWorkerEnvelope,
  jobVersion: z.number().int().nonnegative(),
  indexedFiles: z.number().int().nonnegative(),
  skippedFiles: z.array(GraphWorkerSkipSchema),
  sectionsWritten: z.number().int().nonnegative(),
  sectionsDeleted: z.number().int().nonnegative(),
  completedAtMs: z.number().int().nonnegative(),
  /** Wall-clock for the whole batch; `phaseDurationsMs` is the split. */
  batchDurationMs: z.number().nonnegative(),
  phaseDurationsMs: GraphPhaseDurationsSchema
})
export type GraphWorkerIndexResult = z.output<typeof GraphWorkerIndexResultSchema>

export const GraphWorkerReadySchema = z.object({
  ...GraphWorkerEnvelope,
  /** Random 64-bit token, not a counter — contract C2 needs difference, not
   *  monotonicity. Serialised as a decimal string because it is a `bigint`; the
   *  adapter does `BigInt(...)` before `attach()`. One schema across all three
   *  hops (D5). */
  generation: GraphGenerationSchema,
  schemaVersion: z.number().int().positive(),
  rebuilt: z.boolean(),
  autoRebuildCount: z.number().int().nonnegative(),
  phaseDurationsMs: GraphPhaseDurationsSchema
})
export type GraphWorkerReady = z.output<typeof GraphWorkerReadySchema>

/**
 * Structured error. `code` crosses IPC; `detail` is LOG-ONLY and MUST be
 * stripped before any renderer or MCP payload is composed — it may contain
 * absolute paths and SQLite messages.
 */
export const GraphWorkerErrorSchema = z.object({
  ...GraphWorkerEnvelope,
  code: GraphErrorCodeSchema,
  detail: z.string().max(2048).optional()
})
export type GraphWorkerError = z.output<typeof GraphWorkerErrorSchema>

/**
 * A stream, not a reply: it carries an `id` for fencing symmetry but must never
 * be routed through the adapter's `pending` map.
 */
export const GraphWorkerProgressSchema = z.object({
  ...GraphWorkerEnvelope,
  jobVersion: z.number().int().nonnegative(),
  processedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  skippedFiles: z.number().int().nonnegative(),
  /**
   * ABSOLUTE, so it keeps the 4096 ceiling the other worker paths use — this is
   * the worker's own filesystem view. Main projects it to project-relative and
   * **truncates to `GRAPH.MAX_STATUS_PATH_LENGTH`** before it reaches
   * `GraphProgressSchema.currentFilePath` (#29). The two bounds differ on
   * purpose; what must never happen is main forwarding this value unprojected,
   * which would fail the status snapshot rather than the field.
   *
   * IPC-payload only; never logged raw (§9.8).
   *
   * Deliberately NOT `ConfinedRelativePathSchema`: this is the worker's absolute
   * filesystem view, so confining it would reject every real payload.
   * Confinement is applied downstream, on the projected/truncated status path.
   */
  currentFilePath: z.string().max(4096).nullable()
})
export type GraphWorkerProgress = z.output<typeof GraphWorkerProgressSchema>

export const GraphWorkerIndexResultMessageSchema = GraphWorkerIndexResultSchema.extend({
  type: z.literal('result')
})
export const GraphWorkerErrorMessageSchema = GraphWorkerErrorSchema.extend({
  type: z.literal('error')
})
export const GraphWorkerReadyMessageSchema = GraphWorkerReadySchema.extend({
  type: z.literal('ready')
})
export const GraphWorkerProgressMessageSchema = GraphWorkerProgressSchema.extend({
  type: z.literal('progress')
})
export type GraphWorkerProgressMessage = z.output<typeof GraphWorkerProgressMessageSchema>

/**
 * The reply to a `close` request. `close` is awaited with a timeout through the
 * adapter's `pending` map (`IGraphIndexWorker.close()`), so the worker's honest
 * acknowledgement needs a home in the union — without it a real `closed` fails
 * `safeParse`, is dropped as a protocol error, and every close hangs to
 * `WORKER_CLOSE_TIMEOUT` before a force-terminate that {@link IGraphIndexWorker}
 * documents as the FAILURE path.
 *
 * `checkpointed` reports whether SQLite completed its final
 * checkpoint-and-delete of `-wal`/`-shm`; `phaseDurationsMs` keeps close on the
 * same "answer 'where did it go?' from a log bundle" contract as every other
 * reply (it reports the `write_txn`/`fts_merge` split of the shutdown).
 *
 * The envelope's `jobId` is kept, not sentinelled or split away: the envelope is
 * uniform by design ("present on EVERY message in both directions"), and the
 * `close` REQUEST already carries a `jobId` — a shutdown is part of a DB-swap or
 * teardown scope, which is exactly what a job id names ("minted once per reindex
 * or DB swap"). It is a correlation string here, not the `jobVersion` fence
 * (which stays absent from lifecycle verbs). Breaking envelope uniformity for one
 * verb would cost more than the field.
 */
export const GraphWorkerClosedMessageSchema = z.object({
  ...GraphWorkerEnvelope,
  type: z.literal('closed'),
  checkpointed: z.boolean(),
  phaseDurationsMs: GraphPhaseDurationsSchema
})
export type GraphWorkerClosed = z.output<typeof GraphWorkerClosedMessageSchema>

/**
 * Worker → main union, and the **normative fencing rule** for it.
 *
 * "Triple fence on every inbound message" is not implementable as written:
 * `jobVersion` is per-message, not on the envelope, so `ready` and `error` have
 * no third fence to check and an adapter written to the absolute rule would drop
 * every one of them. The real rule, which the schemas above implement:
 *
 * - **Replies** (`ready`, `error`, `result`, `closed`) are correlated by `id`
 *   through the adapter's `pending` map, and fenced on `switchVersion` +
 *   `sessionVersion`. `result` is additionally fenced on `jobVersion`, so a
 *   cancelled job's in-flight batch cannot drive the next job's accumulator.
 * - The **stream** (`progress`) is never routed through `pending` — it carries
 *   an `id` only for symmetry — and IS triple-fenced (`switchVersion`,
 *   `sessionVersion`, `jobVersion`), because a late `progress` from a terminated
 *   worker or a pre-switch project would otherwise drive the status bar.
 *
 * `jobVersion` is absent from `open`, `rebuild`, `close` and `closed` for the
 * same reason: they are lifecycle verbs, scoped by `sessionVersion`, not by a job.
 *
 * @see specs/designs/sd-021-worker-contracts.md §8.2 - the normative union
 */
export const GraphWorkerMessageSchema = z.discriminatedUnion('type', [
  GraphWorkerIndexResultMessageSchema,
  GraphWorkerErrorMessageSchema,
  GraphWorkerReadyMessageSchema,
  GraphWorkerProgressMessageSchema,
  GraphWorkerClosedMessageSchema
])
export type GraphWorkerMessage = z.output<typeof GraphWorkerMessageSchema>
