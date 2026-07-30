<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-021 part 5 — worker schema, protocol, supervision, and the state machine (AC-4)

Part of the SD-021 set — index in [`sd-021-graph-architecture.md` §0](sd-021-graph-architecture.md). Covers **§8**. Lifecycle contracts C1–C9 are in [`sd-021-db-contracts.md`](sd-021-db-contracts.md); the DDL and write paths in [`sd-021-db-schema.md`](sd-021-db-schema.md).

---

## 8. Worker lifecycle & NFR-008 recovery

### 8.0 Decision record — worker thread vs chunked main-thread processing

AC-4 requires this decision **recorded**, not assumed; 05-notes "Open Questions › Architecture › 1" asks it explicitly.

| | Chunked main-thread | **Worker thread (chosen)** |
|---|---|---|
| UI responsiveness | better-sqlite3 is synchronous; one `integrity_check` or FTS insert batch blocks the event loop. Chunking bounds a slice but cannot bound `integrity_check` or `VACUUM` — single indivisible calls. | All writes off main; PTY drain and IPC dispatch are structurally protected (§12.7). |
| Crash containment | A `SQLITE_CORRUPT` abort or native fault takes the app down. | Fail-closed terminate + respawn; NFR-008 is satisfiable at all. |
| Evidence | — | SD-019 proved worker+main handle coexistence in one process (`native-dependencies.md:295-301`); the §3.2 spike proved worker-writes + main-readonly-reads on one WAL file. |
| Repo precedent | none | `GitStatusService` / `GitStatusWorkerAdapter` / `git-status.worker.ts`. |
| Cost | simpler | a message protocol, a supervisor, a restart ladder, contracts C1–C9. |

**Chosen: worker thread.** Consequence: search deliberately does **not** go through the worker — it uses the main-process read-only connection (§5.1). The decision is worker-for-writes, main-thread-for-reads.

### 8.1 Spawn

A fourth `rollupOptions.input` in `electron.vite.config.ts` (joining `index`, `git-status.worker`, `sqlite-smoke.worker` at `:18-24`) emits `out/main/graph-index.worker.js`, loaded via `join(__dirname, 'graph-index.worker.js')` — identical dev and packaged because `chunkFileNames: '[name]-[hash].js'` (`:31`) keeps chunks flat.

The entry uses the **import-safe** `if (parentPort) { … }` guard (`sqlite-smoke.worker.ts:230`), not the throwing guard in `git-status.worker.ts`, so tests can import it.

**Creation is proactive, not lazy** (§8.5), and bounded (M20):

```ts
new Worker(workerPath, {
  resourceLimits: {
    maxOldGenerationSizeMb: GRAPH.WORKER_MAX_OLD_GEN_MB,   // 512
    maxYoungGenerationSizeMb: GRAPH.WORKER_MAX_YOUNG_GEN_MB // 32
  }
})
```

Without `resourceLimits` a batch of 50 files whose whole text is read, hashed, split and inserted can exhaust the worker heap and take the process with it. With them, the worker dies alone and the supervisor sees a normal `exit`.

### 8.2 Worker message schema (B6) — a committed #21 artifact

Revision 2 described the protocol in a prose table and referenced five types (`GraphWorkerOpenRequest`, `GraphWorkerReady`, `GraphWorkerIndexRequest`, `GraphWorkerIndexResult`, `GraphWorkerProgressMessage`) that were **defined nowhere**, absent from §2.2 and §11 — so `IGraphIndexWorker` could not typecheck and gate 2 could not pass, while §9 row 10 explicitly assigned "worker request/response types" to #21. The table was also not a substitute: it omitted `id` from every main→worker row though the reply path resolves `pending.get(id)`; `close` carried no `id` yet was awaited with a timeout; the `error` row carried an undeclared free-form `error` string that `GraphErrorSchema` deliberately excludes (a message-leak vector); and `GraphWorkerIndexResult` — which must feed `GraphProgressSchema.skippedFiles` and `corpus_stats.skipped_file_count` — was never shaped at all. #23, #25 and #32 would each have invented their own.

