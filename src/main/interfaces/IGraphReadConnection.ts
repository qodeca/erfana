// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for the main-process read-only graph connection
 *
 * Takes a QUERY KEY, never SQL — the structural half of the zero-interpolation
 * contract. There is no `exec()`, no `pragma()`, no cursor or iterator, and no
 * method returning a holdable handle, because a read transaction held across an
 * `await` blocks every writer checkpoint for the writer's full `busy_timeout`
 * and grows the WAL unbounded (contract C4).
 *
 * @see GraphReadConnection for implementation (#23)
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-db-contracts.md §5.5, C1-C4 - the reader contracts
 */
import type { GraphQueryKey } from '../services/graph/graphSchema'
import type { FtsMatchExpression } from '../../shared/graphMatch'

/**
 * Bind parameters for the two search phases.
 *
 * Every optional filter is an explicit `null` rather than an absent key: the
 * predicates are written `(:param IS NULL OR ...)`, so a missing named parameter
 * would raise rather than widen. `folderKey` and `excludeKey` are `path_key`
 * form (NFC + case-folded), and `folderKey` arrives already terminated with `/`.
 *
 * **Provenance:** the design NAMES `GraphSearchQueryParams` and
 * {@link GraphSearchPageRows} in the `querySearchPage` signature (§5.5) but never
 * defines either shape. Both are reconstructed here from the only two sources
 * that constrain them — the named parameters `GRAPH_QUERIES.searchPage` and
 * `GRAPH_SEARCH_HYDRATE_SQL` actually bind, and the quantities
 * `GraphSearchResponse` requires — so #23 and #26 implement one shape rather
 * than inventing two. Recorded rather than papered over: if the two-phase SQL
 * changes its parameter list, this interface is the second file to edit.
 *
 * **`:ids` is deliberately absent.** `GRAPH_SEARCH_HYDRATE_SQL` binds `:match`
 * and `:ids`, but `:ids` is phase-2 only and is the JSON-encoded output of
 * phase 1 — it cannot be supplied by the caller, and putting it here would
 * invite an implementation that tries. The implementation derives it from the
 * {@link GraphSearchRankRow} list; only `:match` is shared between the phases.
 */
export interface GraphSearchQueryParams {
  /**
   * Sanitised FTS5 match expression — quoted tokens joined by ' ' or ' OR '.
   *
   * Branded {@link FtsMatchExpression}, whose **only** producer is
   * `buildMatchExpression`. A raw user string is a `TS2322` compile error here,
   * so "binding alone is insufficient" (FTS5 parses the bound string as its own
   * grammar) cannot regress unnoticed. `buildMatchExpression` returns
   * `FtsMatchExpression | null`; the caller resolves the `null` path (empty
   * result set, no SQLite touched) *before* constructing these params.
   */
  match: FtsMatchExpression
  folderKey: string | null
  fileType: string | null
  after: number | null
  before: number | null
  excludeKey: string | null
  excludeSection: number | null
  /** Phase-1 cap, `GRAPH.MAX_COUNT_PROBE`, or `k + 1` when the probe is skippable. */
  probeLimit: number
  offset: number
  k: number
}

/** One phase-1 row: rank only, no auxiliary functions. */
export interface GraphSearchRankRow {
  sectionId: number
  score: number
}

/** One phase-2 row, hydrated for the returned page only. Sentinel-marked. */
export interface GraphSearchHydratedRow {
  sectionId: number
  filePath: string
  heading: string
  headingPath: string
  headingSlug: string
  headingLevel: number
  startLine: number
  endLine: number
  snippet: string
  headingHl: string
}

/**
 * Both phases of one search, from one WAL snapshot.
 *
 * Named but never defined by the design — see the provenance note on
 * {@link GraphSearchQueryParams}. The four members are exactly what
 * `GraphSearchResponse` cannot be composed without.
 */
export interface GraphSearchPageRows {
  /** The requested page slice, in rank order. */
  ranked: GraphSearchRankRow[]
  /** Hydrated rows for `ranked`, in arbitrary order — join on `sectionId`. */
  hydrated: GraphSearchHydratedRow[]
  /** Phase-1 row count, bounded by `probeLimit`. */
  totalMatched: number
  /** True when phase 1 hit `probeLimit`, so `totalMatched` is a floor. */
  totalMatchedCapped: boolean
}

/**
 * Bind parameters for the key-addressed reads (`queryAll`/`queryGet`).
 *
 * **The `explain` MATCH site (#21 [13]).** `GRAPH_QUERIES.explain` binds `:match`
 * exactly as phase-1 `searchPage` does, but reaches SQLite through `queryAll`
 * rather than the typed `querySearchPage` composite — and per §9.6 `explain` runs
 * **per term**, so it is the *more frequent* raw-string site. A plain
 * `Record<string, unknown>` accepts any string, reopening the "binding alone is
 * insufficient" hazard the brand exists to close. Intersecting the loose record
 * with an optional branded `match` keeps every other key's params open while
 * making a raw `match` string a compile error at this second site too:
 * {@link buildMatchExpression} (returning {@link FtsMatchExpression}) is the only
 * value that satisfies it.
 */
export type GraphKeyedQueryParams = Record<string, unknown> & {
  match?: FtsMatchExpression
}

export interface IGraphReadConnection {
  /**
   * Open the read-only handle and record `{ dev, ino }` for the identity guard.
   *
   * **Idempotent**: closes any existing handle and clears the statement cache
   * first, so a double attach leaks neither the prior handle nor its
   * generation-scoped cache.
   *
   * @param dbPath - Absolute path to `graph.db`
   * @param generation - The rebuild token. It crosses IPC and lives on disk as a
   *   decimal string (`GraphGenerationSchema`, D5); this in-process API is the
   *   **only** hop where it is a `bigint`. The worker adapter converts with
   *   `BigInt(ready.generation)` before calling this, and the status-snapshot
   *   builder converts back with `generation().toString()`.
   */
  attach(dbPath: string, generation: bigint): void

  /** Close the handle and clear the statement cache. Safe when not attached. */
  detach(): void

  isAttached(): boolean

  /**
   * The attached handle's rebuild token, as a `bigint` (the sole in-process
   * form). The snapshot builder stringifies it via `GraphGenerationSchema`; on
   * disk and on the wire it is a decimal string (D5).
   */
  generation(): bigint

  /**
   * Drop every cached prepared statement.
   *
   * Called **unconditionally** on every `ready.rebuilt === true`: cached
   * statements are frozen across a schema change, and correctness must never
   * depend on comparing generation tokens, which a rebuild drops along with
   * `graph_meta` (contract C2).
   */
  clearStatements(): void

  /**
   * Re-`stat()` the file and compare against the recorded identity.
   *
   * A sync client, a `git checkout` or a restored backup can replace `graph.db`
   * underneath an attached reader. The writer gets `SQLITE_READONLY_DBMOVED` and
   * notices; the reader does not, and would serve silently wrong results behind
   * a green dot (contract C3).
   *
   * @returns false when the file was replaced — caller detaches and re-attaches
   */
  verifyIdentity(): boolean

  queryAll<T>(key: GraphQueryKey, params: GraphKeyedQueryParams): T[]

  queryGet<T>(key: GraphQueryKey, params: GraphKeyedQueryParams): T | undefined

  /**
   * The ONE composite: search phase 1 and phase 2 in a single synchronous
   * transaction, so the page and its count come from one WAL snapshot.
   *
   * Two autocommit statements would mix quantities across snapshots, and
   * `LIMIT`/`OFFSET` paging over a mutating `sections_fts` could duplicate and
   * skip rows — not a rare window, since search stays enabled throughout
   * indexing. Contains no `await` by construction.
   */
  querySearchPage(params: GraphSearchQueryParams): GraphSearchPageRows
}
