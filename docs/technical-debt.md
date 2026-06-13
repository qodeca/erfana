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

### 3. BaseDialog lacks Tab-cycling focus trap

**Severity**: Low
**Impact**: Only TranscriptionDialog has proper Tab cycling; all other dialogs allow Tab to escape the dialog.

**Problem**: BaseDialog's comment says "Focus trap" but the code only auto-focuses the first element – it does NOT cycle Tab/Shift+Tab within the dialog. TranscriptionDialog implements its own `handleFocusTrap` to work around this.

**Recommended Solution**: Move TranscriptionDialog's Tab-cycling logic into BaseDialog so all dialogs benefit.

**Files**: `src/renderer/src/components/Dialog/BaseDialog.tsx`, `src/renderer/src/components/Transcription/TranscriptionDialog.tsx`

---

### 4. LanguageSelect missing `id` for label association

**Severity**: Low
**Impact**: `htmlFor="transcription-lang"` on the label references a non-existent `id` on `<select>`. Label click doesn't focus the select.

**Fix**: Add `id="transcription-lang"` to `<select>` in `LanguageSelect.tsx`.

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

**Files**: `.github/workflows/e2e.yml`, `e2e/fixtures.ts` (lines 355–360, 406–410), `e2e/visual-regression.e2e.ts`.