`src/shared/ipc/graph-worker-schema.ts` is therefore committed by #21.

```ts
/** Present on EVERY message in both directions. Fences + tracing travel together. */
const GraphWorkerEnvelope = {
  /** Request-reply correlation key for the adapter's `pending` map. */
  id: z.number().int().positive(),
  /** Project fence — mirrors DirectoryWatcherService.switchVersion (:44). */
  switchVersion: z.number().int().nonnegative(),
  /** Worker-incarnation fence — bumped on every respawn (§8.5). */
  sessionVersion: z.number().int().nonnegative(),
  /** Batch/request scope (NFR-011). */
  correlationId: z.string().min(1),
  /** Parent scope: one reindex or DB swap spans ~200 batches (M25). */
  jobId: z.string().min(1)
}

/** Every main -> worker shape is strictObject. The renderer's permissiveness
 *  argument (main adds a field without breaking an OLDER renderer mid-upgrade)
 *  has no analogue for a worker shipping in the same binary — what a plain
 *  z.object buys here is silence: `jobversion` mis-cased would be stripped, the
 *  request would parse, and a security-relevant fence would be gone unlogged. */
export const GraphWorkerRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...GraphWorkerEnvelope, type: z.literal('open'),
    dbPath: z.string().min(1).max(4096), projectPath: z.string().min(1).max(4096),
    expectedSchemaVersion: z.number().int().positive() }),
  z.strictObject({ ...GraphWorkerEnvelope, type: z.literal('index'),
    /** Monotonic job fence — bumped on cancel and on each new reindex (M10). */
    jobVersion: z.number().int().nonnegative(),
    mode: GraphReindexMode,
    batch: z.array(GraphWorkerBatchEntrySchema).max(GRAPH.MAX_BATCH_SIZE) }),
  z.strictObject({ ...GraphWorkerEnvelope, type: z.literal('rebuild'),
    reason: GraphReindexReason }),
  z.strictObject({ ...GraphWorkerEnvelope, type: z.literal('close') })
])

export const GraphWorkerBatchEntrySchema = z.strictObject({
  /** Project-relative, NFC. The worker derives path_key itself (§6.2). */
  path: z.string().min(1).max(4096),
  op: z.enum(['upsert', 'delete', 'deleteSubtree'])
})

/** Per-file failure, carried back so counters and quarantine can be driven main-side. */
export const GraphWorkerSkipSchema = z.object({
  path: z.string().min(1).max(4096),
  code: GraphErrorCodeSchema          // GRAPH_INDEX_FILE_UNREADABLE | _PARSE_FAILED | _TOO_LARGE
})

export const GraphWorkerIndexResultSchema = z.object({
  ...GraphWorkerEnvelope,
  jobVersion: z.number().int().nonnegative(),
  indexedFiles: z.number().int().nonnegative(),
  skippedFiles: z.array(GraphWorkerSkipSchema),
  sectionsWritten: z.number().int().nonnegative(),
  sectionsDeleted: z.number().int().nonnegative(),
  /** M27 — wall-clock for the whole batch, plus the phase split. */
  completedAtMs: z.number().int().nonnegative(),
  batchDurationMs: z.number().nonnegative(),
  phaseDurationsMs: GraphPhaseDurationsSchema
})

export const GraphWorkerReadySchema = z.object({
  ...GraphWorkerEnvelope,
  /** Random 64-bit token, not a counter (C2/M4). Serialised as a decimal string. */
  generation: z.string().regex(/^-?\d+$/),
  schemaVersion: z.number().int().positive(),
  rebuilt: z.boolean(),
  autoRebuildCount: z.number().int().nonnegative(),
  phaseDurationsMs: GraphPhaseDurationsSchema
})

/**
 * Structured error. `code` crosses IPC; `detail` is LOG-ONLY and MUST be stripped
 * before any renderer or MCP payload is composed — it may contain absolute paths
 * and SQLite messages. Revision 2's free-form `error: string` was a leak vector.
 */
export const GraphWorkerErrorSchema = z.object({
  ...GraphWorkerEnvelope,
  code: GraphErrorCodeSchema,
  detail: z.string().max(2048).optional()
})

export const GraphWorkerProgressSchema = z.object({
  ...GraphWorkerEnvelope,           // includes correlationId + jobId (M26)
  jobVersion: z.number().int().nonnegative(),
  processedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  skippedFiles: z.number().int().nonnegative(),
  currentFilePath: z.string().max(4096).nullable()   // IPC-payload only; never logged raw (§9.6)
})

export const GraphWorkerMessageSchema = z.discriminatedUnion('type', [
  GraphWorkerIndexResultSchema.extend({ type: z.literal('result') }),
  GraphWorkerErrorSchema.extend({ type: z.literal('error') }),
  GraphWorkerReadySchema.extend({ type: z.literal('ready') }),
  GraphWorkerProgressSchema.extend({ type: z.literal('progress') })
])
```

