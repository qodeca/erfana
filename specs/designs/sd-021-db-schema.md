<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-021 part 3 — database schema, queries, and write paths (AC-2)

Part of the SD-021 set — index in [`sd-021-graph-architecture.md` §0](sd-021-graph-architecture.md). Covers **§6**. Topology and lifecycle contracts C1–C9 are in [`sd-021-db-contracts.md`](sd-021-db-contracts.md).

---

## 6. Database schema

### 6.1 Beta status

Exported verbatim as `GRAPH_SCHEMA_BETA_NOTICE`:

> The on-disk graph index schema is **beta** and carries **no stability guarantee**. Any Erfana release may change it. On a schema-version mismatch the entire index is discarded and rebuilt from the markdown sources — there are no data-preserving migrations during beta. The database is a derived cache, never a source of truth; deleting it loses nothing.

### 6.2 Path identity contract (M1) — read before the DDL

`files.path UNIQUE` under SQLite's default **BINARY** collation compares bytes. macOS/APFS is case-insensitive-preserving and hands back **NFD** for accented names; NTFS is case-insensitive; chokidar can surface differing case across `add`/`unlink` and case-only renames. In a codebase full of Polish filenames this is not theoretical: `Wstęp.md` in NFC and in NFD insert as **two rows** — counters double, duplicate results appear, the delete resolver misses one form and leaves permanent `sections` + `sections_fts` orphans, and the byte-prefix folder filter silently fails on a case difference. `COLLATE NOCASE` does **not** fix it: it folds only the 26 ASCII letters.

**Contract.** Every path crossing into the repository layer is canonicalised there — never by the caller:

```
canonicalPath(p) = p.normalize('NFC')                       // display form, stored in files.path
pathKey(p)       = canonicalPath(p).toLowerCase()           // identity form, stored in files.path_key
```

`path_key` carries the `UNIQUE` constraint and is the **only** column used for identity, prefix filtering, `unlinkDir` subtree matching and `excludeFilePath`. `path` is display-only and is what appears in `GraphSearchResult.filePath`. `toLowerCase()` is the full-Unicode simple case fold available in JS and is applied identically on both platforms so a database is portable. Case-only renames therefore resolve to the same row, which is the correct behaviour on case-insensitive filesystems and an acceptable merge on case-sensitive ones (documented in §12.4).

### 6.3 DDL

`GRAPH_SCHEMA_VERSION = 1`. Every table is **`STRICT`** (m1): the design's stated philosophy is fail-loudly — the entire argument for dropping `ON DELETE CASCADE` — and untyped columns contradict it. `STRICT` requires SQLite ≥ 3.37.0, but the asserted floor is **3.38.0** because the two-phase search binds `json_each(:ids)` and the JSON1 built-ins became unconditional only in 3.38.0 — a 3.37.x build without JSON1 would pass a STRICT-only gate then fail every search's phase 2 ([17], §6.4). 3.38.0 subsumes 3.37.0 (STRICT), which subsumes 3.35.0 (`RETURNING`).

