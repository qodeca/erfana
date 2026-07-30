// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Error vocabulary and path confinement for the graph boundary (issue #21).
 *
 * **Layering rule — this module is the LEAF of the graph schema layer.** It
 * must never import from `graph-schema.ts` or `graph-status-schema.ts`.
 *
 * It exists because §4.2 splits the status block out of `graph-schema.ts`, which
 * re-exports it so no import path breaks. `GraphStatusSnapshotSchema` needs
 * `GraphErrorSchema`, so leaving the error block in `graph-schema.ts` would make
 * the two modules mutually dependent — and ESM evaluates a re-exported module
 * BEFORE the re-exporting one, so `GraphErrorSchema` would still be in its
 * temporal dead zone when the status schemas are constructed. Hoisting the
 * shared half here keeps the module graph acyclic: error ← status ← schema.
 *
 * Everything here is re-exported from `graph-schema.ts` — import from either.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-cross-cutting.md §9.2 - the code table with user copy
 * @see specs/designs/sd-021-graph-architecture.md §4.2 - the split point
 */
import { z } from 'zod'
import { ErrorCode } from '../errors'
// `graph-constants.ts` has zero imports of its own, so this cannot re-enter the
// layering cycle the header forbids.
import { GRAPH } from '../graph-constants'

/**
 * The 26 error codes producible on a graph or MCP channel.
 *
 * `ErrorCode` itself is too broad for this boundary: a `WHISPER_*` code would
 * validate on `graph:search` and the renderer would get no exhaustive switch.
 *
 * @see specs/designs/sd-021-cross-cutting.md §9.2 - the code table with user copy
 */
export const GRAPH_ERROR_CODES = [
  ErrorCode.GRAPH_DB_OPEN_FAILED,
  ErrorCode.GRAPH_DB_DIR_NOT_WRITABLE,
  ErrorCode.GRAPH_DB_CORRUPTED,
  ErrorCode.GRAPH_DB_SCHEMA_MISMATCH,
  ErrorCode.GRAPH_DB_REBUILD_FAILED,
  ErrorCode.GRAPH_DB_NOT_READY,
  ErrorCode.GRAPH_DB_MOVED,
  ErrorCode.GRAPH_DB_DISK_FULL,
  ErrorCode.GRAPH_FTS5_UNAVAILABLE,
  ErrorCode.GRAPH_WORKER_UNAVAILABLE,
  ErrorCode.GRAPH_WORKER_TIMEOUT,
  ErrorCode.GRAPH_WORKER_DISABLED,
  ErrorCode.GRAPH_WORKER_PROTOCOL,
  ErrorCode.GRAPH_SEARCH_FAILED,
  ErrorCode.GRAPH_SEARCH_QUERY_INVALID,
  ErrorCode.GRAPH_INDEX_ALREADY_RUNNING,
  ErrorCode.GRAPH_INDEX_FILE_UNREADABLE,
  ErrorCode.GRAPH_INDEX_FILE_TOO_LARGE,
  ErrorCode.GRAPH_INDEX_PARSE_FAILED,
  ErrorCode.GRAPH_INDEX_BATCH_FAILED,
  ErrorCode.GRAPH_INDEX_CANCELLED,
  ErrorCode.GRAPH_INDEX_STALE,
  ErrorCode.GRAPH_INDEX_PROJECT_CHANGED,
  ErrorCode.MCP_SERVER_START_FAILED,
  ErrorCode.MCP_SERVER_ALREADY_RUNNING,
  ErrorCode.MCP_TOOL_INVALID_ARGS
] as const

/** `z.enum` over an externally-declared TS enum — `z.nativeEnum` is deprecated. */
export const GraphErrorCodeSchema = z.enum(GRAPH_ERROR_CODES)
export type GraphErrorCode = z.infer<typeof GraphErrorCodeSchema>

