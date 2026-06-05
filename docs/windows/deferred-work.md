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

This ledger covers **D1-D8** (Phase 2 review aftermath). **D9-D12** (Phase 4 audit aftermath) live in the companion file [`deferred-work-phase4.md`](deferred-work-phase4.md).

| Phase | Items |
|---|---|
| **Phase 4** (whisper, OCP cleanup window) | ~~D1 `resolvePlatformBinary` extraction~~ (amended 2026-04-21 — whisper is not a probe-style caller; see D1 for revised promotion rule), D2 `MAX_FILENAME_LENGTH` consolidation, D3 `ExportLock` deduplication |
| **Phase 5** (distribution + signing) | D6 `DependencyDetector` cache TTL |
| **Phase 6** (polish + CI guard) | ~~D5 Log-redaction pass for filename PII~~ (✅ RESOLVED 2026-06-05, `feature/windows-phase-6-polish`), ~~D7 Filename PII 40-char truncation review~~ (✅ RESOLVED 2026-06-05, bundled with D5). D4 Structured-error IPC serialization — **promoted to its own ticket** ([#220](https://github.com/qodeca/erfana/issues/220)) (design review found it larger/riskier than the umbrella implied; still deferred, now the active D-item). **Phase 4 items**: see [`deferred-work-phase4.md`](deferred-work-phase4.md) for D11 (ISP split of `IWhisperModelManager`) and D12 (rewrite the 5 skipped `WhisperModelManager.test.ts` cases). |
| **Tracked-only** (no scheduled phase) | D8 IPC serialization ADR. **Phase 4 items**: see [`deferred-work-phase4.md`](deferred-work-phase4.md) for D9 (forensic-logging correlation ID) and D10 (`WhisperPlatform` tagged-union refactor, triggers when a 3rd platform lands). |

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
**Status:** ACTIVE deferred item (the now-promoted Phase 6 D-item). A 2026-06-05 design review (during `feature/windows-phase-6-polish`) found this larger and riskier than the umbrella implied and **moved it to its own ticket** ([#220](https://github.com/qodeca/erfana/issues/220)) rather than bundling it with the D5/D7 polish.

### 2026-06-05 design-review findings

- **Recommended transport is Option B (return-object), not a message-string prefix.** The 3 filename handlers (`createFile` / `createFolder` / `rename`) should **return** a structured `{ ok, data, error: { code } }` object instead of throwing — `invoke` resolves objects with their props intact, and the renderer reads `result.error.code`. A message-string prefix would just re-introduce a string sentinel (the very thing this item exists to retire). This narrows Option B's original "~50 handlers, breaking change" framing to the 3 filename handlers as the first slice.
- **`INVALID_FILENAME_MARKER` has a wider consumer list than the H3 fix suggested.** The marker is also used to *build the thrown message* in `validateFilename.ts:54,217` and is asserted by tests in `validateFilename.test.ts`. Full consumer list spans **~8 code files plus docs** (`docs/glossary.md`, `docs/error-codes.md`, `docs/windows/implementation-plan.md`, `phase2-closure.md`). Any retirement must update all of these in lockstep.

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

## D5 — Log-redaction pass for filename PII — ✅ RESOLVED 2026-06-05 (`feature/windows-phase-6-polish`)

**Resolution:** New `src/main/utils/redactUserInput.ts` strips filename PII from **log** messages for `ErrorCode.INVALID_FILENAME` at the `createFile` / `createFolder` / `rename` handlers; the user-facing toast keeps the full filename. Applied **at the call-site as an interim measure** (with a test guard), not yet centralized in `LoggingService`. **Follow-up trigger:** centralize in `LoggingService` before any telemetry / crash-reporting feature ships (logs leaving the device is the original promotion criterion). D7 is covered by this same redaction (see below).

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

## D7 — Filename PII 40-char truncation review — ✅ RESOLVED 2026-06-05 (`feature/windows-phase-6-polish`, bundled with D5)

**Resolution:** Reviewed — the 40-char toast truncation in `validateFilename.ts` is **intentional UX and stays**. The LOG-side PII concern that motivated this item is now covered by the D5 redaction (`redactUserInput.ts`), so D7 is considered resolved as part of D5.

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
- Phase 5 implementation (D6 trigger — `DependencyDetector` cache TTL)
- Phase 6 implementation (D4 + D5 + D7 trigger; see [`deferred-work-phase4.md`](deferred-work-phase4.md) for D11)
- Any change to a file referenced above (re-evaluate the deferral)

Historical triage points (no longer applicable):
- ~~Phase 4 implementation (D1 + D2 + D3 trigger)~~ — Phase 4 shipped in v0.9.4 without triggering D1/D2/D3 (D1 amended 2026-04-21, see entry; D2/D3 re-evaluate when a probe-style caller surfaces).
- ~~Pre-0.9.4 PR merge (D12 promotion-criteria check)~~ — D12 was resolved 2026-04-23 (`fb3365e`); see [`deferred-work-phase4.md`](deferred-work-phase4.md).

### How to retire an item

When a deferred item ships:
1. Update its entry here with a "RESOLVED in `<commit-sha>`" note
2. Remove it from the index table
3. Cross-reference the resolution commit in the relevant phase tracking doc
