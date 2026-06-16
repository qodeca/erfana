# Contributing to Windows enablement

Workflow for contributors working on Windows parity (Phases 0–6). Environment setup lives in [`../build/windows.md`](../build/windows.md); this file is workflow only.

> **Fresh setup just works.** As of [#213](https://github.com/qodeca/erfana/issues/213), `git clone && npm ci` completes on a default-hardened Windows 11 box with no manual `node_modules` recovery. The committed `patches/node-pty+1.1.0.patch` (applied via `patch-package` in `postinstall`) fixes the two `node-pty` build failures that previously broke a clean install — see [`../build/windows.md` § node-pty build failures on Windows 11](../build/windows.md#node-pty-build-failures-on-windows-11). Do not hand-edit anything under `node_modules`; if you bump `node-pty`, regenerate the patch instead (procedure in [`../build/README.md`](../build/README.md#install-dependencies)).

---

## Which branch?

Phases 0–2 shipped in v0.9.3 on `develop` (2026-04-22); the historical `windows` integration branch was deleted after the merge. All remaining Windows work branches off `develop`:

| Situation | Branch |
|---|---|
| Phase 3–6 work | Fork from `develop`, name branch `feature/windows-phase-<N>-<slug>`, PR back to `develop` |
| Phase 0–2 bugfix follow-up | Fork from `develop`, name branch `fix/windows-<issue>-<slug>`, PR back to `develop` |

**Do not use git worktrees.** Use plain branches only – this project standardises on `git checkout -b` for all isolated work.

---

## Issue-first

Every Windows change lands under a tracked issue. Open issues live with label `windows`:

```bash
gh issue list --repo qodeca/erfana --label windows --state open
```

Phase umbrellas (filed post-Phase-2):

| Phase | Issue | Scope |
|---|---|---|
| Phase 3 | [#164](https://github.com/qodeca/erfana/issues/164) | Screenshot capture parity (`desktopCapturer`, area-select overlay) |
| Phase 4 | [#165](https://github.com/qodeca/erfana/issues/165) | Local Whisper Windows binary — **shipped v0.9.4** (`110f1b9`, 2026-04-23) |
| Phase 5 | [#166](https://github.com/qodeca/erfana/issues/166) | NSIS UX tweaks (`oneClick`, `perMachine`); auto-updater + Windows signing already shipped via #174 in v0.9.5 |
| Phase 6 | [#167](https://github.com/qodeca/erfana/issues/167) | Polish, Windows CI guard, visual baselines |
| Deferred | [#168](https://github.com/qodeca/erfana/issues/168) | D1–D8 deferred items from Phase 2 review |
| Security | [#169](https://github.com/qodeca/erfana/issues/169) | Dependabot triage — production `npm audit` clean as of v0.11.2 per CHANGELOG; issue closure pending re-verification |
| Reputation | [#177](https://github.com/qodeca/erfana/issues/177) | SmartScreen reputation monitoring during initial Azure Artifact Signing ramp |

Pick an issue (or open one) before cutting a branch. A one-line comment claiming the issue is enough – no assignment handshake required.

---

## Commit scope

Conventional Commits with `windows` as the scope when the change is Windows-specific:

```
feat(windows): add markerDetector handshake for cmd.exe
fix(windows): resolve long-path regression in DirectoryWatcherService
docs(windows): close Phase 2 status snapshot
```

Cross-platform refactors that happen to also fix a Windows path use the affected area's scope instead (e.g. `fix(terminal): ...`, `fix(main): ...`).

---

## Testing expectations

Windows-targeted CI is **Phase 6** ([#167](https://github.com/qodeca/erfana/issues/167)). Until it lands, running tests on Windows before opening a PR is the contributor's responsibility.

### Before every Windows PR

On a Windows host:

```bash
npm run typecheck
npm run test:main        # baseline drifts per release — see docs/testing/README.md for the current count
npm run test:renderer
npm run test:preload
```

If the PR touches platform-branched code (`process.platform === 'win32'`, `path.sep`, shell detection, etc.), also run on macOS:

```bash
npm run test:cov
npm run build:mac
```

Cross-platform workflow (stashing diffs, host switching) is documented in [`implementation-plan.md`](implementation-plan.md) § *Multi-session cross-platform workflow*.

### When `flakeGuard` fires in CI output

If you see `[flakeGuard:<scope>] UNHANDLED REJECTION:` or `UNCAUGHT EXCEPTION:` in stderr, **fix the source** – do not retry. `flakeGuard` has a near-zero false-positive rate; a firing is a real post-teardown leak (dangling timer, unresolved promise, unclosed watcher). Pattern: track the handle, cancel it on unmount, mirror the fix from [#159](https://github.com/qodeca/erfana/issues/159).

### Cross-platform path fixtures

Hardcoded `/tmp/...` or `/path/to/...` strings break Windows `PATH_TRAVERSAL` validation (see [#157](https://github.com/qodeca/erfana/issues/157)). Use:

```ts
import path from 'node:path'
import os from 'node:os'

const fixtureDir = path.join(os.tmpdir(), 'erfana-test', 'my-scope')
```

In **renderer** runtime code (not just fixtures), never derive a basename, dirname, or relative path with `filePath.split('/')` / `lastIndexOf('/')` — the main process passes native separators across IPC, so a path can contain `\` on Windows. Use the cross-platform helpers in [`src/renderer/src/utils/fileUtils.ts`](../../src/renderer/src/utils/fileUtils.ts) (`getBasename`, `getDirname`, `getDisplayRelativePath`, `isPathInside`, `isStrictDescendant`); a renderer-scoped ESLint `no-restricted-syntax` rule enforces this. These helpers are display/parse-only — filesystem confinement stays main-side in `ExternalFileService` via `realpath` ([#238](https://github.com/qodeca/erfana/issues/238)).

### Platform overrides in tests

Override `process.platform` per-test rather than gating the whole test with `describe.runIf`:

```ts
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})
```

`describe.runIf` gates on the *host* platform – which silently skips on macOS CI and hides regressions.

---

## Reviewer checklist (for Windows PRs)

- [ ] Issue linked and scope matches the phase
- [ ] Commit scope is `windows` (or area-specific with Windows mention in body)
- [ ] Platform-branched code has a test case per platform branch
- [ ] No hardcoded Unix paths in fixtures
- [ ] `flakeGuard` stderr lines are absent from test output
- [ ] Manual verification on both Windows 11 + macOS documented in PR body if the change touches platform-specific code

---

## Amendment discipline for deferred items

When a deferred-work item's promotion criteria are met (or demonstrably no longer apply), **amend the ledger entry rather than silently drop it**. The 2026-04-21 D1 update in [`deferred-work.md`](deferred-work.md) is the template: the item's original "third caller triggers promotion" rule was narrowed to "third probe-style caller" when Phase 4 (whisper) turned out not to be a probe-style caller. The entry stays in the ledger with a dated amendment note and revised promotion criteria.

**Why amendment-not-drop**:
- **Audit trail** — future reviewers asking "why didn't Phase 4 trigger D1?" find the answer inline instead of discovering the omission during a code audit.
- **Legitimises the design** — the amendment documents that we considered promotion and consciously rejected it with reasoning; silent drop reads as oversight.
- **Preserves promotion criteria** — the item isn't "done", it's "still valid under a narrower rule". A future probe-style caller (e.g. a second Pandoc / Tesseract detection) correctly re-triggers.

**How to amend**:

```markdown
### 2026-MM-DD amendment — <what changed>

<1-2 sentences explaining the real-world observation>

**Promotion rule updated:** <new rule text in one sentence>
```

Apply amendments to any D-entry where the original promotion criteria turn out to be either too narrow or too broad. Don't rewrite the original "Why deferred" / "Cost when promoted" sections — layer the amendment on top so the thread of reasoning is preserved.

---

## Test-file split policy

Default: **one test file per source file** matching the `<Source>.test.ts` pattern. This is the baseline used for ~95% of tests in the codebase.

**Split into a second file** when:

1. **Mock infrastructure diverges**. The existing file established a specific mocking layer (e.g. global `fetch`, a process-spawn helper) that the new tests cannot reuse without breaking the existing ones.
2. **The new tests target a code path the existing file hasn't covered** and the existing file is already large (>500 lines — the same cap as doc files).
3. **The split aligns with a code review boundary**. If the new tests are "regression tests for finding X from audit Y", keeping them in a named file (`<Source>.<concern>.test.ts`) aids future reviewer discoverability.

**Reference implementations**:
- `src/main/services/WhisperModelManager.downgrade.test.ts` sits alongside `WhisperModelManager.test.ts`. The older file uses `mockFetch` at global level (pre-Phase-4 code path); the new file mocks at `secureDownloader` + `verifyManifest` module boundaries. Merging would require rewriting either side, which wasn't the scope of the Phase 4 audit fix. The split is tracked as [D12 in `deferred-work-phase4.md`](deferred-work-phase4.md#d12--rewrite-remaining-5-skip-tests-in-whispermodelmanagertests).
- `src/main/services/FileService.copyItem.limit.test.ts` sits alongside `FileService.copyItem.test.ts`. The older file exercises real disk I/O via `mkdtemp`/`writeFile` in each test — appropriate for happy-path conflict resolution. The `.limit.test.ts` file mocks `fs/promises` at module level to test the `MAX_COPY_ATTEMPTS` safety guard without creating 1001 real files (25+ s on NTFS + Defender). Landed as part of the Windows flake remediation pool (#172).

**Naming**: `<Source>.test.ts` for baseline, `<Source>.<concern>.test.ts` for splits. The `<concern>` should be the narrowest label that makes the split obvious at `ls` time (`downgrade`, `limit`, `timeout`, `e2e`, etc.).

**Decision rule (added 2026-04-23 during flake remediation)**: split into a new file when the mock setup must hoist to module scope (e.g. `vi.mock('fs/promises')`, `vi.mock('node:crypto')`). Keep in-file when the fakes are per-describe-scoped (e.g. `vi.useFakeTimers()` inside one describe block) — splitting for per-describe fakes creates avoidable fragmentation.

---

## `src/main/utils/` tier rules

The `src/main/utils/` directory holds main-process-only helpers that:

- Are **pure or near-pure functions** (no Electron API dependencies, no IPC).
- Are **narrow in scope** (one responsibility per module; SRP).
- May have **1 direct external dependency** each (e.g. `tar`, `yauzl`, `@noble/ed25519`) plus transitives.
- Are **consumed by services in `src/main/services/`** — not directly by the renderer (that would go through IPC).

**Examples (Phase 4, B1)**:
- `zipArchive.ts` + `tarArchive.ts` — split by archive format (SRP); unified `archive.ts` was rejected because zip-slip and tar-slip validators differ.
- `secureDownloader.ts` — hostname allowlist, manual redirect, streaming SHA-256. Pure except for `fetch`.
- `verifyManifest.ts` — minisign Ed25519 verifier. Pure.

**Where NOT to put things**:
- Requires `app.getPath(...)` or `BrowserWindow` → belongs in `services/`.
- Wraps an IPC handler → belongs in `ipc/`.
- Shared between main + renderer → belongs in `src/shared/`.

When a new utility module is a real peer to one of these, add a short JSDoc header explaining what it's a peer of and why it's not inside the service it serves. `verifyManifest.ts` is a good example — it's a peer of `secureDownloader.ts`, not a method of `WhisperModelManager.ts`, because manifest verification is reusable outside the whisper flow.

---

## See also

- [`README.md`](README.md) – document map and status pointer
- [`implementation-plan.md`](implementation-plan.md) – canonical phase status, verification log, multi-session workflow
- [`gap-analysis.md`](gap-analysis.md) – B/M/m-rated inventory referenced by phase descriptions
- [`deferred-work.md`](deferred-work.md) – D1–D8 ledger (Phase 2 origin); [`deferred-work-phase4.md`](deferred-work-phase4.md) – D9–D12 ledger (Phase 4 origin). Amendment discipline in both files follows the template from this doc's "Amendment discipline" section.
- [`whisper-trust-chain.md`](whisper-trust-chain.md) – 4-layer architecture referenced by test-split reasoning
- [`whisper-support-runbook.md`](whisper-support-runbook.md) – operator playbook for Phase 4 error codes
- [`../build/windows.md`](../build/windows.md) – environment setup (Node 24, Python 3.12, VS 2022 Build Tools, Developer Mode, long paths)
- [`../adrs/README.md`](../adrs/README.md) – ADR index + format
- [Glossary](../glossary.md#windows-parity-phase-2) – Phase 2 terms (`flakeGuard`, `WindowsBootstrapBuilder`, `INVALID_FILENAME_MARKER`, …)
