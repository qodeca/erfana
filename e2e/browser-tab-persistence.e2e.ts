// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser profile per project, across project switches and restarts
 * (spec 025 commit 7: 025-AC-006, the e2e part of 025-AC-015; 025-AC-023:
 * Clear browsing data reaches the cookie database).
 *
 * Each spec launches the app itself so it can restart it on the same user
 * data, sandbox home and project folders. The staging site is used over
 * `http`: trusting the test CA arrives with the certificate commit (12c).
 * Condition-based waits only.
 *
 * SIGN-IN ACROSS A RESTART (025-AC-015, last spec). The app runs with the
 * Chromium sandbox on, as shipped – no `--no-sandbox` anywhere in the e2e
 * launch. On macOS Chromium always sandboxes the network service, and Electron
 * 44 lets that sandbox write only below `app.getPath('sessionData')`. The
 * Chromium profile therefore lives in `<userData>/browser-profiles/<name>/chromium`
 * (ADR 0009 decision 1, amended 2026-11-03); the spec proves its cookie
 * database is written there and the sign-in survives a restart. (A profile in
 * the project folder, as first built, never wrote one – every sign-in was
 * lost at quit.)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { test, expect, launchBrowserApp, type BrowserFixtureServers, type LaunchedBrowserApp } from './fixtures/browserHarness'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'
import { SESSION_COOKIE, STAGING_LOGIN } from './fixtures/browser/serve'
import type { BrowserPagePage } from './pages/browser-page.page'
import { chromiumProfileDir } from './pages/browser-profile.page'

/** Open the staging home page in a new tab and wait for its session state. */
async function openStaging(launched: LaunchedBrowserApp, servers: BrowserFixtureServers): Promise<BrowserPagePage> {
  const url = servers.sites.staging.url('/')
  const page = await launched.tabs.open()
  await launched.tabs.navigate(page.tabId, url)
  await page.waitFor(`location.href === ${JSON.stringify(url)} && !!document.documentElement.dataset.session`, 'staging session known')
  return page
}

const session = (page: BrowserPagePage): Promise<string> => page.eval<string>('document.documentElement.dataset.session')

/** Sign in with the staging form, typing through the input harness. */
async function signIn(page: BrowserPagePage): Promise<void> {
  await page.fill('#login-username', STAGING_LOGIN.username)
  await page.fill('#login-password', STAGING_LOGIN.password)
  await page.clickSelector('#login-submit')
  await page.waitFor(`document.documentElement.dataset.session === 'signed-in'`, 'signed in')
}

async function hasSessionCookie(page: BrowserPagePage, servers: BrowserFixtureServers): Promise<boolean> {
  return (await page.cookies(servers.sites.staging.url('/'))).some((c) => c.name === SESSION_COOKIE)
}

