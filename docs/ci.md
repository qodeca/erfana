# Continuous integration

Erfana runs GitHub Actions workflows on pushes. The author-controlled workflows are listed below; vendor-installed workflows (Dependabot, Copilot review, Security Risk Assessment) are managed by their respective GitHub Apps and not covered here.

| Workflow | File | Status | Trigger | Runner | Wall-clock | Purpose |
|----------|------|--------|---------|--------|-----------|---------|
| Quality Checks | `.github/workflows/checks.yml` | active | push to **any branch** | `ubuntu-latest` | ~3 min | Fast feedback on lint / types / unit tests / build / licensing (see job table below) |
| Secret Scan | `.github/workflows/secret-scan.yml` | active (**required check**) | push + PR | `ubuntu-latest` | ~1 min | gitleaks (full git history) + trufflehog (verified secrets only). Version-pinned, SHA-256-checksum-verified binary downloads; no third-party actions |
| E2E Tests | `.github/workflows/e2e.yml` | **disabled** (2026-04-25) | (would be: push to `develop` or `main`, plus all PRs) | `macos-latest` | ~5–8 min | Electron integration tests (Playwright) — see [E2E Tests (disabled)](#e2e-tests-e2eyml-disabled) below |
| Release | `.github/workflows/release.yml` | active | tag push `v[0-9]+.[0-9]+.[0-9]+`, or `workflow_dispatch` (input `dry-run`, default `true` – skips draft creation and asset uploads) | matrix (mac/win) | ~15–25 min compute + **unbounded approval wait** | Multi-platform release build → `prepare`/`build_*`/`finalize`/`cleanup` (calls `build_mac.yml`, `build_win.yml` reusables; Linux distribution target dropped) |
| Whisper Binaries | `.github/workflows/whisper-binaries.yml` | active | `workflow_dispatch` only | `ubuntu-latest` (`validate-inputs`, `publish-release`) + `macos-14` (`build-macos`) + `windows-latest` (`build-windows`) | ~25 min | Self-hosted whisper.cpp build, sign, notarize, publish (see [`build/whisper-binaries.md`](./build/whisper-binaries.md)) |
| Whisper Binaries (Canary) | `.github/workflows/whisper-binaries-canary.yml` | active | monthly schedule | `macos-14` + `windows-latest` + `ubuntu-latest` (`notify-on-failure`) | ~3 min | Credential-health check (Apple notarization, Windows signing) |

Two of the eight files in [`.github/workflows/`](../.github/workflows/) have no row above: `build_mac.yml` and `build_win.yml` are `workflow_call` reusables with no standalone trigger of their own — they run only as jobs of the Release workflow, so they are documented there rather than as separate entries.

The Release row's wall-clock needs a caveat: both build legs sit behind the `production-signing` environment approval, which is a required human review with no time limit. Compute time is 15–25 minutes; end-to-end is that plus however long the approval takes. See [release.md § Approval gate](./build/release.md#approval-gate-production-signing).

**Removed workflows**: the two Claude Code automation workflows (`claude-code-review.yml` – PR auto-review, `claude.yml` – `@claude` mention responder) were removed in August 2026. Both depended on the [Claude Code GitHub App](https://github.com/apps/claude), which is not installed on this repository, so every run failed at token exchange. Neither was a required check. Restore the two files from git history and install the app to reinstate them.

Node 24, `permissions: contents: read`. Every `checks.yml` job that needs dependencies installs via the local composite action [`.github/actions/setup-node-with-retry`](../.github/actions/setup-node-with-retry/action.yml) rather than calling `actions/setup-node` directly. It SHA-pins `actions/setup-node` (v6.4.0) and `actions/cache` (v5.0.5), caches **`~/.npm` only — never `node_modules`** (an install tree poisoned by a compromised postinstall would persist in the cache indefinitely; the download cache is safe because a fresh `npm ci --ignore-scripts` still runs every time), and wraps `npm ci --ignore-scripts` in the 3-attempt retry described below. Postinstall builds are opt-in per job via `run-postinstall`, and only for the allowlisted native modules (electron, node-pty, node-addon-api). The caller must run `actions/checkout` first — a local composite action cannot check out on its own behalf.

## Quality checks (`checks.yml`)

Nine jobs run in parallel (all `ubuntu-latest` except `windows-checks`). The **Required check?** column reflects the live branch-protection required set on `main`; the separate `Secret scan` workflow (above) is the seventh required check.

**Time budgets.** Every job declares a `timeout-minutes`, so a hung step fails the run instead of burning a runner for the six-hour default. The budget is **10 minutes** for each job, with two deliberate exceptions: `windows-checks` gets **15** (Windows runners install and compile slower), and `release-guards` gets **3** (checkout-only, awk/grep scripts, no install). A job that starts brushing its budget is a signal to look at what got slower, not to raise the number.

| Job (`name:`) | Command | Required check? | Notes |
|-----|---------|:---:|-------|
| `lint` (Lint) | `npm run lint` + `npm run lint:css` + `npm run design -- --check` | yes | Three **steps in one job**, deliberately. Branch protection matches the **job** `name:` (`Lint`), so a separate job called `Lint CSS` would be advisory only and would enforce nothing. `lint:css` is stylelint over `src/**/*.css` plus the `design/` cards' inline `<style>` (via `postcss-html`); `design -- --check` regenerates `design/` in memory and fails when a committed generated file is stale |
| `typecheck` (Typecheck) | `npm run typecheck` | yes | tsc node + web |
| `test` (Unit tests) | `npm run test:ci` | yes | full vitest workspace (main / renderer / preload), **no coverage**. Also carries two extra gates — see below |
| `coverage` (Coverage) | `npx vitest --run --config vitest.main.ts --project main --coverage` | yes | enforces the per-file coverage **floors** in `vitest.main.ts` `test.coverage.thresholds` — `scripts/fuses.js` (the #43/#55 packaging-integrity guards + Electron fuses, floor lines/statements 86, functions 88, branches 93; met at ~88) and the whisper trust-chain modules `verifyManifest` / `secureDownloader` / `zipArchive` / `tarArchive` (90% each) plus the #41 `modelId` registry (95%) and the #60 `src/main/utils/rendererCrashHandlers.ts` crash trail (90% each metric). Since `test` runs `test:ci` **without** coverage, these floors gate only here. Scoped to `--project main` (with `all: false`) so `scripts/fuses.js` reports a single deterministic row — see the design note below (issue #55, F4). Added to the branch-protection required set on `main` |
| `build` (Build) | `npx electron-vite build` | yes | also the only gate on the **preload self-containment** guard — see below |
| `license` (License compliance) | `npm run check:headers` + `pipx run reuse lint` | yes | SPDX headers on all sources + REUSE conformance. `check-spdx-headers.mjs` covers `.ts .tsx .js .mjs .cjs .css .html`; a script that *emits* an SPDX header in a string literal must wrap it in `REUSE-IgnoreStart` / `REUSE-IgnoreEnd`, or `reuse lint` parses the literal as that file's own licensing and fails (see `scripts/design-sync.mjs`, `scripts/check-spdx-headers.mjs`) |
| `audit-signatures` (npm audit signatures) | `npm audit signatures` | no | also records the `package-lock.json` digest artifact that `release.yml` byte-verifies at tag time |
| `release-guards` (Release readiness guards) | guard scripts | no | fails the build on a `pull_request_target` trigger, forbidden plist entitlements, legacy signing credentials, release-pubkey drift across docs, and a non-allowlist `files:` block in `electron-builder.yml` (`Guard - electron-builder packaging allowlist`, issue #43 — awk/grep only, since the job is checkout-only; extended in issue #55 to also hard-fail any `extraFiles:` block, at column 0 or indented under `mac:`/`win:`, and warn on `extraResources:` edits). Its checkout uses `fetch-depth: 0` so the `extraResources:` warning can compare against the push/PR base — see the note below |
| `windows-checks` (Windows checks) | `npm run typecheck` + `npm run design -- --check` + `npm run test:main` on `windows-latest` | no | advisory Windows gate; excluded from the required set until proven stable |

**Required status checks on `main`** (seven): `Lint`, `Typecheck`, `Unit tests`, `Build`, `License compliance`, `Coverage` (from `checks.yml`), and `Secret scan` (from `secret-scan.yml`). Note what `Lint` now blocks beyond ESLint: a raw hex colour, a bare `z-index`, a `border-radius` that is not `0` or the circle token, and a stale `design/` — a token violation or an unregenerated design system fails the merge, not just review. `npm audit signatures`, `Release readiness guards`, and `Windows checks` run on every push but are not required to merge. `Coverage` (issue #55, F4) enforces the per-file coverage floors that the required `test` job — which runs `test:ci` without `--coverage` — does not.

**Why the `extraResources:` warning is edit-triggered** (issue #55, F4): the guard's contract is to warn when the `extraResources:` block is **edited**, so the change is a visible prompt to re-check `ALLOWED_EXTRA_RESOURCES_DESTS` and the binding test. It originally warned on the block's mere *presence* — and since `extraResources:` is permanently present (`tessdata`, `LICENSE`, `THIRD-PARTY-LICENSES.md`), the annotation fired on every push and could not signal an edit at all. It now extracts the block from the working file and from the push/PR base commit (`github.event.before`, or `pull_request.base.sha`) and warns only when the two differ — hence `fetch-depth: 0` on the job's checkout. It stays **fail-safe**: when the base is unknowable (new branch, force-push, shallow history) or the config path is not the tracked repo file (the manual negative tests point it at a mutated copy), it falls back to warning rather than staying silent. This layer is advisory either way — the hard gate for `from`/`to` shape is the binding test in the required `Unit tests` job (`scripts/fuses.test.mjs`, "agrees with the repository electron-builder.yml as shipped"), plus the runtime L1/L2a guards in `scripts/fuses.js`.

**Why a separate `Coverage` job** (issue #55, F4): the per-file floors in `vitest.main.ts` fire only under `--coverage`, and the required `test` job runs `test:ci` without it — so before this job the `scripts/fuses.js` floor (and the whisper floors) were enforced only by a local `npm run test:cov`, never in required CI. The job runs the **main project only** (`--project main`): just the main suite loads `scripts/fuses.js` (via `scripts/fuses.test.mjs`), so the v8 report carries exactly one `fuses.js` row at its real coverage. Combined with `all: false` in `vitest.main.ts` (which suppresses the synthetic 0%-baseline row an untested-but-included file would otherwise emit), the threshold match is deterministic; a full-workspace coverage run could instead surface a second 0% `fuses.js` row and fail the gate spuriously.

**Two extra gates live inside the `test` job** — one runs before the tests, one wraps them:

- **chokidar v3 pin guard** — reads the installed `chokidar/package.json` and fails unless it is exactly `3.6.0`. chokidar v4 opens one file descriptor per watched file and exhausts FDs on large projects; v3 uses FSEvents. A regenerated lockfile or a transitive `^4` would otherwise pass typecheck silently. Runs *before* the tests so the failure names the real cause.
- **Deprecation tripwire** — tees vitest output and fails the job on any `deprecated` / `DEPnnn` line that is not on the known-and-tracked allowlist. The only allowlisted entry today is the vitest `workspace` / `defineWorkspace` deprecation, tracked for the vitest 3.2 → 4 migration. Any new deprecation (a vitest 3.x warning, a Node `DEPnnn`) fails the build rather than scrolling past.

**One extra gate lives inside the `build` job** — **preload self-containment** (issue #73). `electron.vite.config.ts` registers an `assertSelfContainedPreloads()` plugin on the preload config; it throws, and so fails `electron-vite build`, if the preload output contains a non-entry (shared) chunk or a relative `require(`. A sandboxed preload is handed to Electron as a standalone file with no module resolver, so a relative `require('./chunks/…')` throws at load time — `window.api` never appears and every built and packaged app opens on the root error screen. Rollup emits exactly that the moment two preload entries import the same module as a *value* (the case that burned #73 was `src/shared/ipc/image-export-channels.ts`). Unit tests never look at the bundle, so this plugin is the only thing that does, and it runs on every `electron-vite build` — local, the `Build` job here, the e2e build step and the packaged release builds alike. When it fires, the fix is to stop sharing the module: inline the handful of values, or import it with `import type`, which is erased and cannot create a chunk. Relaxing the check is not a fix.

**Design notes**:
- **`on: push:` only** (not `pull_request`). Same-repo PRs already trigger a push event on their source branch; adding `pull_request` would double-run the same SHA.
- **ubuntu-latest** — the core checks do not need macOS; Ubuntu runners are ~10x cheaper and allocate faster (`windows-checks` is the sole exception, by design).
- **Separate jobs** (not matrix). Even at nine jobs the count does not justify a matrix abstraction; explicit jobs are clearer.
- **Concurrency cancellation** via `concurrency: group: checks-${{ github.ref }} cancel-in-progress: true`. Rapid pushes / force-pushes to the same ref abort in-flight runs.
- **`npm ci` retry** — every `npm ci` is wrapped in a 3-attempt loop with backoff to tolerate transient ECONNRESET on GitHub runners:
  ```bash
  npm ci --ignore-scripts \
    || (sleep 10 && npm ci --ignore-scripts) \
    || (sleep 20 && npm ci --ignore-scripts)
  ```
  Every attempt carries `--ignore-scripts`, which is what makes caching `~/.npm` safe: no postinstall runs during the install, so a retry cannot smuggle one in either.

## Secret scan (`secret-scan.yml`)

Runs gitleaks over the **full git history**, then trufflehog for verified secrets. Both binaries are version-pinned and SHA-256-checksum-verified rather than pulled through third-party actions. `Secret scan` is a branch-protection required check on `main`.

**The scan is repo-wide, not branch-wide.** gitleaks runs with `--log-opts="--all"`, so it walks every ref in the repository — not just the branch being tested. Two consequences that are easy to get wrong:

- A finding in a commit that exists **only on another branch** still fails the check on your branch, as long as that commit is reachable from any ref on the remote.
- Therefore `.gitleaksignore` must carry the fingerprint on **every** branch whose CI you need green — including branches where the offending file does not exist. Rewinding or rebasing a branch does not shrink what the scan sees, so an allowlist entry dropped by a history rewrite will fail a branch that never contained the secret.

`.gitleaksignore` holds one finding fingerprint per line (`commit:file:rule:line`), each a reviewed non-secret — test fixtures that resemble high-entropy tokens. Add the fingerprint from the failing run's output; where the file is on the current branch, also mark the line with an inline `gitleaks:allow` comment so future commits of the same line do not re-trigger.

## E2E Tests (`e2e.yml`, disabled)

**Disabled 2026-04-25** via `gh workflow disable "E2E Tests"` (pre-migration commit `997ba65`, which does not resolve on `qodeca/erfana` – retained as provenance). The disabled state is also documented inline at the top of `e2e.yml` so it's visible without the Actions UI.

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

For historical reference, when the workflow was active it ran on `push` to `develop` or `main` plus all PRs on `macos-latest`, executed `npm ci` (retry-wrapped) → `npx electron-vite build` → `npx playwright test --project=electron`, and uploaded `test-results/` + `playwright-report/` (30-day retention when the ref is `develop` or `main`, 14 days otherwise). The original root-cause analysis for the visual-suite hang is preserved below since it remains an open investigation.

## Visual regression on CI

**Status**: not running on CI — the entire `e2e.yml` workflow is disabled (see [E2E Tests (disabled)](#e2e-tests-e2eyml-disabled) above). Even when re-enabled, the visual suite would still need to be scoped out via `--project=electron` until the root cause below is resolved. Runs locally only today.

**Symptom**: `page.waitForLoadState('domcontentloaded')` times out at 30s in the `visualWindow` and `visualWindowWithProject` fixtures (`e2e/fixtures/index.ts`).

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
| `npm error code EUSAGE` + "Missing: X from lock file" | The committed lockfile does not satisfy `npm ci`. Usually after a merge — but **on this repo the usual cause is a lockfile written by `npm install`**: under npm 11 it drops `encoding@0.1.13` (an optional peer of `node-fetch`) that `npm ci` requires, so the lock installs with `npm install` and fails every CI job. | **Do not delete the lockfile and regenerate it with `npm install`** — that reproduces the fault. First try `git checkout <last green commit> -- package-lock.json` and confirm `npm ci` succeeds. Regenerate only for a genuine dependency change, and check `git diff package-lock.json` before committing: a diff that only removes `encoding` and shuffles `peer` / `optional` flags is the quirk, not your change. See [CONTRIBUTING](../CONTRIBUTING.md#local-setup) |
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
