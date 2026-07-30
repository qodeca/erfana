<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-021 part 2 — database topology, lifecycle, and contracts C1–C9

Part of the SD-021 set — index in [`sd-021-graph-architecture.md` §0](sd-021-graph-architecture.md). Covers **§5**. The DDL, queries, version gate and write paths live in [`sd-021-db-schema.md`](sd-021-db-schema.md) (§6).

---

## 5. DB topology & lifecycle contract

### 5.1 Topology

```
                       .erfana/graph.db  (+ -wal, -shm)
                              ▲                 ▲
                    write     │                 │   read (readonly:true)
  ┌───────────────────────────┴──┐        ┌─────┴───────────────────────┐
  │ worker_thread                │        │ MAIN process                │
  │  graph-index.worker.js       │        │  GraphReadConnection        │
  │   └ GraphDatabase (writer)   │        │   └ generation-scoped       │
  │   └ Graph{Write,Delete}Repo  │        │     prepared-stmt cache     │
  │  SOLE WRITER                 │        │  READ-ONLY, no held txn     │
  └──────────────▲───────────────┘        └─────▲───────────────────────┘
                 │ postMessage / message              │ GraphSearchService only
  ┌──────────────┴────────────────────────────────────┴───────────────┐
  │ GraphEngineService ─ GraphLifecycle ─ GraphWorkerSupervisor        │
  │ (no DB handle anywhere in this row)                               │
  └───────────────────────────────────────────────────────────────────┘
```

Writes are off the main thread (better-sqlite3 is synchronous; blocking main stalls PTY drain and every IPC channel — §12.7). Reads stay on main because a worker round-trip would cost more than the query and would serialize search behind indexing batches. **The MCP endpoint holds no handle at all** — it proxies through this same reader over a MessagePort (§9 row 6b), so "exactly two handles" is literally true.

### 5.2 Cold-start, project switch, and close

`ProjectService.updateServices` (`:125-129`) is a **synchronous `void`** method, so nothing here may block it.

```
updateServices(newPath)                        ← SYNCHRONOUS, O(1)
  └─ graphLifecycle.onProjectPathChanged(newPath)
        1. ++switchVersion; record newPath
        2. abortController.abort(); new AbortController()      ← cancels pending timers (M6)
        3. drop queued index batches; reader.detach()
        4. ENQUEUE close-then-open on operationQueues, return immediately

closeThenOpenAsync(newPath, version, signal):   ← ASYNC, off the switch path
  5.  if the worker holds a DB handle:
        supervisor.request({ type:'close', id, switchVersion: OLD, sessionVersion })
        bounded by GRAPH.WORKER_CLOSE_TIMEOUT; on timeout, terminate the worker
        (a leaked handle is worse than a lost worker — see below)
  6.  abort unless version === switchVersion && !signal.aborted
  7.  no new lock — ProjectService already holds this project's lock (§9 row 5)
  8.  supervisor.request({ type:'open', id, dbPath, switchVersion, sessionVersion })
        worker: reject GRAPH_DB_OPEN_FAILED if a handle is already open
                (GRAPH_ERROR_CODES is a closed set of 26 — a code outside it
                 fails the adapter safeParse and hangs `open` to its timeout)
                mkdir -p .erfana  (confined + symlink-checked, §9.5)
                new Database(dbPath); pragmas; wal_checkpoint(TRUNCATE) + busy check (C8)
                SQLite/FTS5 gates, integrity, audits, version gate  → §6.6
                reply { type:'ready', generation, schemaVersion, rebuilt }
  9.  abort unless version === switchVersion && !signal.aborted
  10. reader.attach(dbPath, generation)          ← C1 ladder, re-fenced per attempt (M6)
  11. if ready.rebuilt: reader.clearStatements() ← UNCONDITIONAL (M4)
  12. state := 'ready'; publish snapshot
  13. enqueue the initial index pass, front-loading `graph:setPriorityPaths` (FR-049)
```

`rollbackServices` (`:147-159`) mirrors steps 1–4 with the *old* path and re-enters at step 5.

**B5 — the `close` was missing, and it is not cosmetic.** Revision 2's sequence was exhaustive and contained no `close`; `open` called `new Database(dbPath)` unconditionally with no defined behaviour when a handle existed, and §8 called `close` "moot" on restart. Three consequences, all real:

