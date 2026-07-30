<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# WAL concurrency — spike findings note (SD-021 / issue #21)

**Audience:** [#23 — DB layer](https://github.com/qodeca/erfana/issues/23),
[#26 — search service](https://github.com/qodeca/erfana/issues/26) and
[#31 — performance](https://github.com/qodeca/erfana/issues/31).

This note is the consumable output of the WAL-concurrency spike that SD-021 §3.2
summarises. Its purpose is narrow: **make the numbers falsifiable.** Until the
harness landed, every figure in §3.2 was a one-off local observation, and
erratum E3 said so in the future tense. The harness is now
[`scripts/spikes/graph-wal-concurrency.test.mjs`](../../scripts/spikes/graph-wal-concurrency.test.mjs),
collected by `vitest.main.ts` (`scripts/spikes/**/*.test.{js,mjs,ts}`) and therefore run
on **every push** by the required `test` job — one `expect` per contract, C1–C9.

Read the contract text itself in
[`specs/designs/sd-021-db-contracts.md` §5.3](../../specs/designs/sd-021-db-contracts.md);
the C1–C9 → test-file → owner matrix is in
[`sd-021-errata-and-risks.md` §11.2](../../specs/designs/sd-021-errata-and-risks.md).

---

## 1. What the harness asserts, and what it deliberately does not

The harness asserts the **SQLite-level physics** each contract rests on. It does
**not** assert Erfana's implementation of the contract, because that
implementation does not exist yet: `GraphReadConnection` and `GraphDatabase`
land with #23. Confusing the two is the mistake this note exists to prevent — a
green harness means "the platform behaves as the design claims", not "Erfana
obeys the contract".

| Contract | Asserted here | Remainder, and its owner |
|---|---|---|
| **C1** reader-after-ready | `SQLITE_CANTOPEN` on a missing file, and the readonly open does **not** create it | Retry ladder, per-attempt fencing, idempotent double-attach — `graphReadConnection.attach.test.ts` (#23) |
| **C2** no statement across a generation change | A statement prepared **before** an in-place rebuild returns post-rebuild rows through the same never-re-prepared handle | Cache-clear on `ready.rebuilt` with `graph_meta` unreadable — #23 (asserted in-schema by `graphSchema.rebuild.test.ts`) |
| **C3** in-place rebuild | Inode stable across the rebuild (non-win32; content probe on win32) **plus the counter-example**: after `unlink()` + recreate the live reader serves the deleted inode and no PRAGMA notices | `{dev, ino}` re-stat cadence and `SQLITE_READONLY_DBMOVED` handling — #23 |
| **C4** no read txn across an await | A held read transaction blocks the writer's checkpoint for its **full** `busy_timeout`; one read transaction sees a stable snapshot across an interleaved writer commit | `querySearchPage` composite, API shape — `graphReadConnection.snapshot.test.ts` (#23) |
| **C5** no journal-mode flip with a reader attached | `SQLITE_BUSY` **on the writer**; the mode stays `wal` | — (fully asserted) |
| **C6** counts from `corpus_stats` | `count(*)` on FTS5 plans as `SCAN sections_fts`; the counter read plans as `SEARCH corpus_stats` by primary key | Open-time reconciliation repairing a corrupted counter — `graphSchema.queries.test.ts` (#21, done) |
| **C7** reader needs a writable directory | Readonly open/read on a `0o500` directory fails with `SQLITE_CANTOPEN` or `SQLITE_READONLY_DIRECTORY` | Writer-side primary detection, mapping to `GRAPH_DB_DIR_NOT_WRITABLE` — `graphDatabase.open.test.ts` (#23) |
| **C8** checkpoint on open, busy column checked | The blocked checkpoint returns `{busy: 1}` **as data, without raising**; a quiescent `TRUNCATE` leaves a 0-byte WAL; an uncommitted transaction rolls back cleanly | Kill-the-worker-mid-transaction with the reader querying — `graphDatabase.checkpoint.test.ts` (#23) |
| **C9** `VACUUM` safe + pre-flight | `VACUUM` completes with a reader attached and the reader stays usable with no reopen | Simulated low-disk skip — `graphDatabase.rebuild.test.ts` (#23); needs a faked `statfs` |

Two cases carry a platform guard rather than an unconditional assertion:

- **C3's counter-example is `skipIf(win32)`.** Unlinking a file with an open
  handle typically fails outright on Windows, so the POSIX orphaned-inode
  failure mode cannot be staged there. That the failure mode *differs by
  platform* is itself part of the argument for never taking the path.
- **C7 is `skipIf(win32 || root)`.** `chmod` is meaningless on win32 and root
  bypasses directory permissions, so the probe cannot be staged in either case.

Nothing else is skipped. No contract is silently omitted.

---

## 2. Environment of the original measurements

| | |
|---|---|
| Platform | mac-arm64 |
| Runtime | plain Node 22 (**not** Electron — see §4) |
| `better-sqlite3` | `13.0.1` (exact pin, `dependencies`) |
| SQLite | 3.53.3 |
| Shape | worker-thread writes + main-thread readonly reads on one WAL file |
| Volume | 5 runs, ~49 000 concurrent reads |

Result: zero SQLite errors, zero torn transactions, `integrity_check` ok.

The harness reproduces the same **shape** at a far smaller volume (200
interleaved reads against a committing writer) because it runs in the normal
suite on every push. Volume was never the interesting variable — the failure
modes above are deterministic, not statistical.

---

## 3. Measurements, and how much weight each carries

| Measurement | Value | Weight |
|---|---|---|
| FTS5 bare `MATCH` | p50 0.008 ms / p95 0.019 ms / max 0.464 ms | **Weak.** Taken on a freshly built index and on a *bare* MATCH. The canonical query adds two joins, `snippet()`, `highlight()`, a `substr()` filter and a sort; steady-state cost also degrades with FTS5 segment count (§6.8). Not NFR-001 evidence. #31 owns the real number. |
| Writer stall per blocked checkpoint | 228 ms at a 200 ms `busy_timeout` | **Strong**, and it scales: at the production 5 000 ms setting this is a ~5 s writer stall per checkpoint. Reproduced by the harness's C4/C8 cases. |
| Journal-mode flip with a reader attached | `SQLITE_BUSY` 12/12 | **Strong**, now deterministic in CI. |
| `count(*)` on FTS5 | 0.05 ms @1 k → 4.8 ms @100 k | **Strong as a shape** (linear), asserted structurally by the C6 query plan rather than by a timing threshold, which would be flaky on a shared runner. |
| WAL bloat after a mid-transaction kill | 37 MB | **Indicative.** The exact size depends on the batch; what matters is that it is unbounded without the open-time checkpoint. |
| `VACUUM` with a reader attached | 12/12 ok, 0.9–4.9 ms | **Strong** for safety, **weak** for duration — a 10 k-section database is not a 30-section one. |

---

## 4. Still unverified

1. **Electron 39.** The spike ran under plain Node, and so does the harness
   (vitest runs in Node). Safety under Electron is *inferred* from N-API
   stability and process-level file locking, not measured. **#23 re-runs the
   contract assertions in a packaged Electron smoke (`ERFANA_SMOKE`).**
2. **Windows (M34).** `test:main` reaches Windows only through the
   `windows-checks` job, which its own comment marks as excluded from branch
   protection — so a C3 regression there yields a **non-blocking red mark**.
   A named gate must be picked **before the rebuild path merges**: either
   promote `windows-checks` to a required check, **or** add the C3 assertions to
   the packaged Windows `ERFANA_SMOKE` that already runs in the release flow.
   Owner #23. Not satisfiable by an advisory job.

   > **Record the chosen gate and its run ID here when it lands.**
   >
   > | Gate | Run ID | Date |
   > |---|---|---|
   > | _(not yet chosen)_ | — | — |

3. **The canonical query's cost on the main thread.** Budgeted at
   **p95 < 4 ms and worst case < 16 ms of main-thread occupancy**, measured with
   `perf_hooks.monitorEventLoopDelay` — a main-thread budget, not a renderer
   frame budget (§12.7). #23 exit criterion + #31 benchmark.
4. **Multi-process contention.** The project lock is advisory with a
   stale-takeover window, and `checkLock` is async and main-side while writes are
   synchronous in the worker. Accepted risk: the database is a discardable
   cache.
5. **Power-loss durability at `synchronous = NORMAL`.** A crash can lose the last
   committed transactions. Accepted: the next open's hash short-circuit
   self-heals.

---

## 5. Running it

```bash
npm run test:main -- scripts/spikes/graph-wal-concurrency.test.mjs
```

Whole-file runtime is well under a second: the two timing-sensitive cases set
`busy_timeout` to 200 ms rather than the production 5 000 ms, and every case
uses a temp directory it removes in `afterEach`.

If a case fails, the contract it names is the one to read first — the assertion
messages deliberately do not restate the design.
