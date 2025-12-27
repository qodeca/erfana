/**
 * Playwright test fixtures for Erfana Electron app.
 *
 * Provides reusable test fixtures for:
 * - App launch and cleanup
 * - Window management
 * - Project context
 *
 * @see docs/testing/e2e-testing.md - E2E testing documentation
 * @see e2e/utils/helpers.ts - Test helper utilities
 *
 * @example Basic usage
 * ```typescript
 * import { test, expect } from './fixtures';
 * import { TEST_IDS, byTestId } from './utils/helpers';
 *
 * test('activity bar is visible', async ({ window }) => {
 *   const activityBar = byTestId(window, TEST_IDS.ACTIVITY_BAR);
 *   await expect(activityBar).toBeVisible();
 * });
 * ```
 *
 * @example With project loaded
 * ```typescript
 * import { test, expect } from './fixtures';
 * import { TEST_IDS, byTestId } from './utils/helpers';
 *
 * test('opens project files', async ({ appWithProject, windowWithProject }) => {
 *   const projectTree = byTestId(windowWithProject, TEST_IDS.PROJECT_TREE);
 *   await expect(projectTree).toBeVisible();
 * });
 * ```
 */

import {
  test as base,
  expect,
  _electron as electron,
  ElectronApplication,
  Page
} from '@playwright/test'
import path from 'path'
import { TEST_IDS, byTestId } from './utils/helpers'

/**
 * Path to the Erfana project root (for launching the app).
 */
const PROJECT_ROOT = path.join(__dirname, '..')

/**
 * Default test project path for tests that need a project loaded.
 * Can be overridden via environment variable: ERFANA_TEST_PROJECT
 */
const DEFAULT_TEST_PROJECT = process.env.ERFANA_TEST_PROJECT || PROJECT_ROOT

/**
 * Test fixtures type definitions.
 */
type TestFixtures = {
  /**
   * Launched Electron application instance.
   * The app is automatically closed after each test.
   */
  app: ElectronApplication

  /**
   * The first (main) window of the app.
   * Waits for domcontentloaded before returning.
   */
  window: Page

  /**
   * Electron app instance with a project loaded.
   * Passes the test project path as CLI argument.
   */
  appWithProject: ElectronApplication

  /**
   * Window from an app with a project loaded.
   */
  windowWithProject: Page
}

/**
 * Extended Playwright test with Erfana-specific fixtures.
 *
 * @example
 * ```typescript
 * import { test, expect } from './fixtures';
 * import { TEST_IDS, byTestId } from './utils/helpers';
 *
 * test('shows activity bar', async ({ window }) => {
 *   const bar = byTestId(window, TEST_IDS.ACTIVITY_BAR);
 *   await expect(bar).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<TestFixtures>({
  /**
   * Launches the Electron app and provides it to the test.
   * Automatically closes the app after the test completes.
   */
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)

    // Cleanup: close app after test
    await app.close()
  },

  /**
   * Gets the first window and waits for it to be ready.
   */
  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for the activity bar to be visible (app is ready)
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    await use(window)
  },

  /**
   * Launches the Electron app with a project path argument.
   */
  // eslint-disable-next-line no-empty-pattern
  appWithProject: async ({}, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, DEFAULT_TEST_PROJECT],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)

    // Cleanup
    await app.close()
  },

  /**
   * Gets the first window from an app with a project loaded.
   */
  windowWithProject: async ({ appWithProject }, use) => {
    const window = await appWithProject.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for activity bar (app is ready)
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    // Wait for project tree to be populated (project is loaded)
    await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({ state: 'visible', timeout: 15000 })

    await use(window)
  }
})

// Re-export expect for convenience
export { expect }

/**
 * Helper to get the test project path.
 * Useful for tests that need to reference files within the test project.
 */
export function getTestProjectPath(): string {
  return DEFAULT_TEST_PROJECT
}

/**
 * Creates a custom app launcher with specific configuration.
 *
 * @param options - Launch configuration options
 * @returns Function to launch the configured app
 *
 * @example
 * ```typescript
 * const launchWithProject = createAppLauncher({
 *   projectPath: '/path/to/test/project',
 *   env: { DEBUG: 'true' }
 * });
 *
 * test('custom project', async () => {
 *   const app = await launchWithProject();
 *   // ... test code
 *   await app.close();
 * });
 * ```
 */
export function createAppLauncher(options: {
  projectPath?: string
  env?: Record<string, string>
  args?: string[]
}) {
  return async (): Promise<ElectronApplication> => {
    const args = [PROJECT_ROOT]

    if (options.projectPath) {
      args.push(options.projectPath)
    }

    if (options.args) {
      args.push(...options.args)
    }

    return electron.launch({
      args,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ...options.env
      }
    })
  }
}

/**
 * Fixture extension for tests that need multiple windows.
 *
 * @example
 * ```typescript
 * import { testMultiWindow } from './fixtures';
 *
 * testMultiWindow('opens second window', async ({ app, window }) => {
 *   // Trigger new window action (Cmd/Ctrl+Shift+N)
 *   await window.keyboard.press('Meta+Shift+N');
 *
 *   // Wait for second window
 *   const windows = app.windows();
 *   expect(windows.length).toBe(2);
 * });
 * ```
 */
export const testMultiWindow = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, '--enable-multi-window'],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)
    await app.close()
  },

  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    await use(window)
  },

  // eslint-disable-next-line no-empty-pattern
  appWithProject: async ({}, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, DEFAULT_TEST_PROJECT],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)
    await app.close()
  },

  windowWithProject: async ({ appWithProject }, use) => {
    const window = await appWithProject.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    await use(window)
  }
})

/**
 * Describes a test suite that uses standard fixtures.
 * Alias for test.describe for consistency.
 */
export const describe = test.describe

/**
 * Marks a test as only (skip all other tests).
 * Alias for test.only.
 */
export const only = test.only

/**
 * Skips a test.
 * Alias for test.skip.
 */
export const skip = test.skip

/**
 * Creates a test with beforeEach/afterEach hooks.
 *
 * @example
 * ```typescript
 * import { withHooks, test } from './fixtures';
 * import { TEST_IDS, byTestId } from './utils/helpers';
 *
 * withHooks({
 *   beforeEach: async ({ window }) => {
 *     // Open settings before each test
 *     await byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).click();
 *   },
 *   afterEach: async ({ window }) => {
 *     // Close settings after each test
 *     await window.keyboard.press('Escape');
 *   }
 * })('settings tests', () => {
 *   test('shows editor section', async ({ window }) => {
 *     // Settings is already open
 *     await expect(byTestId(window, TEST_IDS.SETTINGS_SECTION_EDITOR)).toBeVisible();
 *   });
 * });
 * ```
 */
export function withHooks(hooks: {
  beforeEach?: (fixtures: TestFixtures) => Promise<void>
  afterEach?: (fixtures: TestFixtures) => Promise<void>
}) {
  return (name: string, fn: () => void): void => {
    test.describe(name, () => {
      if (hooks.beforeEach) {
        test.beforeEach(async ({ app, window, appWithProject, windowWithProject }) => {
          await hooks.beforeEach!({ app, window, appWithProject, windowWithProject })
        })
      }

      if (hooks.afterEach) {
        test.afterEach(async ({ app, window, appWithProject, windowWithProject }) => {
          await hooks.afterEach!({ app, window, appWithProject, windowWithProject })
        })
      }

      fn()
    })
  }
}