1. **A leaked write handle per switch.** SQLite performs the final checkpoint-and-delete of `-wal`/`-shm` only when the **last** connection closes, so every switched-away project keeps its WAL and shared-memory files forever.
2. **The single-writer claim was void.** `ProjectService` releases the old project's lock on a successful switch (`:314-321`) while the handle persists, so a second Erfana instance can legitimately acquire that lock and open a writer on a file this process still holds. That turns §12.2's "accepted multi-process risk" from a corner case into normal operation.
3. **Windows.** A retained handle blocks moving or deleting the project folder.

**Post-switch latency, now documented.** `close`/`open` enter `operationQueues` (§4.3), so they queue behind an in-flight `index` batch — up to `GRAPH.WORKER_BATCH_TIMEOUT` (30 s). `searchAvailable: false` can therefore persist ~30 s after a switch on a slow batch. That is an explicit row in the §8.6 state table (`opening`, `searchAvailable: false`), not an anomaly, and it is why step 3 detaches the reader immediately rather than waiting: serving the *old* project's rows during that window would be worse.

### 5.3 Numbered contracts

Each cites the measurement that forces it and names its test. The full C1–C9 → test → owner matrix is in [`sd-021-errata-and-risks.md` §11](sd-021-errata-and-risks.md).

---

**C1 — the reader opens only after the writer signals ready, and every retry is re-fenced.**

`readonly: true` implies `fileMustExist`; opening before the file exists throws `SQLITE_CANTOPEN` at construction and does **not** create the file (measured). Hence the §5.2 ordering.

A bounded retry covers the residual race: up to `GRAPH.READER_OPEN_MAX_ATTEMPTS` (5) at `GRAPH.READER_OPEN_RETRY_DELAY_MS` (200 ms). **Retry only on `SQLITE_CANTOPEN`** (better-sqlite3 exposes `err.code` as a `SQLITE_*` string on `SqliteError`). Do **not** retry `SQLITE_READONLY_DIRECTORY`, `SQLITE_PERM`, `SQLITE_NOTADB` or `SQLITE_CORRUPT` — retrying masks a real fault — and do **not** retry `SQLITE_BUSY`, which a 200 ms nap will not resolve; it maps straight to `GRAPH_DB_OPEN_FAILED`.

**M6 — the ladder must not outlive its project.** Revision 2 checked `switchVersion` once, *before* the ladder, then spent up to a second inside it with no further check. A project switch during that second runs `reader.detach()` (step 3) and the still-running old-project loop then succeeds and **re-attaches to the previous project's database**; step 12 publishes a snapshot with a stale `projectPath`. Because results carry only project-relative paths, neither the renderer nor an MCP client can detect the mix-up. Required:

- Re-check `version === switchVersion && !signal.aborted` at the **top of every attempt** and again **immediately after `attach()` returns**; on mismatch, `detach()` and abort.
- Carry an `AbortSignal` created in `onProjectPathChanged` so pending `setTimeout`s cancel rather than race.
- **`attach()` is idempotent**: it closes any existing handle and clears the statement cache before opening. Revision 2 left double-attach undefined, leaking the prior handle and its generation-scoped cache.

Exhausting the ladder ⇒ `degraded` with `searchAvailable: false` — never `error` (§8.6).
*Test:* `graphReadConnection.attach.test.ts` (per-attempt fence, abort mid-ladder, double-attach leaks nothing).

---

**C2 — no prepared statement survives a generation change, and a rebuild clears the cache unconditionally.**

A live readonly handle *does* pick up DDL committed by the writer with no reopen (measured), but **cached prepared statements are frozen across a schema change**. `GraphReadConnection` holds `{ generation, statements: Map<GraphQueryKey, Statement> }`.

**M4 — do not make correctness depend on the token.** The rebuild re-mints `generation` rather than carrying it: the budget keys survive the drop via `GRAPH_REBUILD_PROGRAM.preserve` (B4/[2]), but `generation` is deliberately **not** among them. A counter's next value would still be undefined on exactly the two paths that matter — on `APPLY_FRESH` no prior value exists, and on `REBUILD('corruption')` the unreadable page may *be* `graph_meta`'s, so even a pre-DROP read of the prior token can fail — and a restart-at-1 could re-issue a value the reader already holds at the moment the tables were dropped. Since C3 keeps the same handle and no PRAGMA detects the swap, there would be no other signal, and the reader could keep executing statements prepared against dropped tables. (Earlier revisions grounded this on "`generation` persists only in `graph_meta`, which the rebuild drops"; D1 makes that imprecise — the drop now selectively preserves — so the argument is re-grounded on the apply-fresh and corruption paths, which it never depended on the wholesale drop for.)

Two independent defences, both required:

1. `ready.rebuilt === true` **unconditionally** clears the statement cache — correctness never depends on comparing tokens.
2. `generation` is minted as `randomBytes(8)` (§6.6), so uniqueness rather than monotonicity is relied on; it degrades to telemetry.

