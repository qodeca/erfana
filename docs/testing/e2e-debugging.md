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

### GitHub Actions workflow

The CI workflow (`.github/workflows/e2e.yml`) runs on `push` to `develop` and on all PRs:
1. Installs dependencies (`npm ci`)
2. Builds the app (`npx electron-vite build`)
3. Runs both `electron` and `visual` Playwright projects (`npx playwright test`)
4. Uploads `test-results/` and `playwright-report/` as artifacts (30-day retention on develop, 14-day on PRs)

Visual tests skip gracefully in CI when no baseline exists for the runner platform (macOS). Video is recorded on failure for visual test debugging.

See `.github/workflows/e2e.yml` for the full workflow.

### CI best practices

- Upload traces and screenshots as artifacts on failure
- Use `npm ci` instead of `npm install` for consistent dependencies
- Cache `node_modules` to speed up builds
- Set reasonable timeouts (30 min for the full job)
- Visual regression baselines are platform-specific – generate separately per OS