```sql
-- ─── metadata / version stamp ───────────────────────────────────────────────
-- value_int exists because TEXT affinity converts numerics to text on storage,
-- so a schema_version written as a number reads back as '1' and breaks the
-- === gate in §6.5. Numeric keys use value_int; string keys use value.
-- `generation` is the exception (D5): a 64-bit token stored as a DECIMAL STRING
-- in `value`, because better-sqlite3 reads an INTEGER column as a lossy JS
-- number without a per-statement `safeIntegers()` the key-based reader cannot
-- set, and flipping it globally would re-widen every other integer column to a
-- bigint. TEXT gives one lossless form across disk, the worker `ready` reply and
-- the status snapshot (GraphGenerationSchema).
CREATE TABLE IF NOT EXISTS graph_meta (
  key       TEXT    NOT NULL PRIMARY KEY,
  value     TEXT,
  value_int INTEGER,
  CHECK (value IS NOT NULL OR value_int IS NOT NULL),
  -- [20]: the key allow-list and the per-key column discipline are contracts,
  -- not comments. A version written into `value` would read back NULL, which the
  -- §6.6 gate treats as unstamped and answers with discard-and-rebuild of a
  -- correct corpus; with the budget-preservation blocker [2] that loop was
  -- permanent.
  CHECK (key IN ('schema_version', 'generation', 'schema_stability',
                 'auto_rebuild_count', 'last_auto_rebuild_ms', 'last_auto_rebuild_reason')),
  CHECK (CASE
           WHEN key IN ('schema_version', 'auto_rebuild_count', 'last_auto_rebuild_ms')
             THEN value_int IS NOT NULL AND value IS NULL
             ELSE value IS NOT NULL AND value_int IS NULL
         END)
) STRICT;
-- exhaustive keys: 'schema_version'(int) | 'generation'(text) | 'schema_stability'(text)
--                  'auto_rebuild_count'(int) | 'last_auto_rebuild_ms'(int)
--                  'last_auto_rebuild_reason'(text)
-- No created_at_ms and no last_index_completed_at_ms: the former had no consumer,
-- the latter duplicated corpus_stats.last_indexed_at_ms (which is authoritative
-- because it is written in the same transaction as the counters it must agree with).

-- ─── files ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT    NOT NULL,               -- NFC, project-relative, POSIX. DISPLAY ONLY.
  path_key      TEXT    NOT NULL UNIQUE,        -- NFC + case-folded. IDENTITY. (§6.2)
  extension     TEXT    NOT NULL,               -- lowercase with dot: '.md'
  mtime_ms      INTEGER NOT NULL,               -- Math.trunc(stat.mtimeMs) — see note
  size_bytes    INTEGER NOT NULL,
  file_hash     TEXT    NOT NULL,               -- SHA-256 of preprocessed whole file
  indexed_at_ms INTEGER NOT NULL,
  CHECK (length(path) > 0),
  CHECK (length(path_key) > 0),
  CHECK (mtime_ms >= 0),
  CHECK (size_bytes >= 0)
) STRICT;
-- No idx_files_path: path_key's UNIQUE already provides the identity index, and a
-- duplicate costs a B-tree write per upsert for nothing. No mtime/extension index:
-- the plan is MATCH-driven and those filters are non-sargable (:p IS NULL OR col = :p).
-- RULE: no index without a named consuming query (see §6.6 for the one exception
-- that had a false justification in revision 2 and has been removed).

-- ─── content-addressed bodies (FR-009) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS contents (
  content_hash TEXT    NOT NULL PRIMARY KEY,    -- SHA-256 of normalised text
  text         TEXT    NOT NULL,
  word_count   INTEGER NOT NULL,
  ref_count    INTEGER NOT NULL DEFAULT 0,
  CHECK (word_count >= 0),
  CHECK (ref_count >= 0)                        -- an undercount bug now ABORTS, not silently deletes
) STRICT;
-- Partial index serving the orphan sweep's only predicate (§6.6). Tiny: it holds
-- rows only while they are orphaned, which is between two statements of one txn.
CREATE INDEX IF NOT EXISTS idx_contents_orphan ON contents(ref_count) WHERE ref_count = 0;

-- ─── sections ───────────────────────────────────────────────────────────────
-- NO ON DELETE CASCADE. FTS5 virtual tables do not participate in it, so a cascade
-- would silently orphan sections_fts rows and drift every counter (§6.6).
CREATE TABLE IF NOT EXISTS sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id       INTEGER NOT NULL REFERENCES files(id),
  ordinal       INTEGER NOT NULL,               -- 0-based position within the file
  heading       TEXT    NOT NULL DEFAULT '',
  heading_level INTEGER NOT NULL,               -- 1..6; 0 = pre-heading preamble
  heading_slug  TEXT    NOT NULL DEFAULT '',
  heading_path  TEXT    NOT NULL DEFAULT '',    -- 'H1 > H2 > H3' (AC-009)
  start_line    INTEGER NOT NULL,               -- 1-based, inclusive
  end_line      INTEGER NOT NULL,
  content_hash  TEXT    NOT NULL REFERENCES contents(content_hash),
  CHECK (ordinal >= 0),
  CHECK (heading_level BETWEEN 0 AND 6),        -- mirrors GraphSearchResultSchema's min(0).max(6)
  CHECK (start_line >= 1),
  CHECK (end_line >= start_line)
) STRICT;
-- Also serves the per-file delete resolver and the §6.7 re-index sequence: this
-- UNIQUE (file_id, ordinal) index answers every file_id-only lookup from its
-- leftmost prefix, so a separate idx_sections_file ON sections(file_id) was a
-- strict-prefix duplicate — a B-tree write per section insert/delete for zero
-- read benefit ([18], the redundant-index anti-pattern SQLite documents). Removed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_file_ordinal ON sections(file_id, ordinal);

-- ─── FTS5 search index (FR-017, FR-018) ─────────────────────────────────────
-- rowid IS sections.id. Exactly TWO columns and no UNINDEXED payload, so bm25()
-- weights map 1:1 to (heading, text) and snippet()/highlight() indices are 0 and 1.
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  heading,
  text,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- ─── corpus counters (contract C6) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_stats (
  id                    INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  file_count            INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  -- section_count counts SECTION ROWS. word_count is summed over SECTION ROWS too
  -- (a duplicated body counts once per referencing section), matching what the
  -- delete path subtracts and what FR-034 shows the user.
  section_count         INTEGER NOT NULL DEFAULT 0 CHECK (section_count >= 0),
  word_count            INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  -- unique_content_count counts CONTENTS ROWS (distinct bodies).
  unique_content_count  INTEGER NOT NULL DEFAULT 0 CHECK (unique_content_count >= 0),
  -- Files skipped by the CURRENT/LAST full pass. SET, never incremented across
  -- passes: reset to 0 at the start of every full pass, decremented when a
  -- previously skipped file indexes successfully, and adjusted by the delete path.
  skipped_file_count    INTEGER NOT NULL DEFAULT 0 CHECK (skipped_file_count >= 0),
  last_indexed_at_ms    INTEGER                                  -- AUTHORITATIVE
) STRICT;
INSERT OR IGNORE INTO corpus_stats (id) VALUES (1);
```