**`safeParse` at the worker boundary is mandatory, in both directions.** The renderer boundary already mandates it; the worker boundary carried nothing, despite the worker being the only component that writes to disk. `GraphIndexWorkerAdapter` `safeParse`s every inbound message and drops (with a `warn`) anything that fails; the worker `safeParse`s every request and replies `{type:'error', code:'GRAPH_WORKER_PROTOCOL'}` rather than acting on a malformed one.

**Fencing rule, per message class.** `jobVersion` is declared per-message, not on the envelope, so "drop unless all three match" is unimplementable for `ready` and `error` — they have no third fence, and an adapter written to the absolute rule drops every one of them. The rule the schemas implement:

- **Replies** (`ready`, `error`, `result`) are correlated by `id` through `pending` and dropped unless `switchVersion` **and** `sessionVersion` match. `result` additionally carries `jobVersion` and is dropped unless it matches too.
- The **stream** (`progress`) is never routed through `pending` — it carries an `id` only for symmetry — and IS triple-fenced (`switchVersion`, `sessionVersion`, `jobVersion`). Revision 2 left `progress` unfenced, so a late message from a terminated worker or a pre-switch project could drive the status bar after a restart.

`jobId` is a correlation string, not a version, and cannot serve this purpose — hence `jobVersion` (M10), which stops a cancelled job's in-flight result and trailing `progress` from driving the *next* job's accumulator and terminal snapshot. `open`, `rebuild` and `close` are lifecycle verbs scoped by `sessionVersion` and carry no `jobVersion` for the same reason.

### 8.3 Fail-closed contract

Mirroring `GitStatusWorkerAdapter.ts:45-50, 100-120`:

- **Per-request timeout** → delete from `pending`, reject, `terminate()`.
- **`worker.on('error')`** → reject **all** pending.
- **`worker.on('exit', code)`** → null the handle, `sinks.onExit(code, sessionVersion)`, reject all pending if `code !== 0`. The `onExit` sink is what lets the supervisor notice an **idle** worker dying — the NFR-008 case a pending-map-only design misses entirely.
- **No in-process fallback.** There is no main-thread write path. If the worker is unavailable, indexing stops and the engine reports it; search continues from the reader (`degraded`, `searchAvailable: true`).
- **An `index` arriving before a successful `open`** (a fresh respawn holds no handle) is answered `{type:'error', code:'GRAPH_DB_NOT_READY'}`. The worker never lazily opens — it must not guess a path. Doubly prevented main-side: `GraphLifecycle` queues index work and does not dispatch until `ready`.

### 8.4 `GRAPH` and `MCP` constants (`src/shared/constants.ts`, #21)

