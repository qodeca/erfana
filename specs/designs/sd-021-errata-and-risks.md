<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-021 part 7 — spec errata, test plan, residual risks, supersession

Part of the SD-021 set — index in [`sd-021-graph-architecture.md` §0](sd-021-graph-architecture.md). Covers **§10** errata, **§11** tests and the C1–C9 matrix, **§12** residual risks, **§15** supersession, **§16** the issue-body correction.

---

## 10. Spec errata to commit with #21

Style follows the existing #20 errata: a blockquote under the affected item opening `> **Erratum (#21):**`, closing with a pointer into this set.

### E1 — Migrations become discard-and-rebuild

**FR-003** (`02-requirements.md:29-38`), **AC-002** (`04-acceptance.md:19-30`), **`01-overview.md:27`**.

> **Erratum (#21):** During beta there are **no data-preserving migrations**. The database is a derived cache (05-notes "Contract stability"), so a schema-version mismatch — **higher or lower** — discards all indexed data and triggers a full reindex, **in place**: `DROP` + recreate in one transaction on the same file, never `unlink()` and never `rename()`, because a live read-only handle keeps serving a deleted inode and no PRAGMA detects it. Version lives in `graph_meta.schema_version` (`value_int`, not `value` — TEXT affinity would return `'1'` and fail the `===` gate on every open). See `sd-021-db-contracts.md` C3 and `sd-021-db-schema.md` §6.6.

`01-overview.md:27` becomes "Schema versioning with discard-and-rebuild on mismatch (no migrations during beta)".

### E2 — The `file:*` / `project:changed` event API does not exist

Nine locations. **AC-012** (`04-acceptance.md:170-181`), **AC-032** (`:468-479`), **AC-033** (`:482-493`), **UC-002 step 2** (`03-use-cases.md:49`), **UC-008 steps 2–3** (`:253-254`), **`01-overview.md:40`**:

> **Erratum (#21, propagating #20):** The literal `file:saved` / `file:created` / `file:deleted` API does not exist — a grep across `src/` returns zero hits — and `FileWatcherService` is a **single-file** watcher for the open editor file, not a project-wide bus. Read every "FileWatcherService emits/detects `file:*`" step as: "`DirectoryWatcherService` emits a coalesced `add`/`change`/`unlink` batch, consumed **main-side** in `processEvents` via the constructor-injected `onCoalescedBatch(dirPath, events, version)` callback at `DirectoryWatcherService.ts:545-546`, where `coalescedEvents` (bound `:518`) is still intact, immediately before the count-only send at `:547`." The renderer `directory-watch:changed` payload carries counts only. `01-overview.md:40` becomes "Event-driven triggers from DirectoryWatcherService".

**AC-034** (`04-acceptance.md:496-508`) and **UC-001 step 1** (`03-use-cases.md:14`):

> **Erratum (#21, propagating #20):** `project:changed` is renderer-directed IPC (`webContents.send` from `switchProject`), not a service EventEmitter — nothing can `.on()` it. Read "System detects / receives `project:changed`" as: "`ProjectService.updateServices` (`:125-129`) calls `IGraphProjectLifecycle.onProjectPathChanged`, which synchronously bumps the switch version, aborts pending timers, drops queued batches and detaches the reader, then enqueues **close-then-open** asynchronously off the switch path; teardown mirrors in `rollbackServices` (`:147-159`)." See `sd-021-db-contracts.md` §5.2.

### E3 — 05-notes and FR-039 staleness

**(a) Native-dependency status**, `05-notes.md:17` **and** `05-notes.md:100` (both still say mac-arm64 "remains to be confirmed at pin time"):

> **Erratum (#21):** Both supported arches are confirmed — mac-arm64 (signed + notarized) and win-x64 (signed) packaged smokes pass (`docs/graph/native-dependencies.md:275-278`, run 30102038426). SD-019 proved **handle coexistence**, explicitly not shared-file concurrency (both smokes used `:memory:`, `:295-301`). The shared-WAL-file topology this spec depends on is separately evidenced in SD-021 §3.2; that evidence is a **one-off local observation until** `scripts/spikes/graph-wal-concurrency.test.mjs` lands and runs in CI (M31).

**(b) Dependency-table pin drift** (`05-notes.md:85-86`):

> **Erratum (#21):** Both pins are exact, not caret ranges: `better-sqlite3` `"13.0.1"` in `dependencies` (`package.json:45`); `@modelcontextprotocol/sdk` `"1.29.0"` in **`devDependencies`** (`:68`), moving to `dependencies` in #30.

**(c) Internal-dependency row** (`05-notes.md:92`):

> **Erratum (#21):** The source of project-wide file change events is **`DirectoryWatcherService`** (`:504-554`). `FileWatcherService` watches only the open editor file.

**(d) FR-039 SDK ordering** (`02-requirements.md:448`):

> **Erratum (#21):** The v2-first ordering is inverted relative to the shipped decision. SD-019 **rejected `@modelcontextprotocol/server@2.x` as beta-only** and pinned `@modelcontextprotocol/sdk@1.29.0` (rev 2025-11-25). Read FR-039 as "built on `@modelcontextprotocol/sdk` v1 pinned at 1.29.0 using `registerTool`; the v1→v2 migration is a tracked #30 follow-up." Note also that FR-039's "stdio transport" is refined by SD-021 §9.4: Erfana hosts an ACL'd local socket and ships a **client-spawned** stdio bridge.

### E4 — "Delete the database file" is forbidden

Five locations: **UC-005 step 7** (`03-use-cases.md:155`), **UC-005 step 4 confirmation copy** (`:152`), **UC-001 A1** (`:26` — the *corruption* path §6.6 auto-runs), **AC-003** (`04-acceptance.md:43`), **AC-024** (`:357`).

> **Erratum (#21):** Rebuild is **in place** — `DROP` + recreate in a single transaction on the same `graph.db` — never by deleting or renaming it. A live read-only connection follows an in-place rebuild transparently, but after `unlink()` + recreate it silently serves the deleted inode forever (measured; `data_version` / `schema_version` / `user_version` all fail to detect it), and on Windows unlinking an open file typically fails outright. Read "deletes the database" as "drops and recreates all tables in place". UC-005's confirmation copy becomes "This will clear and rebuild the entire index. Continue?".

### E5 — Corruption recovery is silent for the first pass, visible for a loop

**FR-004** (`02-requirements.md:40-47`), **AC-003**'s dialog clause (`04-acceptance.md:33-44`), **UC-001 A1** (`03-use-cases.md:26`), **NFR-007** (`02-requirements.md:664-671`).

> **Erratum (#21):** Corruption recovery is **automatic and silent for the first recovery** — the index is a rebuildable derived cache, so there is no modal, no confirmation and no "Rebuild?" prompt; the sequence surfaces only through the status indicator (yellow → green). Read FR-004's "report … with recovery options" as "detect on startup, recover automatically, and surface state through the status indicator"; read NFR-007's "offer automatic recovery" as "perform automatic recovery"; drop AC-003's dialog clause and UC-001 A1's prompt/confirm steps. **A recurring rebuild is not silent:** the budget is `GRAPH.MAX_AUTO_REBUILDS_PER_SESSION` = 2 with a 10-minute cooldown, persisted in `graph_meta` so it survives a restart; on exhaustion Erfana stops rebuilding, enters `disabled` with `GRAPH_DB_REBUILD_FAILED`, and surfaces it. The manual "Rebuild index" button (FR-033) is unaffected and resets the budget. See §9.10.

### E6 — Status-dot null state and the searchable/stale split

**FR-037** (`02-requirements.md:419-427`).

> **Erratum (#21):** A fourth **grey** value is added for the null state (no project open / not yet initialised). Green/yellow/red keep their FR-037 meanings; grey means "nothing to report". The snapshot also carries `searchAvailable`, orthogonal to the dot: yellow + `true` = "index behind", red + `false` = "search is broken". Without that split the FR-037/FR-038 UI cannot render the difference. Additionally, **green is reserved for a zero-skip pass**: a pass that skipped files ends `degraded` with "Indexed with {n} files skipped".

### E7 — The #20 analysis note's migration caution

**`analysis/20-save-watch-index-pipeline.md:203-205`**.

> **Erratum (#21):** There are no migrations (E1). The caution stands and is stronger than stated: `updateServices` is synchronous, so the DB is opened **in the worker**, off the switch path, with main only recording the path, bumping the switch version and aborting pending timers synchronously. Read "migrations" as "the schema-version gate and any resulting in-place rebuild".

### E8 — NFR-009 is not satisfied today (B10)

**NFR-009** (`02-requirements.md:686-693`) and **AC-039** (`04-acceptance.md:568-579`).

Revision 2 asserted JSON output was "a `LoggingService` property" — i.e. already done. **Verified false:** the file transport is a plaintext template (`LoggingService.ts:245`), `formatMessage` emits `` `${message} ${JSON.stringify(context)}` `` (`:498`), and `formatErrorMessage` joins parts with `' | '` (`:522`). No log line is a JSON object. The framing was also inverted on the other clause: **stack traces are already automatic** (`:511-513`), so that half needed no per-call-site obligation at all.

> **Erratum (#21):** AC-039's "log entries are in JSON format" is **not** satisfied by the current logger. Two ways forward, and the choice belongs to the **JSON log transport** parcel (`(new issue — not yet created)`), not to #31, which is chartered to verify and today has nothing to verify: **(a)** add a JSON file transport (electron-log accepts a `format` function returning a serialised object, so `instanceId`, level, timestamp, message and context become fields); or **(b)** narrow NFR-009/AC-039 to "**a human-readable message followed by a single-line JSON context object**", whose parse recipe is: take everything from the first `{` to the end of line and `JSON.parse` it; entries with no context have none. Duration metrics are satisfied by §8.8's phase fields; stack traces are already automatic. **Until (a) or (b) lands, NFR-009 is open** and must not be ticked.

### E9 — FR-042 backpressure becomes a bounded queue

**FR-042** (`02-requirements.md:476-483`) and **AC-030** (`04-acceptance.md:438-449`).

> **Erratum (#21):** "Queued and delayed, not rejected" assumes a transport with flow control. `MessagePortMain` has none — `postMessage` never blocks and queues unconditionally — so unbounded delay-queueing is not backpressure; it is an unbounded main-process queue a looping client can grow without limit, each entry landing on the synchronous main-thread reader from outside the trust boundary. Read FR-042 as: "apply advisory rate limiting with a bounded queue (`MCP.MAX_INFLIGHT` = 4, `MCP.MAX_QUEUE_DEPTH` = 32); requests beyond the bound receive a typed `graph:throttled` response carrying `retryAfterMs`, which the client is expected to honour. This is a rejection in transport terms and a delay in client terms." AC-030's "no error response is returned" becomes "no *failure* response is returned; a throttle signal with a retry hint is". See §9.5.

### E10 — Incremental update is file-granular, not section-granular

**FR-012** (`02-requirements.md:132-140`) and **AC-010** (`04-acceptance.md:142-154`).

> **Erratum (#21):** The write path re-indexes at **file** granularity: an unchanged file is short-circuited on `files.file_hash`, and a changed file has its sections deleted and re-inserted with fresh ids rather than upserted per ordinal. Section-level upsert was rejected because it strands trailing `sections` and `sections_fts` rows when an edited file yields fewer sections, never decrements `contents.ref_count`, and drifts every counter — and because FTS5 rows must then be `UPDATE`d at a retained rowid, which nothing in the spec described. Read AC-010's "only the changed section is updated (1 UPDATE)" as "only changed **files** are re-indexed; an unchanged file performs zero writes". The < 100 ms bound is unaffected. See `sd-021-db-schema.md` §6.7.

---

## 11. Test plan

Co-located `*.test.ts` (never `__tests__/`), all under the **`main`** vitest project (`vitest.main.ts:10` globs `src/main/**` and `src/shared/**`). **Typecheck note:** `tsconfig.node.json:3-13` includes `src/shared/**/*` and excludes only `src/main/**/*.test.*`, so the new *shared* tests are inside the typecheck program and must be strict-clean.

### 11.1 #21's own contract tests

| # | File | Budget | Proves |
|---|---|---|---|
| 1 | `src/shared/ipc/graph-schema.test.ts` | 420; **split TAKEN**: filters, status, jobs and the error vocabulary live in `graph-schema.filters.test.ts` / `graph-status-schema.test.ts` / `graph-schema.jobs.test.ts` / `graph-error-schema.test.ts`, the last mirroring the module split (comparables `git-watcher-schema.test.ts` 759, `project-lock-schema.test.ts` 521) | `.parse()` happy paths for every payload. Rejections: empty and **whitespace-only** `query` (proving `.trim()`); over-length; `k` = 0 / > `MAX_TOP_K`; `offset` ≥ `MAX_COUNT_PROBE`; unknown enum members; a non-graph `ErrorCode` on `GraphErrorSchema.code`; `queuedFilePaths` over count **and** over element length. **`strictObject`**: an unknown key on any request or filter is **rejected**, not stripped (m4). **Defaults + input/output**: `parse({})` succeeds where all fields default; `parse(undefined)` fails; `z.input` allows omission where `z.output` requires (M14). **Correlation**: a request omitting `correlationId` parses, a response omitting it fails. **Folder/fileType**: `'doc'` transforms to `'doc/'`; `'md'`, `'.MD'`, `'*.md'` are rejected (M17). Punctuation-only queries parse at the schema layer (the short-circuit is #26's). |
| 2 | `graph-channels.test.ts` + `constants.graph.test.ts` | 90 + 100 | All channel values start with `graph:` and are unique. `GRAPH.DB_ARTIFACTS` has exactly three entries each beginning with `GRAPH.DB_FILE` (single-literal derivation). `DEFAULT_TOP_K ≤ MAX_TOP_K`; `MCP.MAX_TOP_K < GRAPH.MAX_TOP_K`; `MAX_COUNT_PROBE > 0` so the `offset` bound is valid; `MCP.BETA_DISCLAIMER` contains U+2013. `GRAPH_ERROR_CODES.length === 26`. |
| 3 | `src/shared/errors.graph.test.ts` | 130 | Every `GRAPH_*`/`MCP_*` code has a non-empty, non-fallback `ERROR_MESSAGES` entry, **distinct** from every other graph/MCP message (a duplicate the `Record` type cannot catch). `GRAPH_ERROR_CODES` and the prefix-derived set are equal — so a new code cannot be added to one and forgotten in the other. |
| 4 | `project-settings-schema.graph.test.ts` | 130 | `graph.excludeFolders` parses in both modes with defaults; an unknown top-level key is **stripped, not rejected** (proving no existing `.erfana/settings.json` changes outcome). `GlobalSettingsSchema` parses without a `graph` key and does **not** materialise one. |
| 5 | `ProjectSettingsService.test.ts` *(extend)* | +90 | Default / `extend` / `replace` resolution; list **contains `.erfana`** (FR-010/AC-008) and is **not equal** to `DEFAULT_WATCHER_IGNORE_PATTERNS`. |
| 6 | `graph/graphSchema.test.ts` | 340; **split TAKEN**: write-path + query catalogue in `graphSchema.queries.test.ts`, the `graph_meta` point lookups (version, generation, rebuild budget) in `graphSchema.meta.test.ts` | **AC-2 proof**, real in-memory `better-sqlite3` (precedent `nativeDeps.smoke.test.ts`, an always-on gate on ubuntu + windows). Apply `GRAPH_SCHEMA_DDL`; assert FTS5 compiled in; `sqliteVersionAtLeast` passes; a **two-document** MATCH returns exactly the matching row; heading-3× bm25 ordering. **Path identity (M1):** `Wstęp.md` in NFC and NFD insert **one** row. **Delete path (§6.7):** a bare `DELETE FROM files` throws `SQLITE_CONSTRAINT_FOREIGNKEY`; the repository sequence leaves **zero** `sections_fts` orphans, no `ref_count = 0` rows, and counters equal to a recount. **STRICT/CHECK (m1):** a REAL `mtime_ms`, `heading_level = 7`, `end_line < start_line` and a negative counter each abort. **Stamp (B9):** after apply-fresh **and** after rebuild, `schema_version` / `generation` / `schema_stability` are present and correct and re-running the §6.6 gate returns OK, not REBUILD. **Symmetry (M35):** snapshot `SELECT name, type FROM sqlite_schema` after the DDL; after the DROP half the snapshot is empty except `sqlite_sequence`; the six-table count is **derived from that set, never hard-coded**; plus an apply-fresh-onto-a-foreign-schema case. **Audits (M3):** an injected FTS orphan and an injected section-without-posting are both detected. |
| 7 | `graph/graphSchema.rebuild.test.ts` | 220 | **Contract C3 + C2 together.** Writer applies DDL and inserts; a second handle opens `{readonly: true, fileMustExist: true}` and **prepares and caches** a statement; the writer runs `GRAPH_REBUILD_PROGRAM` in one transaction; **the same, never-reopened reader REUSES its cached statement handle** and must observe the post-rebuild state — this is what gives the test discriminating power, which revision 2 lacked by leaving reuse-vs-re-prepare unstated. Then assert the cache is cleared on `rebuilt: true` even when `graph_meta` is unreadable (M4). On non-`win32` assert `fs.statSync(dbPath).ino` is unchanged; on `win32` `ino` is unreliable, so substitute a content probe (`platform()`-guarded, per `docs/windows/contributing.md`). A comment — **not** production code — records that `unlink()` + recreate leaves the reader serving stale data. |
| 8 | `graph/graphCorrelation.test.ts` | 70 | `/^idx-\d+-[0-9a-f]{12}$/` and `/^job-…/`; 10 000 draws unique (probabilistic — 48 bits of `randomBytes` gives ≈1.8 × 10⁻⁷ collision odds at that scale; asserted as a safety check, explicitly not a guarantee). |
| 9 | `graph/sqliteVersion.test.ts` | 60 | **M32.** `sqliteVersionAtLeast` parses to `X*1e6 + Y*1e3 + Z` and **rejects** `'3.4.0'`, `'3.9.0'`, `'3.34.9'`, `'3.36.99'` — every one of which passes a naive lexical `>=`, which is what revision 2 specified. Accepts `'3.37.0'`, `'3.53.3'`. Floor is `GRAPH_MIN_SQLITE = 3_037_000` because `STRICT` tables need 3.37.0, which subsumes `RETURNING`'s 3.35.0. |
| 10 | `scripts/spikes/graph-wal-concurrency.test.mjs` | 400 | **M31.** One `expect` per contract, C1–C9. Collected by `vitest.main.ts:10` on ubuntu and the advisory Windows job, so the §3.2 measurements become falsifiable instead of anecdote. |

**Coverage.** The ">80 %" claim is **dropped as unenforceable**, for a reason that reaches past #21 — see M33 in §12.2. The real gate is `npm run test:main` passing all ten items plus `npm run typecheck` proving `ERROR_MESSAGES` exhaustiveness.

**Not tested by #21:** worker lifecycle, IPC handler behaviour, search execution, and the `.erfana/.gitignore` file content — #21 commits no writer, no handler and no worker. Those land with #23/#25/#26 using the `vi.hoisted()` + `vi.mock('worker_threads')` recipe (`GitStatusWorkerAdapter.test.ts:18-59`).

### 11.2 C1–C9 matrix (M30)

Revision 2 claimed each contract "names its test in §11" while only C3 had one. Every row now has a file, an owner and a measurable exit criterion.

| Contract | Test file | Owner | Exit criterion |
|---|---|---|---|
| **C1** reader-after-ready + fenced retry | `graphReadConnection.attach.test.ts` | #23 | Open before the file exists throws `SQLITE_CANTOPEN`; the ladder retries **only** that code; a `switchVersion` bump mid-ladder aborts and does **not** attach; a double `attach()` leaks no handle |
| **C2** no statement across a generation change | test 7 (above) | #21 asserts, #23 implements | The reader **reuses** its cached statement across the rebuild and still returns correct rows; cache clears on `rebuilt: true` with `graph_meta` unreadable |
| **C3** in-place rebuild | test 7 | #21 + #23 | Inode unchanged (non-win32); the never-reopened reader observes post-rebuild state |
| **C4** no txn across await; one composite | `graphReadConnection.snapshot.test.ts` | #23 | Interleaved writer commits during `querySearchPage` yield a page and count from **one** snapshot; no public method returns a transaction or iterator |
| **C5** no journal-mode flip with a reader attached | spike test 10, assertion `C5` | #21 | Flipping to `delete` with a reader attached raises `SQLITE_BUSY` on the **writer** |
| **C6** counts from `corpus_stats`, never `count(*)` on FTS | `graphSchema.test.ts` | #21 | Corpus-stats read touches `corpus_stats` only; the open-time reconciliation repairs a deliberately corrupted counter |
| **C7** reader needs a writable directory | `graphDatabase.open.test.ts` (skip win32) | #23 | chmod'd directory ⇒ `GRAPH_DB_DIR_NOT_WRITABLE`, detected **writer-side first** |
| **C8** checkpoint on open, busy column checked | `graphDatabase.checkpoint.test.ts` | #23 | Kill the worker mid-transaction with the reader querying; after restart `-wal` is bounded **and** a `busy === 1` result is not treated as success |
| **C9** `VACUUM` safe + free-space pre-flight | spike assertion `C9` + `graphDatabase.rebuild.test.ts` | #21 + #23 | `VACUUM` succeeds with a reader attached; a simulated low-disk condition **skips** `VACUUM` rather than failing the rebuild |

**M19 — two-phase query, recorded as the primary design.** Phase 1 ranks with no auxiliary functions in the sorter; phase 2 hydrates only the returned rowids. `ftsQueryPlan.test.ts` (#26) pins the plan with better-sqlite3 13's `db.explain()`, so the "the plan is MATCH-driven" premise — on which the §6.3 index-dropping decision rests — is **asserted rather than assumed**. #31 benchmarks both shapes at 10 k sections × `k = 100` × `offset = 999` against an **aged** index.

---

## 12. Residual risks and open items

### 12.1 Deferred: the Cmd+Shift+F conflict

FR-029 / AC-021 specify `Cmd/Ctrl+Shift+F`. **It is already consumed:** `useSearchKeyboard.ts:60` matches modifier + `'f'` and **ignores `e.shiftKey`**, calls `preventDefault()` + `stopPropagation()`, and is registered in the **capture** phase (`:71`). `useSearchKeyboard.test.ts:276-286` locks this in, in a test named `'ignores Cmd+Shift+F'` that asserts `openSearch` **was** called. **#22** owns the decision; **#27** owns the code and test edit. No fix is proposed here and the shortcut is not reserved. This closes 05-notes' "does it conflict with existing functionality?" — yes.

### 12.2 Unverified, and what would falsify it

| Item | Why it matters | Disposition |
|---|---|---|
| **The canonical query's cost.** §3.2 measured a bare `MATCH`. The real path adds two joins, `snippet()`, `highlight()`, a `substr()` filter and a sort. | Runs **synchronously on main**, which also drives node-pty and every IPC channel. | #23 exit criterion + #31 benchmark, budgeted as **p95 < 4 ms and worst case < 16 ms of main-thread occupancy** via `perf_hooks.monitorEventLoopDelay` (§7.2). Fallback: `includeMatchedTerms: false` + lazy `graph:explain`. |
| **Electron 39.** The spike ran under plain Node. | Safety is *inferred* from N-API stability and process-level locking, not measured. | #23 re-runs the contract assertions in a packaged Electron smoke (`ERFANA_SMOKE`). |
| **All of it on Windows (M34).** C3's failure mode differs: unlinking an open file typically fails outright rather than orphaning an inode. | The only Windows path for `test:main` is `windows-checks`, which its own comment marks excluded from branch protection — so a C3 regression yields a **non-blocking red mark**. | **Named gate, pick one before the rebuild path merges:** promote `windows-checks` to a required check, **or** add the C3 assertions to the packaged Windows `ERFANA_SMOKE` that already runs in the release flow and **record the run ID in `docs/graph/wal-concurrency-spike.md`**. Owner #23; not satisfiable by an advisory job. |
| **The spike harness does not exist yet (M31).** `scripts/spikes/` is absent, yet E3's committed text called it a fact. | Every cited number (228 ms, 12/12, 37 MB, 0.05→4.8 ms) is unfalsifiable in CI on both platforms. | E3 is worded in the **future tense** until the file lands; gate 10 requires **all C1–C9 assertions**, not exit 0. |
| **Multi-process contention.** The lock is advisory with a stale-takeover window; `checkLock` is async and main-side while writes are synchronous in the worker. | `onOwnershipLost` (§9.7) narrows the window; it does not close the TOCTOU. | Accepted. The DB is a discardable cache, and B5's explicit `close` removes the *normal-operation* case revision 2 created. |
| **Power-loss durability at `synchronous = NORMAL`.** | A crash can lose the last committed transactions. | Accepted: derived cache; the next open's hash short-circuit self-heals. |
| **Coverage is unenforced (M33).** `coverage` is a top-level **sibling** of `test` in `vitest.main.ts:16` (`test` closes `:15`), where vitest expects `test.coverage`. | The blast radius is larger than #21: the per-file **90 % thresholds guarding the whisper trust chain** (`verifyManifest`, `secureDownloader`, `zipArchive`, `tarArchive`, `:36-39`) are almost certainly **not applied**, so `npm run test:cov` reports success while enforcing nothing. Even once nested, `include: ['src/main/**']` + `all: false` never measures `src/shared/**`, where #21's deliverables live. | **Vitest coverage config fix** `(new issue — not yet created)`, a **hard prerequisite for #23** (gate 17). Verify by lowering a threshold deliberately and asserting `npm run test:cov` **fails**. |

### 12.3 Open item for the product owner — `.erfana` visibility

§9.11 scopes the exclusion to the three DB artifacts rather than the directory, because hiding `.erfana` also hides `settings.json` — a tracked file in this repo. **Recommendation: keep `.erfana/` visible.** Deciding otherwise is a UX issue, not #21, and needs edits to `DEFAULT_TREE_HIDDEN_PATTERNS` (`constants.ts:124-127`) and `FileService.ts:9, 50`.

### 12.4 Carried forward

| Item | Disposition |
|---|---|
| FR-009 dedup applies to `contents` only; FTS materialises per-section postings, so text is stored ~twice. Content-over-a-**view** external FTS5 would halve it and unlock the `rank=1` consistency check — it is **possible**, contrary to revision 2's stated reason. | Standalone kept for sync-statement simplicity and no trigger dependency; recorded as **evaluated and rejected**, first to revisit in M2 (§6.9). |
| Case-folding merges case-only variants on case-sensitive filesystems. | Accepted: correct on macOS/Windows, an acceptable merge on Linux, which is not a supported arch. |
| `PRAGMA user_version` as a transactional mirror is unverified. | `graph_meta` is authoritative; #23 verifies before adding the mirror. |
| Per-column bm25 via two weight vectors in one SELECT is unverified. | Not in the contract; `graph:explain` is the shipped breakdown. |
| Truncated reads: `awaitWriteFinish: false` (`DirectoryWatcherService.ts:210`). | #32 picks a stability check **or** relies on the hash plus the post-flush `change`, and tests it. |
| **Typecheck-program correction.** Revision 2 argued the `ResolvedProjectSettings` mocks are safe because they are `as any`-cast. `tsc --listFiles` proves something stronger: `ProjectService.test.ts` and `ProjectService.switching.test.ts` are **outside the program entirely** (`tsconfig.node.json:10`). The cast is irrelevant; the exclusion is decisive. They are updated anyway so #25 inherits no surprise. |
| `errors.ts` reaches ~490 lines after #21's 26 codes; `constants.ts` ~480. | **Decision named now:** `constants.ts` **splits** — extract `GRAPH`/`MCP`/`DEFAULT_GRAPH_EXCLUDE_PATTERNS` to `src/shared/graph-constants.ts`, re-exported. `errors.ts` **does not split** — the exhaustive `Record<ErrorCode,string>` is the only completeness enforcement in the codebase and any spread-and-merge defeats it; when it crosses 500 it is accepted debt in `docs/technical-debt.md`, following the `security.md` precedent (`:125-128`). |

### 12.5 Declared deviations from the spec

1. **`grey` status dot** beyond FR-037's three (erratum E6).
2. **`searchAvailable`** added — FR-037/FR-038 cannot render "index behind" vs "search broken" without it (E6).
3. **`char(2)`/`char(3)` snippet delimiters, not `<mark>`** — the spec's markup would push raw HTML across IPC into a renderer that deliberately blocks it.
4. **Two-column FTS5, not five** as 05-notes' proposed DDL shows — clean bm25 weights, unambiguous `snippet()`/`highlight()` indices.
5. **Related-sidebar scope resolved** (05-notes `:152`): exclude the current **section**, keep the rest of the current file eligible; `excludeFilePath` remains for stricter callers.
6. **Batch size fixed for R1**, resolving 05-notes' "configurable or auto-tuned?".
7. **Cancellation is main-side and cooperative** — the in-flight batch always finishes. UC-005's "Cancel" means "cancel the queue", not "abort the write".
8. **A seventh channel, `graph:explain`** — a schema and query with no channel to reach them would still have forced a channel edit later.
9. **`error` deleted from `GraphIndexState`** — every plausible producer is routed elsewhere by a contract that says so in words.
10. **FR-042 bounded queue** (E9) and **FR-012 file granularity** (E10).

### 12.6 NFR-003 budget (m8)

NFR-003's 500 ms was assigned wholesale to #31 with no start event, no end event and no per-stage allocation — and the chain stacks **two `ThrottledWorker` windows in series**: the watcher's own `collectionDelay: 75` (verified `DirectoryWatcherService.ts:222`) then the graph's 300 ms. That is **375 ms — 75 % of the budget — before a byte is read**. "Leading" helps the first save in a burst but not the second, which is the normal editor-autosave pattern.

**Start** = chokidar `change` fires. **End** = the reader can return the new section for a `MATCH`.

| Stage | Budget |
|---|---|
| watcher coalesce (existing) | 75 ms |
| graph debounce | 300 ms |
| read + parse + SHA-256 | 60 ms |
| write transaction (incl. FTS insert) | 40 ms |
| WAL visibility to the reader | 25 ms |
| **total** | **500 ms** |

**Decision taken now, not left to #32:** when a coalesced batch contains **exactly one entry**, `GraphIndexQueue` **bypasses the 300 ms window** and dispatches immediately, spending ~200 ms instead of ~375 ms of the budget on debouncing. The window exists to collapse bursts; a single-entry batch has no burst to collapse. Bursts keep the full window. #31 instruments the composite end-to-end so the table is falsifiable.

### 12.7 Main-process framing

01-overview success criterion 7's 16 ms is a **renderer frame budget**, but the graph's synchronous work runs on **main**, which also owns node-pty and IPC dispatch. Blocking there shows up as input lag and terminal stutter, not dropped frames, so a frame counter would not catch it. Every budget in this set is stated as **main-thread occupancy** measured with `perf_hooks.monitorEventLoopDelay`.

---

## 15. Supersession of `docs/future/graph-engine/`

30+ files plus 7 SVG wireframes, last updated **October 2025**, each banner-marked "WORK IN PROGRESS – NOT READY FOR DEVELOPMENT". `01-overview.md:3` already calls the folder read-only reference, but Phase 5 would still hit two sources.

| Superseded claim | Location | SD-021 |
|---|---|---|
| `GraphEngineService` subscribes to a `FileWatcherService` EventEmitter via a shared `eventBus` | `architecture-overview.md:69-72, 108-141` | No such API (E2). Main-side `onCoalescedBatch`; DB swap via `updateServices`. |
| **External-content FTS5** with three `AFTER INSERT/DELETE/UPDATE` triggers | `data-model.md:92-116` | Standalone two-column FTS5 with **explicit** deletes (§6.7). The superseded DDL is also internally inconsistent: it declares `content='sections'` while listing a `section_id UNINDEXED` column the content table lacks. |
| `sections.file_id … ON DELETE CASCADE` | `data-model.md:77, 233` | **No cascade anywhere** — FTS5 does not participate in it, so it would silently orphan postings and drift counters (§6.7). |
| "better-sqlite3 is synchronous, **main-thread safe**"; the engine owns the DB on main | `architecture-overview.md:268-269` | Worker owns all writes; main holds a read-only handle (§5.1, §8.0). |
| `postinstall: electron-rebuild`, `externalizeDeps`, unpinned install | `packaging.md:99-118` | Exact pin `13.0.1` in `dependencies`; `npmRebuild: false`; no `electron-rebuild` postinstall (SD-019 §4). |
| `meta` with `embedder_id`/`hybrid_weights`; `embeddings`, `vss_sections`, `entities`, `edges`, `mentions`, `episodes` | `data-model.md:53-218` | R1 is six tables (§6.3). The rest is M2–M5. |
| Five MCP tools with per-tool rate limits | `architecture-overview.md:174-184`; `mcp-server-tools.md:148-330` | R1 ships **one** tool with one advisory limit, an untrusted-content envelope and an authenticated transport (§9.3, §9.4). |

**Adopted** (independently re-derived, now cross-confirmed): SQLite + FTS5 + WAL; bm25 heading 3× / text 1× (`data-model.md:256-261`); content-hash incremental updates; a 300 ms debounce (`architecture-data-flow.md:197`); prepared statements (`:250`); per-project isolation (`:258`); progress events driving a status indicator (`data-ingestion-updates.md:91-184`).

**Valid but out of scope for R1:** `embedding-pipeline-*`, `vector-search-*`, `hybrid-search-*`, `graph-capabilities-*`, `implementation-guide/m2-*`…`m5-*`, and the temporal patterns — these map to specs #005/#006/#007. The **wireframes** remain useful input for #22 and are not superseded.

**Banner** for `architecture-overview.md`, `data-model.md`, `packaging.md`, `implementation-guide/m1-backend.md`:

> **Superseded for M1 (2026-07).** The authoritative M1 architecture is `specs/designs/sd-021-graph-architecture.md` and its companion parts. Where this document conflicts — the FileWatcherService event bus, external-content FTS5 with triggers, `ON DELETE CASCADE`, main-thread DB ownership, and the `electron-rebuild` packaging steps — **SD-021 wins**. See SD-021 §15.

---

## 16. Issue #21 body correction

**Current:** `… on mismatch → delete + full reindex`

**Replacement:**

```
… on mismatch → in-place discard + full reindex (DROP + recreate all tables in one
transaction on the same graph.db file; never unlink or rename — a live read-only
connection silently serves the deleted inode and no PRAGMA detects the swap, and on
Windows unlinking an open file typically fails outright). See SD-021 C3 / §6.6.
```

Two further body corrections:

1. **AC-4** should read "Worker-vs-chunked decision recorded (= worker-based) **and** worker lifecycle / NFR-008 recovery contract defined" — the decision record is §8.0.
2. **The NFR-007 citation** on the UI-responsiveness item is wrong: NFR-007 is *Database corruption recovery*. The UI-responsiveness requirement is `01-overview.md:78` success criterion 7 — and per §12.7 it is a renderer frame budget, while this code runs on main.
