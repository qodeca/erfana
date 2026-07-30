// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Graph index on-disk schema: DDL, rebuild programs and the query catalogue.
 *
 * **BUNDLE-BOUNDARY RULE — this file MUST have zero `import` statements.**
 * It is the first module pulled into *both* the `index` and the
 * `graph-index.worker` rollup entries, so importing `logger` (and through it
 * electron-log) here would drag the whole logging stack into the worker bundle.
 * Everything below is a plain string/number constant or a dependency-free pure
 * function. `graphSchema.meta.test.ts` ("bundle boundary") is the gate: it reads
 * this file and asserts zero lines match `^import`.
 *
 * Contract-only for #21: no `new Database(...)` executes any of this yet (#23).
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-db-schema.md §6.3-§6.6 - DDL, constants, queries, gate
 * @see specs/designs/sd-021-graph-architecture.md §4.5 - the zero-import rule
 */

/**
 * Bumped on every incompatible on-disk change. A mismatch in **either**
 * direction — a newer Erfana having written a higher value, or a lower one —
 * discards the corpus and rebuilds; there are no data-preserving migrations
 * during beta.
 */
export const GRAPH_SCHEMA_VERSION = 1

/**
 * Beta notice, exported verbatim for the Settings panel.
 *
 * @see specs/designs/sd-021-db-schema.md §6.1
 */
export const GRAPH_SCHEMA_BETA_NOTICE =
  'The on-disk graph index schema is beta and carries no stability guarantee. ' +
  'Any Erfana release may change it. On a schema-version mismatch the entire ' +
  'index is discarded and rebuilt from the markdown sources — there are no ' +
  'data-preserving migrations during beta. The database is a derived cache, ' +
  'never a source of truth; deleting it loses nothing.'

/**
 * SQLite floor, in the integer encoding `sqlite_version()` implies.
 *
 * 3.37.0 for `STRICT` tables, which subsumes `RETURNING`'s 3.35.0.
 */
export const GRAPH_MIN_SQLITE = 3_037_000

/**
 * Numeric `sqlite_version()` comparison.
 *
 * `sqlite_version()` returns a STRING, and compared lexicographically
 * `'3.4.0' > '3.35.0'` and `'3.9.0' > '3.35.0'` — both would WRONGLY PASS a gate
 * whose entire purpose is to fail closed. Parse to `X*1e6 + Y*1e3 + Z` instead.
 *
 * @param version - Raw `sqlite_version()` output, e.g. `'3.53.3'`
 * @param min - Floor in the same encoding, e.g. {@link GRAPH_MIN_SQLITE}
 * @returns true when `version` is greater than or equal to `min`
 */
export function sqliteVersionAtLeast(version: string, min: number): boolean {
  const parts = version.trim().split('.')
  if (parts.length < 3) return false

  const [rawMajor, rawMinor, rawPatch] = parts
  if (!/^\d+$/.test(rawMajor) || !/^\d+$/.test(rawMinor) || !/^\d+$/.test(rawPatch)) {
    return false
  }

  const encoded = Number(rawMajor) * 1_000_000 + Number(rawMinor) * 1_000 + Number(rawPatch)
  return encoded >= min
}

// ─── DDL (§6.3) ──────────────────────────────────────────────────────────────

/**
 * Ordered `CREATE`/`INSERT` statements, no parameters. Executed in order via
 * `db.exec()`.
 *
 * Every table is `STRICT` (the design's philosophy is fail-loudly — the whole
 * argument for dropping `ON DELETE CASCADE` — and untyped columns contradict it).
 * There is **no `ON DELETE CASCADE` anywhere**: FTS5 virtual tables do not
 * participate in it, so a cascade would silently orphan `sections_fts` rows and
 * drift every counter.
 *
 * Index rule: **no index without a named consuming query.**
 */