```ts
const GRAPH_DB_FILE = 'graph.db'          // hoisted so DB_ARTIFACTS derives, not duplicates

export const GRAPH = {
  DB_DIR: '.erfana',
  DB_FILE: GRAPH_DB_FILE,
  DB_ARTIFACTS: [GRAPH_DB_FILE, `${GRAPH_DB_FILE}-wal`, `${GRAPH_DB_FILE}-shm`],

  WRITER_BUSY_TIMEOUT: 5_000,
  WORKER_OPEN_TIMEOUT: 60_000,
  WORKER_BATCH_TIMEOUT: 30_000,
  WORKER_CLOSE_TIMEOUT: 5_000,
  WORKER_MAX_OLD_GEN_MB: 512,
  WORKER_MAX_YOUNG_GEN_MB: 32,

  // --- supervision (B3) ------------------------------------------------
  RESTART_BASE_DELAY_MS: 800,
  /** Ceiling on the exponential respawn delay. A persistent fault must not spin. */
  MAX_RESPAWN_DELAY_MS: 300_000,          // 5 min
  /** restartAttempts resets ONLY after this long alive AND >=1 completed batch. */
  LADDER_RESET_HEALTHY_MS: 90_000,
  /** Breaker is the ONLY terminal authority. recordCrash fires on EVERY exit. */
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_WINDOW: 600_000,
  CIRCUIT_BREAKER_RESET: 300_000,
  /** Batch timeouts or worker deaths attributable to one file before quarantine. */
  QUARANTINE_THRESHOLD: 2,

  // --- rebuild budget (B4) ---------------------------------------------
  MAX_AUTO_REBUILDS_PER_SESSION: 2,
  REBUILD_COOLDOWN_MS: 600_000,

  // --- reader ------------------------------------------------------------
  READER_OPEN_MAX_ATTEMPTS: 5,
  READER_OPEN_RETRY_DELAY_MS: 200,

  // --- indexing ----------------------------------------------------------
  DEFAULT_BATCH_SIZE: 50,
  MIN_BATCH_SIZE: 1,
  MAX_BATCH_SIZE: 500,
  INDEX_COLLECTION_DELAY_MS: 300,
  MAX_PRIORITY_PATHS: 50,
  /** Files larger than this are counted in skippedFileCount and never read (M20). */
  MAX_INDEXED_FILE_BYTES: 8 * 1024 * 1024,
  /** Free space required before an index batch or a VACUUM is attempted. */
  MIN_FREE_DISK_BYTES: 256 * 1024 * 1024,
  DISK_RECHECK_INTERVAL_MS: 60_000,

  // --- FTS5 merge policy (B8) -------------------------------------------
  FTS_AUTOMERGE: 4,
  FTS_CRISISMERGE: 16,
  FTS_MERGE_EVERY_N_BATCHES: 8,
  FTS_MERGE_PAGES: 64,

  // --- search ------------------------------------------------------------
  DEFAULT_TOP_K: 10,
  MAX_TOP_K: 100,
  MAX_QUERY_LENGTH: 4_096,
  MAX_QUERY_TERMS: 24,
  MAX_COUNT_PROBE: 1_000,
  SEARCH_DEBOUNCE_MS: 120,
  BM25_HEADING_WEIGHT: 3.0,
  BM25_TEXT_WEIGHT: 1.0,

  // --- status push -------------------------------------------------------
  STATUS_PUSH_MIN_INTERVAL_MS: 100,
  MAX_STATUS_PUSH_RATE_HZ: 10,
  MAX_QUEUE_PREVIEW: 20,
  MAX_RECENT_SKIPS: 20
} as const

export const MCP = {
  RATE_LIMIT_PER_MINUTE: 100,
  MAX_INFLIGHT: 4,
  MAX_QUEUE_DEPTH: 32,
  MAX_TOP_K: 20,                          // lower than the renderer's (M7)
  MAX_RESULT_BYTES: 8 * 1024,
  MAX_RESPONSE_BYTES: 64 * 1024,
  BETA_DISCLAIMER: 'beta – contract may change'
} as const
```

`MAX_RESTART_ATTEMPTS` is **deleted**. Revision 2 had two independent give-up counters; the repo uses one or the other, never both (`GitStatusService`: breaker only, the adapter has no restart counter at `:105-111`; `GitWatcherService.ts:698-735`: `restartAttempts` only). `restartAttempts` now only drives the backoff exponent; the **breaker is the sole terminal authority**.

