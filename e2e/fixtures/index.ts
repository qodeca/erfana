/**
 * Composed Playwright fixture export.
 *
 * Merges all fixture sets into a single `test` export that tests can import.
 * Chain order matters: app → project → POM → editor (each layer depends on layers above).
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

type WorkerFixtures = {
  userDataDir: string
}

type TestFixtures = {
  app: ElectronApplication
  window: Page
  appWithProject: ElectronApplication
  windowWithProject: Page
  // Test project fixtures
  testProjectFiles: Record<string, string>
  testProject: { path: string }
  projectSettings: Record<string, unknown> | undefined
  withSettings: void
  openFilePath: string | undefined
  appWithTestProject: ElectronApplication
  windowWithTestProject: Page
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
    try {
      await app.close()
    } catch {
      // App may already be closed (e.g. crash during test)
    }
  },

  // Test-scoped: main window
  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })

    await use(window)
  },

  // Test-scoped: app with project loaded
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
    try {
      await app.close()
    } catch {
      // App may already be closed (e.g. crash during test)
    }
  },

  // Test-scoped: window with project loaded
  windowWithProject: async ({ appWithProject }, use) => {
    const window = await appWithProject.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })
    await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({ state: 'visible', timeout: 15000 })

    await use(window)
  },

  // --- Test project fixtures ---

  // Option: seed files for testProject (override with test.use())
  testProjectFiles: [{}, { option: true }],

  // Test-scoped: isolated project directory with seed files
  testProject: async ({ testProjectFiles }, use) => {
    const e2eTempDir = path.join(__dirname, '..', '..', '.e2e-temp')
    await fs.promises.mkdir(e2eTempDir, { recursive: true })

    const projectPath = await fs.promises.mkdtemp(path.join(e2eTempDir, 'test-'))
    const files =
      Object.keys(testProjectFiles).length > 0
        ? testProjectFiles
        : { 'test.md': '# Test Document\n\nTest content.\n' }

    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(projectPath, name)
      const resolved = path.resolve(filePath)
      if (!resolved.startsWith(path.resolve(projectPath) + path.sep)) {
        throw new Error(`testProjectFiles key "${name}" escapes project directory`)
      }
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, content, 'utf-8')
    }

    await use({ path: projectPath })

    try {
      await fs.promises.rm(projectPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors – must not mask test failures
    }
  },

  // Option: project settings to write (override with test.use())
  projectSettings: [undefined, { option: true }],

  // Test-scoped: writes .erfana/settings.json to testProject before use.
  // Note: restore logic is defensive – testProject always creates a fresh dir,
  // so pre-existing settings won't exist. Kept for future decoupling from testProject.
  withSettings: async ({ testProject, projectSettings }, use) => {
    const settingsDir = path.join(testProject.path, '.erfana')
    const settingsFile = path.join(settingsDir, 'settings.json')

    let originalContent: string | undefined
    let settingsExisted = false

    if (projectSettings !== undefined) {
      try {
        originalContent = await fs.promises.readFile(settingsFile, 'utf-8')
        settingsExisted = true
      } catch {
        // File does not exist – will be created fresh
      }

      await fs.promises.mkdir(settingsDir, { recursive: true })
      await fs.promises.writeFile(
        settingsFile,
        JSON.stringify(projectSettings, null, 2),
        'utf-8'
      )
    }

    await use()

    // Teardown: restore or remove settings file
    if (projectSettings !== undefined) {
      try {
        if (settingsExisted && originalContent !== undefined) {
          await fs.promises.writeFile(settingsFile, originalContent, 'utf-8')
        } else {
          await fs.promises.rm(settingsFile, { force: true })
        }
      } catch {
        // Ignore cleanup errors – must not mask test failures
      }
    }
  },

  // Option: file path to open in editor (override with test.use())
  openFilePath: [undefined, { option: true }],

  // Test-scoped: app launched with testProject path
  appWithTestProject: async ({ userDataDir, testProject }, use) => {
    const app = await electron.launch({
      args: [PROJECT_ROOT, testProject.path, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)

    // KNOWN_WAIT: electron-log flush before close (teardown path, not assertion)
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await app.close()
    } catch {
      // App may already be closed (e.g. crash during test)
    }
  },

  // Test-scoped: window from appWithTestProject
  windowWithTestProject: async ({ appWithTestProject }, use) => {
    const window = await appWithTestProject.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })
    await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({ state: 'visible', timeout: 15000 })

    await use(window)
  },

  // Test-scoped: opens a file in the editor and provides MonacoPage
  withOpenFile: async ({ windowWithTestProject, openFilePath }, use) => {
    if (openFilePath === undefined) {
      await use(undefined)
      return
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
