# E2E Debugging and CI/CD

Debug tools, trace analysis, and CI/CD integration for Playwright E2E tests.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) - Main E2E documentation
- [E2E Helpers](./e2e-helpers.md) - Test utilities

---

## Playwright Inspector

Debug tests step-by-step with the Playwright Inspector:

```bash
# Run tests with inspector
PWDEBUG=1 npm run test:e2e

# Or set environment variable
export PWDEBUG=1
npm run test:e2e
```

**Inspector features**:
- Step through test execution line by line
- Pause test and inspect DOM state
- Pick locator by clicking elements
- Explore page console logs
- View screenshots at each step

**Keyboard shortcuts** (in Inspector):
- `F10` - Step over
- `F11` - Step into
- `Shift+F11` - Step out
- `F5` - Resume
- `F8` - Pause

---

## Viewing traces

Traces are automatically captured on test failures (configured in `playwright.config.ts`):

```typescript
export default defineConfig({
  use: {
    trace: 'retain-on-failure',  // Capture trace on failure
    screenshot: 'only-on-failure',  // Capture screenshot on failure
  },
})
```

**View traces after test run**:

```bash
# Run tests (traces saved on failure)
npm run test:e2e

# Open trace viewer
npx playwright show-trace trace.zip

# Or specify path
npx playwright show-trace test-results/.../trace.zip
```

**Trace viewer features**:
- Timeline of all actions
- DOM snapshot at each step
- Network requests
- Console logs
- Screenshots and videos
- Source code highlighting

**Trace options**:
- `'on'` - Always capture traces (slow, large files)
- `'on-first-retry'` - Capture on retry (recommended)
- `'off'` - Never capture traces
- `'retain-on-failure'` - Keep only failed test traces

---

## Headed mode

Run tests with visible browser window:

```bash
npm run test:e2e:headed

# Or with Playwright CLI
npx playwright test --headed
```

**Use headed mode when**:
- Debugging visual issues
- Verifying animations and transitions
- Understanding test failures
- Developing new tests

---

## CI/CD integration

Full CI pipeline documentation is in [docs/ci.md](../ci.md). Quick E2E-specific summary:

- **`e2e.yml`** runs on `push` to `develop` and all PRs: `npm ci` → `electron-vite build` → `playwright test --project=electron` → upload `test-results/` and `playwright-report/` (30-day retention on develop, 14-day on PRs)
- **Scoped to `--project=electron`** — visual suite is skipped on CI because of a macos-latest-specific `waitForLoadState('domcontentloaded')` hang; see [docs/ci.md § Visual regression on CI](../ci.md#visual-regression-on-ci) for root-cause notes
- **`checks.yml`** (separate workflow) runs lint / typecheck / unit tests / build on every push to any branch — see [docs/ci.md § Quality checks](../ci.md#quality-checks-checksyml)

### E2E-specific CI notes

- Traces captured on failure (`trace: 'retain-on-failure'`); screenshots on failure only
- Playwright `retries: 1` for `electron` project, `retries: 0` for `visual` (visual diffs should be investigated, not retried — spec 019-FR-003)
- Timeout budget: 30 min for the full job (set in `e2e.yml`)
- Video recording wraps `electron.launch()` only when `process.env.CI` is set – see `e2e/fixtures.ts:buildVisualLaunchOptions`
