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
import * as fs from 'fs'
import * as path from 'path'
import { TEST_IDS, byTestId } from './utils/helpers'

/**
 * Creates a worker-scoped userDataDir fixture with a given prefix.
 * Each worker gets a unique temp directory under `.e2e-temp/` that is
 * cleaned up after all tests in the worker complete.
 */
function createUserDataDirFixture(prefix: string) {
  return [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use: (value: string) => Promise<void>, workerInfo: { workerIndex: number }) => {
      const e2eTempDir = path.join(__dirname, '..', '.e2e-temp')
      await fs.promises.mkdir(e2eTempDir, { recursive: true })
      const userDataDir = await fs.promises.mkdtemp(
        path.join(e2eTempDir, `${prefix}${workerInfo.workerIndex}-`)
      )
      await use(userDataDir)
      await fs.promises.rm(userDataDir, { recursive: true, force: true })
    },
    { scope: 'worker' as const }
  ]
}

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
 * Worker-scoped fixtures type definitions.
 *
 * Worker fixtures are shared across all tests in a single worker process.
 * This is more efficient than creating/destroying per test.
 */
type WorkerFixtures = {
  /**
   * Isolated user data directory for the Electron app.
   *
   * Each worker gets its own directory under `.e2e-temp/` to ensure:
   * - No Zustand state pollution between test runs
   * - No localStorage/IndexedDB conflicts
   * - Clean slate for each parallel worker
   *
   * The directory is created before the first test and cleaned up
   * after the last test in the worker.
   */
  userDataDir: string
}

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
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userDataDir: createUserDataDirFixture('worker-') as any,

  /**
   * Launches the Electron app and provides it to the test.
   * Automatically closes the app after the test completes.
   * Uses isolated user data directory to prevent state pollution.
   */
  app: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)

    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
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
   * Uses isolated user data directory to prevent state pollution.
   */
  appWithProject: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, DEFAULT_TEST_PROJECT, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)

    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
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

/**
 * Visual test fixture type definitions.
 * Extends standard fixtures with deterministic sizing and CI video recording.
 */
type VisualTestFixtures = {
  /** Electron app with deterministic 1280x800 window, 1x DPR, and CI video recording. */
  visualApp: ElectronApplication
  /** Window from visual app, ready for screenshot capture. */
  visualWindow: Page
  /** Isolated test project directory with seed markdown files. */
  visualTestProject: string
  /** Visual app with a project loaded. */
  visualAppWithProject: ElectronApplication
  /** Window from visual app with project, ready for screenshot capture. */
  visualWindowWithProject: Page
}

/**
 * Seed files for the visual test project.
 * Creates a minimal project with a known markdown file for deterministic screenshots.
 */
const VISUAL_TEST_SEED_FILES: Record<string, string> = {
  'README.md': `# Visual test project

This is a test document used for visual regression testing.

## Features

- Markdown rendering
- Code blocks
- Lists and headings

\`\`\`typescript
const greeting = 'Hello, world!'
console.log(greeting)
\`\`\`

> A blockquote for visual variety.
`
}

/**
 * Build Electron launch options for visual regression tests.
 * Adds --force-device-scale-factor=1 for consistent rendering and
 * enables video recording when running in CI.
 */
function buildVisualLaunchOptions(
  userDataDir: string,
  projectPath?: string
): { args: string[]; env: Record<string, string>; recordVideo?: { dir: string; size: { width: number; height: number } } } {
  const args = [PROJECT_ROOT, '--force-device-scale-factor=1', `--user-data-dir=${userDataDir}`]
  if (projectPath) {
    args.splice(1, 0, projectPath)
  }

  const opts: ReturnType<typeof buildVisualLaunchOptions> = {
    args,
    env: { ...process.env, NODE_ENV: 'development' }
  }

  if (process.env.CI) {
    opts.recordVideo = {
      dir: path.join(__dirname, '..', 'test-results', 'videos'),
      size: { width: 1280, height: 720 }
    }
  }

  return opts
}

/**
 * Force-close an Electron app by destroying all windows first.
 * BrowserWindow.destroy() skips the 'close' event, preventing quit
 * confirmation dialogs from blocking teardown.
 */