*Test:* §11 test 7 asserts the surviving reader **reuses its cached statement handle** across the rebuild (proving C2 and C3 together, not one or the other), plus a case where `graph_meta` is unreadable and the cache still clears.

---

**C3 — the rebuild is IN-PLACE. Never `unlink()`, never `rename()`. (CRITICAL)**

Measured: after `unlink()` + recreate, the live readonly handle **silently serves the deleted inode forever** — correct-looking, integrity-clean, wrong data, while the writer appends to the new file. `PRAGMA data_version`, `schema_version` and `user_version` **all failed to detect it**; only an `fs.stat()` inode comparison revealed it. In-place `DROP` + recreate inside one transaction on the same handle lets the reader follow with **zero coordination**.

In-place is also the safer cross-platform choice: on Windows, unlinking a file with an open handle typically fails outright and POSIX orphaned-inode semantics do not apply, so the `unlink` path fails **differently** on the two supported platforms. Every spec location asserting deletion is corrected by erratum E4.

**M24 — Erfana not doing it is not enough.** The database lives in the **user's** project directory, which is hostile to that assumption: iCloud/Dropbox/OneDrive replace files in place, `git checkout`/`git clean` can remove an accidentally-committed `graph.db`, a user can restore a backup, and the lock's stale-takeover window can admit a second process. The failure is not data loss — it is **silently wrong search results behind a green dot**, plus genuine corruption, since two same-path databases share one WAL. The asymmetry matters: the writer gets `SQLITE_READONLY_DBMOVED` and notices; the reader does not, and §8.5 deliberately keeps it attached across worker restarts so nothing ever re-opens it.

Required guard:

- `attach()` records `{ dev, ino }` (plus `size` + `mtimeMs` on `win32`, where `ino` is unreliable).
- Re-`stat()` on a cheap cadence: on every `getCorpusStats`, on window focus / project activate, and whenever the writer reports `SQLITE_READONLY_DBMOVED`.
- On mismatch: `detach()`, re-`attach()`, clear the statement cache (C2), set `stale: true`, log `warn`.
- The writer's `SQLITE_READONLY_DBMOVED` maps to `GRAPH_DB_MOVED` and transitions per §8.6.
- The writer **fails closed on `SQLITE_NOTADB`** — it does *not* rebuild. `SQLITE_NOTADB` is the signature of a sync client writing a placeholder or conflict file over `graph.db`; rebuilding would destroy the user's real file if it later reappears, and it is exactly the loop B4's budget exists to stop.

*Test:* §11 test 7 (in-place, platform-guarded `ino`) + `graphReadConnection.dbmoved.test.ts` (replace the file underneath an attached reader; assert detection, re-attach, `stale: true`).

---

**C4 — no read transaction may span an `await` or an IPC round trip.**

Measured: one held read transaction blocked **25/25** writer checkpoints, each stalling for the writer's full `busy_timeout` (228 ms at a 200 ms setting; better-sqlite3 defaults to 5000 ms ⇒ a **5 s writer stall per checkpoint**) and grew the WAL unbounded (0 → 1 MB in 25 batches).

**M9 — revision 2 over-generalised from that evidence.** It banned `transaction()` outright, but the measured hazard is a transaction held *across an await*, not a synchronous one wrapping two adjacent statements — and better-sqlite3's `db.transaction(fn)` cannot span an await by construction. The over-broad ban had a real cost: `search` and its probe ran as two autocommit statements against **two different WAL snapshots**. In WAL mode a reader sees an unchanging snapshot only for the duration of a read transaction, so `hasMore = (offset + results.length) < totalMatched` mixed quantities across snapshots and `LIMIT/OFFSET` paging over a mutating `sections_fts` could duplicate and skip rows. Not a rare window: §8.6 keeps search enabled during `indexing`/`degraded` — the normal state for the first minutes of every project open — and #28's sidebar re-queries on every cursor move.

Restated contract, structural enforcement unchanged:

- `IGraphReadConnection` accepts a **`GraphQueryKey`**, never SQL. No `exec()`, no `pragma()`, no cursor/iterator, no method returning a holdable handle. (§9 row 11 layer (a) is untouched.)
- It exposes exactly **one** composite, `querySearchPage(params)`, implemented internally with `db.transaction(...)` so §6.5's phase 1 and phase 2 share one snapshot. It is synchronous end to end and contains no `await`.
- No other method may open a transaction, and no transaction may be reachable from outside the class.