export const GRAPH_SCHEMA_DDL: readonly string[] = [
  // `value_int` exists because TEXT affinity converts numerics to text on
  // storage, so a schema_version written as a number reads back as '1' and
  // breaks the === gate in §6.6. Numeric keys use value_int; string keys value.
  // Exhaustive keys: 'schema_version'(int) | 'generation'(int)
  //                  'schema_stability'(text) | 'auto_rebuild_count'(int)
  //                  'last_auto_rebuild_ms'(int) | 'last_auto_rebuild_reason'(text)
  `CREATE TABLE IF NOT EXISTS graph_meta (
  key       TEXT    NOT NULL PRIMARY KEY,
  value     TEXT,
  value_int INTEGER,
  CHECK (value IS NOT NULL OR value_int IS NOT NULL)
) STRICT`,

  // mtime_ms MUST be written as Math.trunc(stat.mtimeMs): INTEGER affinity
  // converts only when lossless, so a fractional value would store as REAL and
  // an exact-equality staleness comparison would silently misbehave. STRICT
  // turns any lapse into an immediate abort rather than a latent bug.
  //
  // size_bytes and indexed_at_ms are WRITE-ONLY in R1 — no GRAPH_QUERIES
  // statement and no phase-2 hydrate reads either. Staleness is decided by
  // mtime_ms + file_hash, and corpus_stats.last_indexed_at_ms is the
  // authoritative index timestamp. They are written anyway because they are the
  // per-file provenance a diagnostics bundle and a per-file incremental audit
  // need, and because adding a NOT NULL column later is a schema-version bump,
  // which under the beta no-migration rule discards and rebuilds the corpus.
  `CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT    NOT NULL,
  path_key      TEXT    NOT NULL UNIQUE,
  extension     TEXT    NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  size_bytes    INTEGER NOT NULL,
  file_hash     TEXT    NOT NULL,
  indexed_at_ms INTEGER NOT NULL,
  CHECK (length(path) > 0),
  CHECK (length(path_key) > 0),
  CHECK (mtime_ms >= 0),
  CHECK (size_bytes >= 0)
) STRICT`,

  // CHECK (ref_count >= 0) turns an undercount bug into an ABORT rather than
  // silent data loss.
  //
  // `text` is WRITE-ONLY in R1: search reads the body from sections_fts, which
  // holds its own copy (the standalone-FTS5 duplication §6.9 measures at
  // ~40 MB), so no query here selects it. It is stored regardless because it is
  // the ENABLING column for the §6.9 content-over-a-view migration — external
  // content over a view on `sections JOIN contents`, recorded as evaluated and
  // rejected for R1 rather than impossible, and the first thing to revisit if
  // index size becomes a complaint. Dropping it now would make that revisit a
  // corpus-discarding schema bump.
  `CREATE TABLE IF NOT EXISTS contents (
  content_hash TEXT    NOT NULL PRIMARY KEY,
  text         TEXT    NOT NULL,
  word_count   INTEGER NOT NULL,
  ref_count    INTEGER NOT NULL DEFAULT 0,
  CHECK (word_count >= 0),
  CHECK (ref_count >= 0)
) STRICT`,

  // Partial index serving the orphan sweep's only predicate. Tiny: it holds
  // rows only while they are orphaned, which is between two statements of one
  // transaction.
  `CREATE INDEX IF NOT EXISTS idx_contents_orphan ON contents(ref_count) WHERE ref_count = 0`,

  `CREATE TABLE IF NOT EXISTS sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id       INTEGER NOT NULL REFERENCES files(id),
  ordinal       INTEGER NOT NULL,
  heading       TEXT    NOT NULL DEFAULT '',
  heading_level INTEGER NOT NULL,
  heading_slug  TEXT    NOT NULL DEFAULT '',
  heading_path  TEXT    NOT NULL DEFAULT '',
  start_line    INTEGER NOT NULL,
  end_line      INTEGER NOT NULL,
  content_hash  TEXT    NOT NULL REFERENCES contents(content_hash),
  CHECK (ordinal >= 0),
  CHECK (heading_level BETWEEN 0 AND 6),
  CHECK (start_line >= 1),
  CHECK (end_line >= start_line)
) STRICT`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_file_ordinal ON sections(file_id, ordinal)`,
  // Consumed by the per-file delete resolver and the re-index sequence.
  `CREATE INDEX IF NOT EXISTS idx_sections_file ON sections(file_id)`,

  // rowid IS sections.id. Exactly TWO columns and no UNINDEXED payload, so
  // bm25() weights map 1:1 to (heading, text) and snippet()/highlight() column
  // indices are 0 and 1.
  `CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  heading,
  text,
  tokenize = 'porter unicode61 remove_diacritics 2'
)`,

  // section_count counts SECTION ROWS; word_count is summed over section rows
  // too (a duplicated body counts once per referencing section).
  // skipped_file_count is SET, never incremented across passes.
  `CREATE TABLE IF NOT EXISTS corpus_stats (
  id                    INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  file_count            INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  section_count         INTEGER NOT NULL DEFAULT 0 CHECK (section_count >= 0),
  word_count            INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  unique_content_count  INTEGER NOT NULL DEFAULT 0 CHECK (unique_content_count >= 0),
  skipped_file_count    INTEGER NOT NULL DEFAULT 0 CHECK (skipped_file_count >= 0),
  last_indexed_at_ms    INTEGER
) STRICT`,

  `INSERT OR IGNORE INTO corpus_stats (id) VALUES (1)`
]

/**
 * Ordered `DROP` statements, reverse dependency order.
 *
 * Children before parents matters: the writer runs with `foreign_keys = ON`, so
 * dropping `files` while `sections` rows still reference it aborts.
 */
export const GRAPH_DROP_DDL: readonly string[] = [
  `DROP INDEX IF EXISTS idx_sections_file`,
  `DROP INDEX IF EXISTS idx_sections_file_ordinal`,
  `DROP INDEX IF EXISTS idx_contents_orphan`,
  `DROP TABLE IF EXISTS corpus_stats`,
  `DROP TABLE IF EXISTS sections_fts`,
  `DROP TABLE IF EXISTS sections`,
  `DROP TABLE IF EXISTS contents`,
  `DROP TABLE IF EXISTS files`,
  `DROP TABLE IF EXISTS graph_meta`
]

/**
 * The version/generation stamp — PARAMETERISED, named params `:version` and
 * `:generation`.
 *
 * It cannot live in an ordered string array driven by `db.exec()`, which is why
 * a "rebuild steps" array alone left a rebuilt database carrying no
 * `schema_version` row at all.
 */
export const GRAPH_STAMP_SQL = `INSERT INTO graph_meta(key, value, value_int) VALUES
  ('schema_version',   NULL,   :version),
  ('generation',       NULL,   :generation),
  ('schema_stability', 'beta', NULL)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_int = excluded.value_int`

/** A program is `exec()`-able steps plus one prepared stamp, run in the same transaction. */
export interface GraphSchemaProgram {
  readonly steps: readonly string[]
  readonly stamp: string
}

/**
 * The rebuild program: `DROP`s then `CREATE`s, then the stamp, all inside one
 * `BEGIN IMMEDIATE` on the **same file**. Never `unlink()`, never `rename()` — a
 * live read-only handle silently serves the deleted inode forever and no PRAGMA
 * detects the swap (contract C3).
 */
export const GRAPH_REBUILD_PROGRAM: GraphSchemaProgram = {
  steps: [...GRAPH_DROP_DDL, ...GRAPH_SCHEMA_DDL],
  stamp: GRAPH_STAMP_SQL
}

/** The apply-fresh program. Same stamp — a fresh database must be stamped too. */
export const GRAPH_APPLY_FRESH_PROGRAM: GraphSchemaProgram = {
  steps: [...GRAPH_SCHEMA_DDL],
  stamp: GRAPH_STAMP_SQL
}

// ─── queries (§6.5, §6.6) ────────────────────────────────────────────────────

/**
 * The key set accepted by `IGraphReadConnection`, which takes a key and never
 * SQL. Phase 2 of the search is deliberately **not** a member — it is reachable
 * only through the `querySearchPage` composite, so both phases share one WAL
 * snapshot (contract C4).
 */
export type GraphQueryKey =
  | 'searchPage'
  | 'explain'
  | 'corpusStats'
  | 'schemaVersion'
  | 'generation'
  | 'rebuildBudget'
  | 'ftsOrphanAudit'
  | 'sectionOrphanAudit'
  | 'counterAudit'

/**
 * Search phase 2: hydrate ONLY the returned page (at most `MAX_TOP_K` rowids).
 *
 * Not a {@link GraphQueryKey}. `ORDER BY bm25(...)` forces a sorter, so any
 * auxiliary function in the phase-1 SELECT list would be evaluated for every row
 * entering the sorter rather than just the returned page — `snippet()` on a ~2 KB
 * text column, picking the best fragment across the whole column, is the
 * expensive one. Two-phase is the primary design, not a contingency.
 *
 * Delimiters are `char(2)`/`char(3)` (STX/ETX), never `<mark>`: no HTML crosses
 * IPC into a renderer that deliberately blocks it.
 *
 * The truncation marker is `char(4)` (EOT) for the same reason, not a printable
 * `'…'`: `GraphSearchResult.snippetTruncated` is derived by looking for it, and
 * a section whose own prose ends in an ellipsis is indistinguishable from a
 * clipped window — while also surviving the C0/C1 strip and leaking a marker
 * Erfana invented into the MCP payload. EOT is in the same C0 range as the
 * sentinels, so one strip removes all three.
 */
export const GRAPH_SEARCH_HYDRATE_SQL = `SELECT s.id AS sectionId, f.path AS filePath, s.heading,
       s.heading_path AS headingPath, s.heading_slug AS headingSlug,
       s.heading_level AS headingLevel, s.start_line AS startLine, s.end_line AS endLine,
       snippet(sections_fts, 1, char(2), char(3), char(4), 30) AS snippet,
       highlight(sections_fts, 0, char(2), char(3))        AS headingHl
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
JOIN files    f ON f.id = s.file_id
WHERE sections_fts MATCH :match AND sections_fts.rowid IN (SELECT value FROM json_each(:ids))`

/**
 * Every SQL statement the read-only connection may execute, addressed by key.
 *
 * `:match` is bound **and** grammar-sanitised before it gets here — binding
 * alone is insufficient because FTS5 parses the bound string as its own
 * language. Filters compare against `path_key` (NFC + case-folded), never the
 * display `path`, and `:folderKey` arrives already terminated with `/`.
 */
export const GRAPH_QUERIES: Readonly<Record<GraphQueryKey, string>> = {
  /**
   * Phase 1 — rank only, no auxiliary functions, and it doubles as the count
   * probe: it returns up to `:probeLimit` ranked rowids, so `totalMatched` is
   * the row count and the page is `rows.slice(offset, offset + k)`. There is
   * deliberately no separate probe query re-running the MATCH, both joins and
   * all six filter expressions a second time.
   *
   * `bm25()` is NEGATIVE — more negative is more relevant — so ascending
   * `ORDER BY score` is correct. Weights (3.0, 1.0) map 1:1 to (heading, text).
   */
  searchPage: `SELECT sections_fts.rowid AS sectionId, bm25(sections_fts, 3.0, 1.0) AS score
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
JOIN files    f ON f.id = s.file_id
WHERE sections_fts MATCH :match
  AND (:folderKey      IS NULL OR substr(f.path_key, 1, length(:folderKey)) = :folderKey)
  AND (:fileType       IS NULL OR f.extension = :fileType)
  AND (:after          IS NULL OR f.mtime_ms >= :after)
  AND (:before         IS NULL OR f.mtime_ms <= :before)
  AND (:excludeKey     IS NULL OR f.path_key <> :excludeKey)
  AND (:excludeSection IS NULL OR s.id <> :excludeSection)
