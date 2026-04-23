# Deferred work — Phase 4 audit aftermath (D9–D12)

Continuation of [`deferred-work.md`](deferred-work.md) for items surfaced by the Phase 4 3-reviewer audit (2026-04-21). Same template as D1-D8. Items D9-D12 are **Phase 4** in origin; the Phase 2 items D1-D8 stay in the primary ledger.

**GitHub-tracked under [#168](https://github.com/qodeca/erfana/issues/168)** — see primary ledger for full cross-issue indexing.

Cross-cutting discipline (amendment-not-drop, triage cadence) is documented in the primary ledger + [`contributing.md`](contributing.md) §"Amendment discipline for deferred items".

## Index by suggested target

| Phase | Items |
|-------|-------|
| **Phase 6** (polish + CI guard) | D11 ISP split of `IWhisperModelManager` |
| **Tracked-only** (no scheduled phase) | D9 forensic-logging correlation ID, D10 `WhisperPlatform` tagged-union refactor (triggers when a 3rd platform lands) |
| **✅ Resolved** | D12 (2026-04-23) — `WhisperModelManager.test.ts` rewrite, 41 tests cross-platform |

---

## D9 — Forensic-logging tuple expansion beyond spawn 5-tuple

**Severity:** LOW (solution-reviewer post-B1+B2 audit I4)
**Source:** Solution — "forensic logging shape as specified by plan incomplete"

### What

Plan §"LocalWhisperService" §"Modified modules" commits to logging `{url, expectedSha, computedSha, signatureValid, manifestRevision, spawnedPath, binaryVersion}` at INFO on every download + spawn. B5a delivered the spawn half (`{spawnedPath, computedSha, signatureValid, manifestRevision, binaryVersion}` via the new `VerifiedBinary` return type); the install-time half (`{url, expectedSha}`) is already logged by `WhisperModelManager.ensureBinary()` but not in a single `Whisper install` event name — it's split across "Fetching whisper manifest", "Whisper manifest signature verified", "Downloading whisper archive", "Whisper binary installed" events.

### Why deferred

- Current spawn-log + install-log pair already covers all 7 keys; the only gap is that they're not **grouped under a single correlation ID**.
- Grouping requires either a per-install correlation ID (new concept) or a structured-logging framework swap — both are disproportionate to the marginal forensic benefit.
- The audit finding was downgraded from "merge-blocker" to "important" once it became clear the keys ARE logged, just not in the single event shape the plan literally wrote.

### Cost when promoted

~1 hour:
- Generate a correlation-ID (e.g. `install-${timestamp}-${short-uuid}`) at the top of `ensureBinary()` and thread it through every INFO log in the install path + the subsequent spawn INFO via the `VerifiedBinary` shape.
- Add unit test asserting both install-side and spawn-side events carry the same correlation ID.

### Promotion criteria

- A real forensic incident where grouping logs across install + spawn becomes non-trivial without the correlation ID.
- Migration to a structured-logging backend (OpenTelemetry, Pino with traceId, etc.) — at which point the correlation ID becomes cheap.

### Risks if forgotten

- LOW — the keys are already logged; an operator doing forensic analysis can join on timestamp + user-data-path + `manifestRevision`.

---

## D10 — Tagged-union purity refactor of `WhisperPlatform`

**Severity:** SHOULD-FIX (architecture-reviewer S3 post-B1+B2 audit)
**Source:** Architecture — "Tagged-union not fully applied"

### What

`src/main/services/whisper-assets.ts:50` declares `type WhisperPlatform = 'darwin-universal' | 'win32-x64'` — a concatenated-string enum. The architecture review flagged that the original plan prescribed `{platform: NodeJS.Platform, arch: NodeJS.Architecture | 'universal'}` as a structural tuple. `WhisperModelManager.ts:336` further uses substring-sniffing (`spec.filename.includes('macos')`) to pick a manifest key, which is fragile across future filename renames.

### Why deferred

- Current shape works correctly today with 2 supported platforms.
- Refactor would touch `whisper-assets.ts`, `WhisperModelManager.ts`, and the downgrade-protection tests' mock `classifyPlatform` — non-trivial test-surface churn.
- Substring-sniffing bug has a simple narrower fix (carry the tagged discriminator through instead of re-deriving from the filename) — bundle with the refactor, not urgent independently.

### Cost when promoted

~3 hours:
- Rename `WhisperPlatform` → `{platform, arch}` tagged tuple.
- Key `ARTIFACTS` by discriminator object, not concatenated string.
- Drop the `spec.filename.includes('macos')` sniff in favour of the carried discriminator.
- Update downgrade tests' `vi.mock('./whisper-assets', ...)` shape.

### Promotion criteria

- A third platform lands (linux-x64, win32-arm64) — the current enum cost grows linearly while the tuple cost stays flat.
- Any filename rename in CI (e.g. versioning scheme change) — substring-sniffing breaks first.

### Risks if forgotten

- LOW at 2 platforms; **MEDIUM** when the third lands.

---

## D11 — ISP split of `IWhisperModelManager`

**Severity:** SHOULD-FIX (architecture-reviewer S2 post-B1+B2 audit)
**Source:** Architecture — "Fat interface on `IWhisperModelManager`"

### What

`IWhisperModelManager` has 11 methods spanning binary-management (`ensureBinary`, `verifyInstalledBinary`, `isBinaryInstalled`), model-management (`ensureModel`, `isModelInstalled`, `listInstalledModels`, `deleteModel`, `getModelInfo`, `getModelPath`), and directory helpers (`getWhisperDir`, `getBinaryPath`). `LocalWhisperService` consumes 3 (`ensureBinary`, `ensureModel`, `verifyInstalledBinary`); renderer IPC handlers consume a disjoint set.

### Why deferred

- Splitting a widely-implemented interface is a high-blast-radius refactor.
- Current test mocks partially-implement the interface via `as never` casts — they already exhibit the "client depends on only some methods" pattern, which means ISP is already effectively observed at the test seam if not the type level.
- No second implementation of the interface exists yet — the cost of splitting for one implementer is entirely architectural purity, no concrete bug prevented.

### Cost when promoted

~2 hours:
- Extract `IWhisperBinaryProvider` (ensureBinary + verifyInstalledBinary + getBinaryPath + isBinaryInstalled) consumed by `LocalWhisperService`.
- Extract `IWhisperModelStore` (ensureModel / isModelInstalled / list / delete / info / getModelPath) consumed by IPC handlers.
- Concrete class still implements both.
- Update injection sites to accept the narrower shape.

### Promotion criteria

- A second implementation lands (e.g. a test double with selective surface, a remote-whisper provider behind the same interface).
- Renderer IPC gains a new per-method permission boundary that wants to grant access to only the model-store methods without binary-management.

### Risks if forgotten

- LOW — current coupling is tight but correct; no concrete bug is waiting.

---

## D12 — Rewrite remaining 5 `.skip()` tests in `WhisperModelManager.test.ts` — ✅ RESOLVED 2026-04-23

**Severity:** SHOULD-FIX (architecture-reviewer S4 + solution-reviewer I7 post-B1+B2 audit)
**Source:** Architecture / Solution — "5 skipped tests need tracking; `describe.skipIf(darwin)` hides entire ensureBinary suite on Windows/Linux CI"

### 2026-04-23 RESOLVED

Delivered via full-file rewrite of `src/main/services/WhisperModelManager.test.ts`. All 16 skipped / platform-gated tests replaced with Phase 4-aware equivalents using the module-boundary mock layer established in `WhisperModelManager.downgrade.test.ts`.

**Final shape**: 41 tests, 0 skipped, 0 platform-gated. Runs cross-platform on ubuntu-latest CI. Workspace total advanced from 7852 passed / 94 skipped → 7868 passed / 78 skipped (Δ matches the 16-test swap exactly).

**Coverage delta**:
- `ensureBinary()` 9-step install flow — now end-to-end asserted (manifest download, sig verify, downgrade block, source-pin check, archive download with SHA pin, extraction (zip + tar.gz parametrised), MOTW/chmod, sentinel writes).
- `isBinaryInstalled()` — full verification chain covered (access + schema sentinel + streaming per-file SHA via `createReadStream` mock yielding bytes whose real SHA-256 matches the test spec).
- `ensureModel()` — happy path via `downloadToFile` + rename, progress callback, cleanup-on-failure, cache update, abort handling.
- Legacy-cruft migration, unsupported-platform rejection, SecureDownloaderError wrapping — all now covered.

Error-code paths (`WHISPER_DOWNGRADE_BLOCKED` / `WHISPER_SOURCE_PIN_DRIFT` / `WHISPER_MANIFEST_INVALID`) remain in `WhisperModelManager.downgrade.test.ts` per the test-file split policy — not duplicated here.

### What

`src/main/services/WhisperModelManager.test.ts` has 6 `.skip()` / `describe.skipIf` occurrences at lines 244, 269, 463, 751, 775, 866. The `describe.skipIf(process.platform !== 'darwin')('ensureBinary()', ...)` block at :463 in particular hides the entire ensureBinary suite on the `checks.yml` ubuntu-latest runner — meaning the pre-Phase-4 install-path tests run in CI **only** when a contributor triggers the macOS e2e workflow. B5b's new `WhisperModelManager.downgrade.test.ts` runs platform-neutrally, but the 5 pre-Phase-4 tests remain skipped with TODO comments referencing this issue.

### Why deferred

- The 5 skipped tests reference the pre-Phase-4 code path (broken ggml-org URL, `getArchSuffix()` approach) which no longer exists. They need full rewrites against the Phase 4 `downloadToFile` + `verifyManifest` + `verifyAllFiles` flow — not small patches.
- B5b's downgrade tests cover the net-new trust-chain logic (the actual regression-risk surface). The 5 skipped tests are coverage of ensureBinary's happy-path install flow, which is less critical.
- The existing tests in that file use `mockFetch` directly, bypassing `secureDownloader`; rewriting them requires re-architecting the mock layer to match B5b's approach (mock at `secureDownloader` + `verifyManifest` module boundaries).

### Cost when promoted

~4 hours:
- Delete the 5 `.skip()` / `skipIf` blocks.
- Port each test's intent to the B5b mock infrastructure (mock `downloadToFile`, `verifyManifest`, `untarGz`/`unzip`).
- Remove platform-gating — tests run on all OSes via mocked `classifyPlatform`.
- Delete the unused `mockFetch`-based helpers once no callers remain.

### Promotion criteria

- Pre-0.9.4 release: run the full `WhisperModelManager.test.ts` rewrite before merging the Phase 4 PR.
- Post-merge: rewrite as Phase 5 follow-up, opening a GH issue referencing this D12 entry.

### Risks if forgotten

- MEDIUM — the happy-path install flow has downgrade-protection + SHA-pin + error-code coverage via `WhisperModelManager.downgrade.test.ts`, but no test exercises the actual fetch → extract → chmod → sentinel-write sequence on Phase 4. A regression in ensureBinary's ordering (e.g. writing the sentinel before `verifyAllFiles` completes) would only be caught by manual UAT.

---

## See also

- [`deferred-work.md`](deferred-work.md) — primary ledger D1-D8 (Phase 2 review aftermath)
- [`contributing.md`](contributing.md) §"Amendment discipline for deferred items" — how to amend rather than drop
- [`implementation-plan.md`](implementation-plan.md) §"Phase 4 — Local Whisper parity" — full Phase 4 context
- [`../adrs/README.md`](../adrs/README.md) — ADRs 0001-0004 for the load-bearing Phase 4 decisions