**`mtime_ms` must be integral.** Node's `fs.Stats.mtimeMs` is floating point, and INTEGER affinity converts only when the conversion is **lossless** — so a fractional value stores as REAL and #32's exact-equality staleness comparison silently misbehaves while range filters keep working. Write sites MUST use `Math.trunc(stat.mtimeMs)`; `STRICT` turns any lapse into an immediate abort rather than a latent bug.

**`AUTOINCREMENT` on both ids** prevents rowid reuse colliding with a leftover `sections_fts` rowid. Cost: one `sqlite_sequence` row and monotonic 64-bit growth — irrelevant in a rebuildable cache. §6.7 fixes the revision-2 contradiction where an ordinal *upsert* (which retains ids) was justified alongside AUTOINCREMENT (which assumes fresh ids).

### 6.4 Exported constant shapes

```ts
export const GRAPH_SCHEMA_VERSION = 1
/** Ordered CREATE/INSERT statements, no parameters. Executed in order. */
export const GRAPH_SCHEMA_DDL: readonly string[]
/** Ordered DROP statements, reverse dependency order. */
export const GRAPH_DROP_DDL: readonly string[]
/**
 * The version/generation stamp. PARAMETERISED, so it cannot live in an ordered
 * string array driven by db.exec (revision 2's GRAPH_REBUILD_STEPS could not
 * execute it, which is why a rebuilt DB carried no schema_version row at all).
 */
// named params :version, :generation (decimal string, D5), and the three budget
// params :autoRebuildCount / :lastAutoRebuildMs / :lastAutoRebuildReason
export const GRAPH_STAMP_SQL: string
/** Pre-DROP read that carries the rebuild budget across the drop (B4/[2]); its
 *  columns are the stamp's budget param names. === GRAPH_QUERIES.rebuildBudget. */
export const GRAPH_REBUILD_PRESERVE_SQL: string
/** The rebuild program. `preserve` runs first, then `steps` with exec(), then the
 *  prepared `stamp`, all in one txn. */
export const GRAPH_REBUILD_PROGRAM: {
  steps: readonly string[]              // [...GRAPH_DROP_DDL, ...GRAPH_SCHEMA_DDL]
  stamp: string                         // === GRAPH_STAMP_SQL
  preserve: string                      // === GRAPH_REBUILD_PRESERVE_SQL
}
/** The apply-fresh program. Same stamp — a fresh DB must be stamped too — but no
 *  `preserve`: nothing to carry, so the stamp's budget params bind NULL. */
export const GRAPH_APPLY_FRESH_PROGRAM: { steps: readonly string[]; stamp: string }

export type GraphQueryKey =
  | 'searchPage' | 'explain' | 'corpusStats' | 'schemaVersion' | 'generation'
  | 'rebuildBudget'                       // §9.10 auto_rebuild_count / _ms / _reason
  | 'ftsOrphanAudit' | 'sectionOrphanAudit'
  | 'ftsAlignmentAudit'                   // [3] posting vs rowid-source divergence
  | 'controlCharAudit'                    // [4] C0/C1 sentinels in model-facing columns
  | 'counterAudit'
export const GRAPH_QUERIES: Readonly<Record<GraphQueryKey, string>>

/**
 * sqlite_version() returns a STRING. Compared lexicographically, '3.4.0' > '3.35.0'
 * and '3.9.0' > '3.35.0' — both would WRONGLY PASS a gate whose whole purpose is to
 * fail closed. Parse to the integer encoding instead.
 */
export function sqliteVersionAtLeast(v: string, min: number): boolean
export const GRAPH_MIN_SQLITE = 3_038_000    // 3.38.0 — json_each built-in ([17]) ⊃ STRICT (3.37.0) ⊃ RETURNING (3.35.0)
```