ORDER BY score
LIMIT :probeLimit`,

  /**
   * FR-032 "why this result?" for one section.
   *
   * `highlight()` returns the **whole** column with every match wrapped in the
   * sentinels, so the caller can derive one window per occurrence plus an exact
   * per-term count — which a single 30-token `snippet()` window cannot supply.
   * Bounded to one row by the rowid equality.
   */
  explain: `SELECT sections_fts.rowid AS sectionId,
       highlight(sections_fts, 0, char(2), char(3)) AS headingMarked,
       highlight(sections_fts, 1, char(2), char(3)) AS textMarked
FROM sections_fts
WHERE sections_fts MATCH :match AND sections_fts.rowid = :sectionId`,

  /**
   * Contract C6: counts come from the counter table, never `count(*)` on
   * `sections_fts` (a full scan, linear in rows). The two `graph_meta` reads are
   * primary-key point lookups and use `value_int` directly, so no string ever
   * reaches `GraphCorpusStats.schemaVersion` to fail its `safeParse`.
   *
   * **`schemaVersion` and `schemaStability` are NULL on an unstamped database**
   * — the correlated subqueries return NULL when the row is missing, and
   * `corpus_stats` always has its `id = 1` row, so the statement still returns
   * one row. `GraphCorpusStatsSchema` declares both non-nullable on purpose, so
   * the caller MUST map that case explicitly (an unstamped `graph_meta` is a
   * `GRAPH_DB_SCHEMA_MISMATCH`/rebuild condition, not a stats payload) rather
   * than passing the row to `safeParse` and reporting a validation failure.
   */
  corpusStats: `SELECT file_count           AS fileCount,
       section_count        AS sectionCount,
       word_count           AS wordCount,
       unique_content_count AS uniqueContentCount,
       skipped_file_count   AS skippedFileCount,
       last_indexed_at_ms   AS lastIndexedAtMs,
       (SELECT value_int FROM graph_meta WHERE key = 'schema_version')   AS schemaVersion,
       (SELECT value      FROM graph_meta WHERE key = 'schema_stability') AS schemaStability