*Test:* `graphReadConnection.snapshot.test.ts` — interleave writer commits with a `querySearchPage`, assert the page and its count come from one snapshot; plus an API assertion that no public method returns a transaction or an iterator.

---

**C5 — never flip `journal_mode` out of WAL while the reader is attached.**

Measured: deterministic `SQLITE_BUSY` on the **writer**, 12/12. Any such maintenance must `detach()` first. No R1 path does this; the contract exists so a future one cannot be added silently.
*Test:* spike-harness assertion `C5`.

---

**C6 — corpus counts come from the counter table; never `count(*)` on `sections_fts`.**

Measured: `SELECT count(*)` on an **FTS5 virtual** table is a full scan, linear in rows (0.05 ms @1 k → 4.8 ms @100 k), unaffected by checkpointing. `corpus_stats` (§6.3) is the sole source for `GraphCorpusStats`, and every counter is updated **inside the same transaction as the data change** — which is why the cascade defect §6.7 removes was fatal rather than cosmetic. Search totals use §6.5's phase-1 row count, bounded by `GRAPH.MAX_COUNT_PROBE`.

**Scope correction (m2).** Revision 2 generalised this to a blanket "never `count(*)`", which removed the cheapest drift detector available. `count(*)` on the ordinary b-tree tables (`files`, `sections`, `contents`) is single-digit milliseconds at the 10 k ceiling, runs in the **worker**, and is off any frame budget. §6.6's open-time reconciliation uses exactly that to recount and repair `corpus_stats`. The contract is therefore narrow: **never `count(*)` on `sections_fts`.**
*Test:* `graphSchema.test.ts` — corpus-stats reads touch `corpus_stats` only; the reconciliation repairs a deliberately corrupted counter.

---

**C7 — a WAL reader needs write access to the containing directory, but the writer detects it first.**

The reader creates the `-shm` file; on a read-only directory the readonly open throws `SQLITE_CANTOPEN` / `SQLITE_READONLY_DIRECTORY` (measured).

**Primary detection is writer-side.** The writer runs first (§5.2 step 8): `mkdir -p .erfana` or `new Database(dbPath)` fails there. C7 is the **reader-side residual** — the narrow window where the directory turns read-only between writer open and reader attach, or where the file exists but `-shm` creation is refused. Both map to the single code `GRAPH_DB_DIR_NOT_WRITABLE` → `degraded`, `searchAvailable: false`, indexing disabled. (Revision 2 also named a phantom `GRAPH_DB_NOT_WRITABLE` two sentences earlier; it does not exist in `errors.ts` and is deleted — m9.)
*Test:* `graphDatabase.open.test.ts` with a chmod'd temp directory, skipped on `win32`.

---

**C8 — checkpoint on the next writer open, and CHECK THE BUSY COLUMN.**

Terminating the worker mid-transaction is **data-safe** (uncommitted rows rolled back, `integrity_check` ok) but leaves WAL bloat (37 MB measured). `PRAGMA wal_checkpoint(TRUNCATE)` therefore runs immediately after the pragmas on every writer open, before `integrity_check`.

**M8 — as written it silently no-ops in exactly the case it exists for.** `TRUNCATE` is `RESTART` plus truncation, and `RESTART` blocks until all readers have finished with the log. On a **worker restart** the main reader is deliberately left attached and search stays enabled (`searchAvailable: true`, `degraded`), so a user typing produces overlapping read transactions on precisely the connection that must be quiescent. When `busy_timeout` expires the pragma **returns a row** `{busy, log, checkpointed}` rather than raising — better-sqlite3 hands it back as data — so a naive writer treats it as success, proceeds to `integrity_check`, and the WAL is never truncated. Invisible: no error code, no status change, and revision 2 listed no C8 test at all.

Required:

- Read the returned row. `busy === 1` means the checkpoint did **not** happen.
- On the **restart** path only, `detach()` the reader for the duration of the open sequence, then re-attach (cold-start and switch paths already have it detached, so only this path changes).
- If still busy after that, degrade to `PASSIVE`, set `stale: true`, record `walSizeBytes` in the snapshot, and retry at the next quiescent point rather than pretending success.

*Test:* `graphDatabase.checkpoint.test.ts` — kill the worker mid-transaction while the reader queries, restart, assert `-wal` is bounded and that a busy result is not treated as success.

---

**C9 — `VACUUM` is safe with the reader attached, but needs a free-space pre-flight.**

Measured 12/12 ok, 0.9–4.9 ms. Permitted only at the end of a rebuild or a user-initiated full reindex. `VACUUM` needs up to **twice** the database size in free space, so on a full disk the *recovery* fails and can leave less headroom than it started with — hence §6.6's pre-flight: skip `VACUUM` rather than fail the rebuild, and log `warn`.

