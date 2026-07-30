<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-021 — Graph R1 architecture (issue #21) — part 1: scope & modules

**Status:** design + contract-code plan, **revision 3** (lens review: 8 reviewers, 55 findings folded in) · **Tier:** 4 (spec #004) · **Depends on:** #19, #20 · **Blocks:** #22–#32

## 0. Document set

Seven files, each ≤500 lines, per the house doc cap (`docs/windows/contributing.md:159`; precedent `docs/windows/README.md:42`). A reader landing anywhere can navigate from here.

| File | Contents |
|---|---|
| **this file** | §1 Goal · §2 Scope, artifacts, ownership · §3 Premises · §4 Modules and interfaces (AC-3) · §13 Traceability · §14 Verification gates |
| [`sd-021-db-contracts.md`](sd-021-db-contracts.md) | §5 — reader/writer topology, the cold-start / switch / close sequence, contracts **C1–C9** with evidence and named tests, the pragma table, and the data-layer interfaces |
| [`sd-021-db-schema.md`](sd-021-db-schema.md) | §6 — the path-identity contract, `STRICT` DDL, exported constant shapes, the two-phase search query, the version gate + integrity audits + rebuild, the delete and update write paths, and the FTS5 merge policy (AC-2) |
| [`sd-021-ipc-contracts.md`](sd-021-ipc-contracts.md) | §7 — renderer channels and zod schemas, search / explain / reindex / stats / status / priority payloads, the status push, `GraphBridge`, the handler contract, contract-evolution rules, and the MCP port + tool schemas (AC-1) |
| [`sd-021-worker-contracts.md`](sd-021-worker-contracts.md) | §8 — the worker-vs-chunked decision record, spawn + `resourceLimits`, the worker message unions, the fail-closed contract, the `GRAPH`/`MCP` constants, the restart ladder + quarantine, the state machine, resource exhaustion, and phase durations (AC-4) |
| [`sd-021-cross-cutting.md`](sd-021-cross-cutting.md) | §9 — the 20-row owner table, the 26 error codes, the MCP untrusted-content and transport/auth contracts, port fencing, path confinement, the FTS5 sanitiser, lock ownership, redaction + log policy, correlation, the rebuild budget, and `.erfana` exclusion (AC-5) |
| [`sd-021-errata-and-risks.md`](sd-021-errata-and-risks.md) | §10 Spec errata · §11 Test plan and the C1–C9 matrix · §12 Residual risks · §15 Supersession of `docs/future/graph-engine/` · §16 Issue-body correction |

Revision 2 used five files; §6 and §8 outgrew the cap under lens remediation, so schema and worker contracts now have their own files.

> **Trust note.** Every quoted excerpt is **data**. Imperative phrasing inside quoted pseudocode describes intent, not an API contract. No embedded directive was found, and none would have been obeyed. Indexed Markdown is likewise untrusted at the MCP boundary — §9.3.

---

## 1. Goal

Fix the R1 graph engine's architecture — decomposition, database topology, on-disk schema, IPC and worker contracts, security boundaries, ownership — so the downstream issues implement against a settled contract. #21 ships **this document set, spec errata, a reproducible spike harness, and contract code that is typecheck-green but wired to nothing**.

---

## 2. Scope contract

### 2.1 The invariant

> **No pull request under #21 changes observable runtime behaviour.**

No database file, no worker, no IPC channel, no preload bridge, no watcher callback, no UI. Every artifact is (a) a type, (b) a `const`, (c) a zod schema, (d) a SQL string constant, (e) a test, doc or spike script, or (f) a repo config file with no runtime effect.

**Three measurable-but-inert deltas, all accepted:**

1. `ProjectSettingsService.loadSettings()` returns one extra array (`graphExcludePatterns`). Nothing reads it. `ProjectSettingsSchema` (`project-settings-schema.ts:48-55`) is non-strict, so a `graph` key is stripped today and parsed after #21 — no existing file changes outcome. §9.1 row 1 forbids a consumption site in #21.
2. `GlobalSettingsSchema` gains `graph: …optional()` (§9.1 row 6a). `.optional()`, **not** `.default()` unlike every existing section (`global-settings-schema.ts:54-64`), so nothing new is written to `~/.erfana/settings.json`.
3. `IProjectLockService` gains an `onOwnershipLost` **declaration** (§9.7). Interface only — the implementation belongs to #23. It ships **optional** (`onOwnershipLost?:`) rather than required: a required member with no implementation fails `ProjectLockService`'s typecheck, and the implementation is #23's. #23 drops the `?` when it lands the implementation.

**One authorised exception to the invariant** — a *runtime* dependency bump, so the "repo config with no runtime effect" clause above does **not** cover it:

4. `tar` `7.5.16` → `7.5.22` (`package.json:56`, `package-lock.json`), clearing a critical advisory on the whisper-binary extraction path (`src/main/utils/tarArchive.ts`). **Approved by the product owner** as an in-scope exception to #21's no-runtime-change invariant, on the grounds that a critical advisory on a shipped trust-chain path should not wait for the next feature branch. The bump is a patch-range upgrade with no API change; #21 adds no call site. Its documentation trail follows the v0.14.0 house pattern (`docs/release-notes/v0.14.0.md:28, 36`): `CLAUDE.md:44` and `THIRD-PARTY-LICENSES.md` are refreshed in the same change. **No other dependency changes under #21.**

### 2.2 What #21 commits

| # | Artifact | Kind |
|---|---|---|
| 1 | `src/shared/ipc/graph-channels.ts` | new — 7 invoke channels + 1 event |
| 2 | `src/shared/ipc/graph-schema.ts` | new — renderer schemas, `GraphBridge`; re-exports 2a and 2b so the boundary keeps one import path |
| 2a | `src/shared/ipc/graph-error-schema.ts` | new — `GRAPH_ERROR_CODES`, `GraphErrorCodeSchema`, `GraphErrorSchema`, `isConfinedRelativePath`. Leaf module: the status split needs these, and a value re-export in both directions is an ESM cycle |
| 2b | `src/shared/ipc/graph-status-schema.ts` | new — status/progress payloads, the §4.2 split point taken up front |
| 3 | `src/shared/ipc/graph-worker-schema.ts` | new — `GraphWorkerRequestSchema` / `GraphWorkerMessageSchema` discriminated unions (B6) |
| 4 | `src/shared/ipc/graph-mcp-schema.ts` | new — port envelope, tool input/output, untrusted-content envelope, `GraphMcpConnectSchema` (B1, B2, B7) |
| 5 | `src/shared/graph-constants.ts` | new — `GRAPH` + `MCP` blocks, `DEFAULT_GRAPH_EXCLUDE_PATTERNS` (split out to keep `constants.ts` under the 500-line cap) |
| 5a | `src/shared/constants.ts` | edit — re-exports the block above, so `constants.ts` stays a valid import path |
| 6 | `src/shared/errors.ts` | edit — 26 codes + 26 `ERROR_MESSAGES` strings |
| 7 | `src/shared/ipc/project-settings-schema.ts` | edit — `graph` section + `ResolvedProjectSettings.graphExcludePatterns` |
| 8 | `src/shared/ipc/global-settings-schema.ts` | edit — optional `graph` section (FR-042 hook) |
| 9 | `src/main/services/ProjectSettingsService.ts` | edit — resolve the new section |
| 10 | `src/main/interfaces/IGraph*.ts` (6 files) | new — type-only (§4.4) |
| 11 | `src/main/interfaces/IProjectLockService.ts` | edit — declare `onOwnershipLost?(cb): () => void` (M11). **Deviation, deliberate:** the member ships **optional**, not required. A required member with no implementation fails `ProjectLockService`'s typecheck, and the implementation is #23's — so "declaration only, no runtime change" is only achievable with the `?`. #23 drops the `?` when it implements. |
| 12 | `src/main/services/graph/graphSchema.ts` | new — DDL, `GRAPH_QUERIES`, `GRAPH_*_PROGRAM`, `GRAPH_STAMP_SQL`, `sqliteVersionAtLeast()` |
| 13 | `src/main/services/graph/graphCorrelation.ts` | new — `generateGraphCorrelationId()`, `generateGraphJobId()` |
| 14 | `scripts/spikes/graph-wal-concurrency.test.mjs` | new — the §3.2 harness **as assertions**, collected by vitest (M31) |
| 15 | `docs/graph/wal-concurrency-spike.md` | new — findings note |
| 16 | `.gitignore` | edit — the three `GRAPH.DB_ARTIFACTS` plus `graph.db-journal` (repo config, no runtime effect) |
| 16a | `vitest.main.ts` | edit — collect `scripts/spikes/**/*.test.{js,mjs,ts}` so artifact 14 runs in the `test` check |
| 17 | `docs/error-codes.md` | edit — `## Graph engine (26 codes)` |
| 18 | Tests for 1–13 (§11) | new |
| 19 | Spec errata (§10) + this document set | docs |

### 2.3 Work parcels

**Numbering rule.** Only the numbers below are verified to exist as issues. Where a parcel has no issue yet it is named descriptively and marked **`(new issue — not yet created)`**; no number is invented, because a wrong number resolves to something else — in this repository #33 and #34 are merged **pull requests**, not issues.

| Parcel | Scope | Key FR/NFR |
|---|---|---|
| **#21** | Architecture: `GraphEngineService`, DB schema, IPC contracts | — |
| **#22** | Design: search UI/UX (4 surfaces) — **design-only**; owns the Cmd+Shift+F *decision* (§12.1) | — |
| **#23** | DB layer: SQLite + FTS5 + WAL + recovery; the ESLint SQL-sink rule; `onOwnershipLost` implementation; FTS5 merge policy | FR-001–005, **NFR-007**, **NFR-008** |
| **#24** | Preprocessing: markdown strip, hashing, section extraction, NFC path canonicalisation | FR-006–009, FR-011 |
| **#25** | Indexing (1/2): discovery, batch initial indexing, progress, write/delete repositories | FR-010, FR-013, FR-049, FR-050 |
| **#26** | Search API: two-phase query, *calls* the FTS5 sanitiser (`buildMatchExpression` moved to #21 per D7 — #26 owns only the call site and may revise the invented tuning), filters, pagination, explain | FR-017–023, **NFR-004** |
| **#27** | UI: Global Search panel; owns the `useSearchKeyboard.test.ts` edit | FR-029–032, **NFR-011** |
| **#28** | UI: Related Sidebar | FR-024–028, **NFR-011** |
| **#29** | UI: Settings panel + Status indicator (**one** issue) | FR-033–038, NFR-010, **NFR-011** |
| **#30** | MCP server: socket/pipe endpoint, ACL, token, consent UI, stdio bridge, untrusted-content envelope | FR-039–044 |
| **#31** | Testing: NFR benchmarks + E2E for both surfaces | NFR-001, NFR-002, NFR-003, NFR-006 |
| **#32** | Indexing (2/2): incremental, event triggers, debounce, switch fencing | FR-012, FR-014–016, FR-045–048, NFR-005, NFR-011 |
| **Vitest coverage config fix** `(new issue — not yet created)` | Re-nest `coverage` under `test` in `vitest.main.ts` and add `src/shared/**` to `include`. Must land **before #23 starts**, or the graph programme has no coverage signal at any point — and the whisper trust-chain's 90 % per-file thresholds are almost certainly inert today (M33). | — |
| **JSON log transport** `(new issue — not yet created)` | Either a JSON file transport for `LoggingService`, or the NFR-009 / AC-039 erratum narrowing the requirement. Not #31's: #31 is chartered to *verify*, and today there is nothing to verify (B10). | **NFR-009** |

---

## 3. Premises

### 3.1 Verified by repository read

| Premise | Evidence |
|---|---|
| `better-sqlite3` exactly `13.0.1` in `dependencies`; `@modelcontextprotocol/sdk` exactly `1.29.0` in `devDependencies` | `package.json:45, 68` |
| Worker build: extra `rollupOptions.input` → `out/main/<name>.worker.js`, flat `chunkFileNames`, `join(__dirname, …)` | `electron.vite.config.ts:17-32`; `GitStatusWorkerAdapter.ts:35` |
| Fail-closed worker: timeout → terminate; error / non-zero exit → reject all pending; no in-process fallback | `GitStatusWorkerAdapter.ts:45-50, 100-120, 122-132` |
| Import-safe worker guard `if (parentPort) { … }` | `sqlite-smoke.worker.ts:230-277` |
| Sink injected at construction is the house DI idiom | `claude-status-handlers.ts:172` |
| Circuit breaker: `recordCrash` prunes a rolling window; **only `recordSuccess` clears `crashTimestamps`** | `GitStatusCircuitBreaker.ts:63-99` |
| Backoff `base * 2^attempt`, base 800 ms; `sessionVersion++` on restart | `GitWatcherService.ts:698, 706-709` |
| `operationQueues` + factory + singleton tail — **one verb, no long jobs** | `GitStatusService.ts:43, 58-79, 175-180` |
| `isTrustedSender` is a shared export; `claude-status-handlers.ts:62-81` re-implements it — a defect | `senderValidation.ts:35` |
| Push broadcast helper; handler registration site | `ipcBroadcast.ts:26`; `src/main/index.ts:276-300` |
| Handlers construct their own service when the arg is absent | `claude-status-handlers.ts:167-172` |
| `src/preload/index.ts` = **1117 lines**, already over cap (pre-existing debt) | last brace `:1117` |
| `DEFAULT_WATCHER_IGNORE_PATTERNS` 27 entries, no `.erfana`; `shouldIgnorePath` is a **substring** match | `constants.ts:80-115`; `DirectoryWatcherService.ts:85-93` |
| `DEFAULT_TREE_HIDDEN_PATTERNS` = `['node_modules', '.git']` | `constants.ts:124-127`; `FileService.ts:9, 50` |
| `.erfana/settings.json` is **tracked in this repo**; `.gitignore` (56 lines) has no `.erfana` | `Glob`; `.gitignore` |
| Settings resolution `:107-118` / `:140-145` / `:120-138` | `ProjectSettingsService.ts` |
| `ProjectService` constructor is a fixed **6-interface positional** list, built once with 6 args | `ProjectService.ts:85-92`; `file-handlers.ts:38-45` |
| `updateServices` is **synchronous `void`**; mirror `rollbackServices` | `ProjectService.ts:125-129, 147-159` |
| Watcher triple fence `:469`, `:509`, `:568`; **its own `ThrottledWorker({collectionDelay: 75})`** | `DirectoryWatcherService.ts:44, 222` |
| Index seam: `coalescedEvents` bound `:518`, intact at the injection point `:545-546`, before the count-only send `:547` | `DirectoryWatcherService.ts:504-554` |
| `awaitWriteFinish: false` → a `change` may surface a truncated file | `DirectoryWatcherService.ts:210-211` |
| `isomorphic-git.isIgnored` is **async**, walks every ancestor `.gitignore`, reads `.git/info/exclude`, always ignores `.git` | `node_modules/isomorphic-git/index.js:5415-5464` |
| `ERROR_MESSAGES: Record<ErrorCode,string>` exhaustiveness is the only completeness enforcement | `errors.ts:186-188, 384-386` (**421** lines) |
| `constants.ts` = **408** lines | `constants.ts` |
| ESLint scoped `no-restricted-syntax` precedent | `eslint.config.mjs:107-127` |
| `vitest.main.ts:10` globs `src/main/**` + `src/shared/**`; `coverage` at `:16` is a **sibling of `test:`** (which closes `:15`), `include: ['src/main/**']`, `all: false` | `vitest.main.ts` |
| `tsconfig.node.json` includes `src/shared/**/*`, excludes only `src/main/**/*.test.*` — **shared tests are inside the typecheck program** | `tsconfig.node.json:3-13` |
| `GlobalSettingsSchema` materialises every section via `.default(() => …)` | `global-settings-schema.ts:50-65` |
| `z.nativeEnum` used nowhere; zod `^4.1.12` | `Grep`; `package.json:57` |
| Worker-mock recipe (`vi.hoisted()` + `vi.mock('worker_threads')` + `MockWorker extends EventEmitter`) | `GitStatusWorkerAdapter.test.ts:18-59` |
| `logger.error/fatal(message, error?, context?)` vs `trace/debug/info/warn(message, context?)` | `LoggingService.ts:318, 340, 351` |
| **`LoggingService` emits PLAINTEXT.** `formatMessage` = `` `${message} ${JSON.stringify(context)}` `` (`:498`); `formatErrorMessage` joins with `' \| '` (`:522`). Stack traces **are** already automatic (`:511-513`) | `LoggingService.ts` |
| **`redactUserInput` is a no-op unless `code ∈ {INVALID_FILENAME}`** (`:28`, `:63-66`); the path-safe helper is `redactPath` (`:109`); `redactedLogError` (`:88`) | `src/main/utils/redactUserInput.ts` |
| **`onOwnershipLost` is NOT a `ProjectLockService` / `IProjectLockService` API** — a `LockHeartbeat` constructor field (`:53`, fired `:179`, `:191`) wired inline at `ProjectLockService.ts:143`, body = `activeLocks.delete(...)` | verified |
| `RateLimitedLogger` exists (emit-once-per-interval + `suppressedCount`) | `src/main/utils/RateLimitedLogger.ts`; used `DirectoryWatcherService.ts:21, 62` |
| `pathSecurity.ts` and `SymlinkDetector.ts` exist; `ExternalFileService.ts:177-178` uses `realpath` for confinement | verified |
| `ProjectLockService` public surface = 8 methods | `ProjectLockService.ts:173, 428, 482, 569, 694, 750, 767, 811` |
| SD-019 proved **handle coexistence** only; both smokes used `:memory:` | `docs/graph/native-dependencies.md:295-301` |

**LOC comparables** (measured, used to budget §4.2): `GitStatusService` **180** · `GitStatusWorkerAdapter` **133** · `GitStatusCircuitBreaker` **122** · `git-status.worker` **520** · `ClaudeStatusService` **551** · `GitWatcherService` **795** · `claude-status-handlers` **290** · `screenshot-schema` **323** · `git-watcher-schema.test` **759** · `project-lock-schema.test` **521**.

### 3.2 Empirical facts — WAL concurrency spike

mac-arm64, plain Node 22, `better-sqlite3@13.0.1`, SQLite 3.53.3. 5 runs, ~49 000 concurrent reads. Worker-writes + main-thread-readonly-reads on one WAL file: zero SQLite errors, zero torn transactions, `integrity_check` ok. FTS5 **bare-`MATCH`** p50 0.008 ms / p95 0.019 ms / max 0.464 ms **on a freshly built index** — see §6.8 and §12.2 for why that is not NFR-001 evidence in steady state, and §7.2 for why a bare MATCH is not the canonical query either.

The harness **will be committed** as `scripts/spikes/graph-wal-concurrency.test.mjs` with one assertion per contract (M31). Until it lands, every §3.2 number is a one-off observation, and erratum E3 says so.

### 3.3 MCP transport

Revision 2 claimed a *stdio* server hosted via `utilityProcess` while also having Erfana start it on project open — incompatible, because stdio's security property is that the **client** spawns the server and owns both pipes. **Resolved in [§9.4](sd-021-cross-cutting.md):** Erfana hosts a per-project unix socket / named pipe with OS-level ACLs inside the `utilityProcess`, authenticates peers with a rotated 256-bit token, obtains first-connect consent naming the exposed directory, and ships a client-spawned stdio↔socket bridge. That supersedes SD-019 §8's phrasing.

### 3.4 Other locked inputs

FTS5 asserted at runtime via `sqlite_compileoption_used('ENABLE_FTS5') === 1` plus a two-document MATCH proving filtering (`native-dependencies.md` §6; SD-019 §8 item 6 / §12). Arches mac-arm64 + win-x64; `asar: false`. Watcher integration: main-side `onCoalescedBatch(dirPath, events, version)` at `DirectoryWatcherService.ts:545-546`; no `EventEmitter`, no second watcher; a fixed 300 ms leading window **stacked on the watcher's existing 75 ms window** (budget in §12.6). Schema-version mismatch ⇒ discard and fully reindex.

---

## 4. Module & file boundary plan (issue AC-3)

> **AC-3 has no FR backing** — it is the repo's ≤500-line/SRP convention.

### 4.1 Role mapping

| GitStatus role | LOC | Graph counterpart |
|---|---|---|
| Thin orchestrator | 180 | `GraphEngineService` — GitStatus has **one verb, no state machine, no restart**, so 180 is not a like-for-like budget |
| Worker adapter | 133 | `GraphIndexWorkerAdapter` — plus a progress stream, injected sinks, a triple fence, `safeParse` both ways |
| Circuit breaker | 122 | `GraphCircuitBreaker` |
| Worker interface | 46 | `IGraphIndexWorker` — verb-only; streams arrive via sinks |
| Worker entry | **520 (over cap)** | `graph-index.worker.ts` **≤180**, dispatcher only |

Graph adds three roles GitStatus has no analogue for: a main-process **read-only connection**, a **lifecycle state machine**, and a **worker supervisor**.

### 4.2 File plan

**New — #21**

| Path | LOC | Split point |
|---|---|---|
| `src/shared/ipc/graph-channels.ts` | 60 | — |
| `src/shared/ipc/graph-schema.ts` | 380 | split TAKEN in #21 (the two rows below) — a re-export keeps one import path for the boundary |
| `src/shared/ipc/graph-error-schema.ts` | 130 | leaf: error codes + `GraphErrorSchema` + `isConfinedRelativePath`. Both files above depend on it; nothing depends back, or the ESM cycle puts `GraphErrorSchema` in a TDZ |
| `src/shared/ipc/graph-status-schema.ts` | 150 | the status/progress split this table already named |
| `src/shared/ipc/graph-worker-schema.ts` | 230 | — |
| `src/shared/ipc/graph-mcp-schema.ts` | 220 | — |
| `src/main/interfaces/IGraph*.ts` (6) | 40–70 ea | — |
| `src/main/services/graph/graphSchema.ts` | 320 | split `GRAPH_QUERIES` into `graphQueries.ts` |
| `src/main/services/graph/graphCorrelation.ts` | 40 | — |
| `scripts/spikes/graph-wal-concurrency.test.mjs` | 400 | near budget: split per contract into `scripts/spikes/graph-wal/` |

**New — downstream.** Every estimate is anchored to a measured comparable, not to a wish.

| Path | LOC | Owner | Anchor · split point |
|---|---|---|---|
| `graph/GraphEngineService.ts` | 150 | #23 | Queue + fences + ID minting + delegation only. Below `GitStatusService`'s 180 because the state machine and supervisor are extracted. |
| `graph/GraphLifecycle.ts` | 280 | #23 | State machine (§8.6), close→open sequence, reader attach + `AbortSignal`, rebuild budget, cancel flag. Anchor: `ClaudeStatusService` **551** for a narrower job. **Split `graphOpenSequence.ts` at >400.** |
| `graph/GraphWorkerSupervisor.ts` | 220 | #23 | Respawn ladder, healthy-dwell reset, breaker, quarantine, sinks. Anchor: `GitWatcherService`'s restart block. **Split `graphBackoff.ts` at >400.** |
| `graph/GraphIndexWorkerAdapter.ts` | 230 | #23 | Anchor `GitStatusWorkerAdapter` **133** plus stream demux, `safeParse` both directions, triple fence. **Split `graphWorkerProtocol.ts` at >400.** |
| `graph/GraphCircuitBreaker.ts` | 130 | #23 | Anchor `GitStatusCircuitBreaker` **122** plus the half-open-completes-a-batch rule. |
| `graph/GraphReadConnection.ts` | 230 | #23 | Handle, generation cache, key-based API, `querySearchPage` composite, inode guard. **Split `graphStatementCache.ts` at >400.** |
| `graph/GraphSearchService.ts` | 280 | #26 | **Sole caller of `IGraphReadConnection`.** Two-phase query, result + explain mapping; *calls* `buildMatchExpression` (committed by #21 in `src/shared/graphMatch.ts` per D7 — the `ftsQueryBuilder.ts` split no longer applies to this file). |
| `graph/GraphStatusPublisher.ts` | 140 | #29 | Snapshot composition, min-rate coalescing, broadcast. |
| `graph/GraphIndexQueue.ts` | 220 | #25 | `ThrottledWorker(300)` + `EventCoalescer`, priority paths, overflow→stale, singleton re-enqueue. |
| `graph/gitignoreFilter.ts` | 130 | #25 | async `isIgnored` + excludes + `.md` gate + confinement. |
| `workers/graph-index.worker.ts` | 180 | #23 | Dispatcher only — deliberately ~⅓ of `git-status.worker`'s 520. |
| `workers/graph/GraphDatabase.ts` | 300 | #23 | Open, pragmas, version gates, integrity + audits, rebuild. **Split `graphRebuild.ts` at >400.** |
| `workers/graph/GraphWriteRepository.ts` | 320 | #25 | Upsert + update path (§6.7). **Split `graphUpsert.ts` at >400.** |
| `workers/graph/GraphDeleteRepository.ts` | 220 | #25 | Delete path, hoisted sweep, counters. |
| `workers/graph/markdownSections.ts` | 220 | #24 | FR-011. |
| `workers/graph/preprocess.ts` | 180 | #24 | FR-006–008 + NFC canonicalisation. |
| `src/main/ipc/graph-handlers.ts` | 350 | #26 | Anchor `claude-status-handlers` **290** for 3 handlers; this has 7. **Split `graph-status-handlers.ts` at >400.** |
| `src/main/services/mcp/McpEndpoint.ts` | 280 | #30 | Socket/pipe listener, ACL, token, consent, drain, bounded queue. **Split `mcpAuth.ts` at >400.** |
| `resources/mcp-bridge/erfana-mcp-bridge.mjs` | 120 | #30 | stdio↔socket bridge the client spawns (§9.4). |

**Edits — downstream**

| Path | Change | Owner |
|---|---|---|
| `electron.vite.config.ts` | add the `'graph-index.worker'` rollup input | #23 |
| `src/main/index.ts` | `registerGraphHandlers()` in the `:276-300` block; dispose on quit | #26 |
| `src/preload/index.ts` | `graph:` bridge — **minimal**; the file is already 1117 lines | #26 |
| `src/preload/index.d.ts` | one line: `graph: GraphBridge` | #26 |
| `src/main/services/ProjectLockService.ts` | implement the `onOwnershipLost` subscription #21 declares | #23 |
| `src/main/services/DirectoryWatcherService.ts` | constructor-injected `onCoalescedBatch` at `:545-546` | #32 |
| `src/main/services/ProjectService.ts` | **7th optional** ctor param `graphLifecycle?: IGraphProjectLifecycle`; call from `updateServices` + `rollbackServices` | #32 |
| `eslint.config.mjs` | scoped SQL-sink rule (§9.6) | #23 |
| `vitest.main.ts` | re-nest `coverage`; add `src/shared/**` | Vitest coverage config fix `(new issue — not yet created)` |
| `LoggingService.ts` | JSON file transport, or the NFR-009 erratum | JSON log transport `(new issue — not yet created)` |

### 4.3 Decomposition of the orchestrator

A single 200-LOC `GraphEngineService` owning a 7-state machine, an 11-step async open, queueing, the breaker **and** the restart policy was not credible against the comparables (`ClaudeStatusService` 551 for a narrower job). The split is **pre-applied**, not left to Phase 5:

| Class | Owns |
|---|---|
| `GraphLifecycle` | The state machine and every transition (§8.6); the close→open→attach sequence; reader attach/detach + `AbortSignal`; `generation`; the rebuild budget; the cancel flag |
| `GraphWorkerSupervisor` | Worker construction and `resourceLimits`; the respawn ladder + healthy-dwell reset; the breaker; poison-file quarantine; the `onProgress` / `onExit` sinks |
| `GraphEngineService` | The operation queue; the `switchVersion` / `sessionVersion` / `jobVersion` fences; `correlationId` / `jobId` minting; **delegation only** |
| `GraphSearchService` | **All** SQL composition; *calls* the FTS5 sanitiser `buildMatchExpression` (owned by #21 in `src/shared/graphMatch.ts` per D7, not composed here); the **only** caller of `IGraphReadConnection` |

**Queue scoping (M10) — normative.** `operationQueues` is a single per-project promise-chained tail borrowed from `GitStatusService`, which has one verb and no long jobs. Handing it all seven verbs breaks two things:

- **Only `open`, `rebuild`, `index` and `close` enter the queue.**
- **`search`, `explain`, `getCorpusStats`, `getStatus`, `setPriorityPaths` and `cancelReindex` bypass it entirely.**

*Failure mode 1 — cancellation queued behind the job it cancels.* `cancelReindex` would resolve only after the reindex ahead of it completed: `droppedBatches` always 0, UC-005's Cancel a no-op. Because better-sqlite3 cannot be interrupted, draining the queue is the **only** cancellation lever — so the queue would be blocking the one mechanism that works. `cancelReindex` therefore sets a flag, bumps `jobVersion`, and drains synchronously on the caller's turn.

*Failure mode 2 — search queued behind indexing.* A `search` behind an `index` (30 s) or an `open` (60 s) directly contradicts §5.1's rationale for main-thread reads and makes NFR-001 unmeetable in exactly the state where §8.6 advertises search as enabled.

**`GraphEngineService` does NOT:** hold any `better-sqlite3` handle; compose or execute SQL; read files, parse markdown, or hash; own a watcher or coalescer; register `ipcMain` handlers or call `webContents.send`; host the MCP endpoint; decide user-facing copy — it emits a state and an `ErrorCode`.

### 4.4 Interfaces (ISP split)

```ts
/** Consumed by graph-handlers.ts. Parameters are z.input types (M14). */
export interface IGraphQueryService {
  search(request: GraphSearchRequestInput): Promise<GraphSearchResponse>
  explain(request: GraphExplainRequestInput): Promise<GraphExplainResponse>
  reindex(request?: GraphReindexRequestInput): Promise<GraphReindexResponse>
  cancelReindex(request?: GraphCancelReindexRequestInput): Promise<GraphCancelReindexResponse>
  getCorpusStats(request?: GraphCorpusStatsRequestInput): Promise<GraphCorpusStatsResponse>
  getStatus(request?: GraphStatusRequestInput): Promise<GraphStatusResponse>
  setPriorityPaths(request: GraphPriorityPathsRequestInput): Promise<GraphPriorityPathsResponse>
}

/** Consumed by ProjectService ONLY. Synchronous and O(1) — updateServices is sync void. */
export interface IGraphProjectLifecycle {
  onProjectPathChanged(newPath: string | null): void
}

/** Substitutable in tests, mirroring the claude-status emit-sink precedent. */
export interface IGraphStatusPublisher {
  publish(payload: GraphStatusChangePayload): void
  dispose(): void
}

/** Owns SQL composition. The only caller of IGraphReadConnection. Takes RESOLVED requests. */
export interface IGraphSearchService {
  search(req: GraphSearchRequest, ids: GraphTraceIds): GraphSearchResponse
  explain(req: GraphExplainRequest, ids: GraphTraceIds): GraphExplainResponse
  getCorpusStats(ids: GraphTraceIds): GraphCorpusStatsResponse
}

/** Both IDs travel together on every payload and every log line (§9.9). */
export interface GraphTraceIds { correlationId: string; jobId?: string }

export interface IGraphEngineService extends IGraphQueryService, IGraphProjectLifecycle {
  dispose(): Promise<void>
}
```

`IGraphIndexWorker`, `GraphWorkerSinks` and `IGraphReadConnection` are in [`sd-021-db-contracts.md` §5.5](sd-021-db-contracts.md).

**Construction**, mirroring `GitStatusService.ts:45-47, 175-180`:

```ts
export class GraphEngineService implements IGraphEngineService {
  constructor(deps?: {
    worker?: IGraphIndexWorker
    reader?: IGraphReadConnection
    search?: IGraphSearchService
    publisher?: IGraphStatusPublisher
    breaker?: GraphCircuitBreaker
    lock?: IProjectLockService
  }) { /* each defaults to the real implementation */ }
}
export function createGraphEngineService(deps?: GraphEngineDeps): GraphEngineService
export const graphEngineService = createGraphEngineService()   // singleton tail
```

**Reach path to `ProjectService`.** Its constructor is a fixed 6-interface positional list (`:85-92`) built once at `file-handlers.ts:38-45`. A **7th optional** parameter `graphLifecycle: IGraphProjectLifecycle = NOOP_GRAPH_LIFECYCLE` is additive, does not break the existing call site, and keeps `ProjectService` depending on the narrowest possible interface.

### 4.5 Bundle-boundary rule for `graphSchema.ts`

It is the first module pulled into **both** the `index` and `graph-index.worker` rollup entries. Contract: **zero `import` statements** — pure string/number constants plus the dependency-free `sqliteVersionAtLeast()`. This keeps `logger` (and electron-log) out of the worker bundle. Greppable gate, §14 item 7.

### 4.6 Architectural invariant — log parity (M28)

> **Every field the status snapshot shows the user must be recoverable from the log bundle.**

Revision 2 pushed `queueDepth`, `queuedFilePaths`, `stale` and `searchAvailable` to the UI every 100 ms while contracting them into no log at all, and dropped `generation`, `sessionVersion`, `restartAttempts` and breaker state entirely — so the canonical support report ("search returns nothing, `searchAvailable` true, `stale` false") could not distinguish a stale-generation reader, a worker that silently respawned mid-batch, a breaker that had opened and half-opened twice, and a genuinely empty corpus. The four diagnostics are now snapshot fields (§7.6) and are emitted on one `info` line per state transition (§9.9).

---

## 13. Traceability

| Issue AC | Requirement | Section | Spec IDs |
|---|---|---|---|
| **AC-1** | IPC contracts defined | §7, §8.2 | FR-017–023, FR-029–038, FR-041, FR-049, NFR-010, NFR-011 |
| **AC-2** | Database schema defined | §6, §5.3 | FR-001–004, FR-008, FR-009, FR-011, FR-017, FR-018, NFR-007 |
| **AC-3** | Module & file boundary plan | §4 | **No FR backing — repo convention.** |
| **AC-4** | Worker-vs-chunked decision **recorded** + lifecycle/recovery | §8.0, §8.1–§8.8 | NFR-008, NFR-006, FR-013 |
| **AC-5** | Cross-cutting contracts with owners (7 areas incl. packaging and security) | §9, §10 | FR-005, FR-010, FR-035, FR-039–042, FR-050, NFR-004, NFR-005, NFR-006, NFR-009, NFR-011 |

**NFR-007 mis-citation — corrected.** NFR-007 is *Database corruption recovery* (`02-requirements.md:664-671`), satisfied by §6.6 + C3. The UI-responsiveness requirement is `01-overview.md:78` success criterion 7 — and per §7.2 that is a **renderer** frame budget while this code runs on **main**, so the instrument is event-loop delay, not dropped frames.

---

## 14. Verification criteria (Phase 8)

1. `npm run lint`. 2. `npm run typecheck` — proves `ERROR_MESSAGES` is exhaustive over 26 codes and that the new **shared** tests are strict-clean (`tsconfig.node.json:3-13`). 3. `npm run test`. 4. `npx electron-vite build` emits **no new `out/main/*.worker.js`**. 5. `check:headers` + `reuse lint` across all seven documents.
6. **Invariant audit (§2.1):** the diff contains no new `ipcMain.handle`, no `contextBridge` key, no `new Worker(`, no `new Database(` outside a test or spike file, no `webContents.send`, and no edit to `DEFAULT_WATCHER_IGNORE_PATTERNS` or `DEFAULT_TREE_HIDDEN_PATTERNS`.
7. **Bundle gate:** `grep -c '^import' src/main/services/graph/graphSchema.ts` returns 0.
8. **No-raw-path gate (§9.8):** no `logger.*` call under `src/main/services/graph/**`, `src/main/services/workers/graph/**` or `src/main/ipc/graph-handlers.ts` passes a raw path variable; every such site calls `redactPath()`, and no site logs `currentFilePath`, `queuedFilePaths` or `recentSkips[].relativePath` at all.
9. **Row-citation gate (§9.12):** every `§9 row N` reference across the set resolves to the intended row.
10. **Harness gate (M31):** `npx vitest run scripts/spikes/graph-wal-concurrency.test.mjs` passes **all C1–C9 assertions** — not merely exits 0 — and §11's C1–C9 matrix names a test per contract.
11. §11 tests 6 and 7 pass, including the FK-violation assertion, the DDL-symmetry assertion, and the post-rebuild stamp assertion.
12. Errata E1–E10 committed into all five spec files **and** `analysis/20-save-watch-index-pipeline.md`.
13. `docs/error-codes.md` gains `## Graph engine (26 codes)`.
14. All seven design files are ≤500 lines and cross-link correctly.
15. §16's replacement text applied to the issue #21 body.
16. §15's supersession banner added to the four `docs/future/graph-engine/` files.
17. **Both `(new issue — not yet created)` parcels exist and are assigned before #23 starts** — the coverage-config fix is a hard prerequisite, since without it the graph programme ships with no coverage signal at any point.
