# Technical Debt

Concise summary of unresolved technical issues and improvement opportunities in Erfana.

## Active Issues

### 1. node-pty Build Failure on Python 3.13

**Severity**: Medium
**Impact**: Terminal functionality unavailable on Python 3.13+

**Problem**: node-pty dependency requires `distutils` module, removed in Python 3.13.

**Workaround**: Downgrade to Python 3.12 or earlier.

**Solution**: Wait for upstream node-pty update or contribute fix.

**Tracking**: https://github.com/microsoft/node-pty/issues

---

### 2. Template ID System Fragility

**Severity**: Low
**Impact**: Template name changes break code references

**Problem**: Template IDs are derived from slugified display names:

```typescript
// parser.ts
const id = slugify(result.data.name)  // "Mermaid Bug Report" → "mermaid-bug-report"
```

**Issues**:
- Changing template name breaks all code references
- Fragile coupling between display name and programmatic identifier
- No compile-time safety for ID references

**Example**:
```yaml
# Template frontmatter
---
name: Report Mermaid Error  # Slugifies to "report-mermaid-error"
---
```
```typescript
// Code reference
const config = PROMPT_REGISTRY['mermaid-bug-report']  // Returns undefined!
```

**Recommended Solution**:
1. Add explicit `id` field to frontmatter schema
2. Update parser to use explicit ID instead of slugify
3. Add uniqueness validation in registry
4. Migrate all existing templates (explain, improve, rewrite, simplify, mermaid-bug-report)
5. Remove slugify function

**Implementation Files**:
- `src/renderer/src/prompts/schema.ts` - Add `id` field to `PromptFrontmatterSchema`
- `src/renderer/src/prompts/parser.ts` - Use explicit ID
- `src/renderer/src/prompts/registry.ts` - Add uniqueness validation
- Template files in `resources/prompts/*.md` - Add `id` field

**Status**: Architecture review complete, implementation pending.

---

### 3. BaseDialog lacks Tab-cycling focus trap ✅ Resolved (#42)

