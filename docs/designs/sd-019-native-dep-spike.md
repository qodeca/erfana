<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-019 — Native-dependency de-risking spike (issue #19)

**Status:** design-only, lens-reviewed (4 lenses / 15 findings folded in, **GO** stands — no blocker) · **Tier:** 4 spike · **Depends on:** none · **Blocks:** #23 (DB layer), #30 (MCP server) · **Informs:** #21 (worker decision)

## 1. Goal

Prove — in a packaged, signed, fuse-flipped Electron 39 build on macOS arm64 + Windows x64 — that `better-sqlite3@13` (with FTS5) loads **from a verified prebuild inside the bundle** and runs inside a `worker_thread` concurrently with a main-process instance, and that the pinned MCP SDK survives a full in-memory client↔server round-trip. Emit a findings note that #23/#30 build on. **No production feature code**; only smoke modules + build/CI wiring.

## 2. Premises

**Verified (repo reads):**

| Premise | Evidence |
|---|---|
| `asar: false`, `npmRebuild: false` — whole tree ships **unpacked** under `Resources/app/node_modules`; no `asarUnpack`, no `OnlyLoadAppFromAsar` fuse | `electron-builder.yml:35-36`; `scripts/fuses.js:581-593` |
| `RunAsNode: false` fuse blocks Electron-as-bare-Node | `scripts/fuses.js:566` |
| node-pty precedent: `postinstall` = `patch-package && electron-builder install-app-deps`; foreign prebuilds pruned in afterPack before mac deep-strict codesign | `package.json:26`; `scripts/fuses.js:347-421`; `build_mac.yml:239` |
| Worker pattern: second `rollupOptions.input` emits `out/main/<name>.worker.js`; adapter loads via `join(__dirname, '<name>.worker.js')` — same layout dev + packaged; fail-closed timeout/terminate on hang | `electron.vite.config.ts:18-21`; `GitStatusWorkerAdapter.ts:35,45-50,82,105-111` |
| CI insertion points | `build_mac.yml:116/125/232/277`; `build_win.yml:206/229/273`; `checks.yml:113-173` |

**Inferred, to be confirmed at runtime by the spike (do NOT treat as verified):**

- **N-API 10 / ABI-stable** — *inferred* from `engines.node >= 22` + `node-addon-api@^8` (the manifest has **no** `napi_versions` field); **confirmed** only by the runtime load + `compile_options` smoke. [F13]
- **Prebuild-precedence** — external research says the loader resolves `prebuilds/<plat>-<arch>.node` first, but **v13 removed `prebuild-install`**, so `install-app-deps` source-builds into `build/Release/` on every install. Which `.node` actually loads is an **empirical spike output**, not an assumption. [F6]
- **FTS5 compiled-in by default** — confirmed by `sqlite_compileoption_used('ENABLE_FTS5')` at runtime. [F4]

**Reframe of AC#1:** since `asar: false`, "loads from asarUnpack" → "loads from the packaged, signed, fuse-flipped bundle's `node_modules`."

## 3. Supported-arch matrix [F12]

| Arch | Status | Path |
|---|---|---|
| **mac-arm64**, **win-x64** | Supported (verified by packaged smoke) | bundled prebuild |
| mac-x64, win-arm64, Linux | Source-build-only, **unverified** | falls to source build silently — flagged, not shipped |

A stray build on an unsupported arch silently degrades to a source build with zero verification; the findings note and §5 state this explicitly.

## 4. Decisions

1. **Pins (exact).** `better-sqlite3": "13.0.1"` → **`dependencies`** (mandatory: electron-builder packages only `dependencies`, and AC#1 requires it in the bundle). `@modelcontextprotocol/sdk": "1.29.0"` → **`devDependencies`** [reversed / F8]: 1.29.0 pulls a full HTTP stack (`express@^5`, `hono@^4`, `jose`, `ajv`, `cors`, `cross-spawn`) the in-process smoke never touches; it moves to `dependencies` in #30 when a transport ships. `@types/better-sqlite3` → devDeps. Reject `@modelcontextprotocol/server@2.x` (beta-only).
2. **No override; keep `npmRebuild: false`.** We want a prebuild if one loads — but because v13 source-builds on install [F6], the spike must **prove which binary loads** rather than rely on precedence (see §5 "which-binary-loaded"). Dev/CI already has build tools (node-pty), so a source build cannot break install.
3. **fuses.js prune, flat-file, BOTH mac + win afterPack** [F9]. v13 ships **8 flat** `prebuilds/*.node`; a win bundle would otherwise carry 6 foreign `.node` files. Keep `prebuilds/<plat>-<arch>.node`, delete the rest, keep-then-verify. **Reframed as size hygiene**: the "unpruned bundle fails mac deep-strict codesign" claim is likely overstated (electron-builder already deep-signs nested Mach-O — node-pty ships that way today). The spike **A/B-tests a signed bundle with vs without the prune** and records which (if any) actually gates codesign; the prune stays for size regardless. Also add `!node_modules/better-sqlite3/{deps,build,src}/**` to `electron-builder.yml` `files`.
4. **MCP smoke = full in-memory round-trip** [F1]. `InMemoryTransport.createLinkedPair()` linking a `Client` + `McpServer`; `registerTool`; then assert `client.listTools()` contains the tool **and** `client.callTool()` returns the expected result — not a bare `registerTool` call. The in-process choice deliberately **sidesteps the `RunAsNode: false` fuse that #30's stdio server WILL hit** — carried forward as an **open risk for #30** (Electron guidance: host the stdio MCP server via `utilityProcess`, **not** `child_process.fork`). No `StdioServerTransport` is exercised or blessed here.
5. **Packaged verification: advisory-first-then-gate** [reversed / F2]. The packaged unpacked-app smoke (`ERFANA_SMOKE=native-deps`, exit 0/1) runs **non-blocking for one release** and is first exercised on a **develop push / `workflow_dispatch` / the existing `is-dry-run` release path** so its first live execution never ships. Promote to a hard gate only after a green soak. The **deterministic Node/vitest checks stay always-on hard gates**.
6. **Env-gated smoke ships in the public `asar: false` bundle — accepted** [F11]. The `ERFANA_SMOKE` branch is dynamically imported (kept off the hot startup path) but is present in the distributed tree. Accepted for the spike; the findings note records a build-time `define`/tree-shake exclusion as the release-channel follow-up if we keep smoke code long-term.

## 5. Smoke architecture

```
src/main/index.ts
  └─ if ERFANA_SMOKE === 'native-deps'  (early, before window; dynamic import)
        await import('./smoke/nativeDepsSmoke') → run → app.exit(code)

src/main/smoke/nativeDepsSmoke.ts        orchestrator (fail-closed): spawn worker + run MCP round-trip +
                                         concurrent MAIN-process require('better-sqlite3'); collect checks[]
src/main/smoke/mcpInMemoryRoundtripSmoke.ts   InMemoryTransport linked pair: Client+McpServer,
                                         registerTool → listTools() contains + callTool() returns (AC#4)
src/main/services/workers/sqlite-smoke.worker.ts
     open Database(':memory:'); assert sqlite_compileoption_used('ENABLE_FTS5')===1;
     CREATE VIRTUAL TABLE … USING fts5; INSERT one MATCHING + one NON-MATCHING doc;
     SELECT … MATCH known token → assert rows.length===1 AND the returned row is the
     matching one (proves filtering, not a degenerate match-all);
     resolve + report the loaded .node ABSOLUTE PATH; postMessage(SUCCESS_TOKEN + checks)

scripts/smoke/sqlite-worker-smoke.mjs    Node harness: spawns out/main/sqlite-smoke.worker.js (Node-ABI cross-check)
src/main/smoke/nativeDeps.smoke.test.ts  vitest: in-proc better-sqlite3 (compileoption + FTS5 rows) +
                                         MCP round-trip (listTools + callTool)
```

**Fail-closed contract** [F5], mirroring `GitStatusWorkerAdapter.ts:45-50,105-111`: any worker error, non-zero exit, or message timeout → `app.exit(1)` with **no in-process fallback**; the orchestrator requires an explicit `SUCCESS_TOKEN` and asserts **every** expected `checks[]` entry ran **and** passed before exit 0.

**Which-binary-loaded** [F6] is an explicit spike output: the worker logs + **records** the resolved `better_sqlite3.node` absolute path as an **informational** check — **not** a pass/fail gate (excluded from the success-token gate). If it resolves `build/Release/` instead of `node_modules/better-sqlite3/prebuilds/`, that is recorded as the real behaviour, **not failed** (closing OQ-1's circularity).

**Concurrent main + worker** [F3]: the orchestrator `require('better-sqlite3')` and opens its own DB in the **main process** while the worker holds a separate DB — proving the "context-aware / DB-per-worker" claim in one process. If it cannot be proven, the claim is dropped from §8 (preference: prove it).

Worker registered as a third `rollupOptions.input` → `out/main/sqlite-smoke.worker.js`; loaded via `join(__dirname, 'sqlite-smoke.worker.js')`, exactly like the git-status worker.

### Verification matrix (authority vs cross-check) [F3, traceability corrections]

| Check | Linux / `checks` | Win x64 | mac arm64 |
|---|---|---|---|
| better-sqlite3 loads under real ABI | Node-ABI portability **cross-check** | `windows-checks` + **packaged (authority)** | **packaged (authority)** |
| `compile_options` + FTS5 MATCH rows===1 | in-proc vitest | in-proc vitest + packaged | packaged |
| Executes in `worker_thread` (AC#2) | cross-check only (plain Node, **not** authority) | **packaged (authority)** | **packaged (authority)** |
| Main + worker same-process (context-aware) | vitest (best-effort) | packaged | packaged |
| Which `.node` loaded (prebuild vs build/Release) | cross-check | packaged output | packaged output |
| MCP round-trip (listTools + callTool) | in-proc vitest | in-proc vitest + packaged | packaged |

Authority for AC#1/AC#2 is the **packaged mac/win smoke**, run on a develop push per Decision 5; Linux is a portability cross-check, never AC#2 authority. Unsupported arches (§3) get **no** verification.

## 6. Per-file change list (all ≤500 lines)

**New**
| # | Path | ~LOC | Purpose | AC |
|---|---|---|---|---|
| 1 | `src/main/services/workers/sqlite-smoke.worker.ts` | 110 | worker: compileoption assert, FTS5 create/insert/MATCH rows===1, report loaded `.node` path, success token | 1,2 |
| 2 | `src/main/smoke/nativeDepsSmoke.ts` | 140 | fail-closed orchestrator: spawn worker + MCP round-trip + concurrent main-process DB; checks[] | 1,2,4 |
| 3 | `src/main/smoke/mcpInMemoryRoundtripSmoke.ts` | 70 | InMemoryTransport linked pair: Client+McpServer, listTools + callTool | 4 |
| 4 | `scripts/smoke/sqlite-worker-smoke.mjs` | 45 | spawn built worker (Node-ABI cross-check) | 2 (cross-check) |
| 5 | `src/main/smoke/nativeDeps.smoke.test.ts` | 110 | vitest: in-proc sqlite+FTS5 rows + MCP round-trip | 1,4 |
| 6 | `docs/graph/native-dependencies.md` | — | findings note (authored at spike run) | 5 |

**Edits**
| # | Path | Change | AC |
|---|---|---|---|
| 7 | `package.json` | `better-sqlite3":"13.0.1"` → `dependencies`; `@modelcontextprotocol/sdk":"1.29.0"` + `@types/better-sqlite3` → `devDependencies` | 3 |
| 8 | `electron-builder.yml` | add `!node_modules/better-sqlite3/{deps,build,src}/**` to `files` | 1 |
| 9 | `electron.vite.config.ts` | add `'sqlite-smoke.worker'` rollup input | 1,2 |
| 10 | `scripts/fuses.js` | add `pruneForeignBetterSqlitePrebuilds` (flat-file, keep-then-verify), wire into afterPack for **both** mac + win, export | 1 |
| 11 | `src/main/index.ts` | early `ERFANA_SMOKE==='native-deps'` guard → dynamic import → `app.exit` | 1 |
| 12 | `.github/workflows/build_mac.yml` | packaged smoke **after electron-builder build / before DMG notarize+staple** [F15]; advisory (non-blocking) [F2] | 1,2,4 |
| 13 | `.github/workflows/build_win.yml` | packaged smoke after signtool verify, before Upload; advisory | 1,2,4 |
| 14 | `.github/workflows/checks.yml` | append `node scripts/smoke/sqlite-worker-smoke.mjs` to `build` job (Node-ABI cross-check, always-on hard gate) | 2 |

(`test` + `windows-checks` auto-collect file #5 via the `vitest.main.ts` glob — always-on hard gate, no workflow edit.)

## 7. Acceptance-criteria → artifact traceability

| AC | Requirement | Satisfied by | Authority |
|---|---|---|---|
| 1 | Packaged mac arm64 + win x64 load from bundle + SELECT + FTS5 MATCH | #1,#2,#8,#10,#11 + packaged #12/#13; in-proc vitest #5 for logic | packaged mac/win |
| 2 | Loads/executes in worker_thread | #1 + packaged #12/#13 (authority); #4/#14 Linux cross-check | packaged mac/win |
| 3 | Exact pins + source-build fallback documented | #7 exact pins + §8 (12.x fallback pin + source-build) | — |
| 4 | MCP SDK proven | #3,#5 InMemoryTransport round-trip (listTools + callTool) | in-proc + packaged |
| 5 | Findings note consumed by #23/#30 | #6 | — |

## 8. Findings note (AC#5) — required contents of `docs/graph/native-dependencies.md`

1. **Pins + provenance** [F10]: `better-sqlite3@13.0.1`, `@modelcontextprotocol/sdk@1.29.0` (devDep) with publish dates; **verify npm provenance/attestations** for both; commit `package-lock.json` (SRI hashes); confirm `npm audit signatures` passes on the new tree (it feeds the CI `audit-signatures` digest).
2. **ABI rationale** [F13]: N-API 10 is *inferred* (engines + `node-addon-api@^8`, no `napi_versions` field) and *confirmed at runtime*; state it as such.
3. **Which-binary-loaded result** [F6]: record empirically whether the load resolved `prebuilds/` or `build/Release/` (v13 removed `prebuild-install`, so `install-app-deps` source-builds every install); include the absolute path the smoke printed.
4. **better-sqlite3 13 freshness + regression history** [F7]: 13.0.0 was the **first-ever N-API rewrite**; 13.0.1 patched a 13.0.0 param-binding regression ~36 min later. Elevated risk. Document a concrete **fallback pin to the last mature 12.x NAN line** alongside the source-build fallback (§10). Record this history for #23.
5. **Build config**: `asar:false`/`npmRebuild:false` implications; the flat-file prune (mac+win) reframed as size hygiene + the A/B codesign result [F9]; the `files` exclusion of `{deps,build,src}`; worker rollup input + `__dirname` load path.
6. **FTS5 runtime-assert method** [F4]: `sqlite_compileoption_used('ENABLE_FTS5')===1` and a MATCH returning `rows.length===1` (not a `compile_options` substring scan).
7. **Concurrency model** [F3]: context-aware N-API, DB-per-worker — with the concrete "main + worker same process" proof result (or note if dropped).
8. **MCP decision** [F1,F14]: `sdk@1.29.0` is the correct **spike** pin; the proof is an `InMemoryTransport` round-trip. **No `StdioServerTransport` blessing** — instead: #30's stdio server hits `RunAsNode: false` and must be hosted via **`utilityProcess`, not `child_process.fork`** (carried open risk). Also: MCP SDK **v2** (`@modelcontextprotocol/server`, beta-only today) will replace the monolithic v1 SDK — **#30 inherits a v1→v2 migration; track as a #30 follow-up.**
9. **Supported-arch matrix** [F12]: supported = mac-arm64, win-x64; source-build-only/unverified = mac-x64, win-arm64, Linux.
10. **Shipped smoke tradeoff** [F11]: env-gated smoke code is present in the public bundle; note the `define`/tree-shake exclusion option for release channels.
11. Addressed explicitly to **#23** (DB layer) and **#30** (MCP server).

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **better-sqlite3 13 immaturity** — first N-API rewrite; 13.0.1 hot-patched a 13.0.0 binding regression [F7] | med | **high** | Exact pin; documented 12.x-NAN fallback pin + source-build fallback; regression history recorded for #23 |
| Loader source-builds into `build/Release/` (v13 dropped `prebuild-install`); precedence unproven [F6] | **high** | med | Spike **proves** which `.node` loads and records it; build tools already present so install can't break |
| Foreign prebuilds bloat win bundle / (maybe) gate mac codesign [F9] | high (bloat) / low (codesign) | med | Flat-file prune on **both** OSes; **A/B codesign** pruned vs unpruned to falsify the codesign claim |
| **#30 stdio server hits `RunAsNode:false`** (carried from this spike) [F1] | med | high | Documented for #30: host via `utilityProcess`, not `child_process.fork` |
| #30 inherits MCP SDK **v1→v2** migration [F14] | med | med | Tracked as #30 follow-up in findings note |
| Electron app won't launch headless on CI runner | low | high | Exit before window creation; **hang ceiling now concrete** — `Promise.race` hard ceiling (~60s) in `index.ts` forces `app.exit(1)` on any hang, plus CI step `timeout-minutes: 5` + a bounded launch (`timeout 120` on mac / a 120s watchdog on win); smoke stays advisory-first (`continue-on-error`) so a hang fails only the advisory step |
| Env-gated smoke code ships in public bundle [F11] | n/a | low | Accepted; dynamic-import off hot path; tree-shake option noted for release |
| Flat-file prune deletes the target `.node` | low | high | Keep-then-verify + dedicated unit test |

## 10. Source-build fallback (verbatim — for the findings note; use only if a prebuild ever fails)

Requires Python **3.12** (NOT 3.13), macOS Xcode CLT / Windows VS Build Tools (C++). One of:

```
npm install better-sqlite3@13.0.1 --build-from-source
npx @electron/rebuild -v 39.2.4 -f -w better-sqlite3
cd node_modules/better-sqlite3 && npm run build-release
```

**Maturity fallback** [F7]: if 13.x proves unstable during #23, pin the last mature **12.x NAN line** (`better-sqlite3@^12`) — note this needs `@electron/rebuild` against the Electron ABI (NAN, not N-API-portable).

## 11. Open questions (for approval)

1. **OQ-1 (resolved by F6):** "accept the rebuild?" is replaced by "**prove and record** which `.node` loads." No standing question — the spike outputs the answer.
2. **OQ-2 (resolved):** findings note path settled at `docs/graph/native-dependencies.md`.
3. **OQ-3 (resolved by Decision 5):** packaged smoke is advisory-first-then-gate; deterministic checks are the always-on hard gate.
4. **OQ-4 (RESOLVED):** does the unpruned bundle actually fail mac codesign? **No.** Local Developer ID A/B (2026-07-26): **both** the pruned `Erfana.app` and an unpruned copy (7 foreign better-sqlite3 prebuilds injected back + re-signed `--deep --options runtime`) pass `codesign --verify --deep --strict` (exit 0, "satisfies its Designated Requirement"). The prune is **size hygiene only**, not a codesign gate — keep it regardless. (Notarization was not part of this check; moot since production always ships pruned.)
5. **OQ-5 (new, deferred to #30):** `utilityProcess` vs alternative for the stdio MCP host under `RunAsNode:false`.

## 12. Verification criteria (phase 8)

- **Always-on hard gates:** `npm run test:main` passes incl. `nativeDeps.smoke.test.ts` (in-proc sqlite + two-doc FTS5 filtering [rows===1 + matching row] + `compileoption_used` + MCP `listTools`/`callTool`) **and `runSqliteWorker.test.ts`** (real fail-closed worker-spawn: timeout / `error` / non-zero exit / clean-exit-without-result) on ubuntu + windows; `electron-vite build` emits `out/main/sqlite-smoke.worker.js`; `node scripts/smoke/sqlite-worker-smoke.mjs` exits 0 (Node-ABI cross-check) **and asserts the expected sqlite checks are present, not just `ok`**.
- **Advisory-first (Decision 5):** packaged mac arm64 + win x64 unpacked apps exit 0 under `ERFANA_SMOKE=native-deps`, exercised on a develop push / `workflow_dispatch` / `is-dry-run` before any live tag; mac smoke runs **before** DMG notarize/staple [F15].
- **Which-binary output** [F6]: smoke logs the resolved `better_sqlite3.node` absolute path; recorded in the findings note.
- **Prune A/B** [F9] — **DONE (local Developer ID A/B, 2026-07-26):** `codesign --verify --deep --strict` ran on **both** the pruned and the **unpruned** mac bundle; **both pass** (exit 0, "satisfies its Designated Requirement"). The prune does **not** gate codesign — it is **size hygiene only**; keep it regardless. (CI only builds the pruned bundle, so the unpruned arm was produced locally; notarization not part of this check.)
- **Supply chain** [F10]: `npm audit signatures` green on the new tree; `package-lock.json` committed; provenance/attestations checked for both packages.
- `docs/graph/native-dependencies.md` present with all §8 contents.
- `npm run lint`, `typecheck`, `check:headers`, `reuse lint` green.
