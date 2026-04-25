# Continuous integration

Erfana runs two GitHub Actions workflows on pushes. They target different concerns with different cost/latency trade-offs.

| Workflow | File | Trigger | Runner | Wall-clock | Purpose |
|----------|------|---------|--------|-----------|---------|
| Quality checks | `.github/workflows/checks.yml` | push to **any branch** | `ubuntu-latest` | ~3 min | Fast feedback on lint / types / unit tests / build |
| E2E Tests | `.github/workflows/e2e.yml` | push to `develop` + PRs | `macos-latest` | ~5–8 min | Electron integration tests (Playwright) |

Node 24, `actions/setup-node@v4` with `cache: npm`, `permissions: contents: read`.

## Quality checks (`checks.yml`)

Four jobs run in parallel:

| Job | Command | Typical duration |
|-----|---------|------------------|
| `lint` | `npm run lint` | 1–2 min |
| `typecheck` | `npm run typecheck` (tsc node + web) | 1–2 min |
| `test` | `npm run test:ci` (vitest workspace, ~7,955 tests across 250 files) | 2–3 min |
| `build` | `npx electron-vite build` | 2–3 min |

**Design notes**:
- **`on: push:` only** (not `pull_request`). Same-repo PRs already trigger a push event on their source branch; adding `pull_request` would double-run the same SHA.
- **ubuntu-latest** — none of these checks need macOS; Ubuntu runners are ~10x cheaper and allocate faster.
- **Separate jobs** (not matrix). 4 items doesn't justify DRY abstraction; explicit jobs are clearer.
- **Concurrency cancellation** via `concurrency: group: checks-${{ github.ref }} cancel-in-progress: true`. Rapid pushes / force-pushes to the same ref abort in-flight runs.
- **`npm ci` retry** — every `npm ci` is wrapped in a 3-attempt loop with backoff to tolerate transient ECONNRESET on GitHub runners:
  ```bash
  npm ci || (sleep 10 && npm ci) || (sleep 20 && npm ci)
  ```

## E2E Tests (`e2e.yml`)

Runs on `push` to `develop` and all pull requests.

| Step | Command |
|------|---------|
| Install | `npm ci` (with retry) |
| Build | `npx electron-vite build` |
| Test | `npx playwright test --project=electron` |
| Upload | `test-results/`, `playwright-report/` (30-day retention on develop, 14 on PRs) |
| Upload visual diffs | `test-results/**/*-diff.png` on failure (currently no-op – visual suite is not run on CI) |

**Scoped to `--project=electron`** because the `visual` project fails 5/5 on `macos-latest` with `page.waitForLoadState('domcontentloaded')` timeouts while passing 5/5 locally (including with `CI=true`). See [Known issues](./known-issues.md) and [Visual regression on CI](#visual-regression-on-ci) below.

Run the `visual` suite manually:
```bash
npm run test:e2e:visual                  # Run visual regression tests
npm run test:e2e:update-screenshots      # Update baselines
```

## Visual regression on CI

**Status**: disabled on CI (scoped out via `--project=electron`), runs locally only.

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
npm run test:ci           # same as CI – basic reporter
npx electron-vite build
npm run test:e2e          # electron project only (same as CI)
npm run test:e2e:visual   # visual project (CI skips this)
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `npm error code EUSAGE` + "Missing: X from lock file" | Lockfile out of sync with package.json (often after merge) | `rm -rf node_modules package-lock.json && npm install`, commit the new lockfile |
| `npm error code ECONNRESET` / "network aborted" | Transient GitHub runner → npmjs.org | Retry wrapper usually recovers it. If persistent, escalate to `nick-fields/retry` action. |
| E2E electron passes locally, fails on CI | Usually flake (Monaco cursor blink, timing). Playwright retries once; see flaky count in run summary | Fix with `disableCursorBlink()` / condition-based waits |
| Visual test fails on CI only | See [Visual regression on CI](#visual-regression-on-ci) above | Run locally; CI visual coverage is a known gap |

## Related documentation

- [E2E Testing Guide](./testing/e2e-testing.md) — Playwright fundamentals, POM pattern, fixtures
- [E2E Debugging](./testing/e2e-debugging.md) — Inspector, trace viewer, headed mode
- [E2E Troubleshooting](./testing/e2e-troubleshooting.md) — Common failure modes
- [Testing overview](./testing/README.md) — All test types (unit, integration, E2E, visual)
- [Known issues](./known-issues.md) — Visual-on-CI limitation
- [Technical debt](./technical-debt.md) — Debt tracking (includes visual-on-CI)