`GRAPH_STAMP_SQL` — a compound `INSERT … SELECT` so the three budget rows can be inserted **only when non-null** (before the first automatic rebuild they are NULL, and a `graph_meta` row with both columns NULL violates the base CHECK — an unconditional insert would abort every apply-fresh):

```sql
INSERT INTO graph_meta(key, value, value_int)
SELECT 'schema_version', NULL, :version
UNION ALL SELECT 'generation', :generation, NULL
UNION ALL SELECT 'schema_stability', 'beta', NULL
UNION ALL SELECT 'auto_rebuild_count', NULL, :autoRebuildCount WHERE :autoRebuildCount IS NOT NULL
UNION ALL SELECT 'last_auto_rebuild_ms', NULL, :lastAutoRebuildMs WHERE :lastAutoRebuildMs IS NOT NULL
UNION ALL SELECT 'last_auto_rebuild_reason', :lastAutoRebuildReason, NULL WHERE :lastAutoRebuildReason IS NOT NULL
ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_int = excluded.value_int;
```

`GRAPH_REBUILD_PRESERVE_SQL` reads the three budget values **before** `GRAPH_DROP_DDL` removes `graph_meta`; its row feeds the stamp's budget params, so the budget survives the drop (B4/[2] — see §6.6). Apply-fresh has no `preserve` and binds NULL, so the `WHERE :param IS NOT NULL` arms insert exactly the three fixed rows.

`GRAPH_QUERIES.schemaVersion` reads `value_int` directly (no `CAST`, so no string reaches `GraphCorpusStats.schemaVersion` `z.number().int().positive()`); `.generation` reads `value` — the decimal string the caller passes to `BigInt(...)` (D5).

### 6.5 Search queries — two phase (M19)

`ORDER BY bm25(...)` forces a sorter, so any auxiliary function in the SELECT list is evaluated for **every row entering the sorter**, not just the returned page. Revision 2's fallback ("drop `highlight()`") removed the *cheap* function — `highlight()` ran on column 0 (`heading`, a few tokens) while `snippet()` ran on column 1 (`text`, ~2 KB) and must additionally pick the best fragment by maximising distinct query terms across the whole column. Two-phase is therefore the **primary** design, not a contingency.

```sql
-- GRAPH_QUERIES.searchPage — phase 1: rank only, no auxiliary functions.
SELECT sections_fts.rowid AS sectionId, bm25(sections_fts, 3.0, 1.0) AS score
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
JOIN files    f ON f.id = s.file_id
WHERE sections_fts MATCH :match
  AND (:folderKey    IS NULL OR substr(f.path_key, 1, length(:folderKey)) = :folderKey)
  AND (:fileType     IS NULL OR f.extension = :fileType)
  AND (:after        IS NULL OR f.mtime_ms >= :after)
  AND (:before       IS NULL OR f.mtime_ms <= :before)
  AND (:excludeKey   IS NULL OR f.path_key <> :excludeKey)
  AND (:excludeSection IS NULL OR s.id <> :excludeSection)
ORDER BY score
LIMIT :probeLimit;                       -- GRAPH.MAX_COUNT_PROBE

-- phase 2: hydrate ONLY the returned page (≤ MAX_TOP_K rowids).
SELECT s.id AS sectionId, f.path AS filePath, s.heading, s.heading_path AS headingPath,
       s.heading_slug AS headingSlug, s.heading_level AS headingLevel,
       s.start_line AS startLine, s.end_line AS endLine,
       snippet(sections_fts, 1, char(2), char(3), char(4), 30) AS snippet,  -- EOT marker
       highlight(sections_fts, 0, char(2), char(3))        AS headingHl
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
JOIN files    f ON f.id = s.file_id
WHERE sections_fts MATCH :match AND sections_fts.rowid IN (SELECT value FROM json_each(:ids));
```

