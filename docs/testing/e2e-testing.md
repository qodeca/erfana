# E2E Testing with Playwright

## Overview

Erfana supports automated E2E testing using Playwright with Electron. This guide covers setup, configuration, and test patterns.

**Related documentation**:
- [E2E Selectors](./e2e-selectors.md) – Complete testid catalog (225 testids)
- [E2E Third-Party](./e2e-third-party.md) – Monaco, xterm.js, Mermaid testing
- [E2E Helpers](./e2e-helpers.md) – Test utilities and patterns (backward-compatible adapter)
- [E2E Debugging](./e2e-debugging.md) – Debugging and CI/CD
- [E2E Troubleshooting](./e2e-troubleshooting.md) – Common issues and fixes
- [E2E Lessons Learned](./e2e-lessons-learned.md) – Hard-won insights
- Spec #011 (archived) – Specification
- Spec #018 (archived) – E2E infrastructure overhaul (POM pattern, fixtures, condition-based waits)
- [Test ID constants](../../src/renderer/src/constants/testids.ts) – Source code
- [POM classes](../../e2e/pages/) – Page Object Model implementations
- [Fixtures](../../e2e/fixtures/index.ts) – Composed Playwright fixtures (POM, project, settings, open-file)
- [Wait helpers](../../e2e/utils/wait-helpers.ts) – Race-safe IPC wait utilities

---

## Prerequisites

- Node.js 24+
- Playwright installed: `npm install --save-dev @playwright/test`

---

## Quick start

### Running tests

```bash
# Functional E2E tests
npm run test:e2e

# Run with visible window
npm run test:e2e:headed

# Visual regression tests
npm run test:e2e:visual

# Update visual baselines
npm run test:e2e:update-screenshots
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

Two Playwright projects are configured:

| Project | Test match | Retries | Purpose |
|---------|-----------|---------|---------|
| `electron` | `**/*.e2e.ts` (ignores `visual-regression*`) | 1 | Functional E2E tests |
| `visual` | `**/visual-regression.e2e.ts` | 0 | Screenshot comparison (diffs must be investigated) |

Visual project settings: `snapshotDir: './e2e/screenshots'`, `snapshotPathTemplate: '{snapshotDir}/{arg}-{platform}{ext}'`, `maxDiffPixelRatio: 0.01`, `animations: 'disabled'`.

See `playwright.config.ts` for the full configuration.

---

## Page Object Model (POM) architecture

Erfana E2E tests use a Page Object Model pattern with composed Playwright fixtures.

### POM classes

Located in `e2e/pages/`:

| Class | Purpose |
|-------|---------|
| `KeyboardHelper` | Platform-aware keyboard shortcuts (Cmd/Ctrl abstraction) |
| `TerminalPage` | Terminal interactions – `waitForPrompt()`, `sendCommand()`, `waitForOutput()` |
| `MonacoPage` | Editor interactions – `waitForReady()`, `focus()`, `setContent()`, `getContent()` |
| `MermaidPage` | Mermaid diagram interactions |
| `ProjectTreePage` | Project tree navigation and file operations |

### Composed fixtures

Import `test` from `e2e/fixtures/index.ts` to get POM instances as fixtures:

```typescript
import { test, expect } from '../fixtures'

test('terminal sends command', async ({ terminalPage }) => {
  await terminalPage.waitForPrompt()
  await terminalPage.sendCommand('echo hello')
  await terminalPage.waitForOutput('hello')
})
```

Available fixtures:

| Fixture | Scope | Description |
|---------|-------|-------------|
| `userDataDir` | Worker | Isolated Electron user data directory |
| `app` | Test | Electron application instance |
| `window` | Test | First window page |
| `keyboardHelper` | Test | Platform-aware keyboard shortcuts |
| `terminalPage` | Test | Terminal POM instance |
| `monacoPage` | Test | Monaco editor POM instance |
| `mermaidPage` | Test | Mermaid diagram POM instance |
| `projectTreePage` | Test | Project tree POM instance |

### Project and setup fixtures

Additional fixtures for tests that need a project directory, settings, or an open file:

| Fixture | Scope | Description |
|---------|-------|-------------|
| `testProject` | Test | Creates an isolated temp directory with configurable seed files; auto-cleanup on teardown |
| `withSettings` | Test | Writes `.erfana/settings.json` into the project (no teardown – testProject owns cleanup) |
| `withOpenFile` | Test | Opens a file in the editor, waits for Monaco readiness, provides a `MonacoPage` |
| `appWithTestProject` | Test | Launches Electron with the `testProject` path as argument |
| `windowWithTestProject` | Test | First window page from `appWithTestProject` |

Configure via option fixtures with `test.use()`:

```typescript
import { test, expect } from '../fixtures'

test.use({
  testProjectFiles: { 'notes.md': '# Notes\n\nSeed content.' },
  openFilePath: 'notes.md'
})

