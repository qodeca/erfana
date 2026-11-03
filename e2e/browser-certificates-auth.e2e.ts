// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Certificates, HTTP sign-in and the private-network rule of the built-in
 * browser, main side (spec 025 commits 12c–d: the main-observable parts of
 * 025-AC-021 and 025-AC-022, and S-16).
 *
 * There is no browser UI yet, so the window's preload bridge stands in for
 * it: the certificate page is read from `browser-tab:state` (`certificate`,
 * `erfanaPage`, `security`), the sign-in box from `browser-tab:strip`, and
 * the answers go back through `browser-tab:certificate` and
 * `browser-tab:answerStrip` – the renderer's own path. Every answer comes
 * after the test clock passed main's 500 ms input guard; the early-press
 * edges (499 / 500 ms) and the 7-day expiry are proven by the unit suites on
 * a manual clock: moving the app's clock 7 days would fire the hang probe's
 * one-second interval more than 10,000 times, which the test clock refuses.
 *
 * The fixtures' test CA is trusted through the site test hook (probe 10c);
 * the expired, host-mismatch and self-signed fixtures are not affected by it.
 * Condition-based waits only.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, launchBrowserApp, type BrowserFixtureServers, type LaunchedBrowserApp } from './fixtures/browserHarness'
import { BASIC_AUTH } from './fixtures/browser/serve'
import type { BrowserTabPage } from './pages/browser-tab.page'
import type { BrowserPagePage } from './pages/browser-page.page'

/** Main's input guard on the certificate page and on strip rows (025-FR-019, 025-FR-021). */
const INPUT_GUARD_MS = 500
const WAIT_MS = 15_000
/** The fixture's `/basic` sign-in, as the box's fields carry it. */
const CREDENTIALS = { username: BASIC_AUTH.username, password: BASIC_AUTH.password } as const

interface CertificateWarning {
  decisionId: string
  host: string
  code: number
  shownAt: number
}

interface RawState {
  committedUrl: string | null
  erfanaPage: string | null
  security: string
  certificate?: CertificateWarning
}

interface SignInRow {
  requestId: string
  kind: string
  text: string
  takesFocus: boolean
  remembered?: string
  signIn?: { username: string; savedPassword: boolean; insecure: boolean; rejected: string | null; remember: string }
}

interface Recorder {
  __siteStripRows?: Record<string, SignInRow[]>
  __siteStripRecorder?: () => void
  __browserTabStates?: Record<string, RawState>
  api: { browserTab: Record<string, (...args: unknown[]) => unknown> & { onStrip(cb: (e: { tabId: string; op: string; row?: SignInRow }) => void): () => void } }
}

type Hooks = { __erfanaTestHooks?: Record<string, Record<string, (...a: unknown[]) => unknown>> }

/** Call `__erfanaTestHooks.<group>.<name>(...args)` in main. */
async function hook<T>(app: ElectronApplication, group: string, name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [g, n, a]) => {
      const hooks = (globalThis as Hooks).__erfanaTestHooks
      if (!hooks?.[g as string]) throw new Error('Test hooks are not installed (build with npm run build:e2e)')
      return hooks[g as string][n as string](...(a as unknown[]))
    },
    [group, name, args] as const
  )) as T
}

const advance = (app: ElectronApplication, ms: number): Promise<void> => hook(app, 'clock', 'advance', ms)

/** Record every strip row the window is shown, per tab. Idempotent. */
async function installStripRecorder(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as Recorder
    if (w.__siteStripRecorder) return
    w.__siteStripRows = {}
    w.__siteStripRecorder = w.api.browserTab.onStrip((event) => {
      if (event.op !== 'add' || !event.row) return
      ;(w.__siteStripRows![event.tabId] ??= []).push(event.row)
    })
  })
}

function stripRows(window: Page, tabId: string): Promise<SignInRow[]> {
  return window.evaluate((id) => (window as unknown as Recorder).__siteStripRows?.[id] ?? [], tabId)
}

function rawState(window: Page, tabId: string): Promise<RawState | null> {
  return window.evaluate((id) => (window as unknown as Recorder).__browserTabStates?.[id] ?? null, tabId)
}

async function waitForState(window: Page, tabId: string, expected: Partial<RawState>): Promise<RawState> {
  await expect.poll(() => rawState(window, tabId), { timeout: WAIT_MS }).toMatchObject(expected)
  return (await rawState(window, tabId))!
}