/**
 * The rebuild `generation` token as it crosses every boundary: a **decimal
 * string**, not a JS number (D5).
 *
 * It is `randomBytes(8)` read as a signed 64-bit integer (contract C2 needs
 * difference, not monotonicity), so it routinely exceeds `Number.MAX_SAFE_INTEGER`
 * — `1n === 1` is permanently false and a value above 2^53 is lossy as a number.
 * A single representation on all three hops keeps it lossless: on disk in
 * `graph_meta.value` (TEXT), on the worker `ready` reply, and on the status
 * snapshot. The **main-side owner** is the only place it is a `bigint`: the
 * worker adapter does `BigInt(ready.generation)` before
 * `IGraphReadConnection.attach(dbPath, generation)`, and the snapshot builder
 * does `reader.generation().toString()` on the way back out.
 *
 * `.max(20)` bounds it to the width of the most negative int64
 * (`-9223372036854775808`, 20 chars); the regex pins it to an optionally-signed
 * run of digits so `BigInt(...)` on an accepted value cannot throw.
 */
export const GraphGenerationSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^-?\d+$/, { message: 'generation must be a decimal integer string' })

// ─── path confinement (§9.5 c) ───────────────────────────────────────────────

/**
 * True when a path component can normalise onto `..`.
 *
 * Exact equality with `'..'` is not enough on Windows, and Erfana ships there:
 * **Win32 strips trailing spaces and periods from every path component**, so
 * `'.. '` (dot-dot-space) and `'.. .'` both resolve to `..` and an exact
 * comparison accepts them. Generalised: a component built only from dots and
 * spaces that carries two or more dots normalises to a traversal — or to
 * nothing — and can never name a real file, so it is refused outright. A single
 * dot (`'./a.md'`) stays acceptable, and `'a..b'` / `'...md'` are ordinary names.
 */
function isTraversalSegment(segment: string): boolean {
  if (!/^[. ]+$/.test(segment)) return false
  const dotCount = segment.length - segment.replace(/\./g, '').length
  return dotCount >= 2
}

/**
 * True when `p` is a non-empty, project-relative path with no `..` segment.
 *
 * Rejects POSIX absolutes, Windows drive-qualified paths and UNC paths, in both
 * separator conventions, because the indexer reads whatever it is handed — an
 * absolute path or `../../../.ssh/id_rsa` would be a read-into-index primitive
 * reachable through the MCP surface.
 *
 * Display/validation only. Real confinement stays main-side via `realpath`.
 *
 * @see specs/designs/sd-021-cross-cutting.md §9.5 (c) - path confinement
 */
export function isConfinedRelativePath(p: string): boolean {
  if (p.length === 0) return false
  if (p.startsWith('/') || p.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(p)) return false
  return !p.split(/[/\\]/).some(isTraversalSegment)
}

// ─── errors ──────────────────────────────────────────────────────────────────

/**
 * Structured error carried on every graph response.
 *
 * No free-form message: user copy is looked up from `ERROR_MESSAGES` in the
 * renderer, so a SQLite string or an absolute path can never cross IPC.
 */
export const GraphErrorSchema = z.object({
  code: GraphErrorCodeSchema,
  atMs: z.number().int().nonnegative(),
  /**
   * Project-relative path when the error is attributable to one file. Never
   * absolute — and the {@link isConfinedRelativePath} refine is what makes that
   * sentence enforceable rather than aspirational: an attributed error is the
   * one payload composed from a path the indexer was *given*, and it is rendered
   * in the skip list and the Settings diagnostics.
   *
   * Shares `MAX_STATUS_PATH_LENGTH` with the other relative paths in the status
   * payload: `lastError` rides inside `GraphStatusSnapshotSchema`, so a ceiling
   * of its own could reject the snapshot that carries it.
   */
  relativePath: z
    .string()
    .max(GRAPH.MAX_STATUS_PATH_LENGTH)
    .refine(isConfinedRelativePath, {
      message: 'relativePath must be project-relative and free of ".." segments'
    })
    .nullable()
    .default(null)
})
export type GraphError = z.output<typeof GraphErrorSchema>