`busy_timeout` on the **reader** is irrelevant — it is never consumed; contention flows toward the writer, which is why only the writer sets it.
*Test:* spike-harness assertion `C9` + a disk-full simulation in `graphDatabase.rebuild.test.ts`.

### 5.4 Pragma table

| Connection | Pragma | Value | Why |
|---|---|---|---|
| writer | `journal_mode` | `WAL` | FR-002; never changed while a reader is attached (C5) |
| writer | `synchronous` | `NORMAL` | Throughput (NFR-002). Power-loss durability unverified — §12.2 |
| writer | `busy_timeout` | `GRAPH.WRITER_BUSY_TIMEOUT` (5000 ms) | Contention flows to the writer (C9) |
| writer | `foreign_keys` | `ON` | Makes a bare `DELETE FROM files` fail loudly (§6.7) |
| writer | `wal_checkpoint(TRUNCATE)` | on open, **result inspected** | C8 |
| reader | `readonly` | `true` (implies `fileMustExist`) | C1 |
| reader | — | no `busy_timeout`, no journal pragma, no `pragma()` at all | C4, C5, C9 |

### 5.5 Data-layer interfaces (committed by #21)

```ts
/** Verb-only worker contract (ISP). Streams and liveness arrive through injected sinks. */
export interface IGraphIndexWorker {
  open(req: GraphWorkerOpenRequest): Promise<GraphWorkerReady>
  index(req: GraphWorkerIndexRequest): Promise<GraphWorkerIndexResult>
  rebuild(req: GraphWorkerRebuildRequest): Promise<GraphWorkerReady>
  close(req: GraphWorkerCloseRequest): Promise<void>
  dispose(): Promise<void>
  isAlive(): boolean
}

/**
 * Sinks injected at construction — the house idiom
 * (`new ClaudeStatusService({ emit: emitToWebContents })`, claude-status-handlers.ts:172).
 * Chosen over on*(cb) methods so IGraphIndexWorker stays verb-only and the supervisor
 * is the single owner of stream + liveness handling.
 */
export interface GraphWorkerSinks {
  onProgress(msg: GraphWorkerProgressMessage): void
  /** Fires for an IDLE worker death too — the NFR-008 case a pending-map design misses. */
  onExit(code: number, sessionVersion: number): void
}

/**
 * Read-only connection. Takes a QUERY KEY, never SQL (C4 layer (a)).
 * No exec(), no pragma(), no iterate(), no publicly reachable transaction.
 */
export interface IGraphReadConnection {
  /** Idempotent: closes any existing handle and clears the cache first (C1/M6). */
  attach(dbPath: string, generation: bigint): void
  detach(): void
  isAttached(): boolean
  generation(): bigint
  /** Unconditional — called on every ready.rebuilt === true (C2/M4). */
  clearStatements(): void
  /** Re-stat {dev, ino}; false if the file was replaced underneath us (C3/M24). */
  verifyIdentity(): boolean
  // `params` is `GraphKeyedQueryParams = Record<string, unknown> & { match?:
  // FtsMatchExpression }`, not a bare record: the `explain` key binds `:match`
  // through this method (and per §9.6 runs per term), so a raw match string must
  // be a compile error here as it is on `querySearchPage` (#21 [13], D7).
  queryAll<T>(key: GraphQueryKey, params: GraphKeyedQueryParams): T[]
  queryGet<T>(key: GraphQueryKey, params: GraphKeyedQueryParams): T | undefined
  /** The ONE composite: §6.5 phase 1 + phase 2 in a single synchronous snapshot (C4/M9). */
  querySearchPage(params: GraphSearchQueryParams): GraphSearchPageRows
}
```

`GraphSearchQueryParams.match` and the optional `GraphKeyedQueryParams.match` are typed `FtsMatchExpression` (`string & { readonly __fts: unique symbol }`, from `src/shared/graphMatch.ts`), whose sole producer is `buildMatchExpression` — so binding a raw user query to either MATCH site is a `TS2322`. Committed by **#21** (reassigned from #26 per D7); see [`sd-021-cross-cutting.md` §9.6](sd-021-cross-cutting.md).

The worker request/message types these signatures reference are defined as zod discriminated unions in `src/shared/ipc/graph-worker-schema.ts` — see [`sd-021-worker-contracts.md` §8.2](sd-021-worker-contracts.md). Revision 2 referenced five such types without defining any of them, so `IGraphIndexWorker` could not typecheck (B6).
