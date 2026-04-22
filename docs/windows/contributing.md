# Contributing to Windows enablement

Workflow for contributors working on Windows parity (Phases 0–6). Environment setup lives in [`../build/windows.md`](../build/windows.md); this file is workflow only.

---

## Which branch?

| Situation | Branch |
|---|---|
| Phase 0–2 follow-ups, still on the `windows` integration branch | Fork from `windows`, PR back to `windows` |
| Phase 3–6 work, after `windows → develop` merges | Fork from `develop`, name branch `feature/windows-phase-<N>-<slug>`, PR to `develop` |
| Unsure whether `windows → develop` has merged yet | Check the merge-readiness gate in [`implementation-plan.md`](implementation-plan.md#status-snapshot-last-updated-2026-04-21-v092-base) |

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
| Phase 4 | [#165](https://github.com/qodeca/erfana/issues/165) | Local Whisper Windows binary |
| Phase 5 | [#166](https://github.com/qodeca/erfana/issues/166) | Auto-updater URL, code signing, NSIS tweaks |
| Phase 6 | [#167](https://github.com/qodeca/erfana/issues/167) | Polish, Windows CI guard, visual baselines |
| Deferred | [#168](https://github.com/qodeca/erfana/issues/168) | D1–D8 deferred items from Phase 2 review |
| Security | [#169](https://github.com/qodeca/erfana/issues/169) | Dependabot triage |

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
npm run test:main        # 243 files / ~7887 tests expected as of 2026-04-21 (Phase-2 UAT)
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

## See also

- [`README.md`](README.md) – document map and status pointer
- [`implementation-plan.md`](implementation-plan.md) – canonical phase status, verification log, multi-session workflow
- [`gap-analysis.md`](gap-analysis.md) – B/M/m-rated inventory referenced by phase descriptions
- [`../build/windows.md`](../build/windows.md) – environment setup (Node 24, Python 3.12, VS 2022 Build Tools, Developer Mode, long paths)
- [Glossary](../glossary.md#windows-parity-phase-2) – Phase 2 terms (`flakeGuard`, `WindowsBootstrapBuilder`, `INVALID_FILENAME_MARKER`, …)
