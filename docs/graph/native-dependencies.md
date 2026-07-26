<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Native dependencies — spike findings note (SD-019 / issue #19)

**Audience:** [#23 — DB layer](https://github.com/qodeca/erfana/issues/23) and
[#30 — MCP server](https://github.com/qodeca/erfana/issues/30). This note is the
consumable output of the native-dependency de-risking spike. It records what the
spike **empirically proved**, what it **inferred**, and what is **still
unverified** and must be confirmed by a packaged/signed CI run before #23/#30
rely on it.

**Status of the evidence in this note:** the Node-ABI cross-check
(`node scripts/smoke/sqlite-worker-smoke.mjs`), the in-process vitest smoke, and a
**local unpacked Electron 39 mac-arm64 developer run**
(`ERFANA_SMOKE=native-deps electron .` — real worker + real main DB concurrent,
exit 0) are **verified**. The **signed, packaged win-x64 bundle load is
verified in CI** (run 30102038426 — §3/§13), and the **signed + notarized
mac-arm64 `.app` packaged load is now also verified in CI** (run 30102038426,
`build_mac` job 89510284551 — §3/§13). **Nuance:** the mac packaged smoke ran
against the signed + notarized `.app` **but before DMG notarize/staple**, so
DMG-stapled load was not separately smoked. The
`codesign --deep --strict` pruned-vs-unpruned **A/B** is now **VERIFIED locally**
(§5/§13 item 2) — **both** bundles pass deep-strict, so the prune is size hygiene
only. The sole remaining task is the multi-run green soak before promoting the
advisory step to a hard gate. Treat any claim tagged _(UNVERIFIED)_ accordingly.

See the design for full rationale: `specs/designs/sd-019-native-dep-spike.md`.

---

## 1. Pins + provenance

| Package | Version | Location | Rationale |
|---|---|---|---|
| `better-sqlite3` | `13.0.1` (exact) | **`dependencies`** | electron-builder packages only `dependencies`; AC#1 requires the native binary in the bundle. |
| `@modelcontextprotocol/sdk` | `1.29.0` (exact) | **`devDependencies`** | The in-process spike round-trip never touches the HTTP transport stack `1.29.0` pulls (`express@^5`, `hono@^4`, `jose`, `ajv`, `cors`, `cross-spawn`). **#30 must move it to `dependencies`** when a real transport ships. |
| `@types/better-sqlite3` | `^7.6.13` | `devDependencies` | Types only. |

- **`@modelcontextprotocol/server@2.x` rejected** — beta-only today (see §8).
- **Supply chain — provenance audit (`npm audit signatures`):** **PASS** on the
  new tree — **1314 signatures verified, 134 attestations**. This is a
  **provenance / tamper-evidence** check (registry signatures + build
  attestations), **not** a vulnerability check. It feeds the CI
  `audit-signatures` job's `package-lock.json` digest. `package-lock.json` is
  committed (SRI hashes present) so the lock is reproducible and tamper-evident.
  **Scope the claim:** attestations are confirmed for the **two DIRECT** spike
  deps (`better-sqlite3`, `@modelcontextprotocol/sdk`); transitive-dependency
  attestation coverage is **partial** (not every transitive publisher emits
  provenance).
- **Supply chain — vulnerability audit (`npm audit`):** the spike's dependency
  additions introduce **exactly one new moderate**:
  `@hono/node-server <2.0.5` — **GHSA-frvp-7c67-39w9** (path traversal in
  `serve-static` on Windows via an encoded backslash), pulled **transitively** by
  `@modelcontextprotocol/sdk@1.29.0`. **ACCEPTED for the spike** because the SDK
  is a `devDependency` and the vulnerable HTTP/static-file stack is **tree-shaken
  out of the shipped bundle** — the smoke imports only `/server/mcp.js`,
  `/client/index.js`, and `/inMemory.js` (no `@hono/node-server`, no
  `serve-static`, no transport). (Other pre-existing repo advisories reported by
  `npm audit` — e.g. `axios`, `vite`, `dompurify`, `brace-expansion` — are
  unrelated to this spike and out of scope here.) **#30 must revisit this** — see
  §8.
- **Provenance re-check discipline:** both direct packages resolve through the
  public npm registry with registry signatures (the 1314-signature audit above).
  #23/#30 should re-run **both** `npm audit signatures` (provenance) **and**
  `npm audit` (vulnerabilities) after any bump; a bump that loses
  provenance/attestation coverage — or that pulls the `@hono/node-server` moderate
  into the shipped tree — is a red flag.

## 2. ABI rationale (N-API version)

**N-API 10 is _inferred_, then _confirmed at runtime_.** The `better-sqlite3@13.0.1`
manifest has **no `napi_versions` field** and no `binary` field. N-API 10 is
inferred from:

- `engines.node: ">=22"` (Node 22 ships N-API 10), and
- `dependencies: { "node-addon-api": "^8.0.0" }` (node-addon-api 8 targets the
  N-API 10 surface).

**Confirmed at runtime — scoped to what actually ran.** Two runtime confirmations
exist today: (a) the plain-Node worker cross-check (`sqlite-worker-smoke.mjs`
harness), and (b) a **local unpacked Electron 39 (Node 22.20.0) developer run**
(`ERFANA_SMOKE=native-deps electron .`) that executed the smoke — real worker
thread + concurrent main-process DB — and exited 0. In both, the prebuilt binary
loaded and executed its FTS5 assertions without an ABI mismatch. This is
**verified locally on the unpacked build**; the **signed packaged win-x64 bundle
load is verified in CI** (run 30102038426 — §3/§13), and the
**signed + notarized mac-arm64 `.app` packaged load is now also verified in CI**
(run 30102038426, `build_mac` job 89510284551 — §3/§13; smoke ran on the notarized
`.app` before DMG staple). Because it is an
N-API (ABI-stable) addon, a single prebuild is portable across the Node and
Electron ABIs — this is the whole reason the Linux cross-check is meaningful (see
§11). State it as inferred + runtime-confirmed-on-the-unpacked-build, not as a
manifest fact and not as a packaged-bundle fact.

## 3. Which binary loaded (the F6 / OQ-1 answer)

**Empirically RECORDED (not gated) on mac-arm64 — VERIFIED.** The worker smoke
printed the absolute path of the loaded `.node`:

```
/Users/…/erfana/node_modules/better-sqlite3/prebuilds/darwin-arm64.node
```

- The `sqlite:prebuild-path` check is **informational** (`informational: true`),
  per SD-019 §2 [F6] / §5: it is an **empirical output to record, not a pass/fail
  gate**. Its `passed` reflects only "a `.node` resolved and its absolute path
  was captured"; the `prebuilds/` vs `build/Release/` distinction lives in the
  check's `detail` string. It is deliberately **excluded** from the success-token
  gate (`SmokeCheck.informational` is filtered out of the worker's `ok`
  computation) and from the orchestrator's `EXPECTED_CHECKS`, so a load from
  `build/Release/` (a legitimate source-build outcome) can **never** null the
  token and red the REQUIRED `checks.yml` `build` job. The path is still surfaced
  in the smoke logs and this findings note.
- On mac-arm64 it **empirically resolved `prebuilds/darwin-arm64.node`** — the
  flat prebuild — **not** `build/Release/`.
- **Nuance (recorded honestly):** `better-sqlite3@13` removed `prebuild-install`,
  so `electron-builder install-app-deps` invokes `node-gyp`, which _does_ create a
  `build/Release/` directory. In the spiked tree that directory contains **only
  node-gyp intermediates** (`obj.target/`, `.deps/`, `.forge-meta`) and **no
  linked `better_sqlite3.node`**. The loader therefore resolves the flat
  `prebuilds/<plat>-<arch>.node`. So the practical F6 answer on mac-arm64 is:
  **the prebuild wins**; the `build/` tree is dead weight (pruned from the bundle
  via the `electron-builder.yml` `files` exclusion — §5).
- This closes OQ-1's circularity: we do not assume prebuild precedence, we
  **record the loaded path**. #23 should keep the smoke's path assertion so a
  future install that starts source-building a real `build/Release/*.node` is
  caught.
- **Signed packaged CI run confirms the same path (VERIFIED).** The
  `build_mac` packaged smoke (run 30102038426, job 89510284551) recorded
  `loadedBinaryPath = …/release/0.16.3/mac-arm64/Erfana.app/Contents/Resources/
  app/node_modules/better-sqlite3/prebuilds/darwin-arm64.node` — the flat
  `darwin-arm64.node` prebuild **inside the signed + notarized `.app`**, matching
  the local unpacked run. The `afterPack` prune logged `Pruned 7 foreign
  better-sqlite3 prebuild(s); kept darwin-arm64.node`, so only that prebuild
  remained under `prebuilds/` in the signed bundle.

**win-x64 — VERIFIED (signed, packaged CI run).** The packaged Windows smoke in
the signed bundle recorded the loaded binary as the flat win-x64 prebuild inside
the packaged (unpacked, `asar:false`) app tree:

```
\\?\D:\a\erfana\erfana\release\0.16.3\win-unpacked\resources\app\node_modules\better-sqlite3\prebuilds\win32-x64.node
```

- Evidence: `release.yml` dry-run **run 30102038426**, `build_win` job
  **89510284522**, branch `feat/19-native-dep-spike` @ `3229b7e` (dry-run —
  nothing shipped). The `sqlite:prebuild-path` check reported
  `loaded from prebuilds/: …\prebuilds\win32-x64.node` — the **prebuild wins on
  win-x64 too**, not `build/Release/`. The foreign-prebuild prune ran in
  `afterPack` and logged `✅ Pruned 7 foreign better-sqlite3 prebuild(s); kept
  win32-x64.node` (v13 ships 8 flat prebuilds → 7 pruned), so only
  `win32-x64.node` remained under `prebuilds/` in the signed bundle.
- **Not run locally.** The local unpacked-Electron proxy was **not** executed on
  the spike owner's Windows box — it is Windows-x64 **emulated on Apple Silicon
  (Parallels)** and its native toolchain is broken for this build: node-gyp
  `10.2.0-electron.1` does not recognize the installed **Visual Studio 2026
  (v18.6)** and falls back to an uninstalled **ClangCL** toolset (`MSB8020`), so
  `electron-builder install-app-deps` cannot rebuild better-sqlite3 there. The
  **CI `windows-latest` (real bare-metal x64) signed run is therefore the sole
  win-x64 authority** — which is the stronger proof anyway (§11).

## 4. better-sqlite3 13 freshness + regression history (risk for #23)

**Elevated risk — read before building the DB layer.**

- `13.0.0` was the **first-ever N-API rewrite** of better-sqlite3 (the line was
  NAN/`node-gyp` against a specific Node ABI before v13).
- `13.0.1` patched a **param-binding regression** introduced in `13.0.0`, released
  very shortly after `13.0.0`. We pin `13.0.1` (the fixed patch), never `13.0.0`.

**Fallback plan for #23** (use only if 13.x proves unstable during DB work):

1. **Maturity fallback — pin the last mature 12.x NAN line:** `better-sqlite3@^12`.
   Caveat: 12.x is **NAN**, not N-API-portable, so it must be rebuilt against the
   Electron ABI with `@electron/rebuild` (the single-prebuild portability in §2
   does **not** hold for 12.x).
2. **Source-build fallback** (verbatim; requires Python **3.12** — _not_ 3.13 —
   plus macOS Xcode CLT / Windows VS C++ Build Tools). One of:

   ```
   npm install better-sqlite3@13.0.1 --build-from-source
   npx @electron/rebuild -v 39.2.4 -f -w better-sqlite3
   cd node_modules/better-sqlite3 && npm run build-release
   ```

   Dev/CI already has native build tools present (node-pty), so a source build
   cannot break `npm install`.

## 5. Build configuration + implications

- **`asar: false`, `npmRebuild: false`** (`electron-builder.yml`). The whole
  `node_modules` tree ships **unpacked** under `Resources/app/node_modules`. There
  is no `asarUnpack` and no `OnlyLoadAppFromAsar` fuse, so AC#1's "loads from
  asarUnpack" reframes to **"loads from the packaged, signed, fuse-flipped
  bundle's `node_modules`."**
- **Flat-file prune of foreign prebuilds (mac + win)** — `scripts/fuses.js`
  keeps `prebuilds/<plat>-<arch>.node` and deletes the other 6 flat prebuilds in
  `afterPack` (keep-then-verify). v13 ships **8 flat** `prebuilds/*.node`; without
  the prune a Windows bundle would carry 6 foreign `.node` files. **Confirmed size
  hygiene (A/B: both pruned and unpruned pass `codesign --deep --strict`):** the
  "unpruned bundle fails mac deep-strict codesign" claim is **disproven** —
  electron-builder already deep-signs nested Mach-O (node-pty ships that way
  today). The prune stays for bundle size regardless (drops ~15 MB).
  - **A/B codesign result — VERIFIED (local Developer ID codesign A/B):** the
    `codesign --verify --deep --strict --verbose=2` comparison of a **pruned**
    vs **unpruned** signed mac bundle was run locally on the maintainer's Mac.
    **Both pass** → exit 0, "valid on disk" + "satisfies its Designated
    Requirement". **Method:** the pruned bundle is the electron-builder-signed
    `release/0.16.3/mac-arm64/Erfana.app` (afterPack kept only
    `darwin-arm64.node`; signed `Developer ID Application: QODECA sp. z o.o.
    (DZ477VK57L)`; `resign.js` afterSign already verified it). The unpruned bundle
    is a copy of that `.app` with all 7 foreign better-sqlite3 prebuilds
    (`darwin-x64`, `linux-arm64`, `linux-x64`, `linuxmusl-arm64`, `linuxmusl-x64`,
    `win32-arm64`, `win32-x64`) injected back, then re-signed with
    `codesign --force --deep --options runtime --sign "Developer ID Application:
    QODECA sp. z o.o. (DZ477VK57L)"`. **Caveats:** the unpruned bundle was
    produced by injecting the foreign prebuilds into the already-signed `.app` and
    re-signing `--deep` (not a second full electron-builder afterPack run) —
    faithful for the codesign-seal question this item asked, but note the method;
    `darwin-x64.node` is Mach-O (signed as nested code) while the `win32-*` /
    `linux-*` `.node` files are non-Mach-O (sealed as resources); **notarization
    was NOT part of this check** (this is the local `codesign --verify --deep
    --strict` verification item 2 asked for — Apple notary-service acceptance of
    an unpruned bundle was not tested, and is moot since production always ships
    pruned). **Conclusion:** the foreign-prebuild prune is **NOT** required for
    `codesign --deep --strict` — it is size hygiene only. Keep the prune either
    way.
- **`files` exclusion** — `electron-builder.yml` adds
  `!node_modules/better-sqlite3/{deps,build,src}/**`, dropping the source-build
  inputs and the node-gyp `build/` tree (see §3) from the shipped bundle.
- **Worker layout** — `electron.vite.config.ts` registers
  `'sqlite-smoke.worker'` as a rollup `input`, emitting
  `out/main/sqlite-smoke.worker.js`. It is loaded via
  `join(__dirname, 'sqlite-smoke.worker.js')`, identical to the git-status
  worker. `chunkFileNames` is flattened (`[name]-[hash].js`, no nested dir) so
  `__dirname === out/main`, keeping shared chunks in the same directory as the
  worker entry — dev and packaged layouts match.
- **How the packaged smoke reaches a `devDependency` MCP SDK** — critical
  mechanism. `@modelcontextprotocol/sdk` is a **`devDependency`** (§1), so
  electron-builder does **NOT** copy it into the packaged
  `Resources/app/node_modules`. The packaged `ERFANA_SMOKE=native-deps` run only
  reaches the MCP code because **electron-vite/Vite BUNDLES the SDK's JS into the
  `out/main` chunk at build time** — its main-process build externalizes
  runtime `dependencies` (e.g. `better-sqlite3`, a native addon that cannot be
  bundled) but **inlines imported `devDependencies`** into the emitted chunk. So
  the MCP round-trip ships as bundled JS inside `out/main`, not as a
  node_modules package. **This changes when #30 moves the SDK to `dependencies`**
  (needed for a real stdio transport): it then also lands in the packaged
  `node_modules` and is externalized rather than inlined — re-verify the packaged
  MCP path after that move. Contrast: a native addon like `better-sqlite3` can
  never be inlined, which is exactly why it must stay a `dependency` (§1).

## 6. FTS5 runtime-assert method

FTS5 availability is asserted **at runtime**, not by scanning a compile-options
string:

- `sqlite_compileoption_used('ENABLE_FTS5') === 1` — **confirmed**.
- A real `CREATE VIRTUAL TABLE … USING fts5` **that proves FILTERING**: the
  worker inserts **two** docs — one MATCHING and one NON-MATCHING — then MATCHes a
  token present in only the matching one and asserts **exactly the matching row**
  comes back (`rows.length === 1` **and** the returned rowid + body are the
  matching doc's). A degenerate MATCH that ignored the index and returned every
  row would fail this — **confirmed** (FIX 4).

#23: reuse this pattern (`sqlite_compileoption_used` + a **two-doc**
matching/non-matching MATCH assertion, not a bare row-count) as the FTS5 smoke; do
**not** rely on a substring scan of `PRAGMA compile_options`.

## 7. Concurrency model (context-aware N-API, DB-per-worker)

**Proven in the local unpacked Electron run (real worker + main DB coexisted),
and now in both signed packaged CI bundles — the `main:concurrent-db` check
PASSED inside the signed win-x64 app and the signed + notarized mac-arm64 `.app`
(run 30102038426, §13).** The simultaneous main + worker handle coexistence was
exercised end-to-end by the local unpacked `ERFANA_SMOKE=native-deps` run (which
spawns the real worker thread while the main-process handle stays open) and by
the real-worker fail-closed unit test — **not** by the in-process vitest
orchestrator test, which injects a *faked* worker result and so only proves the
main-process handle stays usable across the awaited step (see the docstring in
`nativeDeps.smoke.test.ts`). The packaged/signed bundle proof is still pending.
The orchestrator opens a main-process `Database` and **keeps it open across** the
worker run: it inserts a row, then `await runSqliteWorker()` (which spawns a
`worker_thread` that opens its **own** separate `Database` and runs its FTS5
assertions), then — while the main handle is still open — **re-SELECTs the row
it inserted before the worker ran** and asserts it reads back correctly, and
finally closes the main handle in a `finally`. A successful read *after* the
worker's independent handle came and went proves the two `better-sqlite3`
handles were live in the **same OS process at the same time** without a
cross-instance ABI conflict.

What is proven: two independent handles coexist in one process (context-aware
N-API / **DB-per-worker**). What is *not* claimed: the two handles do not share
or contend on the same on-disk DB file (both use `:memory:`, which is
per-connection) — coexistence, not shared-file concurrency, is the property #23
needs. The check is **fail-closed**: any throw sets `main:concurrent-db`
`passed: false`, which reds the run (exit 1). #23 can safely run a DB instance
per worker plus a main-process instance.

## 8. MCP decision (for #30)

- **Spike pin `@modelcontextprotocol/sdk@1.29.0` is correct** for the spike. The
  proof is an **`InMemoryTransport` round-trip** — **VERIFIED**:
  `InMemoryTransport.createLinkedPair()` links a `Client` + `McpServer`;
  `registerTool` → `client.listTools()` **contains** the registered tool →
  `client.callTool()` **returns** the expected result. Not a bare `registerTool`
  call.
- **No `StdioServerTransport` is blessed here.** The in-process transport
  deliberately sidesteps the `RunAsNode: false` fuse (which blocks Electron
  running as bare Node).
- **Packaging note (devDep → bundled JS).** The spike's SDK is a `devDependency`
  and is **not** in the packaged `node_modules`; the packaged smoke reaches it
  only because electron-vite **inlines** it into the `out/main` chunk (see §5).
  When #30 moves the SDK to `dependencies` for a real transport, it will instead
  be externalized into the packaged `node_modules` — a packaging-shape change
  that must be re-smoked in the signed bundle, not assumed to carry over.
- **Before moving `@modelcontextprotocol/sdk` from `devDependencies` to
  `dependencies` (#30): re-run `npm audit` and bump `@hono/node-server` to
  ≥2.0.5** (or confirm it stays tree-shaken out of the packaged bundle). While the
  SDK is a devDep the `@hono/node-server` moderate (GHSA-frvp-7c67-39w9, §1) is
  tree-shaken away; the move to `dependencies` would otherwise **ship that
  moderate into the packaged `node_modules`**. This is a hard gate for the #30
  packaging change, not an optional follow-up.
- **Carried open risk for #30:** #30's stdio MCP server **will** hit
  `RunAsNode: false`. Host it via Electron **`utilityProcess`**, **not**
  `child_process.fork`. This is the single biggest architectural constraint #30
  inherits from this spike.
- **v1 → v2 migration (follow-up for #30):** MCP SDK **v2**
  (`@modelcontextprotocol/server`, **beta-only today**) will replace the
  monolithic v1 SDK. #30 inherits a **v1 → v2 migration** — track it as a #30
  follow-up. Do not adopt v2 now (beta).

## 9. Supported-arch matrix

| Arch | Status | Path |
|---|---|---|
| **mac-arm64** | Supported — **VERIFIED** (signed + notarized packaged CI run 30102038426, §3/§13; DMG-staple not separately smoked) | bundled prebuild |
| **win-x64** | Supported — **VERIFIED** (signed packaged CI run 30102038426, §3/§13) | bundled prebuild |
| mac-x64 | Source-build-only, **unverified** | silent source build |
| win-arm64 | Source-build-only, **unverified** | silent source build |
| Linux (all) | Source-build-only, **unverified** (dev/CI cross-check only) | silent source build |

A stray build on an **unsupported** arch silently degrades to a source build with
**zero verification**. #23/#30 must not ship an unsupported arch without adding
its own packaged smoke.

## 10. Shipped-smoke tradeoff

The `ERFANA_SMOKE=native-deps` branch (`src/main/index.ts`) is **present in the
public `asar: false` bundle**. It is **dynamically imported** and env-gated, so it
stays off the hot startup path — but the smoke source does ship in the
distributed tree. **Accepted for the spike.** If smoke code is kept long-term, the
release-channel follow-up is a build-time `define` / tree-shake exclusion so the
branch is stripped from production bundles. #23/#30: if you keep smoke modules,
budget that exclusion.

## 11. CI verification model

| Gate | Kind | Where | Blocking? |
|---|---|---|---|
| `nativeDeps.smoke.test.ts` (in-proc sqlite + FTS5 rows + MCP `listTools`/`callTool`) | **always-on hard gate** | `test` + `windows-checks` (vitest) | yes |
| `node scripts/smoke/sqlite-worker-smoke.mjs` (Node-ABI cross-check) | **always-on hard gate** | `checks.yml` `build` job (after `electron-vite build`) | yes |
| Packaged `.app` smoke (`ERFANA_SMOKE=native-deps`) | **advisory-first** | `build_mac.yml` (after sign, before DMG notarize/staple) | **no** (`continue-on-error`) |
| Packaged `win-unpacked` exe smoke | **advisory-first** | `build_win.yml` (after signtool verify, before Upload) | **no** (`continue-on-error`) |

- **Authority vs cross-check:** the packaged mac/win smoke is the **authority**
  for AC#1/AC#2. Linux (`checks.yml` + vitest) is a **portability cross-check**,
  never AC#2 authority. Unsupported arches (§9) get no verification.
- **Advisory-first-then-gate (Decision 5):** the packaged smoke runs
  non-blocking, first exercised on a **develop push / `workflow_dispatch` /
  `is-dry-run`** so its first live execution never ships. **Promote to a hard
  gate only after a green soak.** The deterministic Node/vitest checks stay
  always-on hard gates now.

## 12. Local empirical run (mac-arm64) — reproduction

```
$ npx electron-vite build
$ node scripts/smoke/sqlite-worker-smoke.mjs
  [PASS] sqlite:load — …/prebuilds/darwin-arm64.node
  [PASS] sqlite:fts5-compileoption — sqlite_compileoption_used('ENABLE_FTS5') = 1
  [PASS] sqlite:fts5-match — MATCH 'brown' over 2 docs (1 matching, 1 not) returned 1 row(s); expected exactly the matching row (rowid 1)
  [PASS] sqlite:prebuild-path — loaded from prebuilds/: …/prebuilds/darwin-arm64.node
[sqlite-worker-smoke] PASSED (Node-ABI portability cross-check)
```

Supply chain: `npm audit signatures` → **1314 signatures verified, 134
attestations** (PASS).

## 13. Verification status — packaged/signed CI runs

These carry the **AC#1/AC#2 authority**. #23/#30 must not treat any item still
tagged UNVERIFIED as proven until its packaged/signed CI run is green.

> **Update (win-x64 VERIFIED, 2026-07-24).** The **Windows x64** leg is now
> proven end-to-end by a signed packaged CI run — `release.yml` dry-run
> **run 30102038426**, `build_win` job **89510284522**, branch
> `feat/19-native-dep-spike` @ `3229b7e`, on `windows-latest` (real bare-metal
> x64), signed via Azure Trusted Signing (`signtool verify /pa /all` →
> "Successfully verified"). The packaged smoke exited **0** with **7/7 checks
> PASS** and `loadedBinaryPath = …\win-unpacked\resources\app\node_modules\
> better-sqlite3\prebuilds\win32-x64.node`. This flips items **1 (win half)**,
> **3**, and **4 (win half)** below.
>
> **Update (mac-arm64 VERIFIED, 2026-07-26).** The **mac arm64** leg is now also
> proven by a signed packaged CI run — same `release.yml` dry-run
> **run 30102038426**, `build_mac` job **89510284551**, branch
> `feat/19-native-dep-spike` @ `3229b7e`. The `afterPack` prune logged
> `Pruned 7 foreign better-sqlite3 prebuild(s); kept darwin-arm64.node`, `.app`
> notarization succeeded, and the packaged smoke ran against the signed +
> notarized `release/0.16.3/mac-arm64/Erfana.app`, exiting **0** with **7/7
> checks PASS** and `loadedBinaryPath = …/mac-arm64/Erfana.app/Contents/
> Resources/app/node_modules/better-sqlite3/prebuilds/darwin-arm64.node`. This
> flips items **1 (mac half)** and **4 (mac half)** below. **Honest nuance:** the
> smoke ran **after `.app` sign + `.app` notarization but before DMG
> notarize/staple**, so the loaded bundle was a signed + notarized `.app`;
> **DMG-level stapling was not separately exercised** by the smoke.
>
> **Update (codesign A/B VERIFIED, 2026-07-26).** Item **2** (codesign A/B) is now
> **VERIFIED** by a local Developer ID codesign A/B on the maintainer's Mac (CI
> only ever builds the pruned bundle, so the unpruned arm was produced locally).
> **Both** the pruned `Erfana.app` and an unpruned copy (all 7 foreign
> better-sqlite3 prebuilds injected back + re-signed `--deep --options runtime`)
> **pass** `codesign --verify --deep --strict --verbose=2` (exit 0, "valid on
> disk" + "satisfies its Designated Requirement"). The foreign-prebuild prune is
> therefore **size hygiene only**, not a codesign gate — the earlier F9 concern is
> disproven. The advisory-first gating is intentionally **unchanged** — two single
> green packaged runs are not the multi-run soak SD-019 Decision 5 requires before
> promoting the step to a hard gate, which is now the sole remaining task.

1. **Signed packaged bundle load (AC#1/AC#2 authority).**
   - **win-x64 — VERIFIED** (run 30102038426): better-sqlite3 loaded from the
     signed, fuse-flipped `win-unpacked` bundle's `node_modules/…/prebuilds/
     win32-x64.node`.
   - **mac-arm64 — VERIFIED** (run 30102038426, `build_mac` job 89510284551):
     better-sqlite3 loaded from the **signed + notarized, fuse-flipped**
     `Erfana.app`'s `Contents/Resources/app/node_modules/…/prebuilds/
     darwin-arm64.node`. **Nuance:** the smoke ran after `.app` sign + `.app`
     notarization but **before DMG notarize/staple**, so a signed + notarized
     `.app` load is VERIFIED; **DMG-stapled load was not separately smoked**.
2. **Codesign A/B (F9) — VERIFIED (local Developer ID codesign A/B).**
   `codesign --verify --deep --strict --verbose=2` on **pruned vs unpruned**
   signed mac bundles — **both pass** (exit 0, "valid on disk" + "satisfies its
   Designated Requirement"). The foreign-prebuild prune therefore does **NOT** gate
   codesign; it is **size hygiene only** (drops ~15 MB) — the earlier F9 "unpruned
   fails deep-strict" concern is disproven. **Method:** pruned = the
   electron-builder-signed `release/0.16.3/mac-arm64/Erfana.app` (kept only
   `darwin-arm64.node`; `Developer ID Application: QODECA sp. z o.o. (DZ477VK57L)`;
   `resign.js` afterSign already verified). Unpruned = a copy of that `.app` with
   all 7 foreign prebuilds (`darwin-x64`, `linux-arm64`, `linux-x64`,
   `linuxmusl-arm64`, `linuxmusl-x64`, `win32-arm64`, `win32-x64`) injected back,
   re-signed `codesign --force --deep --options runtime`. **Not run in CI:** the
   pipeline only ever builds the pruned bundle, so the unpruned arm was produced
   locally. **Caveats:** the unpruned bundle was made by injecting prebuilds into
   the already-signed `.app` and re-signing `--deep` (not a fresh electron-builder
   afterPack run); `darwin-x64.node` seals as nested Mach-O code, `win32-*` /
   `linux-*` `.node` seal as resources; **notarization was not part of this check**
   (moot — production always ships pruned). Keep the prune for size regardless.
3. **The entire Windows x64 leg — VERIFIED** (run 30102038426). The win-x64
   prebuild load (`sqlite:load`), FTS5 compile-option + two-doc MATCH
   (`sqlite:fts5-compileoption`, `sqlite:fts5-match`), `worker_thread` +
   main-process concurrency (`main:concurrent-db`), and the MCP round-trip
   (`mcp:listTools`, `mcp:callTool`) **all PASSED inside the signed, packaged
   Windows app** (exit 0). The foreign-prebuild prune logged `Pruned 7 …; kept
   win32-x64.node`. Note the Electron Windows GUI-subsystem caveat that made this
   verifiable: the packaged smoke relies on the `app.exit` **code** (stderr may
   not reach the CI console). To
   preserve the which-binary-loaded evidence despite that, the smoke also writes
   its summary + `checks[]` + `loadedBinaryPath` to `ERFANA_SMOKE_LOG`
   (synchronously, before `app.exit`); both the mac and win CI steps set that env
   var to a temp path and `cat` it after the launch (FIX 2). Both packaged steps
   are additionally bounded — `timeout-minutes: 5` plus a `timeout 120` (mac) /
   120s SIGKILL watchdog (win) — so a hang fails only the advisory step.
4. **Packaged AC#4 — MCP round-trip in the signed bundle.** The SDK ships as
   electron-vite-inlined JS in `out/main` rather than as a `node_modules` package
   (§5, §8), so the packaged path had to be proven separately from the in-process
   vitest.
   - **win-x64 — VERIFIED** (run 30102038426): the signed packaged smoke log shows
     `mcp:listTools` (advertised `[erfana_smoke_echo]`) + `mcp:callTool`
     (returned `echo:ping`) **PASS** at exit 0 — inlined-SDK path confirmed in the
     signed Windows bundle.
   - **mac-arm64 — VERIFIED** (run 30102038426, `build_mac` job 89510284551): the
     signed + notarized `.app` smoke log shows `mcp:listTools` (advertised
     `[erfana_smoke_echo]`) + `mcp:callTool` (returned `echo:ping`) **PASS** at
     exit 0 — inlined-SDK path confirmed inside the notarized mac bundle (smoke
     ran before DMG staple). The advisory-first (`continue-on-error`) gating is
     intentionally unchanged; a single green (non-blocking) job is not yet the
     multi-run soak required to promote to a hard gate.

**Action for the spike owner:** both the **win-x64** and the **mac-arm64**
advisory packaged smokes have now been exercised via the same `workflow_dispatch`
dry-run (run 30102038426 — `build_win` job 89510284522, `build_mac` job
89510284551); items 1, 3, and 4 are fully flipped above (the mac item-1 flip is
scoped to a signed + notarized **`.app`** load — DMG stapling was not separately
smoked). The **codesign A/B** (item 2) is now **VERIFIED** by a local Developer ID
A/B — both pruned and unpruned bundles pass `codesign --deep --strict`, so the
prune is size hygiene only. The **only** genuinely remaining item is a **multi-run
green soak** (SD-019 Decision 5) before dropping `continue-on-error` and promoting
the packaged smoke to a hard gate — two single green runs do not satisfy it.

---

_Addressed to #23 (DB layer) and #30 (MCP server). Design of record:
`specs/designs/sd-019-native-dep-spike.md`._
