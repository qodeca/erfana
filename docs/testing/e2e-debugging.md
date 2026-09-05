# E2E CI/CD

CI/CD integration for the Playwright E2E suites.

For debugging locally, use the standard Playwright tooling – `PWDEBUG=1` for the
Inspector, `npx playwright show-trace <trace.zip>` for a failed run's trace, and
`npm run test:e2e:headed` for a visible window. None of it is customised here, so
the [Playwright debugging docs](https://playwright.dev/docs/debug) are the
better reference.

**Related documentation**:

- [E2E Testing Guide](./e2e-testing.md) - Main E2E documentation
- [E2E Helpers](./e2e-helpers.md) - Test utilities

---

## CI/CD integration

Full CI pipeline documentation is in [docs/ci.md](../ci.md). Quick E2E-specific summary:

- **`e2e.yml` is currently disabled** (2026-04-25, pre-migration commit `997ba65`, which does not resolve on `qodeca/erfana`) — see [docs/ci.md § E2E Tests (disabled)](../ci.md#e2e-tests-e2eyml-disabled) for the rationale (macos-latest instability) and re-enable command. E2E verification is local-only until the workflow is restored.
- **`checks.yml`** (separate workflow) runs lint / typecheck / unit tests / build on every push to any branch — see [docs/ci.md § Quality Checks](../ci.md#quality-checks-checksyml). It is unaffected by the E2E disable.
- **Historical config** (applies if/when `e2e.yml` is re-enabled): runs on `push` to `develop` and all PRs; pipeline = `npm ci` → `electron-vite build` → `playwright test --project=electron` → upload `test-results/` + `playwright-report/` (30-day retention on `develop` or `main`, 14-day on PRs); visual suite was scoped out via `--project=electron` due to the macos-latest `waitForLoadState('domcontentloaded')` hang — see [docs/ci.md § Visual regression on CI](../ci.md#visual-regression-on-ci) for root-cause notes.

### E2E-specific CI notes (apply when workflow is re-enabled)

- Traces captured on the first retry only (`trace: 'on-first-retry'` in `playwright.config.ts` – a flaky-then-passing test still gets a trace, but not every failing attempt); screenshots on failure only
- Playwright `retries: process.env.CI ? 2 : 0` for the `electron` project (two retries on CI, none locally), `retries: 0` for `visual` (visual diffs should be investigated, not retried — spec 019-FR-003)
- Timeout budget: 30 min for the full job (set in `e2e.yml`)
- Video recording wraps `electron.launch()` only when `process.env.CI` is set – see `buildVisualLaunchOptions` in `e2e/fixtures/index.ts`
