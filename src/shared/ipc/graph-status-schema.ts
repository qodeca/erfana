// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schemas for the graph status surface (issue #21).
 *
 * Split out of `graph-schema.ts` at the point §4.2 names, before M3 grew it
 * further: the status block is the half FR-036/037/038 consume and the half
 * `#29` owns, and it has no coupling to search, explain or the job verbs.
 *
 * **Layering rule** — imports only `graph-error-schema.ts` (the leaf). It must
 * never import `graph-schema.ts`, which re-exports this module: a value
 * re-export in both directions is an ESM cycle, and the re-exported module is
 * evaluated FIRST, so every schema built here from `GraphErrorSchema` would hit
 * a temporal-dead-zone `ReferenceError` at import time.
 *
 * Everything here is re-exported from `graph-schema.ts` — import from either.
 *
 * Responses and events stay permissive (`z.object`, not `z.strictObject`) so
 * main can add a field without breaking an older renderer during a partial
 * upgrade — the deliberate asymmetry with the request schemas.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-ipc-contracts.md §7 - the normative contract
 * @see specs/designs/sd-021-graph-architecture.md §4.2 - the split point
 */
import { z } from 'zod'
import { GRAPH } from '../graph-constants'
import {
  ConfinedRelativePathSchema,
  GraphErrorCodeSchema,
  GraphErrorSchema,
  GraphGenerationSchema
} from './graph-error-schema'

/**
 * Six members. `error` is deliberately absent: every plausible producer is
 * routed to `degraded`, `disabled` or a rebuild by a contract that says so, so
 * it would have no producer, no exit and no meaning.
 */
export const GraphIndexState = z.enum([
  'uninitialized',
  'opening',
  'ready',
  'indexing',
  'degraded',
  'disabled'
])
export type GraphIndexState = z.infer<typeof GraphIndexState>

/** `grey` is the null state (no project / not yet initialised) — erratum E6. */
export const GraphStatusDot = z.enum(['grey', 'green', 'yellow', 'red'])
export type GraphStatusDot = z.infer<typeof GraphStatusDot>

export const GraphBreakerState = z.enum(['closed', 'open', 'half-open'])
export type GraphBreakerState = z.infer<typeof GraphBreakerState>

export const GraphProgressSchema = z.object({
  jobId: z.string().min(1),
  processedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  skippedFiles: z.number().int().nonnegative(),
  /** Project-relative. IPC-payload only; never logged, redacted or otherwise
   *  (§9.8). Bounded at `MAX_STATUS_PATH_LENGTH` like every other relative path
   *  in this payload — an unbounded string pushed at `MAX_STATUS_PUSH_RATE_HZ`
   *  is the one field with no ceiling at all, and a ceiling that disagrees with
   *  its siblings blanks the snapshot instead. #29 truncates; this is a
   *  backstop — hence `truncatable`, so a byte-truncated trailing `..` does not
   *  fail the whole snapshot (see `isConfinedTruncatedPath`). */
  currentFilePath: ConfinedRelativePathSchema(GRAPH.MAX_STATUS_PATH_LENGTH, {
    truncatable: true
  }).nullable(),
  startedAtMs: z.number().int().nonnegative()
})
export type GraphProgress = z.output<typeof GraphProgressSchema>

export const GraphRecentSkipSchema = z.object({
  code: GraphErrorCodeSchema,
  /** IPC-payload only; never logged (§9.8). #29 truncates to the bound, so
   *  confinement is `truncatable` — a severed trailing `..` must not blank the
   *  skip surface. */
  relativePath: ConfinedRelativePathSchema(GRAPH.MAX_STATUS_PATH_LENGTH, { truncatable: true })
})
export type GraphRecentSkip = z.output<typeof GraphRecentSkipSchema>