Phase 1 doubles as the probe: it returns up to `MAX_COUNT_PROBE` ranked rowids, so `totalMatched = rows.length`, `totalMatchedCapped = rows.length === MAX_COUNT_PROBE`, and the page is `rows.slice(offset, offset + k)`. **This removes the separate `searchProbe` query entirely** (m6) — revision 2 ran the MATCH, both joins and all six filter expressions twice, unconditionally, including when `offset === 0 && results.length < k` where the answer was already known.

**Contracts.**

1. `bm25()` is **negative**, more negative = more relevant, so `ORDER BY score` ascending is correct. `score` is exposed raw; the UI ranks by array order and MUST NOT render it as a percentage.
2. Weights `(3.0, 1.0)` map 1:1 to `(heading, text)` — FR-018. Two columns, complete vector, no reliance on defaulting.
3. Filters compare against `path_key` (§6.2). `folderKey` is normalised **and terminated with `/`** at the schema boundary (§7) — `'doc'` must not match `documentation/`.
4. Delimiters are `char(2)`/`char(3)` (STX/ETX), never `<mark>`: no HTML crosses IPC into a renderer that deliberately blocks it.
5. `:match` is bound **and** grammar-sanitised (§9 row 11 — binding alone is insufficient because FTS5 parses the bound string as its own language).
6. Both phases execute inside **one synchronous read transaction** via `IGraphReadConnection.querySearchPage()` — see contract C4 in `sd-021-db-contracts.md`, restated so a synchronous composite is permitted while an await-spanning one remains banned.
7. `GRAPH_QUERIES.explain` (M16) returns per-term windows for a single `sectionId`, so §12.2's lazy-`matchedTerms` fallback is a config change rather than a schema edit.

### 6.6 Version gate, integrity, audits, and rebuild

```
onWriterOpen():
  assert sqliteVersionAtLeast(sqlite_version(), GRAPH_MIN_SQLITE)   # numeric, not lexical
  assert sqlite_compileoption_used('ENABLE_FTS5') === 1             # else GRAPH_FTS5_UNAVAILABLE
  wal_checkpoint(TRUNCATE) and CHECK THE BUSY COLUMN                # contract C8
  if PRAGMA integrity_check != 'ok'                → REBUILD('corruption')
  if sections_fts exists:
     INSERT INTO sections_fts(sections_fts) VALUES('integrity-check')
     on SQLITE_CORRUPT_VTAB                        → FTS_REBUILD  (NOT a corpus discard)
     on other throw                                → REBUILD('corruption')
  # --- audits: integrity_check CANNOT see these (M3, m2) -----------------
  ftsOrphans     := GRAPH_QUERIES.ftsOrphanAudit        # posting with no section
  sectionOrphans := GRAPH_QUERIES.sectionOrphanAudit    # section with no posting
  misaligned     := GRAPH_QUERIES.ftsAlignmentAudit     # [3] posting present + non-orphaned
                                                        #     but carrying another rowid's body
  if ftsOrphans > 0 OR sectionOrphans > 0 OR misaligned > 0  → REBUILD('fts-divergence')
  controlChars   := GRAPH_QUERIES.controlCharAudit      # [4] C0(except tab/LF)/C1 in a
                                                        #     model-facing column (heading*, path, text)
  if controlChars > 0                              → REBUILD('fts-divergence')
  counters := recount files/sections/contents and compare to corpus_stats
  if counters differ                               → repair in place, log warn with both values
  # --- version -----------------------------------------------------------
  v := SELECT value_int FROM graph_meta WHERE key='schema_version'
  if v IS NULL                                     → APPLY_FRESH
  if v  = GRAPH_SCHEMA_VERSION                     → OK
  if v != GRAPH_SCHEMA_VERSION (higher OR lower)   → REBUILD('schema-mismatch')
```

A **higher** on-disk version (newer Erfana, then a downgrade) takes the same discard path — the case migrations cannot handle, and the main reason beta has none.

The orphan audit exists because for a **standalone** FTS5 table the `integrity-check` command verifies only *internal* consistency; cross-checking against content requires an external content source, and even then only with `rank=1`. So an orphan — exactly the state §6.2 (M1) and §6.7 (M2) can produce — passes both `PRAGMA integrity_check` **and** the FTS check forever, surfacing only as results that quietly never appear. Both audit queries are bounded index scans at the ≤10 k ceiling and run in the worker, off any frame budget.