### 8.5 Supervision — the restart ladder (B3)

**The livelock revision 2 shipped, written out so nobody re-introduces it.** Respawn was proactive (respawn → `open` → `ready`) and `restartAttempts` reset on `ready`, while only the *final* attempt called `recordCrash`. But the realistic crash is a native fault, a SQLite abort, or OOM **during an `index` batch** — i.e. *after* a successful open. So: the counter reset every cycle → `recordCrash` was never called → the breaker never opened → `disabled` was structurally unreachable → the backoff exponent stayed pinned at `2^0`, 800 ms, forever. The dropped batch was said to "self-heal via content hashes", but the poison file has **no stored hash**, so the reconcile re-derived the identical batch. Net: an unbounded ~800 ms respawn/crash loop re-running `wal_checkpoint(TRUNCATE)` + `integrity_check` + the FTS integrity-check about once a second, with the UI parked on yellow and nothing ever escalating.

A second, independent defect sat in the same paragraph: `GitStatusCircuitBreaker.recordSuccess()` is the **only** thing that clears `crashTimestamps` (`:63-99`), so a half-open probe that succeeded did not close the breaker and the next crash re-opened it immediately.

**Corrected ladder.**

| Rule | Value |
|---|---|
| Respawn delay | `min(RESTART_BASE_DELAY_MS * 2^restartAttempts, MAX_RESPAWN_DELAY_MS)` → 0.8 / 1.6 / 3.2 / 6.4 … capped at 5 min |
| `restartAttempts` reset | **only** after the worker has been alive ≥ `LADDER_RESET_HEALTHY_MS` (90 s) **and** completed ≥ 1 batch. Never on `ready`. |
| `breaker.recordCrash()` | on **every** `exit` with a non-zero code and on every request timeout — a rolling window, not a consecutive counter |
| `breaker.recordSuccess()` | after a **half-open probe completes a batch**, not merely after it opens |
| Terminal state | breaker open ⟺ `disabled`; after `CIRCUIT_BREAKER_RESET` it half-opens for one probe |
| `sessionVersion++` | on every respawn, invalidating stale handles and messages (`GitWatcherService.ts:709`) |

**Poison-file quarantine.** A file that deterministically kills or times out the worker must stop being re-enqueued, or the ladder alone only slows the loop down.

1. The batch's file list is known main-side, and `progress.currentFilePath` names the file in flight.
2. On a worker death or batch timeout, the file named by the last `progress` gets `+1` suspicion; if none was reported, **every** file in the batch gets `+1`.
3. The batch is re-enqueued **as singletons**, so the second attempt attributes exactly rather than blaming up to 49 innocent files.
4. A file reaching `GRAPH.QUARANTINE_THRESHOLD` (2) is quarantined for the session: counted in `skippedFileCount` with `GRAPH_INDEX_BATCH_FAILED`, added to `recentSkips`, and **never re-enqueued this session**. A restart or a user-initiated full reindex clears the quarantine.

**In-flight requests on restart**

| In flight | Behaviour |
|---|---|
| `index` batch | **Dropped, not retried as-is.** It may have been half-applied. `stale: true`, then re-enqueued as singletons per the quarantine rule. |
| `open` / `rebuild` | Effectively retried — `open` is the first message after every respawn. |
| `close` | The handle died with the worker; treat as satisfied. |

**The reader stays attached across a worker restart**, except for the C8 restart-path checkpoint window, which is the single stated exception (`sd-021-db-contracts.md` C8). The file is unchanged and C3 guarantees no inode swap, so search stays live; statements clear only on `ready.rebuilt` (C2/M4).

### 8.6 State machine (M23)

Revision 2 assigned `GraphLifecycle` "the state machine and every transition" but supplied only a state→UI rendering table. **`error` is deleted from the enum**: C1 routes exhausted reader retries to `degraded` "never `error`", C7 routes to `degraded`, cancellation routes to `degraded` "not `error`", and corruption routes to rebuild — so `error` had no producer, no exit, and no meaning. Six states remain.