test.describe('built-in browser profile per project', () => {
  let projectB: string
  let launched: LaunchedBrowserApp | null = null

  test.beforeEach(async () => {
    await fs.promises.mkdir(E2E_TEMP_DIR, { recursive: true })
    projectB = await fs.promises.mkdtemp(path.join(E2E_TEMP_DIR, 'browser-b-'))
    await fs.promises.writeFile(path.join(projectB, 'b.md'), '# B\n', 'utf-8')
  })

  test.afterEach(async () => {
    await launched?.close()
    launched = null
    await removeDirWithRetry(projectB)
  })

  test('025-AC-015 logins stay in their own project profile, apart from other projects', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    const inA = await openStaging(launched, browserServers)
    expect(await session(inA)).toBe('signed-out')
    await signIn(inA)
    expect(await hasSessionCookie(inA, browserServers)).toBe(true)
    // Erfana's own files in the project; the Chromium profile in user data
    expect(fs.existsSync(path.join(testProject.path, '.erfana', 'browser', 'profile', 'Erfana', 'marker.json'))).toBe(true)
    const chromiumA = await chromiumProfileDir(userDataDir, testProject.path)
    expect(chromiumA).not.toBeNull()

    // Project B in the same window: its own profile, signed out, no staging cookie.
    await launched.openProject(projectB)
    const inB = await openStaging(launched, browserServers)
    expect(await session(inB)).toBe('signed-out')
    expect(await hasSessionCookie(inB, browserServers)).toBe(false)
    expect(fs.existsSync(path.join(projectB, '.erfana', 'browser', 'profile', 'Erfana', 'marker.json'))).toBe(true)
    const chromiumB = await chromiumProfileDir(userDataDir, projectB)
    expect(chromiumB).not.toBeNull()
    expect(chromiumB).not.toBe(chromiumA)

    // Back to project A: its session again, still signed in.
    await launched.openProject(testProject.path)
    const backInA = await openStaging(launched, browserServers)
    expect(await session(backInA)).toBe('signed-in')
    expect(await hasSessionCookie(backInA, browserServers)).toBe(true)
  })

  test('025-AC-006 no browser tab is restored after a project reopen or a restart, and the sign-in stays', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    const first = await openStaging(launched, browserServers)
    await signIn(first)
    await openStaging(launched, browserServers)
    expect(await launched.tabs.tabs()).toHaveLength(2)

    // Close the project (switch away) and reopen it: no tab comes back.
    await launched.openProject(projectB)
    await expect.poll(() => launched!.tabs.tabs()).toEqual([])
    await launched.openProject(testProject.path)
    expect(await launched.tabs.tabs()).toEqual([])
    await expect.poll(() => launched!.tabs.browserSessionContents()).toEqual([])
    expect(await session(await openStaging(launched, browserServers))).toBe('signed-in')

    // Restart: no tab comes back (sign-in across a restart: the last spec).
    await launched.close()
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    expect(await launched.tabs.tabs()).toEqual([])
    expect(await launched.tabs.browserSessionContents()).toEqual([])
  })

  test('025-AC-015 the project profile writes its cookie database, and the sign-in survives a restart', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    await signIn(await openStaging(launched, browserServers))
    const chromium = await chromiumProfileDir(userDataDir, testProject.path)
    expect(chromium, 'the project has a Chromium folder under user data').not.toBeNull()
    const cookieDb = path.join(chromium!, 'Cookies')
    const origin = new URL(browserServers.sites.staging.url('/')).origin
    // Flush the tab's own session: the cookie store writes on a timer otherwise.
    const flushed = await launched.app.evaluate(async ({ webContents }, o) => {
      const tab = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(o))
      if (!tab) return false
      await tab.session.cookies.flushStore()
      return true
    }, origin)
    expect(flushed).toBe(true)
    await expect.poll(() => fs.existsSync(cookieDb), { message: `${cookieDb} written` }).toBe(true)
    // Nothing of Chromium's is written into the project
    expect(fs.existsSync(path.join(testProject.path, '.erfana', 'browser', 'profile', 'Cookies'))).toBe(false)

    await launched.close()
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    const after = await openStaging(launched, browserServers)
    expect(await session(after)).toBe('signed-in')
    expect(await hasSessionCookie(after, browserServers)).toBe(true)
  })

  test('025-AC-023 Clear browsing data removes the sign-in from the cookie database too: still signed out after a restart', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    await signIn(await openStaging(launched, browserServers))
    const none = { cookies: false, cache: false, permissions: false, credentials: false, captures: false }
    const answer = await launched.window.evaluate(
      (categories) =>
        (window as unknown as { api: { browserTab: { clearData: (c: unknown) => Promise<unknown> } } }).api.browserTab.clearData(categories),
      { ...none, cookies: true }
    )
    expect(answer).toEqual({ failed: [] })
    await launched.app.evaluate(async ({ webContents }, o) => {
      const tab = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(o))
      await tab?.session.cookies.flushStore()
    }, new URL(browserServers.sites.staging.url('/')).origin)

    await launched.close()
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    const after = await openStaging(launched, browserServers)
    expect(await session(after)).toBe('signed-out')
    expect(await hasSessionCookie(after, browserServers)).toBe(false)
  })
})
