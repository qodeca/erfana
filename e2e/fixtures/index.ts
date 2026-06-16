// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Composed Playwright fixture export.
 *
 * Merges all fixture sets into a single `test` export that tests can import.
 * Chain order matters: app → project → POM → editor (each layer depends on layers above).
 *
 * Fixture dependency graph:
 * ```
 * Worker: userDataDir
 * Test:   app → window → POM fixtures (keyboardHelper, terminalPage, monacoPage, ...)
 *         appWithProject → windowWithProject
 *         testProject → appWithTestProject → windowWithTestProject
 *                     → withSettings (side effect, must be destructured to activate)
 *                                            → withOpenFile (provides MonacoPage)
 * ```
 *
 * @example
 * ```typescript
 * import { test, expect } from './fixtures';
 *
 * test('terminal opens', async ({ terminalPage }) => {
 *   await terminalPage.open();
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
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'
import { KeyboardHelper } from '../pages/keyboard.helper'
import { TerminalPage } from '../pages/terminal.page'
import { MonacoPage } from '../pages/monaco.page'
import { MermaidPage } from '../pages/mermaid.page'
import { ProjectTreePage } from '../pages/project-tree.page'

const PROJECT_ROOT = path.join(__dirname, '..', '..')
const DEFAULT_TEST_PROJECT = process.env.ERFANA_TEST_PROJECT || PROJECT_ROOT

/** Default seed files used when `testProjectFiles` is empty (`{}`). */
const DEFAULT_SEED_FILES: Record<string, string> = {
  'test.md': '# Test Document\n\nTest content.\n'
}

/**
 * Launch an Electron app with consistent teardown.
 *
 * Shared by `app`, `appWithProject`, and `appWithTestProject` fixtures.
 */
async function launchApp(
  args: string[],
  userDataDir: string,
  use: (app: ElectronApplication) => Promise<void>
): Promise<void> {
  const app = await electron.launch({
    args: [...args, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'development' }
  })

  await use(app)

  // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
  await new Promise((resolve) => setTimeout(resolve, 100))
  try {
    await app.close()
  } catch (error) {
    console.warn('[fixture teardown] app.close() failed:', error)
  }
}

/**
 * Get the first window and wait for it to be ready.
 *
 * Shared by `window`, `windowWithProject`, and `windowWithTestProject` fixtures.
 */
async function getReadyWindow(
  app: ElectronApplication,
  options: { waitForProjectTree?: boolean } = {}
): Promise<Page> {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })
  if (options.waitForProjectTree) {
    await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({ state: 'visible', timeout: 15000 })
  }
  return window
}

type WorkerFixtures = {
  userDataDir: string
}

type TestFixtures = {
  app: ElectronApplication
  window: Page
  appWithProject: ElectronApplication
  windowWithProject: Page
  // Test project fixtures
  /**
   * Seed files for testProject. Default: `{}` (uses DEFAULT_SEED_FILES with `test.md`).
   * Override with `test.use({ testProjectFiles: { 'file.md': 'content' } })`.
   */
  testProjectFiles: Record<string, string>
  testProject: { path: string }
  projectSettings: Record<string, unknown> | undefined
  /**
   * Side-effect fixture – writes `.erfana/settings.json` when `projectSettings` is set.
   * Returns `void`; must be destructured in the test signature to activate.
   */
  withSettings: void
  openFilePath: string | undefined
  appWithTestProject: ElectronApplication
  windowWithTestProject: Page
  /**
   * Opens a file in the editor and provides a ready MonacoPage.
   * Returns `undefined` when `openFilePath` is not set.
   * Typed as `MonacoPage | undefined` due to Playwright fixture limitations –
   * use `withOpenFile!` (non-null assertion) when `openFilePath` is configured.
   */
  withOpenFile: MonacoPage | undefined
  // POM fixtures
  keyboardHelper: KeyboardHelper
  terminalPage: TerminalPage
  monacoPage: MonacoPage
  mermaidPage: MermaidPage
  projectTreePage: ProjectTreePage
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped: isolated user data directory
  userDataDir: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const e2eTempDir = path.join(__dirname, '..', '..', '.e2e-temp')
      await fs.promises.mkdir(e2eTempDir, { recursive: true })

      const userDataDir = await fs.promises.mkdtemp(
        path.join(e2eTempDir, `worker-${workerInfo.workerIndex}-`)
      )

      await use(userDataDir)

      await fs.promises.rm(userDataDir, { recursive: true, force: true })
    },
    { scope: 'worker' }
  ],

  // Test-scoped: app launch
  app: async ({ userDataDir }, use) => {
    await launchApp([PROJECT_ROOT], userDataDir, use)
  },

  // Test-scoped: main window
  window: async ({ app }, use) => {
    await use(await getReadyWindow(app))
  },

  // Test-scoped: app with project loaded
  appWithProject: async ({ userDataDir }, use) => {
    await launchApp([PROJECT_ROOT, DEFAULT_TEST_PROJECT], userDataDir, use)
  },

  // Test-scoped: window with project loaded
  windowWithProject: async ({ appWithProject }, use) => {
    await use(await getReadyWindow(appWithProject, { waitForProjectTree: true }))
  },

  // --- Test project fixtures ---

  // Option: seed files for testProject (override with test.use())
  testProjectFiles: [{}, { option: true }],

  // Test-scoped: isolated project directory with seed files
  testProject: async ({ testProjectFiles }, use) => {
    const e2eTempDir = path.join(__dirname, '..', '..', '.e2e-temp')
    await fs.promises.mkdir(e2eTempDir, { recursive: true })

    const projectPath = await fs.promises.mkdtemp(path.join(e2eTempDir, 'test-'))
    const hasCustomFiles = Object.keys(testProjectFiles).length > 0
    const files = hasCustomFiles ? testProjectFiles : DEFAULT_SEED_FILES

    for (const [name, content] of Object.entries(files)) {
      const resolved = path.resolve(projectPath, name)
      const rel = path.relative(path.resolve(projectPath), resolved)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`testProjectFiles key "${name}" escapes project directory`)
      }
      const filePath = path.join(projectPath, name)
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, content, 'utf-8')
    }

    await use({ path: projectPath })

    try {
      await fs.promises.rm(projectPath, { recursive: true, force: true })
    } catch (error) {
      console.warn('[fixture teardown] testProject cleanup failed:', error)
    }
  },

  // Option: project settings to write (override with test.use())
  projectSettings: [undefined, { option: true }],

  // Test-scoped: writes .erfana/settings.json to testProject before use.
  // No teardown needed – testProject owns directory cleanup.
  withSettings: async ({ testProject, projectSettings }, use) => {
    if (projectSettings !== undefined) {
      const settingsDir = path.join(testProject.path, '.erfana')
      await fs.promises.mkdir(settingsDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(settingsDir, 'settings.json'),
        JSON.stringify(projectSettings, null, 2),
        'utf-8'
      )
    }

    await use()
  },

  // Option: file path to open in editor (override with test.use())
  openFilePath: [undefined, { option: true }],

  // Test-scoped: app launched, then the test project is opened via IPC.
  //
  // The main process doesn't parse a project path from CLI args — it strips
  // `--new-window` and ignores the rest (see src/main/index.ts). The legacy
  // pattern of passing `testProject.path` as argv silently fell back to
  // electron-store's last-opened-project memory, which made these fixtures
  // unreliable and forced the `test.fixme` blocks in fixture-smoke.e2e.ts.
  //
  // The canonical pattern lives in the old fixtures.ts visualWindowWithProject
  // (line ~414): launch with no project args, then call the existing
  // `file:openProjectByPath` IPC handler from the renderer to open the path.
  // That handler is already production-tested and respects the project
  // safeguards (path validation, lockfile, watchers).
  appWithTestProject: async ({ userDataDir }, use) => {
    await launchApp([PROJECT_ROOT], userDataDir, use)
  },

  // Test-scoped: window from appWithTestProject with the project opened.
  windowWithTestProject: async ({ appWithTestProject, testProject }, use) => {
    const window = await getReadyWindow(appWithTestProject)
    await window.evaluate(async (projectPath) => {
      // window.api is the preload-bridge contextBridge surface; cast for
      // ergonomics — same shape as fixtures.ts:414-418 uses.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).api.file.openProjectByPath(projectPath)
    }, testProject.path)
    await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({
      state: 'visible',
      timeout: 15000
    })
    await use(window)
  },

  // Test-scoped: opens a file in the editor and provides MonacoPage.
  // Uses clickFileByName (basename match) – works for flat projects with unique filenames.
  // For nested projects with duplicate basenames, use ProjectTreePage.clickFileInTree() directly.
  withOpenFile: async (
    { windowWithTestProject, openFilePath, testProjectFiles },
    use
  ) => {
    if (openFilePath === undefined) {
      await use(undefined)
      return
    }

    const effectiveFiles = Object.keys(testProjectFiles).length > 0
      ? testProjectFiles
      : DEFAULT_SEED_FILES
    if (!(openFilePath in effectiveFiles)) {
      throw new Error(
        `openFilePath "${openFilePath}" not found in testProjectFiles. ` +
          `Available: ${Object.keys(effectiveFiles).join(', ')}`
      )
    }

    const keyboard = new KeyboardHelper(windowWithTestProject)
    const projectTree = new ProjectTreePage(windowWithTestProject)
    const monaco = new MonacoPage(windowWithTestProject, keyboard)

    await projectTree.clickFileByName(path.basename(openFilePath))
    await monaco.waitForReady()

    await use(monaco)
  },

  // --- POM fixtures ---

  // POM fixtures – bound to `window` (no-project window).
  // Tests using `windowWithProject` should instantiate POMs directly:
  //   const terminal = new TerminalPage(windowWithProject)
  keyboardHelper: async ({ window }, use) => {
    await use(new KeyboardHelper(window))
  },

  terminalPage: async ({ window }, use) => {
    await use(new TerminalPage(window))
  },

  monacoPage: async ({ window, keyboardHelper }, use) => {
    await use(new MonacoPage(window, keyboardHelper))
  },

  mermaidPage: async ({ window }, use) => {
    await use(new MermaidPage(window))
  },

  projectTreePage: async ({ window }, use) => {
    await use(new ProjectTreePage(window))
  }
})

export { expect }

export function getTestProjectPath(): string {
  return DEFAULT_TEST_PROJECT
}

// ---------------------------------------------------------------------------
// Visual regression fixtures
// ---------------------------------------------------------------------------
//
// `visualTest` is a separate fixture set tuned for screenshot-based tests:
// deterministic 1280×800 window at 1× DPR, CI-only video recording, and a
// dedicated worker-scoped userDataDir prefix so visual workers don't share
// state with functional workers. Imported by e2e/visual-regression.e2e.ts.
//
// Moved here from the legacy e2e/fixtures.ts in Phase E.2 of the test-infra
// plan. fixtures.ts now re-exports `visualTest` from this module to keep the
// `from './fixtures'` import working until Phase E.4 deletes the file and
// switches visual-regression.e2e.ts to `from './fixtures/index'`.

/**
 * Worker-scoped userDataDir factory with a configurable prefix. Lets the
 * visual fixture set own its own pool of temp dirs so a functional run and
 * a visual run sharing the same worker index don't collide.
 */
function createUserDataDirFixture(prefix: string) {
  return [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use: (value: string) => Promise<void>, workerInfo: { workerIndex: number }) => {
      const e2eTempDir = path.join(__dirname, '..', '..', '.e2e-temp')
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

type VisualTestFixtures = {
  /** Electron app with deterministic 1280×800 window, 1× DPR, and CI video recording. */
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

function buildVisualLaunchOptions(
  userDataDir: string,
  projectPath?: string
): {
  args: string[]
  env: Record<string, string>
  recordVideo?: { dir: string; size: { width: number; height: number } }
} {
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
      dir: path.join(__dirname, '..', '..', 'test-results', 'videos'),
      size: { width: 1280, height: 720 }
    }
  }
  return opts
}

async function forceCloseApp(app: ElectronApplication): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.destroy()
      }
    })
  } catch (e) {
    if (process.env.CI) console.warn('forceCloseApp: window destroy failed –', e)
  }
  try {
    await app.close()
  } catch (e) {
    if (process.env.CI) console.warn('forceCloseApp: app.close() failed –', e)
  }
}

async function resizeBrowserWindow(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.setSize(size.width, size.height)
        win.setContentSize(size.width, size.height)
      }
    },
    { width, height }
  )
}

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
    const e2eTempDir = path.join(__dirname, '..', '..', '.e2e-temp')
    await fs.promises.mkdir(e2eTempDir, { recursive: true })
    const stat = await fs.promises.lstat(e2eTempDir)
    if (stat.isSymbolicLink()) {
      throw new Error(
        `.e2e-temp is a symlink – refusing to create fixture project. Remove or replace with a real directory to continue.`
      )
    }
    const tmpParent = await fs.promises.mkdtemp(path.join(e2eTempDir, 'visual-'))
    try {
      const projectPath = path.join(tmpParent, 'visual-project')
      await fs.promises.mkdir(projectPath)
      for (const [name, content] of Object.entries(VISUAL_TEST_SEED_FILES)) {
        await fs.promises.writeFile(path.join(projectPath, name), content, 'utf-8')
      }
      await use(projectPath)
    } finally {
      await fs.promises
        .rm(tmpParent, { recursive: true, force: true, maxRetries: 3 })
        .catch(() => {
          // ignore – leftover dirs under .e2e-temp are gitignored
        })
    }
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

    // Open the project via IPC – Erfana's main process does not parse project
    // paths from process.argv; the CLI arg in appWithProject only works because
    // electron-store restores the last project. With isolated userDataDir (no
    // persisted state), IPC openProjectByPath is the only reliable way to load
    // a specific project. Same pattern as windowWithTestProject above (Phase E.1).
    await window.evaluate(async (projectPath: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).api.file.openProjectByPath(projectPath)
    }, visualTestProject)

    const fileNodes = window.locator(`[data-testid^="project-tree-node-file-"]`)
    await expect(fileNodes.first()).toBeVisible({ timeout: 15000 })

    await use(window)
  }
})