`GraphIndexState = 'uninitialized' | 'opening' | 'ready' | 'indexing' | 'degraded' | 'disabled'`

**Open failures are classified**, which revision 2 never did — `GRAPH_FTS5_UNAVAILABLE` and the SQLite-version assertion are **unfixable at runtime** and were returned as `{type:'error', code}` *without killing the worker*, so neither ladder nor breaker applied and a naive implementation would retry them on every project switch and every reindex press.

| From | Trigger | To | Code | `searchAvailable` |
|---|---|---|---|---|
| any | `onProjectPathChanged` | `opening` | — | false |
| `opening` | `ready` + reader attached | `ready` | — | true |
| `opening` | **permanent** open failure (`GRAPH_FTS5_UNAVAILABLE`, SQLite too old) | `disabled` | that code | false |
| `opening` | **transient** open failure (`SQLITE_BUSY`, `SQLITE_CANTOPEN`) after bounded retry | `degraded` | `GRAPH_DB_OPEN_FAILED` | false |
| `opening` | directory not writable | `degraded` | `GRAPH_DB_DIR_NOT_WRITABLE` | false |
| `ready` | batch dispatched | `indexing` | — | true |
| `indexing` | batch `result`, `skippedFiles.length === 0`, queue empty | `ready` | — | true |
| `indexing` | batch `result`, **`skippedFiles.length > 0`** | `degraded` | `GRAPH_INDEX_PARSE_FAILED` (aggregate) | true |
| `indexing` | batch `error` (non-corruption) | `degraded` | `GRAPH_INDEX_BATCH_FAILED` | true |
| `indexing` | `SQLITE_FULL` / `SQLITE_IOERR_*` | `degraded` **(suspended)** | `GRAPH_DB_DISK_FULL` | true |
| any | worker `exit` non-zero, breaker still closed | `degraded` | `GRAPH_WORKER_UNAVAILABLE` | true |
| any | breaker opens | `disabled` | `GRAPH_WORKER_DISABLED` | true |
| `disabled` | breaker half-open probe completes a batch | `ready` | — | true |
| any | corruption detected, budget available | `opening` | `GRAPH_DB_CORRUPTED` | false |
| any | corruption detected, **budget exhausted** | `disabled` | `GRAPH_DB_REBUILD_FAILED` | true if attached |
| `opening` | rebuild success | `ready` | — | true |
| `opening` | rebuild failure | `disabled` | `GRAPH_DB_REBUILD_FAILED` | false |
| any | `SQLITE_NOTADB` on the writer | `disabled` | `GRAPH_DB_OPEN_FAILED` | false |
| any | reader `verifyIdentity()` false | `degraded` | `GRAPH_DB_MOVED` | true after re-attach |
| `indexing` | `cancelReindex` | `degraded` | `GRAPH_INDEX_CANCELLED` | true |
| `degraded` | user reindex completes with zero skips | `ready` | — | true |

**`skippedFileCount > 0` cannot be green (M21).** Revision 2 set `stale` only on overflow or a dropped batch, so a pass skipping 400 unreadable files ended `ready`/green/"Up to date", with the codes reinforcing it ("The rest of the project was indexed normally"). For a *search* feature that is the worst possible failure shape: zero results for content that exists, under an affirmative up-to-date signal. Green is now reserved for a **zero-skip** pass; a skipping pass ends `degraded` with "Indexed with {n} files skipped". `skipped_file_count` is reset at the start of every full pass, decremented when a previously skipped file indexes successfully, and adjusted by the delete path (§6.3).

**UI rendering**

