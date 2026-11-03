// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser profile per project, across project switches and restarts
 * (spec 025 commit 7: 025-AC-006, the e2e part of 025-AC-015).
 *
 * Each spec launches the app itself so it can restart it on the same user
 * data, sandbox home and project folders. The staging site is used over
 * `http`: trusting the test CA arrives with the certificate commit (12c).
 * Condition-based waits only.
 *
 * WHY NO SIGN-IN IS CHECKED ACROSS A RESTART HERE. Measured on Electron 44.9.3
 * (macOS, 2026-11-03): an unpackaged Electron – the one e2e runs – never
 * writes a cookie database for any session, the default one included, even
 * after `cookies.flushStore()`; cookies live in memory only. The packaged app,
 * built with the `EnableCookieEncryption` fuse on (ADR 0010), does write it.
 * So "still signed in after a restart" belongs to the packaged lane (commit 10,
 * 025-AC-015 row "packaged"); here a restart is checked for no restored tabs,
 * and sign-in persistence across a project switch and back.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { test, expect, launchBrowserApp, type BrowserFixtureServers, type LaunchedBrowserApp } from './fixtures/browserHarness'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'
import { SESSION_COOKIE, STAGING_LOGIN } from './fixtures/browser/serve'
import type { BrowserPagePage } from './pages/browser-page.page'

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
    expect(fs.existsSync(path.join(testProject.path, '.erfana', 'browser', 'profile'))).toBe(true)

    // Project B in the same window: its own profile, signed out, no staging cookie.
    await launched.openProject(projectB)
    const inB = await openStaging(launched, browserServers)
    expect(await session(inB)).toBe('signed-out')
    expect(await hasSessionCookie(inB, browserServers)).toBe(false)
    expect(fs.existsSync(path.join(projectB, '.erfana', 'browser', 'profile'))).toBe(true)

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

    // Restart: no tab comes back (sign-in across a restart: packaged lane, see the header).
    await launched.close()
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    expect(await launched.tabs.tabs()).toEqual([])
    expect(await launched.tabs.browserSessionContents()).toEqual([])
  })
})