test('editor opens seed file', async ({ withOpenFile }) => {
  const content = await withOpenFile!.getContent()
  expect(content).toContain('Seed content')
})
```

### Wait helpers

Located in `e2e/utils/wait-helpers.ts`:

| Helper | Purpose |
|--------|---------|
| `waitForIpcComplete` | Race-safe IPC wait – uses `Promise.all` to observe a UI state change triggered by an async operation |

```typescript
import { waitForIpcComplete } from '../utils/wait-helpers'

await waitForIpcComplete({
  locator: byTestId(page, 'title-bar'),
  expectedState: 'visible',
  trigger: () => keyboard.save()
})
```

### Backward compatibility

The `e2e/utils/helpers.ts` adapter provides backward compatibility – existing tests using namespace helpers (e.g., `monaco.focus(page)`) continue to work. The adapter uses WeakMap-based caching to delegate calls to POM instances internally.

### Fixture dependency graph

```
Worker: userDataDir
Test:   app → window → POM fixtures (keyboardHelper, terminalPage, monacoPage, ...)
        appWithProject → windowWithProject
        testProject → appWithTestProject → windowWithTestProject
                    → withSettings (side effect)
                                           → withOpenFile (provides MonacoPage)
```

### Fixture selection guide

| Scenario | Fixtures to use |
|----------|----------------|
| Basic app launch, no project | `app`, `window`, POM fixtures |
| Existing project directory | `appWithProject`, `windowWithProject` |
| Isolated temp project (default seed) | `testProject`, `appWithTestProject`, `windowWithTestProject` |
| Custom seed files | `test.use({ testProjectFiles: { ... } })` + above |
| Project settings | `test.use({ projectSettings: { ... } })` + `withSettings` |
| Open a file in editor | `test.use({ openFilePath: 'file.md' })` + `withOpenFile` |

> **Note**: `withOpenFile` uses `clickFileByName` (basename match). This works for flat projects with unique filenames. For nested projects with duplicate basenames, instantiate `ProjectTreePage` and use `clickFileInTree()` directly.

### Condition-based waits

Prefer condition-based waits over `waitForTimeout`:

| Instead of | Use |
|------------|-----|
| `waitForTimeout(1000)` after terminal init | `terminalPage.waitForPrompt()` |
| `waitForTimeout(500)` after command | `terminalPage.waitForOutput(expected)` |
| `waitForTimeout(N)` for element | Playwright auto-waiting (`toBeVisible()`, `toBeAttached()`) |

When a timeout is truly necessary (e.g., animation settling), annotate it with `// KNOWN_WAIT: <reason>`.

### Shared locator utilities

Located in `e2e/utils/locators.ts`:

```typescript
import { byTestId, byDynamicTestId, waitForTestId, waitForTestIdHidden } from '../utils/locators'

// Static testid
const btn = byTestId(page, 'activity-bar-btn-files')

// Dynamic testid (with path hash)
const node = byDynamicTestId(page, 'project-tree-node', filePath)

// Wait for visibility
await waitForTestId(page, 'terminal-instance')
await waitForTestIdHidden(page, 'dialog-overlay')
```

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

## Environment setup

### API key configuration

Some E2E tests require external API credentials:

1. Create `.env` file in project root with your API keys:
   ```bash
   OPENAI_API_KEY=your-key-here
   ```

2. See `.env.example` for all available environment variables

3. Tests requiring API keys will skip gracefully if the variable is not set

### Test files

- `app-launch.e2e.ts` – Application launch, activity bar, welcome panel visibility
- `third-party-components.e2e.ts` – Monaco editor, xterm.js terminal, Mermaid diagrams
- `directory-watcher.e2e.ts` – Directory watcher pipeline verification
- `audio-transcription.e2e.ts` – Full audio import transcription lifecycle (real OpenAI API, requires `OPENAI_API_KEY`, skips if not set)
- `context-menu-explain.e2e.ts` – Context-menu Explain prompt flow end-to-end in both preview and editor contexts (right-click → Explain → terminal opens)
- `document-import.e2e.ts` – Full LiteParse document-import UI lifecycle: file dialog stub → DocumentImportDialog options → conversion → result on disk
- `fixture-smoke.e2e.ts` – Smoke tests for the composed Playwright fixtures (`testProject`, `withSettings`, `appWithTestProject`, `windowWithTestProject`, `withOpenFile`)
- `settings-logs.e2e.ts` – Settings overlay "Logs folder" section: path display and the "Open" reveal button
- `terminal-expand.e2e.ts` – Terminal maximize over the editor area (Cmd/Ctrl+Shift+M and header button); covers the AppDockLayout splitview manipulation that has no unit test (dockview is not mocked)
- `terminal-resize.e2e.ts` – Regression guard for the editor/terminal sash drag — simulates a real mouse drag and asserts the editor area actually shrinks (would fail on v0.10.0 unfixed; see [CHANGELOG § 0.10.1](../CHANGELOG.md#0101))
- `visual-regression.e2e.ts` – Visual regression for 5 UI states (welcome, editor, terminal, settings, confirm dialog)

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