| State | Dot | Status text | Search | Reindex button |
|---|---|---|---|---|
| `uninitialized` | grey | "No project" | disabled | disabled |
| `opening` | yellow | "Preparing index…" | `GRAPH_DB_NOT_READY` | disabled |
| `ready` | green | "Up to date · {n} files" | enabled | enabled |
| `indexing` | yellow | "Indexing: X/Y files" | enabled, `degraded: true` | disabled |
| `degraded`, reader attached | yellow | mapped copy, or "Indexed with {n} files skipped" | enabled, `degraded: true` | enabled |
| `degraded`, reader down | red | mapped `ERROR_MESSAGES[lastError.code]` | disabled | enabled |
| `disabled` | red | mapped copy | if `searchAvailable` | enabled (forces a breaker reset) |

`GRAPH_DB_REBUILD_FAILED`'s copy is aligned with the button it appears beside: it no longer says "Reopen the project to try again" (an action a user cannot take on an already-open project) while an enabled retry button sits next to it (m9).

### 8.7 Resource exhaustion (M20)

Disk-full was entirely absent from revision 2 — no code, no bound, no transition — and `SQLITE_FULL` during a batch would have mapped only to `GRAPH_INDEX_BATCH_FAILED`, whose copy promises "Erfana is reconciling the affected files automatically": a promise that cannot be kept on a full disk and that drives an infinite reconcile loop. Worse, the rebuild path ends in `VACUUM`, which needs up to twice the database size in free space, so the *recovery* fails and can leave less headroom than it started with.

- `SQLITE_FULL` and `SQLITE_IOERR_*` map to **`GRAPH_DB_DISK_FULL`** (24th code), whose copy names free disk space as the user action.
- Transition is **suspend, not retry**: `degraded`, `searchAvailable: true`, indexing halted. It resumes only after a free-space re-check every `GRAPH.DISK_RECHECK_INTERVAL_MS` (60 s) reports ≥ `GRAPH.MIN_FREE_DISK_BYTES`.
- Batches pre-flight free space; `VACUUM` pre-flights `2 × dbSizeBytes` and is skipped rather than failed (C9).
- Files over `GRAPH.MAX_INDEXED_FILE_BYTES` (8 MB) are **never read**: counted in `skippedFileCount` with `GRAPH_INDEX_FILE_TOO_LARGE`, listed in `recentSkips`.
- `resourceLimits` bounds the worker heap (§8.1), so an unbounded parse dies alone.

### 8.8 Durations and tracing (M27, M25, M26)

Revision 2 offered `queryDurationMs` (search only) and a lone `startedAtMs`, so a log bundle could not answer "the reindex took 40 minutes — where?" — the single most likely support ticket this feature generates.

**Phase durations.** `GraphPhaseDurationsSchema` is a partial record over a frozen phase list, carried on `ready` and on every `result`, and each phase MUST also emit a `<phase>DurationMs` field on its own log line:

```ts
export const GRAPH_PHASES = ['open','integrity_check','audit','rebuild',
  'discover','read','parse','hash','write_txn','fts_merge','search'] as const
export const GraphPhaseDurationsSchema =
  z.partialRecord(z.enum(GRAPH_PHASES), z.number().nonnegative())
```

Owner: **#23** for `open`/`integrity_check`/`audit`/`rebuild`/`fts_merge`, **#25** for `discover`/`read`/`parse`/`hash`/`write_txn`, **#26** for `search`. This is a named obligation with an owner, not a per-call-site aspiration verified by #31.

**Two-level correlation.** A 10 k-file reindex at batch size 50 produces ~200 `index` messages. Revision 2 gave each its own flat `correlationId` with nothing tying it to the parent, so grepping one id yielded one batch with no way to enumerate its 200 siblings, count failures, or bound wall time — NFR-011 failing on precisely the longest, most failure-prone operation in the system. Now: `jobId` is minted once per reindex or DB swap (`generateGraphJobId()`), `correlationId` once per batch or request, **both are required on every worker message in both directions** (§8.2 envelope), both are echoed verbatim, and both must appear in every graph log context. `open`, `rebuild` and `close` carry them too — revision 2 put `correlationId` only on `index`, so a 60 s `open` timeout or a mid-rebuild `GRAPH_DB_CORRUPTED` produced worker-side and main-side lines with nothing to join on.
