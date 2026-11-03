// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Playwright fixtures for the built-in browser (spec 025 solution design
 * § 12, T2, T6, T22): the fixture servers (`browser/serve.ts`), the app
 * launched with the sealed-network switches and a test project open, and the
 * browser POMs.
 *
 * ```ts
 * import { test, expect } from './fixtures/browserHarness'
 * test('025-AC-003 …', async ({ browserTabs, browserServers }) => {
 *   const page = await browserTabs.open()
 *   await browserTabs.navigate(page.tabId, browserServers.sites.static.url('/index.html'))
 * })
 * ```
 */
import * as path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'
import { BrowserTabPage } from '../pages/browser-tab.page'
import { BROWSER_CHROMIUM_ARGS, test as serveTest } from './browser/serve'
import { E2E_CHROMIUM_ARGS, buildAppEnv, closeAppAndWait } from './isolation'

const PROJECT_ROOT = path.join(__dirname, '..', '..')

/** An app this spec launched itself (for a restart), with a project open. */
export interface LaunchedBrowserApp {
  readonly app: ElectronApplication
  readonly window: Page
  readonly tabs: BrowserTabPage
  /** Open another project in the same window (a project switch). */
  openProject(projectPath: string): Promise<void>
  close(): Promise<void>
}

async function openProjectIn(window: Page, projectPath: string): Promise<void> {
  await window.evaluate(async (p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, untyped in e2e
    await (window as any).api.file.openProjectByPath({ projectPath: p })
  }, projectPath)
  await byTestId(window, TEST_IDS.PROJECT_TREE).waitFor({ state: 'visible', timeout: 15000 })
}

/**
 * Launch Erfana as the fixtures do – same user data, same sandbox home, the
 * sealed-network switches – and open `projectPath`. For specs that restart
 * the app: close the previous launch first.
 */
export async function launchBrowserApp(options: {
  userDataDir: string
  homeDir: string
  projectPath: string
}): Promise<LaunchedBrowserApp> {
  const app = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${options.userDataDir}`, ...E2E_CHROMIUM_ARGS, ...BROWSER_CHROMIUM_ARGS],
    env: buildAppEnv({ homeDir: options.homeDir })
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await byTestId(window, TEST_IDS.ACTIVITY_BAR).waitFor({ state: 'visible', timeout: 10000 })
    await openProjectIn(window, options.projectPath)
    const tabs = new BrowserTabPage(app, window)
    await tabs.installRecorder()
    return {
      app,
      window,
      tabs,
      openProject: (projectPath) => openProjectIn(window, projectPath),
      close: () => closeAppAndWait(app)
    }
  } catch (error) {
    await closeAppAndWait(app)
    throw error
  }
}

export const test = serveTest.extend<{ browserTabs: BrowserTabPage }>({
  // Every browser launch reaches *.test through the fixture servers only.
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies by destructuring
  extraLaunchArgs: async ({}, use) => {
    await use([...BROWSER_CHROMIUM_ARGS])
  },
  browserTabs: async ({ appWithTestProject, windowWithTestProject }, use) => {
    const tabs = new BrowserTabPage(appWithTestProject, windowWithTestProject)
    await tabs.installRecorder()
    await use(tabs)
  }
})

export { expect } from './browser/serve'
export type { BrowserFixtureServers } from './browser/serve'