**`ftsAlignmentAudit` ([3])** closes a gap the two orphan audits and `integrity-check` all share. FTS5 takes no constraints, and an INSERT omitting the rowid gets `max(rowid)+1`; a posting can therefore be present and non-orphaned yet carry a *different* section's `heading`/`text` than its rowid resolves to. Such a pair passes both orphan audits and — for a non-contentless table — `integrity-check`, then serves one section's path/heading with another's body. The audit compares the stored posting columns against the joined `sections`/`contents` rows. The **writer-side complement** — asserting `last_insert_rowid()` equals the `sections.id` just inserted before writing the posting — is #21-out-of-scope (there is no writer yet) and is a **#23/#25 obligation**.

**`controlCharAudit` ([4])** enforces the ingest contract (D2). `snippet()`/`highlight()` insert `char(2)`/`char(3)` (span sentinels) and `char(4)` (truncation marker) verbatim, and `snippetTruncated` is derived by searching for `char(4)`; nothing at ingest constrains control characters, so a `char(4)` in a source file forges `snippetTruncated: true` and `char(2)`/`char(3)` forge spans, breaking the declared `occurrencesInSnippet === offsets.length` invariant. The audit flags any C0 (except tab/LF) or C1 (0x80–0x9F) character in the columns that reach an `McpTextSchema` field — `heading`, `heading_path`, `heading_slug`, `files.path` and the section body. The **ingest strip itself** — the exact complement of `isControlCharFree`: strip C0 except tab/LF, plus C1, normalising CRLF and lone CR to LF — is a **#24 (Preprocessing) obligation**; #21 commits only the contract and this backstop audit.

`FTS_REBUILD` is `INSERT INTO sections_fts(sections_fts) VALUES('rebuild')` — it reconstructs the index from the FTS table's own content and is the correct, cheap response to `SQLITE_CORRUPT_VTAB`, which signals FTS-internal damage rather than corpus damage. Routing it to a whole-corpus discard (revision 2) threw away 10 k sections to fix an index.

**Rebuild** (one transaction, one file, no `unlink`, no `rename` — contract C3):

```
BEGIN IMMEDIATE
  budget := run(GRAPH_REBUILD_PROGRAM.preserve)  -- [2] pre-DROP read of the budget keys
  exec(GRAPH_REBUILD_PROGRAM.steps)              -- DROPs (incl. graph_meta) then CREATEs
  -- the stamp re-inserts the preserved budget; the writer bumps count over it and
  -- sets last_auto_rebuild_ms / _reason for THIS rebuild
  run(GRAPH_REBUILD_PROGRAM.stamp, {
    version, generation: nextGeneration,
    autoRebuildCount:      (budget.autoRebuildCount ?? 0) + 1,
    lastAutoRebuildMs:     now,
    lastAutoRebuildReason: reason
  })
COMMIT
if freeSpaceBytes > 2 * dbSizeBytes: VACUUM   -- pre-flight; skip rather than fail (M20)
```

**Budget preservation ([2]) is why `preserve` exists.** `GRAPH_DROP_DDL` drops `graph_meta` completely — it must, because a legacy CHECK-less shape a sync client or a bad restore leaves behind is repaired only by a full drop-and-recreate (`CREATE TABLE IF NOT EXISTS` keeps the old shape forever), and rebuild *is* the repair path. Without the pre-DROP read the stamp restored only 3 of 6 keys, so `rebuildBudget` read all-NULL after every rebuild — "never rebuilt" — `MAX_AUTO_REBUILDS_PER_SESSION` was unreachable, the cooldown compared against NULL, and the loop B4's budget exists to stop ran unbounded and invisible in Settings. `generation` is **not** preserved: it is re-minted every rebuild (below).

`nextGeneration` is **`randomBytes(8)` as a signed 64-bit integer**, not a counter. Contract C2 needs *difference*, not monotonicity, and a counter's source is undefined on exactly the two paths that matter — `REBUILD('corruption')`, where the unreadable page may **be** `graph_meta`'s, and `APPLY_FRESH`, where no prior value exists. A restart-at-1 could re-issue a value the reader already holds at the precise moment the tables were dropped. Additionally, and independently, `ready.rebuilt === true` **unconditionally** clears the reader's statement cache (M4), so correctness never depends on the token at all — `generation` becomes telemetry.