/** The certificate page's warning, once it shows. */
async function waitForWarning(window: Page, tabId: string): Promise<CertificateWarning> {
  const state = await waitForState(window, tabId, { erfanaPage: 'certificate', security: 'warningUp' })
  return state.certificate!
}

/** The `index`-th sign-in row shown in `tabId` (0-based), once it shows. */
async function waitForSignIn(window: Page, tabId: string, index = 0): Promise<SignInRow> {
  await expect
    .poll(async () => (await stripRows(window, tabId)).filter((r) => r.kind === 'signIn').length, { timeout: WAIT_MS })
    .toBeGreaterThan(index)
  return (await stripRows(window, tabId)).filter((r) => r.kind === 'signIn')[index]
}

function bridge(window: Page, method: string, request: unknown): Promise<unknown> {
  return window.evaluate(
    ([m, r]) => (window as unknown as Recorder).api.browserTab[m as string](r),
    [method, request] as const
  )
}

/** Answer the certificate page after the input guard. */
async function decide(app: ElectronApplication, window: Page, tabId: string, warning: CertificateWarning, proceed: boolean): Promise<void> {
  await advance(app, INPUT_GUARD_MS)
  await bridge(window, 'certificate', { tabId, decisionId: warning.decisionId, proceed })
}

/** Answer a sign-in row after the input guard. */
async function answerSignIn(
  app: ElectronApplication,
  window: Page,
  tabId: string,
  row: SignInRow,
  answer: 'signIn' | 'cancel',
  fields?: { username?: string; password?: string; remember?: boolean }
): Promise<void> {
  await advance(app, INPUT_GUARD_MS)
  await bridge(window, 'answerStrip', fields === undefined ? { tabId, requestId: row.requestId, answer } : { tabId, requestId: row.requestId, answer, fields })
}

async function openAt(tabs: BrowserTabPage, url: string): Promise<BrowserPagePage> {
  const page = await tabs.open()
  await installStripRecorder(tabs.window)
  await tabs.navigate(page.tabId, url)
  return page
}

const erfanaFile = (projectPath: string, name: string): string => path.join(projectPath, '.erfana', 'browser', 'profile', 'Erfana', name)

/** Open a tab first (the session exists only then), and trust the fixtures' test CA in it. */
async function trustTestCa(tabs: BrowserTabPage, servers: BrowserFixtureServers): Promise<BrowserPagePage> {
  const page = await tabs.open()
  await installStripRecorder(tabs.window)
  expect(await hook<number>(tabs.app, 'site', 'trustTestCa', servers.tls.caPem)).toBeGreaterThan(0)
  return page
}