FROM corpus_stats
WHERE id = 1`,

  schemaVersion: `SELECT value_int AS schemaVersion FROM graph_meta WHERE key = 'schema_version'`,

  generation: `SELECT value_int AS generation FROM graph_meta WHERE key = 'generation'`,

  /**
   * §9.10 / E5: the three persisted rebuild-budget keys.
   *
   * Without a catalogue key the budget is unreachable by the code that must show
   * it. `graph_meta` persists it so it survives the crash it exists to detect,
   * the reader takes a KEY and never SQL, and E5 requires Settings to show the
   * count and the reason — so a key is the only way the pair reaches
   * `GraphStatusSnapshot.autoRebuildCount` / `.lastAutoRebuildReason`.
   *
   * No `FROM`: three correlated subqueries return exactly one row whose columns
   * are all NULL before the first automatic rebuild, so "never rebuilt" and
   * "no row" are the same, unambiguous answer. `lastAutoRebuildMs` is not on the
   * snapshot — it feeds the `GRAPH.REBUILD_COOLDOWN_MS` check main-side.
   */
  rebuildBudget: `SELECT (SELECT value_int FROM graph_meta WHERE key = 'auto_rebuild_count')       AS autoRebuildCount,
       (SELECT value_int FROM graph_meta WHERE key = 'last_auto_rebuild_ms')     AS lastAutoRebuildMs,
       (SELECT value     FROM graph_meta WHERE key = 'last_auto_rebuild_reason') AS lastAutoRebuildReason`,

  /**
   * Divergence audit — `PRAGMA integrity_check` CANNOT see this.
   *
   * For a standalone FTS5 table the `integrity-check` command verifies only
   * *internal* consistency, so an orphan passes both checks forever and surfaces
   * only as results that quietly never appear. A bounded index scan at the ≤10k
   * ceiling, run in the worker, off any frame budget — which is why this is the
   * one sanctioned `count(*)` against `sections_fts` (contract C6 bans it on the
   * corpus-count path, where it is a linear full scan).
   */
  ftsOrphanAudit: `SELECT count(*) AS orphanCount FROM sections_fts
WHERE rowid NOT IN (SELECT id FROM sections)`,

  /** The mirror case: a section row with no posting, so it can never be found. */
  sectionOrphanAudit: `SELECT count(*) AS orphanCount FROM sections s
WHERE NOT EXISTS (SELECT 1 FROM sections_fts WHERE rowid = s.id)`,

  /**
   * Recount for the open-time reconciliation. `count(*)` on the ordinary b-tree
   * tables is single-digit milliseconds at the 10k ceiling and is the cheapest
   * drift detector available; a difference is repaired in place with a `warn`
   * carrying both values.
   */
  counterAudit: `SELECT (SELECT count(*) FROM files)    AS fileCount,
       (SELECT count(*) FROM sections) AS sectionCount,
       (SELECT count(*) FROM contents) AS uniqueContentCount,
       (SELECT COALESCE(sum(c.word_count), 0)
          FROM sections s JOIN contents c ON c.content_hash = s.content_hash) AS wordCount`
}
