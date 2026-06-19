# Continuous integration

Erfana runs GitHub Actions workflows on pushes. The author-controlled workflows are listed below; vendor-installed workflows (Dependabot, Copilot review, Security Risk Assessment) are managed by their respective GitHub Apps and not covered here.

| Workflow | File | Status | Trigger | Runner | Wall-clock | Purpose |
|----------|------|--------|---------|--------|-----------|---------|
| Quality Checks | `.github/workflows/checks.yml` | active | push to **any branch** | `ubuntu-latest` | ~3 min | Fast feedback on lint / types / unit tests / build / licensing (see job table below) |
| Secret Scan | `.github/workflows/secret-scan.yml` | active (**required check**) | push + PR | `ubuntu-latest` | ~1 min | gitleaks (full git history) + trufflehog (verified secrets only). Version-pinned, SHA-256-checksum-verified binary downloads; no third-party actions |
| E2E Tests | `.github/workflows/e2e.yml` | **disabled** (2026-04-25) | (would be: push to `develop` + PRs) | `macos-latest` | ~5–8 min | Electron integration tests (Playwright) — see [E2E Tests (disabled)](#e2e-tests-e2eyml-disabled) below |
| Release | `.github/workflows/release.yml` | active | tag push `v*.*.*` | matrix (mac/win) | ~15–25 min | Multi-platform release build → `prepare`/`build_*`/`finalize`/`cleanup` (calls `build_mac.yml`, `build_win.yml` reusables; Linux distribution target dropped) |
| Whisper Binaries | `.github/workflows/whisper-binaries.yml` | active | `workflow_dispatch` only | `macos-14` + `windows-latest` | ~25 min | Self-hosted whisper.cpp build, sign, notarize, publish (see [`build/whisper-binaries.md`](./build/whisper-binaries.md)) |
| Whisper Binaries (Canary) | `.github/workflows/whisper-binaries-canary.yml` | active | monthly schedule | `macos-14` | ~3 min | Credential-health check (Apple notarization, Windows signing) |
| Claude Code Review | `.github/workflows/claude-code-review.yml` | active (allows `dependabot`) | `pull_request` opened/synchronize | `ubuntu-latest` | ~1 min | Auto-review on every PR; **non-blocking** (not in branch-protection required checks). `allowed_bots: 'dependabot'` since [#192](https://github.com/qodeca/erfana/pull/192) so Dependabot PRs get a real pass/fail instead of "non-human actor" abort |
| Claude Code (interactive) | `.github/workflows/claude.yml` | active | `@claude` mention on issue/PR comment | `ubuntu-latest` | varies | Interactive code agent for follow-up commits and review-comment threads |

Node 24, `actions/setup-node@v4` with `cache: npm`, `permissions: contents: read`.

## Quality checks (`checks.yml`)

Eight jobs run in parallel (all `ubuntu-latest` except `windows-checks`). The **Required check?** column reflects the live branch-protection required set on `main`; the separate `Secret scan` workflow (above) is the sixth required check.

| Job (`name:`) | Command | Required check? | Notes |
|-----|---------|:---:|-------|
| `lint` (Lint) | `npm run lint` | yes | |
| `typecheck` (Typecheck) | `npm run typecheck` | yes | tsc node + web |
| `test` (Unit tests) | `npm run test:ci` | yes | full vitest workspace (main / renderer / preload) |
| `build` (Build) | `npx electron-vite build` | yes | |
| `license` (License compliance) | `npm run check:headers` + `pipx run reuse lint` | yes | SPDX headers on all sources + REUSE conformance |
| `audit-signatures` (npm audit signatures) | `npm audit signatures` | no | also records the `package-lock.json` digest artifact that `release.yml` byte-verifies at tag time |
| `release-guards` (Release readiness guards) | guard scripts | no | fails the build on a `pull_request_target` trigger, forbidden plist entitlements, etc. |
| `windows-checks` (Windows checks) | `npm run typecheck` + `npm run test:main` on `windows-latest` | no | advisory Windows gate; excluded from the required set until proven stable |

**Required status checks on `main`** (six): `Lint`, `Typecheck`, `Unit tests`, `Build`, `License compliance` (from `checks.yml`), and `Secret scan` (from `secret-scan.yml`). `npm audit signatures`, `Release readiness guards`, and `Windows checks` run on every push but are not required to merge.

**Design notes**:
- **`on: push:` only** (not `pull_request`). Same-repo PRs already trigger a push event on their source branch; adding `pull_request` would double-run the same SHA.
- **ubuntu-latest** — the core checks do not need macOS; Ubuntu runners are ~10x cheaper and allocate faster (`windows-checks` is the sole exception, by design).
- **Separate jobs** (not matrix). Even at eight jobs the count does not justify a matrix abstraction; explicit jobs are clearer.
- **Concurrency cancellation** via `concurrency: group: checks-${{ github.ref }} cancel-in-progress: true`. Rapid pushes / force-pushes to the same ref abort in-flight runs.
- **`npm ci` retry** — every `npm ci` is wrapped in a 3-attempt loop with backoff to tolerate transient ECONNRESET on GitHub runners:
  ```bash
  npm ci || (sleep 10 && npm ci) || (sleep 20 && npm ci)
  ```

## E2E Tests (`e2e.yml`) — disabled

**Disabled 2026-04-25** via `gh workflow disable "E2E Tests"` (see commit `997ba65`). The disabled state is also documented inline at the top of `e2e.yml` so it's visible without the Actions UI.

**Why disabled**: Playwright + Electron tests do not run reliably on `macos-latest` hosted runners. The visual suite hangs at `page.waitForLoadState('domcontentloaded')` (root-cause analysis below); the functional `--project=electron` suite was previously the workaround, but is also unstable on hosted runners. E2E was already excluded from branch-protection required checks, so disabling does not block any merges or releases.

**E2E remains the local-only verification path**:
```bash
npm run test:e2e                  # Functional electron suite
npm run test:e2e:visual           # Visual regression suite
npm run test:e2e:update-screenshots  # Update visual baselines
```

**Re-enable when stable**:
```bash
gh workflow enable "E2E Tests"
```

For historical reference, when the workflow was active it ran on `push` to `develop` + all PRs on `macos-latest`, executed `npm ci` (retry-wrapped) → `npx electron-vite build` → `npx playwright test --project=electron`, and uploaded `test-results/` + `playwright-report/` (30-day retention on develop, 14 on PRs). The original root-cause analysis for the visual-suite hang is preserved below since it remains an open investigation.

## Visual regression on CI

**Status**: not running on CI — the entire `e2e.yml` workflow is disabled (see [E2E Tests (disabled)](#e2e-tests-e2eyml-disabled) above). Even when re-enabled, the visual suite would still need to be scoped out via `--project=electron` until the root cause below is resolved. Runs locally only today.

**Symptom**: `page.waitForLoadState('domcontentloaded')` times out at 30s in `e2e/fixtures.ts:357` (`visualWindow`) and `:408` (`visualWindowWithProject`).

**What's known**:
- Electron launches successfully on CI (main process, BrowserWindow, resize all work)
- Playwright `firstWindow()` returns a Page
- The `domcontentloaded` lifecycle event never propagates back to Playwright
- All 5 visual tests pass locally with `CI=true` and `recordVideo` enabled (rules out the video-recording theory)
- The regular `electron` fixture (same launch path without `--force-device-scale-factor=1` and `recordVideo`) works fine on the same runner

**Candidate root causes** (not yet isolated):
1. GPU / renderer init hang on virtualized `macos-latest` runners
2. Timing race between `app.evaluate(resizeBrowserWindow)` and Playwright's `firstWindow()` attach — on slower CI the `domcontentloaded` fires before Playwright attaches
3. `--force-device-scale-factor=1` interaction with macOS virtualized display

**Diagnostic next step**: instrument the fixture to capture `document.readyState` and `app.getGPUInfo('basic')` before and after `waitForLoadState`, push once, evidence-gather, then form a targeted hypothesis.

## Local reproduction

All CI checks are runnable locally (commands match exactly what CI executes):

```bash
npm run lint
npm run typecheck
npm run test:ci           # same as Quality Checks job – basic reporter
npx electron-vite build
npm run test:e2e          # electron project — local-only today (e2e.yml is disabled)
npm run test:e2e:visual   # visual project — local-only today (visual hang on macos-latest)
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `npm error code EUSAGE` + "Missing: X from lock file" | Lockfile out of sync with package.json (often after merge) | `rm -rf node_modules package-lock.json && npm install`, commit the new lockfile |
| `npm error code ECONNRESET` / "network aborted" | Transient GitHub runner → npmjs.org | Retry wrapper usually recovers it. If persistent, escalate to `nick-fields/retry` action. |
| E2E never appears in PR checks | Workflow is intentionally disabled (see [E2E Tests (disabled)](#e2e-tests-e2eyml-disabled)) | Run E2E locally before merging anything sensitive: `npm run test:e2e` |
| E2E electron passes locally, fails on CI (historical) | Usually flake (Monaco cursor blink, timing). Playwright retries once; see flaky count in run summary | Fix with `disableCursorBlink()` / condition-based waits — applies if the workflow is re-enabled |
| Visual test fails on CI only (historical) | See [Visual regression on CI](#visual-regression-on-ci) above | Run locally; CI visual coverage is a known gap |

## Related documentation

- [E2E Testing Guide](./testing/e2e-testing.md) — Playwright fundamentals, POM pattern, fixtures
- [E2E Debugging](./testing/e2e-debugging.md) — Inspector, trace viewer, headed mode
- [E2E Troubleshooting](./testing/e2e-troubleshooting.md) — Common failure modes
- [Testing overview](./testing/README.md) — All test types (unit, integration, E2E, visual)
- [Known issues](./known-issues.md) — Visual-on-CI limitation
- [Technical debt](./technical-debt.md) — Debt tracking (includes visual-on-CI)