test.describe('025-FR-021 certificate warning', () => {
  test('025-AC-021 a self-signed page shows the warning page; Proceed anyway after the guard loads it and remembers the exception', async ({
    browserTabs,
    browserServers
  }) => {
    const url = browserServers.certServers.selfSigned.url('/')
    const page = await openAt(browserTabs, url)
    const warning = await waitForWarning(browserTabs.window, page.tabId)
    expect(warning.host).toContain('selfsigned.test')
    expect(warning.code).toBe(-202)

    await decide(browserTabs.app, browserTabs.window, page.tabId, warning, true)
    await page.waitForLoaded(url)
    await waitForState(browserTabs.window, page.tabId, { erfanaPage: null, security: 'proceeded', committedUrl: url })

    // Another tab of the project: the exception covers the same certificate.
    const second = await openAt(browserTabs, url)
    await second.waitForLoaded(url)
    expect((await rawState(browserTabs.window, second.tabId))?.erfanaPage).toBeNull()
  })

  test('025-AC-021 an accepted host that presents a new certificate warns again', async ({
    browserTabs,
    browserServers
  }) => {
    const server = browserServers.certServers.selfSigned
    const url = server.url('/')
    const page = await openAt(browserTabs, url)
    await decide(browserTabs.app, browserTabs.window, page.tabId, await waitForWarning(browserTabs.window, page.tabId), true)
    await page.waitForLoaded(url)
    try {
      server.presentCertificate('second')
      await hook(browserTabs.app, 'site', 'resetConnections')
      const renewed = await openAt(browserTabs, url)
      expect((await waitForWarning(browserTabs.window, renewed.tabId)).code).toBe(-202)
    } finally {
      server.presentCertificate('first')
    }
  })

  test('025-AC-021 expired and host-mismatch certificates each warn; Back to safety with no history shows the empty tab', async ({
    browserTabs,
    browserServers
  }) => {
    // With the test CA trusted, each fixture fails for its own reason only.
    await trustTestCa(browserTabs, browserServers)
    const expired = await openAt(browserTabs, browserServers.certServers.expired.url('/'))
    const expiredWarning = await waitForWarning(browserTabs.window, expired.tabId)
    expect(expiredWarning.code).toBe(-201)
    await decide(browserTabs.app, browserTabs.window, expired.tabId, expiredWarning, false)
    await waitForState(browserTabs.window, expired.tabId, { erfanaPage: 'empty', committedUrl: null })

    const mismatch = await openAt(browserTabs, browserServers.certServers.mismatch.url('/'))
    expect((await waitForWarning(browserTabs.window, mismatch.tabId)).code).toBe(-200)
  })

  test('025-AC-021 Back to safety goes back to the page before', async ({ browserTabs, browserServers }) => {
    const first = browserServers.sites.static.url('/plain.html')
    const page = await openAt(browserTabs, first)
    await page.waitForLoaded(first)
    await browserTabs.navigate(page.tabId, browserServers.certServers.selfSigned.url('/'))
    const warning = await waitForWarning(browserTabs.window, page.tabId)
    await decide(browserTabs.app, browserTabs.window, page.tabId, warning, false)
    await page.waitForLoaded(first)
    await waitForState(browserTabs.window, page.tabId, { erfanaPage: null, committedUrl: first })
  })

  test('025-AC-021 a self-signed subresource keeps the page and shows the warning sign', async ({ browserTabs, browserServers }) => {
    const url = browserServers.sites.static.url('/plain.html')
    const page = await openAt(browserTabs, url)
    await page.waitForLoaded(url)
    const api = browserServers.certServers.selfSigned.url('/api/me')
    await page.eval(`fetch(${JSON.stringify(api)}, { mode: 'no-cors' }).then(() => 'ok', () => 'failed')`)
    await waitForState(browserTabs.window, page.tabId, { erfanaPage: null, security: 'subresourceFailed', committedUrl: url })
  })
})

