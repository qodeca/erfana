# Deferred work — Phase 2 review aftermath

**GitHub-tracked under [#168](https://github.com/qodeca/erfana/issues/168)** (meta-issue indexing all D1–D8 items by target phase). Close that issue when all items here are resolved or accepted as won't-fix.

This document tracks every item that surfaced during the four-reviewer audit of Phase 2 (#160–#163) and was **explicitly deferred** rather than fixed in the same commit. Each entry has:

- **Severity** as flagged by the reviewer
- **Source review** (architecture / solution / code / security)
- **Rationale** for deferring (cost, risk, scope, dependency)
- **Promotion criteria** — concrete trigger that should re-prioritize the item
- **Suggested target phase** for execution

The goal is so that no review finding silently rots: every deferred item has a known owner-phase and an objective signal for promotion.

---

## Index by suggested target

| Phase | Items |
|---|---|
| **Phase 4** (whisper, OCP cleanup window) | ~~D1 `resolvePlatformBinary` extraction~~ (amended 2026-04-21 — whisper is not a probe-style caller; see D1 for revised promotion rule), D2 `MAX_FILENAME_LENGTH` consolidation, D3 `ExportLock` deduplication |
| **Phase 5** (distribution + signing) | D6 `DependencyDetector` cache TTL |
| **Phase 6** (polish + CI guard) | D4 Structured-error IPC serialization, D5 Log-redaction pass for filename PII, D7 Filename PII 40-char truncation review (bundled with D5), D11 ISP split of `IWhisperModelManager`, D12 rewrite of the 5 skipped `WhisperModelManager.test.ts` cases (or as pre-0.9.4 merge task — see D12 promotion criteria) |
| **Tracked-only** (no scheduled phase) | D8 IPC serialization ADR, D9 forensic-logging correlation ID, D10 `WhisperPlatform` tagged-union refactor (triggers when a 3rd platform lands) |

---

## D1 — Extract `resolvePlatformBinary()` helper

**Severity:** MEDIUM (architecture-reviewer M1, solution-reviewer SR-005)
**Source:** Architecture — "Extract `resolvePlatformBinary` NOW, not in Phase 4"
**Files implicated:**
- `src/main/services/workers/git-status.worker.ts:36-51` (`buildWin32GitPaths` + `WIN32_GIT_PATHS` + `POSIX_GIT_PATHS`) + `:204-245` (`isExecutableGit` + call site)
- `src/main/services/import/DependencyDetector.ts:17-20` (`WIN32_LIBREOFFICE_PATHS`)
- `src/main/services/watcher/PlatformConfig.ts:194-201` (Phase 4 OCP comment block)

### What

A shared utility that takes `Record<NodeJS.Platform, string[]>` of candidate binary paths plus a fallback command (`where` / `which`) and an optional liveness probe, returns the resolved binary path.

```typescript
// proposed signature
export async function resolvePlatformBinary(opts: {
  candidates: Partial<Record<NodeJS.Platform, string[]>>
  fallbackCmd: { cmd: string; args: string[] }
  livenessProbe?: (path: string) => Promise<boolean>
  cooldownMs?: number
}): Promise<string | null>
```

### Why deferred

The two current callers diverge in non-trivial ways:

- **git resolver**: 60-second cooldown cache, `--version` liveness probe, FD-pressure-aware error handling
- **LibreOffice detector**: per-app-launch cache, `--version` liveness probe (added in review fix), parallel detect with `imageMagick`

Premature extraction risks a leaky abstraction where the helper grows ad-hoc options. The Rule of Three says extract on the **third** caller.

### 2026-04-21 amendment — Phase 4 (whisper) did NOT become the third caller

Phase 4 landed on `feature/windows-phase-4-whisper` without needing `resolvePlatformBinary`. Whisper-cli resolution is a **one-shot, SHA-pinned, signed-manifest download** — the binary path is a `join(binDir, pinned-filename)` expression at `WhisperModelManager.getBinaryPath()`. There is no:

- **Probe-style discovery** (no candidate-list search across Program Files / Chocolatey / Scoop paths).
- **Fallback command** (no `where` / `which` to try).
- **Liveness probe** (the pre-spawn SHA re-hash IS the integrity check, it doesn't exercise behavior).
- **Cooldown cache** (the pin is source-constant, not something to rediscover on failure).

These are the three load-bearing features `resolvePlatformBinary` was designed for. Applying it to whisper would be a category error — fit the tool to a problem that doesn't have those dimensions.

**Promotion rule updated:** extract on the **third PROBE-STYLE caller with fallback / liveness / cooldown needs**, not merely the third caller that touches `process.platform`. Whisper's pin-and-join does not count.

### Cost when promoted

~1 day:
- Extract `resolvePlatformBinary` to `src/main/utils/platformBinary.ts` with full unit tests
- Migrate git-status.worker.ts (preserve cooldown semantics via opts)
- Migrate DependencyDetector.ts
- Land the actual third probe-style caller

### Promotion criteria (revised)

**Mandatory** when **any** of these triggers:

1. A third **probe-style** caller appears — i.e. needs candidate-path discovery AND a fallback command AND (cooldown or liveness) — e.g. Phase 5 scanning for installed signtool across Visual Studio drops, or a future Pandoc / Tesseract / ImageMagick binary probe that isn't already handled by `DependencyDetector`.
2. Either of the two existing callers needs a non-trivial change (e.g. registry probe, allowlist mutation) — extracting first prevents the change from happening twice.
3. A new platform (linux ARM64, win32 ARM64) joins the matrix and adds probe-style resolution needs.

### Risks if forgotten

- LOW currently (only 2 divergent callers; Phase 4 did not add a third).
- HIGH only if a genuine third probe-style caller lands without extraction.

---

## D2 — Consolidate `MAX_FILENAME_LENGTH` constants

**Severity:** LOW (architecture-reviewer L1)
**Source:** Architecture — "MAX_FILENAME_LENGTH in three places with three values"
**Files:**
- `src/main/utils/validateFilename.ts:69` → `255` (filesystem byte/char limit)
- `src/main/services/DocxService.ts:97` → `200` (`.docx` extension headroom)
- `src/main/services/PdfService.ts:628` → `200` (`.pdf` extension headroom)

### What

Push the per-caller max-length through `deriveSafeFilename(name, fallback?, maxLength?)` so the truncation happens in **one** code path.

### Why deferred

- All three values are correct *for their context* (255 is the filesystem limit; 200 leaves headroom for extension + path-length budget on Windows).
- Current state works; no observable bug, no security implication.
- The `MAX_FILENAME_LENGTH = 200` in DocxService + PdfService is documented as "extension headroom" via comments — intent is preserved.

### Cost when promoted

~30 minutes:
- Add `maxLength?: number` parameter to `deriveSafeFilename`
- Update DocxService.sanitizeFilename + PdfService.getSavePath to pass `200` and remove their own truncation
- Delete the two `MAX_FILENAME_LENGTH = 200` private constants
- Update tests

### Promotion criteria

- A third service needs filename truncation (drift-prevention)
- Or `validateFilename`'s 255-char limit is changed (forces re-evaluation of the 200/200 constants anyway)

### Risks if forgotten

NIL — pure cleanup.

---

## D3 — Deduplicate `ExportLock` (Pdf + Docx)

**Severity:** LOW (architecture-reviewer L)
**Source:** Architecture — "`ExportLock` duplicated verbatim across PdfService + DocxService"
**Files:**
- `src/main/services/PdfService.ts:411-438`
- `src/main/services/DocxService.ts:20-48`

### What

Move `ExportLock` to `src/main/utils/Mutex.ts` (or similar). Both services import.

### Why deferred

- Pre-existing duplication, **not** introduced by Phase 2.
- Touching unrelated production code during a Windows-enablement series widens blast radius unnecessarily.
- Phase 4 will already touch service-layer code.

### Cost when promoted

~1 hour:
- Extract `Mutex` class with own tests (existing tests in PdfService/DocxService cover behavior)
- Replace both inline classes with imports
- Verify `npm run test:main` clean

### Promotion criteria

- A third service needs an export lock
- Or any non-trivial change to either ExportLock instance (drift becomes inevitable)

### Risks if forgotten

LOW — duplication is stable; both copies have stayed in sync.

---

## D4 — Structured-error IPC serialization (`AppError.code` propagation)

**Severity:** HIGH (solution-reviewer SR-001 / SR-002, architecture-reviewer M2)
**Source:** Solution + architecture — "Renderer depends on main-process error message shape"

### What

Today, Electron IPC strips custom properties from `Error` objects across the boundary. Only `Error.message` survives. The Phase 2 H3 fix added `INVALID_FILENAME_MARKER` as a shared-constant sentinel that both the thrower and the renderer detectors import — workable, but still string-based.

The **correct** long-term fix is structured-error serialization at the IPC layer. Approaches:

**Option A: handler-level wrapper** (smallest blast radius)

```typescript
// src/main/utils/ipcError.ts
export function serializeAppError(err: unknown): { message: string; code?: string; originalError?: string } {
  if (err instanceof AppError) {
    return { message: err.message, code: err.code, originalError: err.originalError?.message }
  }
  if (err instanceof Error) return { message: err.message }
  return { message: String(err) }
}
```
Wire into every `ipcMain.handle` catch block.

**Option B: middleware via a wrapper-handle helper**

```typescript
export function safeHandle<T>(channel: string, fn: (...args: any[]) => Promise<T>) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) } }
    catch (err) { return { ok: false, error: serializeAppError(err) } }
  })
}
```
Renderer always destructures `{ ok, data, error }`. **Breaking change** for ~50 IPC handlers.

### Why deferred

- Touches every IPC handler → cross-cutting refactor → broad regression surface.
- Today's marker-constant approach works correctly; the regression test pins behavior.
- Phase 6 already plans CI consolidation + Windows polish — natural batch.

### Cost when promoted

~2-3 days for Option A:
- New `serializeAppError` util + tests
- Audit ~50 IPC handlers, wire in catch blocks
- Renderer formatters switch from `message.includes(MARKER)` to `error.code === 'INVALID_FILENAME'`
- Retire `INVALID_FILENAME_MARKER` constant
- Update `useFileOperations.logic.ts` + `errorUtils.ts` formatters

~1 week for Option B (breaking handler API):
- All of A, plus envelope shape `{ ok, data, error }` for every IPC channel
- Renderer call sites updated everywhere

### Promotion criteria

- A second `AppError`-coded error class needs renderer-side discrimination (string-matching becomes a pattern, not a one-off — refactor cost is justified)
- i18n work begins (English-phrase matching breaks under translation)
- Or Phase 6 polish work — bundle with CI guard work

### Risks if forgotten

- MEDIUM — the marker-constant approach is brittle to message edits. The regression test catches the obvious failure mode but not subtle ones (e.g. inserting characters into the marker phrase).
- HIGH if i18n is added without first migrating to structured errors — would silently regress all existing message-based detectors (already-exists, not-found, EACCES handlers in `errorUtils.ts`).

---

## D5 — Log-redaction pass for filename PII

**Severity:** LOW (security-auditor)
**Source:** Security — "Error-message input echo"
**Files:**
- `src/main/utils/validateFilename.ts:assertValidUserFilename` — `name.slice(0, 37)` echoed into AppError
- `src/main/services/LoggingService.ts` (capture path)
- All `logger.error(..., err)` call sites that pass user-input-derived errors

### What

Audit log calls that propagate `AppError` objects derived from user input. Add a `[redacted-filename]` placeholder to logged forms while preserving the user-visible toast message.

### Why deferred

- LOW likelihood of sensitive content (passwords as filenames is unusual user behavior)
- LOW impact (logs are local-only by default; opt-in upload only via support workflow)
- Belongs in a broader log-redaction pass, not piecemeal per-error

### Cost when promoted

~1 day:
- Audit all `logger.error(...)` paths receiving `AppError` instances
- Add `redactUserInput(message, code)` helper that strips quoted user content for `INVALID_FILENAME` and similar user-input codes
- Test that user-visible toast is unaffected

### Promotion criteria

- Telemetry / crash reporting feature is added (logs leave the device)
- A privacy review or compliance audit demands it
- Or a single user reports a sensitive value showing up in their `~/.erfana/logs/`

### Risks if forgotten

- LOW under current "logs stay local" architecture
- MEDIUM if telemetry ships without this fix

---

## D6 — `DependencyDetector` cache TTL

**Severity:** LOW (security-auditor + solution-reviewer)
**Source:** Security + solution — "Cache is permanent for the session"
**File:** `src/main/services/import/DependencyDetector.ts:38-60` (`cachedResult` field + `detectDependencies` cache check)

### What

Today, `cachedResult` lives forever once set. If LibreOffice is uninstalled mid-session, import attempts still spawn `soffice`. Add a 5-minute TTL or invalidate on app focus.

### Why deferred

- Not a security issue (no privilege change; failure mode is "spawn fails" not "wrong code runs")
- UX impact bounded to "missing dependency modal appears one cycle late"
- Real users don't typically uninstall mid-session

### Cost when promoted

~30 minutes:
- Add `lastDetectedAt: number` field
- Check `Date.now() - lastDetectedAt > TTL_MS` before returning cache
- Optional: subscribe to BrowserWindow `focus` event to invalidate

### Promotion criteria

- A user reports stale "feature available" UX after uninstalling a dependency
- Or Phase 5 distribution work surfaces packaging changes (good batch target)

### Risks if forgotten

- NIL today
- LOW long-term

---

## D7 — Filename PII 40-char truncation review

**Severity:** LOW (security-auditor)
**Source:** Security
**File:** `src/main/utils/validateFilename.ts:215` (`name.slice(0, 37)`)

### What

The 40-char display name in error messages currently echoes user input verbatim. If a user pastes a path / token into the filename field, the first 37 chars surface in the toast and (transitively) in logs.

### Why deferred

Same rationale as D5 — bundle into the broader log-redaction pass.

### Cost when promoted

Bundled with D5 (~30 min within the D5 work).

### Promotion criteria

Promoted with D5.

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

## D12 — Rewrite remaining 5 `.skip()` tests in `WhisperModelManager.test.ts`

**Severity:** SHOULD-FIX (architecture-reviewer S4 + solution-reviewer I7 post-B1+B2 audit)
**Source:** Architecture / Solution — "5 skipped tests need tracking; `describe.skipIf(darwin)` hides entire ensureBinary suite on Windows/Linux CI"

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

## D8 — IPC serialization decision ADR

**Severity:** LOW (solution-reviewer SR-002)
**Source:** Solution — "AC drift from the plan; no ADR documenting the decision"

### What

The Phase 2 plan (#161 step 4) called for "IPC serialization verification" of `AppError.code`. Implementation chose the marker-constant workaround (D4 above describes the proper fix). This decision was made implicitly during execution — no ADR documents it.

### Why deferred

- D4 will retire the workaround entirely, making the ADR moot
- Documenting a workaround we plan to retire is wasted effort

### Cost when promoted

~30 minutes (only if D4 is itself deferred indefinitely):
- Write `docs/adrs/0001-ipc-error-marker-vs-structured.md` documenting:
  - The two options considered
  - Why marker-constant was chosen (smaller blast radius, preserves existing handler shape)
  - Promotion criteria for switching to structured errors (mirrors D4's criteria)

### Promotion criteria

- D4 is itself rejected or postponed past Phase 6
- Or a second renderer detector needs the same marker pattern (signaling the workaround is becoming a pattern)

### Risks if forgotten

- LOW today — implementation decision is captured in code comments
- MEDIUM if D4 is rejected and the marker pattern proliferates without explicit blessing

---

## Cross-cutting notes

### What is NOT in this list

- **Phase 1 manual UAT** — tracked under `#154`, separate from review findings
- **#158 v8 coverage race** — pre-existing, tracked separately, deferred to Phase 6
- **Phase 0–1 documentation drift** — already addressed in `docs/windows/implementation-plan.md` updates

### Triage cadence

Re-read this document at the start of:
- Phase 4 implementation (D1 + D2 + D3 trigger — note D1 amended 2026-04-21 so it does NOT trigger for Phase 4's whisper flow)
- Phase 5 implementation (D6 trigger)
- Phase 6 implementation (D4 + D5 + D7 + D11 + D12 trigger)
- Pre-0.9.4 PR merge (D12 promotion-criteria check)
- Any change to a file referenced above (re-evaluate the deferral)

### How to retire an item

When a deferred item ships:
1. Update its entry here with a "RESOLVED in `<commit-sha>`" note
2. Remove it from the index table
3. Cross-reference the resolution commit in the relevant phase tracking doc
