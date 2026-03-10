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
    await app.close()
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
    await app.close()
  },

  // Test-scoped: window with project loaded
  windowWithProject: async ({ appWithProject }, use) => {
    const window = await appWithProject.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })
    await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({ state: 'visible', timeout: 15000 })

    await use(window)
  },

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
