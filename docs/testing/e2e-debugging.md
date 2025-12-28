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

### GitHub Actions example

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]

jobs:
  test-e2e:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Build Electron app
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload trace on failure
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-traces-${{ matrix.os }}
          path: test-results/**/trace.zip
          retention-days: 7

      - name: Upload screenshots on failure
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-screenshots-${{ matrix.os }}
          path: test-results/**/*.png
          retention-days: 7
```

### CI best practices

- Run on multiple OS (macOS, Windows, Linux) for cross-platform validation
- Upload traces and screenshots as artifacts on failure
- Use `npm ci` instead of `npm install` for consistent dependencies
- Cache `node_modules` to speed up builds
- Set reasonable timeouts (E2E tests may be slower in CI)

### Parallel test execution

```yaml
# Run tests in parallel across multiple workers
- name: Run E2E tests
  run: npm run test:e2e -- --workers=4
```

**Worker recommendations**:
- Local: `--workers=2` (don't overload development machine)
- CI: `--workers=4` to `--workers=8` (depends on runner specs)
- GitHub Actions runners: 2-core machines, use `--workers=2`

### Test sharding

```yaml
# Split tests across multiple CI jobs
jobs:
  test-e2e:
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - name: Run E2E tests (shard ${{ matrix.shard }})
        run: npm run test:e2e -- --shard=${{ matrix.shard }}/4
```