test.describe('025-FR-022 HTTP sign-in box', () => {
  test('025-AC-022 a typed address shows a focused box; Remember saves the sign-in encrypted, and it is sent without a box later', async ({
    browserTabs,
    browserServers,
    testProject
  }) => {
    await trustTestCa(browserTabs, browserServers)
    const url = browserServers.sites.staging.url('/basic', { secure: true })
    const page = await openAt(browserTabs, url)
    const row = await waitForSignIn(browserTabs.window, page.tabId)
    expect(row.text).toMatch(/^Sign in to staging\.test/)
    expect(row.takesFocus).toBe(true)
    expect(row.signIn).toMatchObject({ username: '', savedPassword: false, insecure: false, rejected: null })
    const canRemember = row.signIn?.remember === 'available'
    await answerSignIn(browserTabs.app, browserTabs.window, page.tabId, row, 'signIn', {
      ...CREDENTIALS,
      remember: canRemember
    })
    await page.waitFor(`!!document.getElementById('basic-ok')`, 'signed in')
    if (!canRemember) {
      // Linux without a keyring: Remember is not offered (025-FR-022), nothing to check on disk.
      expect(row.signIn?.remember).toBe('noKeyring')
      return
    }
    const file = erfanaFile(testProject.path, 'credentials.json')
    await expect.poll(() => fs.existsSync(file), { timeout: WAIT_MS }).toBe(true)
    const text = fs.readFileSync(file, 'utf8')
    expect(text).not.toContain(BASIC_AUTH.password)
    // Quoted: the bare user name is also part of the host name `staging.test`.
    expect(text).not.toContain(JSON.stringify(BASIC_AUTH.username))

    await hook(browserTabs.app, 'site', 'resetConnections')
    const again = await openAt(browserTabs, url)
    await again.waitFor(`!!document.getElementById('basic-ok')`, 'signed in with the saved sign-in')
    expect((await stripRows(browserTabs.window, again.tabId)).filter((r) => r.kind === 'signIn')).toEqual([])
  })

  test('025-AC-022 a refused saved sign-in shows the box again with the error line; Cancel shows the 401 page', async ({
    browserTabs,
    browserServers
  }) => {
    await trustTestCa(browserTabs, browserServers)
    const url = browserServers.sites.staging.url('/basic', { secure: true })
    const page = await openAt(browserTabs, url)
    const row = await waitForSignIn(browserTabs.window, page.tabId)
    test.skip(row.signIn?.remember !== 'available', 'Remember needs a keyring (025-FR-022)')
    await answerSignIn(browserTabs.app, browserTabs.window, page.tabId, row, 'signIn', { ...CREDENTIALS, remember: true })
    await page.waitFor(`!!document.getElementById('basic-ok')`, 'signed in')

    browserServers.staging.setBasicPassword('changed-password')
    try {
      await hook(browserTabs.app, 'site', 'resetConnections')
      const refused = await openAt(browserTabs, url)
      const retry = await waitForSignIn(browserTabs.window, refused.tabId)
      expect(retry.signIn).toMatchObject({ username: BASIC_AUTH.username, savedPassword: false, rejected: 'saved' })
      await answerSignIn(browserTabs.app, browserTabs.window, refused.tabId, retry, 'cancel')
      await refused.waitFor(`!!document.getElementById('basic-401')`, 'the 401 page')
    } finally {
      browserServers.staging.resetBasicPassword()
    }
  })

  test('025-AC-022 Cancel and a wrong password with Remember ticked save nothing', async ({ browserTabs, browserServers, testProject }) => {
    await trustTestCa(browserTabs, browserServers)
    const url = browserServers.sites.staging.url('/basic', { secure: true })
    const page = await openAt(browserTabs, url)
    const first = await waitForSignIn(browserTabs.window, page.tabId)
    await answerSignIn(browserTabs.app, browserTabs.window, page.tabId, first, 'signIn', { username: BASIC_AUTH.username, password: 'wrong', remember: true })
    const retry = await waitForSignIn(browserTabs.window, page.tabId, 1)
    expect(retry.signIn).toMatchObject({ username: BASIC_AUTH.username, rejected: 'typed' })
    await answerSignIn(browserTabs.app, browserTabs.window, page.tabId, retry, 'cancel')
    await page.waitFor(`!!document.getElementById('basic-401')`, 'the 401 page')
    expect(fs.existsSync(erfanaFile(testProject.path, 'credentials.json'))).toBe(false)
  })

  test('025-AC-022 a sign-in saved for remote http opens the box pre-filled with the warning; one for localhost is sent without a box', async ({
    browserTabs,
    browserServers
  }) => {
    const remote = browserServers.sites.staging.url('/basic')
    const page = await openAt(browserTabs, remote)
    const row = await waitForSignIn(browserTabs.window, page.tabId)
    expect(row.signIn?.insecure).toBe(true)
    test.skip(row.signIn?.remember !== 'available', 'Remember needs a keyring (025-FR-022)')
    await answerSignIn(browserTabs.app, browserTabs.window, page.tabId, row, 'signIn', { ...CREDENTIALS, remember: true })
    await page.waitFor(`!!document.getElementById('basic-ok')`, 'signed in')

    await hook(browserTabs.app, 'site', 'resetConnections')
    const again = await openAt(browserTabs, remote)
    const prefilled = await waitForSignIn(browserTabs.window, again.tabId)
    expect(prefilled.signIn).toMatchObject({ username: BASIC_AUTH.username, savedPassword: true, insecure: true, rejected: null })
    // Sign in without typing the password: main uses the saved one, which never reached the window.
    await answerSignIn(browserTabs.app, browserTabs.window, again.tabId, prefilled, 'signIn', { username: BASIC_AUTH.username })
    await again.waitFor(`!!document.getElementById('basic-ok')`, 'signed in with the saved password')

    const local = browserServers.sites.staging.url('/basic', { host: 'localhost' })
    const localPage = await openAt(browserTabs, local)
    const localRow = await waitForSignIn(browserTabs.window, localPage.tabId)
    expect(localRow.signIn?.insecure).toBe(false)
    await answerSignIn(browserTabs.app, browserTabs.window, localPage.tabId, localRow, 'signIn', { ...CREDENTIALS, remember: true })
    await localPage.waitFor(`!!document.getElementById('basic-ok')`, 'signed in on localhost')
    await hook(browserTabs.app, 'site', 'resetConnections')
    const localAgain = await openAt(browserTabs, local)
    await localAgain.waitFor(`!!document.getElementById('basic-ok')`, 'sent without a box on localhost')
    expect((await stripRows(browserTabs.window, localAgain.tabId)).filter((r) => r.kind === 'signIn')).toEqual([])
  })

  test('025-AC-022 a challenge from a cross-origin frame names the frame host first, without taking focus', async ({
    browserTabs,
    browserServers
  }) => {
    const top = browserServers.sites.static.url('/plain.html')
    const page = await openAt(browserTabs, top)
    await page.waitForLoaded(top)
    const frame = browserServers.sites.staging.url('/basic')
    await page.eval(`(() => { const f = document.createElement('iframe'); f.src = ${JSON.stringify(frame)}; document.body.appendChild(f); return true })()`)
    const row = await waitForSignIn(browserTabs.window, page.tabId)
    // The formatter writes plain-http origins with their scheme.
    expect(row.text).toMatch(/^(http:\/\/)?staging\.test\S*, inside (http:\/\/)?app\.test\S*, asks you to sign in$/)
    expect(row.takesFocus).toBe(false)
  })
})

