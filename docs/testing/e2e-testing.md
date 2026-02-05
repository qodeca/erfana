# E2E Testing with Playwright

## Overview

Erfana supports automated E2E testing using Playwright with Electron. This guide covers setup, configuration, and test patterns.

**Related documentation**:
- [E2E Selectors](./e2e-selectors.md) - Complete testid catalog (138 testids)
- [E2E Third-Party](./e2e-third-party.md) - Monaco, xterm.js, Mermaid testing
- [E2E Helpers](./e2e-helpers.md) - Test utilities and patterns
- [E2E Debugging](./e2e-debugging.md) - Debugging and CI/CD
- [E2E Troubleshooting](./e2e-troubleshooting.md) - Common issues and fixes
- [E2E Lessons Learned](./e2e-lessons-learned.md) - Hard-won insights
- Spec #011 (archived) – Specification
- [Test ID constants](../../src/renderer/src/constants/testids.ts) - Source code

---

## Prerequisites

- Node.js 18+
- Playwright installed: `npm install --save-dev @playwright/test`

---

## Quick start

### Running tests

```bash
# Run E2E tests (requires dev server running)
npm run dev &  # Start dev server in background
npm run test:e2e

# Run with visible window
npm run test:e2e:headed
```

### Test build vs production build

Erfana uses Electron fuses for security hardening. For E2E testing with debugging:

```bash
# Production build (inspector disabled - secure)
npm run build:mac

# Test build (inspector enabled - for Playwright debugging)
ERFANA_TEST_BUILD=true npm run build:mac
```

> **Security note**: Test builds have reduced security (inspector enabled). Only use for testing, never distribute.

| Build Type | `--inspect` Flag | Use Case |
|------------|------------------|----------|
| Production | Disabled (fuse) | Distribution to users |
| Test | Enabled | Playwright debugging, E2E tests |

---

## Playwright configuration

Create `playwright.config.ts` in the project root:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
    },
  ],
})
```

| Option | Value | Rationale |
|--------|-------|-----------|
| `testDir` | `./e2e` | Separate E2E tests from unit tests |
| `timeout` | `60000` | Electron apps need longer startup time |
| `retries` | `1` | Retry flaky tests once |
| `trace` | `retain-on-failure` | Capture trace on failures for debugging |

---

## Test structure

### Basic test template

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test.describe('Erfana E2E', () => {
  test('should launch app and show activity bar', async () => {
    // Launch Electron app
    const app = await electron.launch({
      args: [path.join(__dirname, '..')],
    })

    // Get the first window
    const window = await app.firstWindow()

    // Wait for app to be ready
    await window.waitForLoadState('domcontentloaded')

    // Test: Activity bar should be visible
    const activityBar = window.locator('[data-testid="activity-bar"]')
    await expect(activityBar).toBeVisible()

    // Cleanup
    await app.close()
  })
})
```

### Test with project loaded

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test('should open project and display files', async () => {
  const app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      // Pass project path as argument
      '/path/to/test/project',
    ],
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Wait for project tree to populate
  const projectTree = window.locator('[data-testid="project-tree"]')
  await expect(projectTree).toBeVisible()

  // Verify files are shown (not empty state)
  const emptyState = window.locator('[data-testid="project-tree-empty"]')
  await expect(emptyState).not.toBeVisible()

  await app.close()
})
```

### Test fixture pattern

For reusable app setup, create a fixture:

```typescript
// e2e/fixtures.ts
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

type TestFixtures = {
  app: ElectronApplication
  window: Page
}

export const test = base.extend<TestFixtures>({
  app: async ({}, use) => {
    const app = await electron.launch({
      args: [path.join(__dirname, '..')],
    })
    await use(app)
    await app.close()
  },

  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  },
})

export { expect } from '@playwright/test'
```

Usage:

```typescript
// e2e/activity-bar.e2e.ts
import { test, expect } from './fixtures'

test('activity bar buttons work', async ({ window }) => {
  // Click files button
  await window.locator('[data-testid="activity-bar-btn-files"]').click()

  // Verify project tree is visible
  const projectTree = window.locator('[data-testid="project-tree"]')
  await expect(projectTree).toBeVisible()
})
```

---

## Key concepts

### Testid naming convention

Pattern: `{component}-{element}-{identifier?}` with `-btn-` for buttons

```typescript
// Static testids
'activity-bar'           // Container
'activity-bar-btn-files' // Button within activity bar

// Dynamic testids (with path hash)
'project-tree-node-a1b2c3d4'  // Tree node for specific file
'tab-item-f3e2d1c0'           // Tab for specific file
```

### Third-party components

Monaco, xterm.js, and Mermaid have internal DOM that can't have testids. Use wrapper elements and keyboard input. See [E2E Third-Party](./e2e-third-party.md).

### Portal elements

Dialogs, context menus, and toasts render in React portals. Query them globally, not as children of other elements. See [E2E Helpers](./e2e-helpers.md).

### Dialog handling

The `closeApp()` helper handles quit confirmation dialogs properly by:
1. Triggering quit via `window.close()` (exercises real quit flow)
2. Using retry loop for race conditions
3. Wrapping operations in try-catch (page invalidation is expected)

See [E2E Helpers](./e2e-helpers.md) for implementation.

---

## References

- [Playwright Electron documentation](https://playwright.dev/docs/api/class-electron)
- [Playwright locators](https://playwright.dev/docs/locators)
- Spec #011 (archived)
- [Test ID constants](../../src/renderer/src/constants/testids.ts)
- [Erfana security documentation](../security.md)