export const GraphStatusSnapshotSchema = z.object({
  /** Absolute, and the only absolute path on this boundary — the Settings panel
   *  names the directory being indexed. Keeps the 4096 absolute-path ceiling
   *  rather than `MAX_STATUS_PATH_LENGTH`: it is one field per snapshot, not a
   *  per-file array, and truncating a project root would misname it.
   *
   *  Deliberately NOT `ConfinedRelativePathSchema`: it is absolute by design, so
   *  confinement would reject every real payload. Do not "fix" this to match the
   *  confined sibling paths. */
  projectPath: z.string().max(4096).nullable(),
  state: GraphIndexState,
  dot: GraphStatusDot,
  /** Orthogonal to `state`: a stale index is degraded + true, a down reader is
   *  degraded + false. FR-037/038 cannot render the difference without it. */
  searchAvailable: z.boolean(),
  progress: GraphProgressSchema.nullable(),
  queueDepth: z.number().int().nonnegative(),
  /** FR-038. Project-relative, bounded in count and in element length — an
   *  uncapped preview is ~80 KB per snapshot at the push rate. IPC-payload only
   *  (§9.8). #29 truncates each entry to the bound, so each element uses
   *  `truncatable` confinement (a severed trailing `..` must not blank the
   *  preview). */
  queuedFilePaths: z
    .array(ConfinedRelativePathSchema(GRAPH.MAX_STATUS_PATH_LENGTH, { truncatable: true }))
    .max(GRAPH.MAX_QUEUE_PREVIEW),
  /** Bounded per-file skip surface, so `GRAPH_INDEX_PARSE_FAILED` has somewhere
   *  to go other than thrashing `lastError` across a 10k-file pass. */
  recentSkips: z.array(GraphRecentSkipSchema).max(GRAPH.MAX_RECENT_SKIPS),
  stale: z.boolean(),
  lastError: GraphErrorSchema.nullable(),
  lastIndexedAtMs: z.number().int().nonnegative().nullable(),
  lastIndexDurationMs: z.number().nonnegative().nullable(),
  schemaVersion: z.number().int().positive().nullable(),
  /**
   * §9.10 / E5 rebuild budget, read back from `graph_meta.auto_rebuild_count`
   * through the `rebuildBudget` query.
   *
   * Without this pair the budget is unreachable from the UI that E5 requires to
   * show it: the three keys are persisted, but nothing on a renderer-facing
   * payload carried them, so "Settings shows the count and reason" had no wire.
   *
   * Optional rather than defaulted to 0: a snapshot published before the reader
   * is attached has nothing to read, and "unknown" must not render as "no
   * rebuilds have happened".
   */
  autoRebuildCount: z.number().int().nonnegative().optional(),
  /**
   * Why the last automatic rebuild ran — `'corruption'`, `'schema-mismatch'` or
   * `'overflow-reconcile'` in practice, from `graph_meta.last_auto_rebuild_reason`.
   *
   * Bounded text rather than `GraphReindexReason`: the source is an
   * unconstrained TEXT column written by the writer, and a strict enum would
   * fail the WHOLE snapshot's `safeParse` on one unexpected token — blanking the
   * indicator whose entire job is to report that something is wrong. #29 maps
   * the known tokens to copy and falls back to a generic line; the raw token is
   * never rendered.
   */
  lastAutoRebuildReason: z.string().max(64).nullable().optional(),
  /** Diagnostics. These four fully determine whether a search can return rows,
   *  and the log-parity invariant requires them on the state-transition line.
   *  The same decimal-string form as the worker `ready` reply and the on-disk
   *  token (D5): the snapshot builder does `reader.generation().toString()`, so
   *  `BigInt(snapshot.generation)` on an accepted value round-trips a 64-bit
   *  token exactly. Null before the reader is attached. */
  generation: GraphGenerationSchema.nullable(),
  sessionVersion: z.number().int().nonnegative(),
  restartAttempts: z.number().int().nonnegative(),
  breakerState: GraphBreakerState,
  /** Non-null when a checkpoint was refused and the WAL is growing (contract C8). */
  walSizeBytes: z.number().int().nonnegative().nullable()
})
export type GraphStatusSnapshot = z.output<typeof GraphStatusSnapshotSchema>

/**
 * Pushed over `graph:statusChanged`. `correlationId` lives on the envelope, not
 * the snapshot, so a hide-the-indicator event (`snapshot: null`) still carries one.
 */
export const GraphStatusChangePayloadSchema = z.object({
  snapshot: GraphStatusSnapshotSchema.nullable(),
  correlationId: z.string().min(1),
  jobId: z.string().min(1).nullable()
})
export type GraphStatusChangePayload = z.output<typeof GraphStatusChangePayloadSchema>

/**
 * Envelope, not a bare `null`: the Settings panel must be able to tell "no
 * project" from "reader down" from "the query threw", or it picks no
 * `ERROR_MESSAGES` entry and renders an unexplained blank.
 */
export const GraphStatusResponseSchema = z.object({
  snapshot: GraphStatusSnapshotSchema.nullable(),
  error: GraphErrorSchema.nullable(),
  correlationId: z.string().min(1)
})
export type GraphStatusResponse = z.output<typeof GraphStatusResponseSchema>