Resolved – BaseDialog now owns the Tab trap behind the opt-in `trapFocus` prop, and the hand-rolled `handleFocusTrap` implementations in `DocumentImportDialog` and `TranscriptionDialog` were deleted. See [Resolved Issues](#resolved-issues). The number is kept so existing references to "item #3" stay valid.

---

### 4. LanguageSelect missing `id` for label association ✅ Resolved (#42)

Resolved – `LanguageSelect` accepts an optional `id` prop and renders it on the `<select>`; `TranscriptionDialog` passes `id="transcription-lang"`, matching the label's `htmlFor`. The prop's JSDoc records the naming rule: pass `id` when a visible `<label htmlFor=…>` supplies the accessible name, and the fallback `aria-label` applies only when no `id` is given, so the two never compete. See [Resolved Issues](#resolved-issues). The number is kept so existing references to "item #4" stay valid.

---

### 5. E2E workflow disabled on CI

**Severity**: Medium
**Impact**: The entire `e2e.yml` workflow is disabled (2026-04-25, commit `997ba65`). Neither the functional `electron` suite nor the 5 visual screenshot tests run on CI; both regression classes can merge undetected until a developer runs `npm run test:e2e` / `npm run test:e2e:visual` locally. E2E was already excluded from branch-protection required checks, so disabling does not block any merges or releases — but it removes a safety net.

**Problem**: The visual suite was the original blocker — all 5 tests time out at `page.waitForLoadState('domcontentloaded')` (30s) on GitHub `macos-latest` runners while passing 5/5 locally (including with `CI=true`). The earlier workaround scoped CI to `--project=electron` only, but the functional suite is also unstable on hosted runners; full disable is now the working state until the root cause is isolated.

**What's known about the visual hang**:
- Electron main process launches successfully on CI; `BrowserWindow` exists; resize succeeds
- Playwright `firstWindow()` returns a Page object
- The `domcontentloaded` lifecycle event never propagates; `recordVideo` is not the cause (local `CI=true` runs pass)

**Candidate root causes** (not isolated): GPU/renderer init hang on virtualized runners, `app.evaluate(resize)` → `firstWindow()` timing race, `--force-device-scale-factor=1` interaction.

**Recommended next step**: Fixture instrumentation – capture `document.readyState` and `app.getGPUInfo('basic')` before and after `waitForLoadState`, push once on a temporary re-enable (`gh workflow enable "E2E Tests"`), then form a targeted hypothesis. Re-disable until a fix is in.

**Files**: `.github/workflows/e2e.yml`, `e2e/fixtures/index.ts` — the two visual fixtures `visualWindow` and `visualWindowWithProject`, each of which calls `await window.waitForLoadState('domcontentloaded')` immediately after `firstWindow()` — and `e2e/visual-regression.e2e.ts`. (The `e2e/fixtures.ts` cited here until 2026-08-23 no longer exists: the visual fixture set was moved into `e2e/fixtures/index.ts` and the legacy re-export file was deleted, so its old line numbers pointed at nothing.)

**Tracking**: see [docs/ci.md § E2E Tests (disabled)](./ci.md#e2e-tests-e2eyml-disabled) and [docs/known-issues.md § Visual regression E2E suite hangs on GitHub `macos-latest` CI](./known-issues.md#visual-regression-e2e-suite-hangs-on-github-macos-latest-ci).

---

### 6. Monaco cursor-blink flake in `third-party-components.e2e.ts`

**Severity**: Low
**Impact**: `third-party-components.e2e.ts:38` (Monaco keyboard test) fails first attempt ~10% of runs with `expect(cursor).toBeVisible() – received "hidden"`. Passes on retry #1 reliably; classified as flaky, not failing.

**Root cause**: Monaco's `.cursor` element blinks every 500ms by default. A 2s `toBeVisible` timeout can miss the visible half-cycle under CPU contention.

**Fix pattern exists in codebase**: `e2e/visual-regression.e2e.ts:45` `disableCursorBlink()` helper patches `cursorBlinking: 'solid'`. Apply the same helper to the third-party-components test.

**Files**: `e2e/pages/monaco.page.ts:29`, `e2e/third-party-components.e2e.ts:38`.

---

### 7. `docs/security.md` exceeds /doc-update soft cap (661 lines)

**Severity**: Low
**Impact**: `/doc-update` protocol prefers ≤500-line doc files; `security.md` sits 161 lines over (661 lines, re-measured 2026-08-23; it was 626 at v0.17.0 and 541 when this item was filed).

**Problem**: Largest natural extraction candidate (`Release signing (v0.9.5+, #174)`, from L566 to the end of the file) is structurally pinned. The pubkey block contains `<!-- minisign-pubkey-{primary,rotation}-{begin,end} -->` fence markers that are actively grepped by:

- `.github/workflows/checks.yml` — release-pubkey drift detector: the `Guard - release pubkey drift across docs` step (Guard 5) of the `Release readiness guards` job. It runs on every push but is **not** a required status check on `main` — the required set is `Lint`, `Typecheck`, `Unit tests`, `Build`, `License compliance`, `Secret scan` and `Coverage`, per [`ci.md`](./ci.md)
- `.claude/skills/releasing-erfana/phases/phase-4-verify.md` § 4.3 Verify minisign signature — operator-facing canonical-source note
- `README.md` § Release verification — direct `#release-signing-v095-174` anchor into `docs/security.md`

(Citations de-numbered 2026-08-23: the two line references here had already drifted — Guard 5 sits at `:341–372` today, its step name at `:349`, not the `:298–330` / `:306` recorded when the item was filed. Section and step names are stable; line numbers in this item are not.)

Moving the block would require synchronized edits to checks.yml + skill + README anchor. High blast-radius for cosmetic gain.

**Recommended Solution** (if cap-compliance is wanted later): extract the lower-risk `Test Builds (ERFANA_TEST_BUILD)` section (~L138–L201, ~65 lines) to `docs/security/test-builds.md` instead. Single internal cross-ref at L24; no CI implications. That alone drops `security.md` to ~596 lines — still well over the cap, so cap-compliance now needs at least one further extraction.

**Status**: Re-opened 2026-08-08. The item was filed as an accepted constraint on the condition that it be revisited if `security.md` grew; it has, so the condition is spent. Decision needed: either extract two sections (Test Builds plus one more) to clear the cap, or record that the cap does not apply to this file and close the item.

---

### 8. Renderer components exceed the 500-line guideline

**Severity**: Low — `MarkdownPreview.tsx` (1,009 lines) and `ChatBubble.tsx` (641 lines) exceed the 500-line-per-file guideline (pre-existing; out of scope for the issue #203 clipboard change). Candidates for a future decomposition pass.

---

### 9. TranscriptionDialog hardcodes `zIndex`

**Severity**: Low
**Impact**: `zIndex={10000}` is hardcoded on the TranscriptionDialog instance instead of going through the dialog-stack manager or the `var(--z-dialog)` design token. Diverges from the project's tokens-only rule for spacing/colors/typography and from the dialog stack's contract.

**Fix**: Replace the literal with the dialog-stack manager value, or with `var(--z-dialog)` if the dialog is not stack-managed.

**Files**: `src/renderer/src/components/Transcription/TranscriptionDialog.tsx`.

---

### 10. Language-select dropdown arrow hardcodes `background-size`

**Severity**: Low
**Impact**: The chevron dropdown-arrow background (inline SVG data URI + `background-size: 12px`) is copied verbatim into **five** stylesheets. No token covers it, so restyling every `<select>` in the app means five synchronized edits.

**Fix**: Extract the arrow background (image + size) to a shared utility class or design token so the size lives in one place.

**Files** (re-verified 2026-08-08): `Settings/SettingsOverlay.css:171`, `DocumentImport/DocumentImportDialog.css:117`, `Transcription/TranscriptionDialog.css:71`, `Dialog/CameraDialog.css:54`, `Dialog/Dialog.css:555` — all under `src/renderer/src/components/`. Note `LanguageSelect.tsx`, named here originally, carries no such rule; the language select is styled by `TranscriptionDialog.css`. `SettingsOverlay.css:240` also sets `background-size: 12px` but for the checkbox tick, a different icon — out of scope for this item.

---

### 11. Project-lock honest-challenger stale-steal race (lens-review F3, 2026-06)

**Severity**: Low
**Origin**: Lens-review F3; project-lock heartbeat hardening Phase D

After the heartbeat hardening (Phase A4 resume-refresh, B1 symlink defense, D3 HMAC signing) the major lock-theft vectors are closed. The remaining surface: two healthy peer instances can still race between "this lock is heartbeat-stale" and "I just stole it" because file-locks alone have no OS-level handshake. Resolving requires either a named-pipe handshake or a lease-renewal protocol – out of scope for the enhancement branch. Note this is the *honest* (non-malicious) race; malicious forgery is now defeated by HMAC.

**Estimated effort:** 1–2 days
**Triggers reconsideration:** if telemetry shows double-open occurrences in the wild

---

### 12. Claude status bar — Windows v1 limitations (#217, 2026-06)

**Severity**: Low
**Impact**: The Windows Claude Code context status bar works but carries three known v1 gaps (parity-limited vs the macOS detector).

- **Live cwd not resolved** — Windows v1 has no `lsof` analog wired, so the transcript dir is keyed off the panel's **spawn cwd**, not Claude's live cwd. If the user `cd`s to a different folder before launching `claude`, the bar hides.
- **Same-folder shared transcript** — two `claude` sessions in the same folder share the transcript dir (newest-wins selection); per-panel liveness stays independent.
- **Live-host verification partial** – single-panel detection on a real Windows host is verified (2026-06-13): the ConPTY parent-chain resolves, the bar shows, and the context-window badge tracks a mid-session `/model` switch (Opus 1M ↔ Sonnet 200k). The two-panel concurrent behavior (issue AC-4) still needs manual verification.

**Files**: `src/main/services/claudeStatus/process/WinClaudeProcessDetector.ts`, `src/main/services/claudeStatus/encodeCwd.ts`.

**Recommended next step**: wire a Windows live-cwd probe (e.g. `Get-Process | Select Path` or a handle/NtQueryInformationProcess approach) to close the spawn-cwd fallback gap; run the live-host two-panel UAT on a Windows 11 host.

---

### 13. `scripts/fuses.js` exceeds the 500-line guideline (#43, 2026-08)

**Severity**: Low
**Impact**: `scripts/fuses.js` is ~1,715 lines against the project's ~500-line-per-file guidance; its suite `scripts/fuses.test.mjs` is ~1,758. (Both re-measured 2026-08-23; when this item was filed they were ~1,040 and ~835, so the seam has kept widening.)

**Problem**: The issue #43 packaging-allowlist work added a self-contained `Packaged-contents allowlist` block (~400 lines: `deriveAllowedAppEntries`, `assertConfigMatchesAllowlist`, `assertPackagedAppContents` and their helpers) to a file that already carried the fuse flip, the `spawn-helper` chmod, the two foreign-arch prunes and the media-binary staging.

**Recommended Solution**: extract the block to `scripts/packaging-allowlist.js` and split `fuses.test.mjs` along the same seam. The allowlist code has no dependency on the fuse / chmod / prune / media-cache code, with one exception: `resolvePackedResourcesDir` sits inside that block but has four call sites in `afterPack` — the prune step, the spawn-helper chmod, the media staging, and the allowlist assertion itself — so it has to stay in `fuses.js` (or be imported back). The advisory `Resources/`-inventory warning (`EXPECTED_RESOURCES_ENTRIES` and the check that reads it) should move with the block.

**Files**: `scripts/fuses.js`, `scripts/fuses.test.mjs`.

**Status**: Deferred from #43 — no behaviour change involved, so it can land whenever either file is next opened.

---

### 14. `js-yaml` pinned to the legacy 4.x line (lens-review, 2026-08)

**Severity**: Low
**Impact**: `js-yaml` is a shipped runtime dependency (renderer frontmatter + prompt parsers) currently at `^4.3.1`. The 4.x line is now the maintained *legacy* line; 5.x (latest 5.2.3) is the active branch.

**Problem**: `^4.3.1` is the correct floor for the current DoS advisories (it clears all three, including the `!!omap` one that 4.3.0 leaves open) and avoids a semver-major in a security patch. But future DoS-class fixes may land in 5.x first, and 5.x introduced schema changes (e.g. `YAML11_SCHEMA`) that a migration must account for.

**Recommended Solution**: evaluate a `js-yaml` 5.x migration — check the frontmatter (`frontmatterParser.ts`, uses `JSON_SCHEMA`) and prompt (`prompts/parser.ts`) parse paths against 5.x schema behaviour before bumping. Keep `^4.3.1` until then.

**Files**: `package.json`, `src/renderer/src/utils/frontmatterParser.ts`, `src/renderer/src/prompts/parser.ts`.

**Status**: Deferred — no current advisory affects 4.3.1; this is forward-looking hygiene.

---

### 15. `extraResources` full-sibling enumeration is advisory on Windows (#55, 2026-08)

**Severity**: Low
**Impact**: The issue #55 packaging guard `assertResourcesSiblingsAllowlist` (L2a-2) — the full Electron-owned sibling enumeration beside `app/` — is **fatal on macOS but advisory (`console.warn`) on Windows**. On win32 an unexpected sibling only warns; it cannot block a release.

**Problem**: `EXPECTED_RESOURCES_ENTRIES` (the Electron-owned names `app`/`app.asar`/`icon.icns`/`elevate.exe` plus the config slots) was enumerated on a **macOS-only** packed-tree baseline, and CI never runs an electron-builder pack on Windows (`windows-checks` runs only typecheck + `test:main`). Keeping the enumeration fatal on win32 would rest a release-blocking gate on an unverified baseline and risk a first-Windows-release false-fail. The softening touches **only** this enumeration; the config leak vector — `assertResourcesDestNoRepoLeak` (L2a-1, leak-name tripwire) and `assertExtraFilesDestNoRepoLeak` (L2b) — stays both-platforms-fatal.

**Recommended Solution**: capture a real Windows electron-builder packed-tree baseline, reconcile `EXPECTED_RESOURCES_ENTRIES` against it, then promote L2a-2 to fatal on win32.

**Files**: `scripts/fuses.js` (`assertResourcesSiblingsAllowlist`, `EXPECTED_RESOURCES_ENTRIES`), `scripts/fuses.test.mjs`.

**Tracking**: [#55](https://github.com/qodeca/erfana/issues/55). See [build/fuses.md § Extra-content destinations](./build/fuses.md#extra-content-destinations--extrafiles--extraresources-issue-55).

**Status**: Watch item — promote once a Windows packed-tree baseline exists.

---

### 16. `readRelevantText` allocation hygiene on the transcript read path (#47, 2026-08)

**Severity**: Low
**Impact**: `readRelevantText` runs on the main process ~once/second per Claude terminal. Two small, bounded allocations recur on that path.

**Problem**: The tail read does `Buffer.alloc(maxBytes)` (256 KB, or 2 MB on the bounded fallback), which zero-fills the whole buffer before `handle.read` overwrites only the bytes actually read; and it then materialises the window as two large strings (`buffer.toString(...)` followed by a `slice` past the first newline), the first of which is immediately garbage. Both are microsecond-scale and deliberately accepted (the `alloc` zero-fill is a stale-heap-safety choice noted in the code), but they are avoidable per-refresh GC pressure.

**Recommended Solution**: optionally switch to `Buffer.allocUnsafe` bounded by `bytesRead` (no byte past `bytesRead` is ever read), and find the first newline via `buffer.indexOf(0x0a, …)` to `toString` once instead of allocating an intermediate window string. No behaviour change.

**Files**: `src/main/services/claudeStatus/ClaudeTranscriptParser.ts` (`readRelevantText`).

**Status**: Deferred — flagged by the #47 change-set lens review as pre-existing, out of scope for the freeze fix.

---

### 17. `fallbackGuard` uses FIFO, not LRU, eviction (#47, 2026-08)

**Severity**: Low
**Impact**: The transcript fallback-read result cache (`fallbackGuard`) caps at 256 entries and evicts oldest-by-insertion. Re-keying an existing entry does not refresh its position, so eviction is FIFO-by-first-insert rather than LRU.

**Problem**: Past 256 distinct concurrent transcripts, a hot-but-early file can be evicted before a colder later one. The consequence is bounded — an evicted-but-live file pays one extra bounded (2 MB) fallback read next time — and 256 distinct live transcripts is unrealistic in practice, so this is a conscious accept, not a defect.

**Recommended Solution**: if LRU is ever wanted, `delete` then `set` the key on every record so re-keyed hot entries move to the tail. Not required for correctness.

**Files**: `src/main/services/claudeStatus/fallbackGuard.ts` (`record` helper).

**Status**: Deferred — conscious accept given the 256 cap; flagged by the #47 change-set lens review.

---

### 18. `useDragDropTree` exposes an API surface production no longer consumes (#60, 2026-08)

**Severity**: Low
**Impact**: Three of the hook's six returned members — `flattenedItems`, `getProjection`, `validateMove` — have no production consumer. `ProjectTree.tsx`, the hook's only production call site in the files examined, destructures `findNode`, `findNodeWithRoot` and `isDescendant` only; the other three are exercised by `useDragDropTree.test.ts` alone.

**Problem**: The #60 lookup work (deleting `enhancedFlattenedItems`, repointing six linear scans onto the Map-backed named lookups) left the positional members behind. `flattenedItems` is deliberately still returned — it is the flatten result the hook exists to produce, and its docblock warns against reading nodes out of it by path — but `getProjection` / `validateMove` are drag-projection helpers whose ProjectTree wiring predates the current dnd-kit collision handling. Keeping unconsumed members alive means every future change to the hook has to keep them correct against tests only, with no user-visible signal if they drift.

**Recommended Solution**: narrow the return type when #149/#150 next open `ProjectTree.tsx` — either re-wire the drag path onto `getProjection` / `validateMove` (they encode the root-safety and circular-move rules the inline handlers re-derive) or drop them and keep the module-level `getProjection` / `canMoveItem` exports for tests. Do **not** narrow it in isolation: the decision belongs with whoever touches the drag handlers.

**Files**: `src/renderer/src/hooks/useDragDropTree.ts` (return object), `src/renderer/src/components/ProjectTree/ProjectTree.tsx` (the `useDragDropTree` call site).

**Status**: Deferred to #149/#150 — recorded by the #60 change-set review.

---

### 19. `vitest.renderer.ts` coverage block sits outside `test` (inert) (#60, 2026-08)

**Severity**: Medium
**Impact**: The renderer project has **no enforced coverage thresholds**. `vitest.renderer.ts` declares `coverage` as a sibling of `test` rather than inside it, and vitest ignores a top-level `coverage` key — so the provider, the report directory, the exclude list and the `{ lines: 10, functions: 10, branches: 5, statements: 10 }` thresholds are all dead configuration.

**Problem**: Exactly the misplacement issue #55 F4 fixed for `vitest.main.ts`, which now carries the corrective comment above its `coverage` block. Until it is fixed for the renderer, any renderer coverage target — including the >80 % expectation on the #60 boundary components — is a review-time convention, not a gate.

**Recommended Solution**: move the block under `test:` (one indentation change), then re-measure before choosing thresholds — the current values were never enforced, so they may be either far below or above what the suite actually meets.

**Files**: `vitest.renderer.ts`. Reference fix: `vitest.main.ts`.

**Status**: Open — recorded by the #60 change-set review; also listed as a deferral in [`design/design-issue-60.md`](./design/design-issue-60.md) §8.

---

### 20. `npm run test:cov` runs the whole workspace three times (#60, 2026-08)

**Severity**: Low
**Impact**: `scripts/test-cov.mjs` invokes vitest once per project config (`vitest.main.ts`, `vitest.preload.ts`, `vitest.renderer.ts`) with `--coverage` but **without** `--project`. `vitest.workspace.ts` is auto-discovered from the repo root, so each invocation expands back to all three projects: the full suite runs three times for one coverage report, and each run's coverage is collected across projects rather than scoped to the config that requested it.

**Problem**: Slow locally, and it makes the per-file floors in `vitest.main.ts` (whisper trust chain, `scripts/fuses.js`, `modelId.ts`, `rendererCrashHandlers.ts`) behave differently on a developer machine than in CI. CI's Coverage job scopes with `--project main` — the reason that flag exists is recorded in a comment in `vitest.main.ts` — so the floors are effectively **CI-only** enforcement today.

**Recommended Solution**: pass `--project main|preload|renderer` on each of the three `run(...)` calls in `scripts/test-cov.mjs`, matching what checks.yml already does. Verify the per-file thresholds still fire afterwards.

**Files**: `scripts/test-cov.mjs` (the three `run(...)` calls), `vitest.workspace.ts`, `.github/workflows/checks.yml` (Coverage job).

**Status**: Open — recorded by the #60 change-set review. Derived from configuration, not from a timed run.

---

### 21. No tsconfig covers `e2e/` (#60, 2026-08)

**Severity**: Low
**Impact**: TypeScript errors in Playwright specs are **editor-only**. `npm run typecheck` runs `tsconfig.node.json` (`src/main`, `src/preload`, `src/shared`) and `tsconfig.web.json` (`src/renderer`, `src/preload/*.d.ts`); `tsconfig.test.json` covers `src/**` + `tests/**` + `vitest.*.ts` and is not wired into the script at all. `e2e/` appears in no `include` and is explicitly excluded from every vitest project, so nothing in CI ever type-checks it.

**Problem**: A spec, page object or fixture can be committed with a type error and stay green on every required check. Because `e2e.yml` is disabled (item #5), the error surfaces only when a developer runs the suite locally — and a *type* error surfaces even later than a behavioural one, since Playwright transpiles per file.

**Recommended Solution**: add a `tsconfig.e2e.json` (extending `tsconfig.json`, `include: ["e2e/**/*.ts", "playwright.config.ts"]`, `types: ["node"]`) and a `typecheck:e2e` script folded into `typecheck`. Cheap, and it costs no CI minutes beyond one `tsc` pass.

**Files**: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `tsconfig.test.json`, `package.json` (`typecheck` scripts), `e2e/`.

**Status**: Open — recorded by the #60 change-set review.

---

### 22. Shared renderer HTML entry keeps a whole family of CSS-leak guards alive (#60, 2026-08)

**Severity**: Low
**Impact**: The app window and the screenshot-overlay window share one entry, `src/renderer/index.html`, so any globally-scoped rule in a statically imported stylesheet reaches both. The overlay once inherited a crosshair cursor this way. Four guards exist purely to hold that line: `main.import-isolation.test.ts` (no app CSS imported on the overlay branch), `RootErrorBoundary.css.test.ts` (allowlist: every top-level selector must start with `.root-error`), the `.panel-error` prefix allowlist for `Panels/PanelErrorBoundary.css` — which has **no** stylesheet test file of its own and is instead bolted onto `RootErrorBoundary.contrast.test.ts` (the `scopes every PanelErrorBoundary.css selector to .panel-error` case in its `stylesheet shape` block) — and the standing rule that `src/renderer/src/index.css` must not gain a background rule (`design-issue-60` §2.5).

**Problem**: Every new full-window surface has to re-derive the constraint and, in practice, ship its own allowlist test. The guards are cheap individually and unbounded collectively. The fourth guard **is that prediction happening**: the second crash surface needed the same allowlist, and because a whole test file per stylesheet was too much ceremony it was grafted onto a neighbouring suite instead — so the guard family is now growing sideways as well as in number, and the `.panel-error` rule lives in a file whose name does not mention it.

**Recommended Solution**: give the overlay its own HTML entry, mirroring the existing preload split (`src/preload/screenshotOverlay.ts`). The two windows then have genuinely separate stylesheet graphs and the allowlist tests can be retired rather than multiplied.

**Files**: `src/renderer/index.html`, `electron.vite.config.ts`, `src/main/services/screenshot/ScreenshotOverlayWindow.ts`, `src/renderer/src/main.tsx`, the four guards above (three test files: `main.import-isolation.test.ts`, `RootErrorBoundary.css.test.ts`, `RootErrorBoundary.contrast.test.ts`).

**Status**: Deferred — build-config housekeeping; also listed in [`design/design-issue-60.md`](./design/design-issue-60.md) §8 with the allowlist as the interim control.

---

### 23. `ThrottledWorker.workMany` carries the same spread-push pattern #60 fixed (#60, 2026-08)

**Severity**: Low
**Impact**: `this.buffer.push(...items)` in `ThrottledWorker.workMany` is `Function.prototype.apply` under the hood — the exact construct that threw `RangeError: Maximum call stack size exceeded` in `flattenTree` on a 174k-node project. A single `workMany` call with ~10^5 items would throw inside the watcher pipeline.

**Problem**: Latent only: `workMany` was verified to have **no production callers** (two test call sites). Production feeds the buffer one event at a time through `work(item)`, which is unaffected. It becomes real the moment someone batches watcher events — which is a plausible thing to do for exactly the large-project scenario #60 came from.

**Recommended Solution**: replace with a bounded loop (`for (const item of items) this.buffer.push(item)`) — same semantics, no argument-count exposure — or delete `workMany` if it is still unused when the watcher is next opened.

**Files**: `src/main/services/watcher/ThrottledWorker.ts` (`workMany`).

**Status**: Deferred — no production caller; recorded as a follow-up note on #60 (§8 of the design).

---

### 24. `FileWatcherService.watchFile` confinement check is text-only and unresolved (#70, 2026-08)

**Severity**: Medium — it is a main-process security boundary, though a notification-only one.

**Impact**: `watchFile` gates on `filePath.startsWith(this.projectPath)` (`FileWatcherService.ts:112`) — no `path.resolve`, no trailing separator, and no `fs.realpath`. It is wrong in both directions: `/proj-evil/x.png` **passes** when the project is `/proj` (prefix match without a separator), and `/proj/../p2/x.png` fails closed. The read handlers next to it (`file:readFile`, `file:readImage`) went through `assertInsideProject` in #70 and now do the two-stage lexical + canonical check.

**Why it was left alone in #70**: it is a shared boundary used by every watcher consumer and deserves its own tests and review pass rather than a drive-by edit inside a bugfix. The exposure is bounded — watching is a notification side channel, the *content* read behind it goes through the stricter guard, and the atomic re-arm path already re-validates the path with `classifyConfinement` before rebuilding a watcher (`watcher/atomicRearm.ts` → `AtomicRearmDeps.isPathConfined`).

**Recommended Solution**: route `watchFile` through `assertInsideProject` from `src/main/utils/projectConfinement.ts`, keeping the existing "file does not exist" throw (the guard lets a `missing` verdict through on purpose).

**Files**: `src/main/services/FileWatcherService.ts` (`watchFile`), `src/main/utils/projectConfinement.ts`.

**Status**: Open — recorded by the #70 design (§9.1) and its review rounds. **A follow-up issue should be filed.**

---

### 25. `file:getStats` is exempt from project confinement (#70, 2026-08)

**Severity**: Low

**Impact**: `file:getStats` is guarded by `assertNoConfinementEscape`, not `assertInsideProject`: a path that was never in the project is served, and only a path that *looks* in-project while canonically resolving out of it is refused. Every other read channel is fully confined.

**Problem**: The carve-out is load-bearing, not an oversight. The external-file import shortcut (spec #012, `ProjectTree.handleImportShortcut`) stats the paths the user picked in the native file dialog, and those are outside the project by definition — confining the channel would break that flow. The weaker guard still closes the part #70 needed: the watcher's automatic re-stat of a watched, in-project path cannot be redirected through a symlink.

**Recommended Solution** (the clean fix): have `file:selectExternalFiles` return sizes alongside paths, so `ProjectTree` never stats an external path at all. `file:getStats` can then be confined with `assertInsideProject` like the other read handlers and the carve-out disappears rather than being documented forever.

**Files**: `src/main/ipc/file-handlers.ts` (`file:getStats`), `src/main/utils/projectConfinement.ts` (`assertNoConfinementEscape`), `src/main/ipc/external-file-handlers.ts` (`file:selectExternalFiles`), `src/renderer/src/components/ProjectTree/ProjectTree.tsx`.

**Status**: Open — recorded by the #70 security review. See [API Services § Path confinement](./api-services.md#path-confinement-for-the-file-read-ipc-handlers).

---

### 26. Files over the 500-line guideline after #70 (2026-08)

**Severity**: Low

The policy as practised: *a file a change adds behaviour to must come in under 500 lines; a file only read, moved unchanged, or trivially touched keeps its pre-existing debt and is waived.* Line counts re-measured 2026-08-23; only `file-handlers.ts` has moved since the #70 measurement (601 → 626).

| File | Lines | Why it is waived |
|---|---|---|
| `src/renderer/src/components/Panels/TerminalPanel.tsx` | 1,352 | Pre-existing; #70 only shrinks it (the panel router replaced its inline open logic) |
| `src/renderer/src/components/Panels/ImageViewerPanel/imageViewer.logic.test.ts` | 693 | Moved unchanged by `git mv`; not a line was edited |
| `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx` | 614 | Pre-existing; untouched except by the optional router commit |
| `src/main/ipc/file-handlers.ts` | 626 | Pre-existing; **grew by 4 lines** in #70 to 601 (the `projectConfinement` import plus two `assert*` calls) and has since reached 626. Adding a security guard to an over-cap file was accepted rather than blocking the fix on a refactor |
| `src/renderer/src/components/Panels/ImageViewerPanel/imageViewer.logic.ts` | 539 | Moved unchanged by `git mv` |

`FileWatcherService.ts` deliberately stayed under the cap (498 lines) by moving the watch factory, the unlink branch, the send loop and the subscriber counting into `src/main/services/watcher/`.

**Recommended Solution**: `file-handlers.ts` is the one to split first, since it is the only entry actively gaining code — the project/file/stat/CRUD handler groups are independent. The two `imageViewer.logic*` files are candidates for the next pass that genuinely changes them.

**Status**: Accepted for #70; recorded so the next change to any of these files does not re-litigate it.

---

### 27. A genuine delete does not re-arm the watch (#70, 2026-08)

**Severity**: Low

**Impact**: After a real delete, `FileWatcherService` drops the map entry. Restoring the file more than ~100 ms later does **not** resume auto-refresh — the tab keeps showing the last version it loaded until the user presses **Reload**.

**Problem**: The 100 ms atomic-save window is a bound, not a guarantee. A tool that waits longer than that between `unlink` and `rename` is classified as a delete. Re-arming a genuine delete needs a directory-level watch on the parent, which is a different design from a 1 watcher : 1 path service.

**Mitigation shipped**: the renderer re-checks existence via `file:getStats` before it shows the "deleted" banner, so a slow temp-then-rename recovers silently instead of showing a false banner; and the banner carries a **Reload** button, so the UI never claims freshness it does not have.

**Files**: `src/main/services/watcher/atomicRearm.ts`, `src/renderer/src/hooks/useFileChangeSubscription.ts`.

**Status**: Accepted, with the escape hatch in the UI. See [File Watching § Single-file watch internals](./file-watching/README.md#single-file-watch-internals-70).

---

### 28. `useFileWatcher.reloadFromDisk` does not clear its indicator timer on unmount (#70, 2026-08)

**Severity**: Low

**Impact**: The editor hook sets a 1000 ms "Reloaded from disk" timer and never clears it on unmount. Benign under React 18 (the state update on an unmounted component is a no-op, not a warning), but it is a post-teardown timer of exactly the class `flakeGuard` exists to catch.

**Recommended Solution**: mirror what `useFileChangeSubscription` already does — hold the timeout in a ref and clear it in the effect cleanup. One-line alignment when the editor hook is next opened.

**Files**: `src/renderer/src/hooks/useFileWatcher.ts` (`reloadFromDisk`). Reference implementation: `src/renderer/src/hooks/useFileChangeSubscription.ts`.

**Status**: Deferred — recorded by the #70 review.

---

### 29. `IMAGE_EXTENSIONS` is duplicated across the process boundary (#70, 2026-08)

**Severity**: Low

**Impact**: The list of supported image extensions exists twice — `src/main/services/file/imageRead.ts` (8 entries, used to gate `readImage`) and `src/renderer/src/utils/imageUtils.ts:27` (the same 8 entries, used to decide which panel a file opens in). They are identical today, and the main-process copy even carries a comment saying it "Matches IMAGE_EXTENSIONS in renderer/src/utils/imageUtils.ts" — a comment is the only thing holding them together.

**Problem**: Adding a format on one side only produces a silent asymmetry: a file the renderer routes to the image viewer that the main process then refuses to read, or the reverse.

**Recommended Solution**: move the list to `src/shared/` and import it from both sides, as `DEFAULT_TREE_HIDDEN_PATTERNS` already does for `FileService`. The MIME map beside it can stay main-side.

**Files**: `src/main/services/FileService.ts`, `src/renderer/src/utils/imageUtils.ts`, `src/shared/constants.ts`.

**Status**: Deferred — recorded by the #70 design (§9.5).

---

### 30. Smaller accepted trade-offs from #70 (2026-08)

**Severity**: Low. Recorded so none of them is later filed as a bug.

- **One panel per path *string*.** `sanitizeFilePath` hashes the raw string, so on a case-insensitive volume `/proj/Icon.svg` and `/proj/icon.svg` still open two panels. Harmless now that watches are subscriber-counted — the second panel gets its own subscription and neither can deafen the other.
- **No way to open an image file as text.** Once file opens route through `utils/openFileInPanel.ts`, an SVG always opens in the viewer. Hand-editing an SVG beside an agent is plausible, so a context-menu "Open as text" is worth a follow-up issue; it becomes a prerequisite if the Markdown-preview link path is migrated to the router as well.
- **Two visual artefacts on refresh.** The degraded-state banner mounts above the content, so it pushes the image down and the `ResizeObserver` refires in fit mode (a second, small jump); and an animated GIF restarts from frame 0 when the source object is replaced.
- **No visual-regression coverage for the new surfaces.** The status slot and the banner are transient states; baselines would flake. Descoped deliberately.
- **The end-to-end proof of the fix has no CI gate.** `e2e/preview-refresh.e2e.ts` and `e2e/preview-refresh-terminal.e2e.ts` only run locally (item #5 above). The atomic-replace case is covered deterministically on CI by two main-process suites instead — `FileWatcherService.atomicSave.test.ts` (mocked) and `watcher/singleFileWatch.rename.integration.test.ts` (real chokidar, real rename).

**Status**: Accepted; recorded by the #70 design (§9) and its review rounds.

---

## Code Quality Improvements

### Documentation Token Efficiency

Ongoing effort to keep `docs/` concise and high-value for Claude Code.

**Completed**:
- Archive outdated architectural-review/ ✅
- Condense logging.md (525 → 239 lines) ✅
- Condense terminal/README.md (code examples → tables) ✅
- Condense CHANGELOG.md (old versions compressed) ✅
- Inline the small editor stubs (2026-08-23) ✅ – `docs/editor/{toolbar.md, scroll-sync.md, monaco-configuration.md}` were merged into `docs/editor/README.md` (§ Monaco configuration, § Scroll synchronization, § Formatting toolbar) and deleted; both inbound refs – `docs/rendering/README.md` and `docs/archive/resolved-issues.md` – now point at `../editor/README.md#scroll-synchronization`

**Remaining**:
- Consolidate troubleshooting files (troubleshooting.md + troubleshooting-advanced.md)
- Reduce code example verbosity across remaining files

**Note**: docs/future/ (8,604 lines) preserved for future graph-engine implementation.

---

## Resolved Issues

- ✅ LanguageSelect missing `id` for label association (#42) – optional `id` prop on `LanguageSelect`, passed as `id="transcription-lang"` by `TranscriptionDialog`, so clicking the label focuses the select
- ✅ BaseDialog lacks Tab-cycling focus trap (#42) – Tab cycling, escaped-focus recovery and a `focusout` rescue for controls that become disabled now live in BaseDialog behind the opt-in `trapFocus` prop; the per-dialog `handleFocusTrap` copies were removed
- ✅ Worker thread statusCache crash (v0.9.2) – persistent isomorphic-git cache caused V8 cppgc assertion after ~42 min; replaced with per-call cache
- ✅ Git status main-thread blocking (v0.9.0, #147) – offloaded to worker_threads with native git fallback
- ✅ EMFILE cascade in DirectoryWatcherService (v0.9.0, #146) – restart logic + RateLimitedLogger
- ✅ Terminal Scroll Jump (v0.3.1)
- ✅ Terminal Flickering (v0.3.2)
- ✅ EPIPE Errors (v0.4.0)
- ✅ Panel Resizing (v0.1.0)
- ✅ Monaco Editor CDN Loading
- ✅ Scroll Synchronization (v0.3.0)
- ✅ Plain Code Block Rendering (v0.3.0)

---

## Future Enhancements

### Graph Engine (Planned)

**Status**: Research complete, implementation pending

**Overview**: SQLite-based knowledge graph with hybrid search for markdown documents.

**Documentation**: See [docs/future/graph-engine.md](./future/graph-engine.md) for complete design.

**Key Features**:
- Full-text search with FTS5
- Vector embeddings for semantic search
- Graph relationships between documents
- Tag and metadata indexing

**Priority**: High (killer feature for future version)

---

## Deferred-work ledgers (Windows)

This doc covers project-wide non-Windows technical debt. For phase-structured deferred items with promotion criteria + risk-if-forgotten:

- [`windows/deferred-work.md`](./windows/deferred-work.md) — D1-D8 (Phase 2 review aftermath, tracked in #168)
- [`windows/deferred-work-phase4.md`](./windows/deferred-work-phase4.md) — D9-D12 (Phase 4 audit aftermath; same issue)

Amendment discipline + promotion-rule conventions in [`windows/contributing.md`](./windows/contributing.md) §"Amendment discipline".

## Related Documentation

- [Known Issues](./known-issues.md) - Complete issue history with solutions
- [Troubleshooting](./troubleshooting.md) - Common problems and fixes
- [Architecture](./architecture.md) - System design and patterns
- [Testing](./testing/README.md) - Test coverage and strategies
- [ADRs](./adrs/README.md) - Architecture Decision Records (Phase 4: 0001 self-host whisper, 0002 minisign, 0003 dual-pubkey, 0004 TOCTOU close)

---

**Last Updated**: doc-sweep follow-up (2026-08-23 – the editor-stub inlining moved from *Remaining* to *Completed* under Documentation Token Efficiency, verified on disk: the three stubs are gone, their content is in `docs/editor/README.md`, and both inbound refs are repointed; entry #7's `checks.yml`, release-skill and `README.md` citations converted from line numbers to section/step names after the checks.yml numbers were found stale) + doc-accuracy sweep (2026-08-23 – entry #5 repointed from the deleted `e2e/fixtures.ts` to `e2e/fixtures/index.ts` and its dead line ranges replaced with fixture names; entries #7, #13 and #26 re-measured: `security.md` 626 → 661, `scripts/fuses.js` ~1,040 → ~1,715, `scripts/fuses.test.mjs` ~835 → ~1,758, `file-handlers.ts` 601 → 626) + #70 stale preview tabs (2026-08-23 – entries #24–#30 added from the design's accepted-debt ledger and the review rounds: text-only `watchFile` confinement, the `file:getStats` carve-out and its clean fix, the post-#70 over-cap file measurements, genuine deletes not re-arming, the `useFileWatcher` indicator timer, duplicated `IMAGE_EXTENSIONS`, and five smaller accepted trade-offs) + #60 large-project crash + error containment (2026-08-11 – entries #18–#23 added from the change-set reviews: dead `useDragDropTree` API surface, inert `vitest.renderer.ts` coverage block, `test:cov` workspace fan-out, no tsconfig over `e2e/`, shared renderer HTML entry, `ThrottledWorker.workMany` spread-push) + #55 extra-content packaging guards (2026-08-09 – entry #14 added: `assertResourcesSiblingsAllowlist` advisory-on-Windows watch item) + #43 packaging allowlist QG-11a remediation (2026-08-09 – entry #13 added: `scripts/fuses.js` size after the allowlist block; `resolvePackedResourcesDir` call-site count corrected to four) + v0.17.0 doc sweep (2026-08-08 – entry #4 resolved: `LanguageSelect` `id` prop; entries #7, #8, #10 re-measured against the v0.17.0 tree) + #42 camera mirror + dialog focus work (2026-08-07 – entry #3 resolved: BaseDialog `trapFocus`) + PR #245 (2026-06-13 – entry #12 live-verification updated: single-panel detection + mid-session model-switch verified on a Windows host) + #217 Windows Claude status bar (2026-06-10 — entry #12 added: Windows v1 detector limitations) + v0.14.0 doc sweep (2026-06-08 — entries #9 + #10 added from `Transcription/CLAUDE.md` eviction) + v0.9.6 release (2026-05-22 — critical macOS terminal fix `ea3eaf1`) + v0.9.5 release (2026-04-25) + Phase I branch protection refinement (PR requirement removed same day) + entry #7 documenting `security.md` cap constraint (2026-04-25)