test.describe('S-16 private network', () => {
  test('a public page cannot reach localhost; a local page can', async ({ browserTabs, browserServers }) => {
    const target = browserServers.sites.staging.url('/api/me', { host: 'localhost' })
    const publicPage = await openAt(browserTabs, browserServers.sites.static.url('/plain.html'))
    await publicPage.waitForLoaded(browserServers.sites.static.url('/plain.html'))
    browserServers.clearRequests()
    const refused = await publicPage.eval<string>(`fetch(${JSON.stringify(target + '?from=public')}, { mode: 'no-cors' }).then(() => 'ok', () => 'failed')`)
    expect(refused).toBe('failed')

    // Positive control with the same request from a local page.
    const localTop = browserServers.sites.static.url('/plain.html', { host: 'localhost' })
    const localPage = await openAt(browserTabs, localTop)
    await localPage.waitForLoaded(localTop)
    const allowed = await localPage.eval<string>(`fetch(${JSON.stringify(target + '?from=local')}, { mode: 'no-cors' }).then(() => 'ok', () => 'failed')`)
    expect(allowed).toBe('ok')
    const seen = browserServers.requests.filter((r) => r.path.startsWith('/api/me')).map((r) => r.path)
    expect(seen).toEqual(['/api/me?from=local'])
  })
})

test.describe('025-AC-021 and 025-AC-022 across a restart', () => {
  let launched: LaunchedBrowserApp | null = null

  test.afterEach(async () => {
    await launched?.close()
    launched = null
  })

  test('025-AC-021 025-AC-022 a proceeded certificate and a remembered sign-in still apply after a restart', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    const selfSigned = browserServers.certServers.selfSigned.url('/')
    const basic = browserServers.sites.staging.url('/basic', { secure: true })
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    await trustTestCa(launched.tabs, browserServers)
    const certPage = await openAt(launched.tabs, selfSigned)
    await decide(launched.app, launched.window, certPage.tabId, await waitForWarning(launched.window, certPage.tabId), true)
    await certPage.waitForLoaded(selfSigned)
    const authPage = await openAt(launched.tabs, basic)
    const row = await waitForSignIn(launched.window, authPage.tabId)
    const canRemember = row.signIn?.remember === 'available'
    await answerSignIn(launched.app, launched.window, authPage.tabId, row, 'signIn', { ...CREDENTIALS, remember: canRemember })
    await authPage.waitFor(`!!document.getElementById('basic-ok')`, 'signed in')
    if (canRemember) await expect.poll(() => fs.existsSync(erfanaFile(testProject.path, 'credentials.json'))).toBe(true)
    // Without a signing key (Linux basic_text) trust decisions last for the session only (S-26).
    const trustSaved = fs.existsSync(erfanaFile(testProject.path, 'trust.json'))

    await launched.close()
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    await trustTestCa(launched.tabs, browserServers)
    const certAgain = await openAt(launched.tabs, selfSigned)
    if (trustSaved) {
      await certAgain.waitForLoaded(selfSigned)
      expect((await rawState(launched.window, certAgain.tabId))?.erfanaPage).toBeNull()
    } else {
      await waitForWarning(launched.window, certAgain.tabId)
    }
    const authAgain = await openAt(launched.tabs, basic)
    if (canRemember) {
      await authAgain.waitFor(`!!document.getElementById('basic-ok')`, 'signed in with the saved sign-in')
      expect((await stripRows(launched.window, authAgain.tabId)).filter((r) => r.kind === 'signIn')).toEqual([])
    } else {
      await waitForSignIn(launched.window, authAgain.tabId)
    }
  })
})