async function forceCloseApp(app: ElectronApplication): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.destroy()
      }
    })
  } catch (e) {
    // App may already be closing – log for CI debugging
    if (process.env.CI) console.warn('forceCloseApp: window destroy failed –', e)
  }
  try {
    await app.close()
  } catch (e) {
    // Process may already be dead after destroy – log for CI debugging
    if (process.env.CI) console.warn('forceCloseApp: app.close() failed –', e)
  }
}

/**
 * Resize the BrowserWindow to exact dimensions via Electron's main process API.
 */
async function resizeBrowserWindow(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.setSize(size.width, size.height)
      win.setContentSize(size.width, size.height)
    }
  }, { width, height })
}

/**
 * Extended Playwright test with visual regression fixtures.
 *
 * Provides fixtures with deterministic window sizing (1280x800 at 1x DPR),
 * CI video recording, and consistent rendering for screenshot comparison.
 *
 * @example
 * ```typescript
 * import { visualTest, expect } from './fixtures';
 *
 * visualTest('welcome panel matches baseline', async ({ visualWindow }) => {
 *   await expect(visualWindow).toHaveScreenshot({ name: 'welcome-empty' });
 * });
 * ```
 */
export const visualTest = base.extend<VisualTestFixtures, WorkerFixtures>({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userDataDir: createUserDataDirFixture('worker-visual-') as any,

  visualApp: async ({ userDataDir }, use) => {
    const opts = buildVisualLaunchOptions(userDataDir)
    const app = await electron.launch(opts)
    await resizeBrowserWindow(app, 1280, 800)
    await use(app)
    await forceCloseApp(app)
  },

  visualWindow: async ({ visualApp }, use) => {
    const window = await visualApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })
    await use(window)
  },

  // eslint-disable-next-line no-empty-pattern
  visualTestProject: async ({}, use) => {
    // Create isolated test project with controlled seed files in .e2e-temp (gitignored).
    // The outer dir uses mkdtemp for worker isolation; the inner project dir has a
    // fixed name so the tree/terminal labels are deterministic across runs (prevents
    // random suffixes from leaking into visual snapshots).
    const e2eTempDir = path.join(__dirname, '..', '.e2e-temp')
    await fs.promises.mkdir(e2eTempDir, { recursive: true })
    const tmpParent = await fs.promises.mkdtemp(path.join(e2eTempDir, 'visual-'))
    const projectPath = path.join(tmpParent, 'visual-project')
    await fs.promises.mkdir(projectPath)
    for (const [name, content] of Object.entries(VISUAL_TEST_SEED_FILES)) {
      await fs.promises.writeFile(path.join(projectPath, name), content, 'utf-8')
    }
    await use(projectPath)
    await fs.promises.rm(tmpParent, { recursive: true, force: true })
  },

  visualAppWithProject: async ({ userDataDir }, use) => {
    const opts = buildVisualLaunchOptions(userDataDir)
    const app = await electron.launch(opts)
    await resizeBrowserWindow(app, 1280, 800)
    await use(app)
    await forceCloseApp(app)
  },

  visualWindowWithProject: async ({ visualAppWithProject, visualTestProject }, use) => {
    const window = await visualAppWithProject.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    // Open the project via IPC – Erfana's main process does not parse project paths
    // from process.argv; the CLI arg in appWithProject only works because electron-store
    // restores the last project. With isolated userDataDir (no persisted state),
    // IPC openProjectByPath is the only reliable way to load a specific project.
    await window.evaluate(async (projectPath: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).api.file.openProjectByPath(projectPath)
    }, visualTestProject)

    // Wait for file nodes to appear in the project tree
    const fileNodes = window.locator(`[data-testid^="project-tree-node-file-"]`)
    await expect(fileNodes.first()).toBeVisible({ timeout: 15000 })

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
 *   userDataDir: '/tmp/test-user-data',
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
  userDataDir?: string
  env?: Record<string, string>
  args?: string[]
}) {
  return async (): Promise<ElectronApplication> => {
    const args = [PROJECT_ROOT]

    if (options.projectPath) {
      args.push(options.projectPath)
    }

    if (options.userDataDir) {
      args.push(`--user-data-dir=${options.userDataDir}`)
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
export const testMultiWindow = base.extend<TestFixtures, WorkerFixtures>({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userDataDir: createUserDataDirFixture('worker-multiwin-') as any,

  app: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, '--enable-multi-window', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)
    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await app.close()
  },

  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    await use(window)
  },

  appWithProject: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, DEFAULT_TEST_PROJECT, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)
    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
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