**Tracking**: see [docs/ci.md § E2E Tests (disabled)](./ci.md#e2e-tests-e2eyml-disabled) and [docs/known-issues.md § Visual regression E2E suite hangs on GitHub `macos-latest` CI](./known-issues.md#visual-regression-e2e-suite-hangs-on-github-macos-latest-ci).

---

### 6. Monaco cursor-blink flake in `third-party-components.e2e.ts`

**Severity**: Low
**Impact**: `third-party-components.e2e.ts:38` (Monaco keyboard test) fails first attempt ~10% of runs with `expect(cursor).toBeVisible() – received "hidden"`. Passes on retry #1 reliably; classified as flaky, not failing.

**Root cause**: Monaco's `.cursor` element blinks every 500ms by default. A 2s `toBeVisible` timeout can miss the visible half-cycle under CPU contention.

**Fix pattern exists in codebase**: `e2e/visual-regression.e2e.ts:45` `disableCursorBlink()` helper patches `cursorBlinking: 'solid'`. Apply the same helper to the third-party-components test.

**Files**: `e2e/pages/monaco.page.ts:29`, `e2e/third-party-components.e2e.ts:38`.

---

### 7. `docs/security.md` exceeds /doc-update soft cap (541 lines)

**Severity**: Low
**Impact**: `/doc-update` protocol prefers ≤500-line doc files; `security.md` sits 41 lines over.

**Problem**: Largest natural extraction candidate (`Release signing (v0.9.5+, #174)`, L490–L533) is structurally pinned. The pubkey block contains `<!-- minisign-pubkey-{primary,rotation}-{begin,end} -->` fence markers that are actively grepped by:

- `.github/workflows/checks.yml:214–241` — release-pubkey drift detector (a required `Release readiness guards` status check on `main`)
- `.claude/skills/releasing-erfana/phases/phase-4-verify.md:45` — operator-facing canonical-source note
- `README.md:156` — direct `#release-signing-v095-174` anchor

Moving the block would require synchronized edits to checks.yml + skill + README anchor. High blast-radius for cosmetic gain.

**Recommended Solution** (if cap-compliance is wanted later): extract the lower-risk `Test Builds (ERFANA_TEST_BUILD)` section (L134–L198, ~65 lines) to `docs/security/test-builds.md` instead. Single internal cross-ref at L24; no CI implications. Drops `security.md` to ~476 lines.

**Status**: Accepted constraint. Re-evaluate only if `security.md` grows further or if the CI drift detector is rewritten.

---

### 8. Renderer components exceed the 500-line guideline

**Severity**: Low — `MarkdownPreview.tsx` (~989 lines) and `ChatBubble.tsx` (~639 lines) exceed the 500-line-per-file guideline (pre-existing; out of scope for the issue #203 clipboard change). Candidates for a future decomposition pass.

---

### 9. TranscriptionDialog hardcodes `zIndex`

**Severity**: Low
**Impact**: `zIndex={10000}` is hardcoded on the TranscriptionDialog instance instead of going through the dialog-stack manager or the `var(--z-dialog)` design token. Diverges from the project's tokens-only rule for spacing/colors/typography and from the dialog stack's contract.

**Fix**: Replace the literal with the dialog-stack manager value, or with `var(--z-dialog)` if the dialog is not stack-managed.

**Files**: `src/renderer/src/components/Transcription/TranscriptionDialog.tsx`.

---

### 10. Language-select dropdown arrow hardcodes `background-size`

**Severity**: Low
**Impact**: `background-size: 12px` is hardcoded for the dropdown-arrow background image in `LanguageSelect`. The same literal exists in `Dialog.css`. Two places to keep in sync; no token covers it.

**Fix**: Extract the arrow background (image + size) to a shared utility class or design token so the size lives in one place.

**Files**: `src/renderer/src/components/Transcription/LanguageSelect.tsx`, `src/renderer/src/components/Dialog/Dialog.css`.

---

### 11. Project-lock honest-challenger stale-steal race (lens-review F3, 2026-06)

**Severity**: Low
**Origin**: Lens-review F3; project-lock heartbeat hardening Phase D

After the heartbeat hardening (Phase A4 resume-refresh, B1 symlink defense, D3 HMAC signing) the major lock-theft vectors are closed. The remaining surface: two healthy peer instances can still race between "this lock is heartbeat-stale" and "I just stole it" because file-locks alone have no OS-level handshake. Resolving requires either a named-pipe handshake or a lease-renewal protocol – out of scope for the enhancement branch. Note this is the *honest* (non-malicious) race; malicious forgery is now defeated by HMAC.

**Estimated effort:** 1–2 days
**Triggers reconsideration:** if telemetry shows double-open occurrences in the wild

---

### 12. Claude status bar — Windows v1 limitations ([#217](https://github.com/qodeca/erfana/issues/217), 2026-06)

**Severity**: Low
**Impact**: The Windows Claude Code context status bar works but carries three known v1 gaps (parity-limited vs the macOS detector).

- **Live cwd not resolved** — Windows v1 has no `lsof` analog wired, so the transcript dir is keyed off the panel's **spawn cwd**, not Claude's live cwd. If the user `cd`s to a different folder before launching `claude`, the bar hides.
- **Same-folder shared transcript** — two `claude` sessions in the same folder share the transcript dir (newest-wins selection); per-panel liveness stays independent.
- **Live-host verification partial** – single-panel detection on a real Windows host is verified (2026-06-13): the ConPTY parent-chain resolves, the bar shows, and the context-window badge tracks a mid-session `/model` switch (Opus 1M ↔ Sonnet 200k). The two-panel concurrent behavior (issue AC-4) still needs manual verification.

**Files**: `src/main/services/claudeStatus/process/WinClaudeProcessDetector.ts`, `src/main/services/claudeStatus/encodeCwd.ts`.

**Recommended next step**: wire a Windows live-cwd probe (e.g. `Get-Process | Select Path` or a handle/NtQueryInformationProcess approach) to close the spawn-cwd fallback gap; run the live-host two-panel UAT on a Windows 11 host.

---

## Code Quality Improvements

### Documentation Token Efficiency

Ongoing effort to keep `docs/` concise and high-value for Claude Code.

**Completed**:
- Archive outdated architectural-review/ ✅
- Condense logging.md (525 → 239 lines) ✅
- Condense terminal/README.md (code examples → tables) ✅
- Condense CHANGELOG.md (old versions compressed) ✅

**Remaining**:
- Consolidate troubleshooting files (troubleshooting.md + troubleshooting-advanced.md)
- Reduce code example verbosity across remaining files
- Evaluate inlining of small editor stubs — `docs/editor/{toolbar.md, scroll-sync.md, monaco-configuration.md}` (40/53/60 lines). Deferred from Sprint 3: external inbound refs to `scroll-sync.md` from `docs/archive/resolved-issues.md:70` and `docs/rendering/README.md:42` would require anchor repointing; benefit (single file) vs cost (README bloat + link-break risk) currently balanced. Promotion criteria: when touching editor docs for any other reason (Phase 3+ UI work), re-evaluate the consolidation cost.

**Note**: docs/future/ (8,604 lines) preserved for future graph-engine implementation.

---

## Resolved Issues

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

- [`windows/deferred-work.md`](./windows/deferred-work.md) — D1-D8 (Phase 2 review aftermath, tracked in [#168](https://github.com/qodeca/erfana/issues/168))
- [`windows/deferred-work-phase4.md`](./windows/deferred-work-phase4.md) — D9-D12 (Phase 4 audit aftermath; same issue)

Amendment discipline + promotion-rule conventions in [`windows/contributing.md`](./windows/contributing.md) §"Amendment discipline".

## Related Documentation

- [Known Issues](./known-issues.md) - Complete issue history with solutions
- [Troubleshooting](./troubleshooting.md) - Common problems and fixes
- [Architecture](./architecture.md) - System design and patterns
- [Testing](./testing/README.md) - Test coverage and strategies
- [ADRs](./adrs/README.md) - Architecture Decision Records (Phase 4: 0001 self-host whisper, 0002 minisign, 0003 dual-pubkey, 0004 TOCTOU close)

---

**Last Updated**: PR #245 (2026-06-13 – entry #12 live-verification updated: single-panel detection + mid-session model-switch verified on a Windows host) + #217 Windows Claude status bar (2026-06-10 — entry #12 added: Windows v1 detector limitations) + v0.14.0 doc sweep (2026-06-08 — entries #9 + #10 added from `Transcription/CLAUDE.md` eviction) + v0.9.6 release (2026-05-22 — critical macOS terminal fix `ea3eaf1`) + v0.9.5 release (2026-04-25) + Phase I branch protection refinement (PR requirement removed same day) + entry #7 documenting `security.md` cap constraint (2026-04-25)