**Rebuild budget (B4).** Corruption causes are overwhelmingly persistent — failing flash, controllers that lie about fsync, cloud-sync clients rewriting files underneath SQLite. Without a budget the trace is rebuild → full reindex → corrupt → rebuild, forever, at full write throughput, with the dot flickering yellow→green and `GRAPH_DB_CORRUPTED`'s copy true on every iteration so it never signals a problem. The §8 supervision ladder cannot catch it because the worker never dies — it replies `{type:'error', code}`.

- `graph_meta.auto_rebuild_count` and `last_auto_rebuild_ms` are **persisted**, so the budget survives a restart.
- An automatic rebuild is refused when `auto_rebuild_count >= GRAPH.MAX_AUTO_REBUILDS_PER_SESSION` (2) **or** when `now - last_auto_rebuild_ms < GRAPH.REBUILD_COOLDOWN_MS`.
- On refusal: no rebuild, state `disabled`, `GRAPH_DB_REBUILD_FAILED`, **and it is surfaced** — silence is correct for the first recovery, not for a loop.
- Every automatic rebuild logs `warn` with `{correlationId, jobId, reason, autoRebuildCount}` so the loop is diagnosable from a log bundle.
- A user-initiated rebuild (FR-033) resets `auto_rebuild_count` to 0.

### 6.7 Write paths — delete (M5) and update (M2)

**Both sequences run inside one transaction, and a delete sequence and an upsert sequence MUST NOT interleave within it.** #32's coalesced batches deliver add/change/unlink together, so the transaction shape is normative, not incidental.

**Ordering rule.** All `RETURNING` result sets are materialised with `.all()` **before** any dependent statement runs: `RETURNING` row order is arbitrary and all changes occur during the first `sqlite3_step()`, so streaming while mutating is undefined. A subtree delete materialises every affected section at once — bounded by the batch, and the reason `GRAPH.MAX_BATCH_SIZE` exists.

**Delete (`GraphDeleteRepository`)** — per file, but the sweep is hoisted out of the loop:

```sql
-- 1. resolve (identity column, not display column)
SELECT id FROM files WHERE path_key = :pathKey;
-- 2. remove sections, capturing cleanup keys
DELETE FROM sections WHERE file_id = :fileId RETURNING id, content_hash;   -- .all()
-- 3. per returned row
DELETE FROM sections_fts WHERE rowid = :sectionId;
UPDATE contents SET ref_count = ref_count - 1 WHERE content_hash = :contentHash;
-- 4. now legal — no dependents remain; a bare DELETE here without step 2 raises
--    SQLITE_CONSTRAINT_FOREIGNKEY, which is the point of dropping the cascade.
DELETE FROM files WHERE id = :fileId;
```

Then **once per transaction**, after every insert and delete in the batch, scoped to the hashes actually touched:

```sql
DELETE FROM contents
WHERE content_hash IN (SELECT value FROM json_each(:touchedHashes)) AND ref_count = 0;
```

Revision 2 ran an unscoped `DELETE FROM contents WHERE ref_count <= 0` **per file**, so a 500-file folder delete performed 500 full `contents` scans (~5 M row visits) inside one 30 s-bounded transaction. It was also unsafe in a mixed batch: a newly inserted `contents` row is born at `ref_count = 0` and is indistinguishable from an orphan, so sweeping before the referencing `sections` insert deletes live content and aborts the batch on the foreign key. Scoping to touched hashes plus the `idx_contents_orphan` partial index makes it bounded and correct; `= 0` rather than `<= 0` plus the `CHECK (ref_count >= 0)` turns an undercount bug into an abort instead of silent data loss.

Revision 2's `idx_sections_hash` is **removed**: it is on `sections(content_hash)` and cannot serve a predicate on `contents.ref_count`, so its stated justification ("serves the sweep indirectly") was false — a named query with no index plus a claimed index that could not help, taxing every one of ~10 k section inserts per full reindex with a B-tree write for zero read benefit.

**Counters** are derived from the materialised sets — `sectionsRemoved = rows.length`, `wordsRemoved` summed over those sections, `contentsSwept` from the sweep's `.run().changes` — and never from `count(*)`.

**Update / re-index (`GraphWriteRepository`, §6.7)** — the common case, entirely absent from revision 2:

```sql
-- 0. short-circuit: unchanged file
SELECT file_hash FROM files WHERE path_key = :pathKey;   -- equal ⇒ touch mtime, done
-- 1. delete-then-reinsert (NOT an ordinal upsert)
DELETE FROM sections WHERE file_id = :fileId RETURNING id, content_hash;  -- .all()
DELETE FROM sections_fts WHERE rowid = :sectionId;                        -- per row
UPDATE contents SET ref_count = ref_count - 1 WHERE content_hash = :hash; -- per row
-- 2. insert the new section set with fresh ids
INSERT INTO contents(content_hash, text, word_count, ref_count) VALUES (?,?,?,0)
  ON CONFLICT(content_hash) DO NOTHING;
INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                     heading_path, start_line, end_line, content_hash)
  VALUES (...) RETURNING id;
INSERT INTO sections_fts(rowid, heading, text) VALUES (:sectionId, :heading, :text);
UPDATE contents SET ref_count = ref_count + 1 WHERE content_hash = :hash;
-- 3. UPDATE files SET path, mtime_ms, size_bytes, file_hash, indexed_at_ms
```

**Delete-then-reinsert is chosen over an ordinal upsert**, resolving revision 2's contradiction (an upsert retains `sections.id`, which makes AUTOINCREMENT pointless on the hot path and requires an `UPDATE sections_fts … WHERE rowid = ?` companion that was never specified). Delete-then-reinsert also handles the **shrink** case for free: when an edited file yields fewer sections, an upsert strands the trailing `sections` and `sections_fts` rows, never decrements `ref_count`, and drifts every counter — the exact triple defect §6.6's cascade argument exists to prevent, re-entered through the door revision 2 left open. FR-012's "update only changed sections" is satisfied at the **file** granularity by the step-0 hash short-circuit, which is what AC-010 actually measures.

### 6.8 FTS5 segment-merge policy (B8)

`sections_fts` is standalone and rewritten on every save. FTS5 adds a b-tree segment per transaction, and for a non-contentless table a delete writes **delete-keys** rather than removing postings — old entries persist until a merge — while query cost scales with segment count because every segment is queried separately. Revision 2 contained no `optimize`, no `merge`, and no `automerge`/`crisismerge` anywhere: a user editing daily would get monotonically degrading search with no remediation and no telemetry, and the §3.2 spike (taken on a freshly built index) is **not** evidence for NFR-001 in steady state. `PRAGMA optimize` does not help — it touches `sqlite_stat1` only.

Contract, owned by #23, executed in the writer:

```sql
-- configuration, at open
INSERT INTO sections_fts(sections_fts, rank) VALUES('automerge',   GRAPH.FTS_AUTOMERGE);   -- 4
INSERT INTO sections_fts(sections_fts, rank) VALUES('crisismerge', GRAPH.FTS_CRISISMERGE); -- 16
-- incremental, after every GRAPH.FTS_MERGE_EVERY_N_BATCHES committed batches
INSERT INTO sections_fts(sections_fts, rank) VALUES('merge', -GRAPH.FTS_MERGE_PAGES);
-- full, at the end of a rebuild or a user-initiated full reindex only
INSERT INTO sections_fts(sections_fts) VALUES('optimize');
```

`merge` with a negative argument is bounded work, so it cannot stall a batch. `optimize` is unbounded and therefore confined to the two paths already understood to be long. #31's NFR-001 benchmark MUST run against an **aged** index — 10 k sections after ~5 000 simulated save cycles — so it is capable of failing.

### 6.9 Why standalone FTS5, corrected (M3)

Revision 2 rejected external-content FTS5 on a **false premise**: it considered only `content='contents'` and concluded the per-section `heading` column was unrepresentable. FTS5 accepts "the name of a table, virtual table **or view**", and a view over `sections JOIN contents` exposes both `heading` and `text`, supports `snippet()`/`highlight()`, halves the ~40 MB duplication, and unlocks the `rank=1` content-consistency check.

The decision still lands on **standalone**, for the real reason: external content requires the sync statements (or triggers) to stay exactly correct against a *view*, and a mismatch is silent in the same way an orphan is — trading one invisible-divergence class for another while adding a trigger dependency the codebase has nowhere else. Standalone plus the §6.6 orphan audit gives explicit, testable detection. Content-over-a-view is recorded as **evaluated and rejected**, not impossible, and is the first thing to revisit in M2 if index size becomes a complaint.
