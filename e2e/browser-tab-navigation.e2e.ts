// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser tabs, main side (spec 025 commit 7): Back, Forward,
 * Reload and Stop, hidden tabs, DevTools, the input-harness probe, and the
 * user agent a page, a worker and a popup present (025-FR-024).
 *
 * Tabs are driven through `window.api.browserTab` from Erfana's window (there
 * is no browser UI yet); pages are read and clicked through the main-process
 * hooks (`sendInputEvent`). Condition-based waits only.
 */
import { test, expect, type BrowserFixtureServers } from './fixtures/browserHarness'
import { PAGE_AREA, type BrowserTabPage } from './pages/browser-tab.page'
import { testHook, type BrowserPagePage } from './pages/browser-page.page'

interface Brand {
  brand: string
  version: string
}

/** What one browsing context presents as its browser (025-FR-024). */
interface Presented {
  userAgent: string
  brands: Brand[] | null
  headers: Record<string, string>
}

interface HookPopup {
  pageWebContentsId: number
  committedUrl: string | null
}

/** In a context: its navigator's user agent and brands, and the headers of a request it makes. */
const PRESENTED_EXPR = `fetch('/__headers').then((r) => r.json()).then((headers) => ({
  userAgent: navigator.userAgent,
  brands: navigator.userAgentData ? navigator.userAgentData.brands : null,
  headers
}))`

/**
 * A tab whose session trusts the test CA – client hints and
 * `navigator.userAgentData` exist only in a secure context – and the bundled
 * Chromium's major version.
 */
async function secureTab(browserTabs: BrowserTabPage, servers: BrowserFixtureServers): Promise<{ page: BrowserPagePage; major: string }> {
  const page = await browserTabs.open()
  expect(await testHook<number>(browserTabs.app, 'site', 'trustTestCa', servers.tls.caPem)).toBeGreaterThan(0)
  const major = (await browserTabs.app.evaluate(() => process.versions.chrome)).split('.')[0]!
  return { page, major }
}

/** 025-FR-024: the Chromium version, in every place a site can read it, and no Electron or Erfana token. */
function expectChromium(where: string, seen: Presented, major: string): void {
  expect(seen.userAgent, `${where}: navigator.userAgent`).toMatch(new RegExp(`Chrome/${major}\\.0\\.0\\.0 Safari/537\\.36$`))
  expect(seen.headers['user-agent'], `${where}: User-Agent header`).toBe(seen.userAgent)
  expect(seen.brands, `${where}: navigator.userAgentData.brands`).toContainEqual({ brand: 'Chromium', version: major })
  expect(seen.headers['sec-ch-ua'] ?? '', `${where}: Sec-CH-UA header`).toContain(`"Chromium";v="${major}"`)
  expect(JSON.stringify(seen), `${where}: no Electron or Erfana token`).not.toMatch(/electron|erfana/i)
}

/**
 * A navigation request's headers. In Electron 44 they carry the user agent
 * but no client-hint headers at all (measured 2026-11-03: Chromium adds them
 * only to requests a document makes); whatever they carry holds no token.
 */
function expectNavigationClean(where: string, headers: Record<string, string>, major: string): void {
  expect(headers['user-agent'], `${where}: User-Agent header`).toMatch(new RegExp(`Chrome/${major}\\.0\\.0\\.0 Safari/537\\.36$`))
  expect(JSON.stringify(headers), `${where}: no Electron or Erfana token`).not.toMatch(/electron|erfana/i)
}

test.describe('built-in browser tab', () => {
  test('025-AC-003 Back, Forward, Reload and Stop', async ({ browserTabs, browserServers }) => {
    const { held, sites } = browserServers
    const pageA = sites.static.url('/index.html')
    const pageB = sites.static.url('/page-b.html')
    const page = await browserTabs.open()
    const tab = page.tabId

    // A fresh tab: Back and Forward disabled.
    await browserTabs.waitForState(tab, { canGoBack: false, canGoForward: false })

    await browserTabs.navigate(tab, pageA)
    await browserTabs.waitForState(tab, { committedUrl: pageA, loading: false })
    await browserTabs.navigate(tab, pageB)
    await browserTabs.waitForState(tab, { committedUrl: pageB, canGoBack: true, canGoForward: false, loading: false })

    await browserTabs.history(tab, 'back')
    await browserTabs.waitForState(tab, { committedUrl: pageA, canGoForward: true, loading: false })
    await page.waitForLoaded(pageA)
    await browserTabs.history(tab, 'forward')
    await browserTabs.waitForState(tab, { committedUrl: pageB, canGoBack: true, loading: false })
    await page.waitForLoaded(pageB)

    // Reload runs: the page document is replaced (a marker set before is gone).
    await page.eval(`window.__beforeReload = true`)
    await browserTabs.history(tab, 'reload')
    await page.waitFor(`location.href === ${JSON.stringify(pageB)} && window.__beforeReload === undefined`, 'reloaded')

    // A held response: the tab loads (Reload shows as Stop) with the new address pending.
    const key = `ac003-${test.info().repeatEachIndex}-${Date.now()}`
    const heldUrl = sites.static.url(`/__hold/${key}`)
    await browserTabs.navigate(tab, heldUrl)
    await held.waitForRequest(key)
    await browserTabs.waitForState(tab, { loading: true, pendingUrl: heldUrl, committedUrl: pageB })

    // Stop: the load ends, the held page never renders, the address reverts.
    await browserTabs.history(tab, 'stop')
    await held.waitForAbort(key)
    await browserTabs.waitForState(tab, { loading: false, pendingUrl: null, committedUrl: pageB })
    expect(await page.url()).toBe(pageB)
    await page.waitForLoaded(pageB)

    // A new navigation after going Back clears Forward.
    await browserTabs.history(tab, 'back')
    await browserTabs.waitForState(tab, { committedUrl: pageA, canGoForward: true, loading: false })
    await browserTabs.navigate(tab, sites.static.url('/plain.html'))
    await browserTabs.waitForState(tab, { committedUrl: sites.static.url('/plain.html'), canGoForward: false, canGoBack: true })
  })

  test('025-AC-007 a hidden tab keeps its page state', async ({ browserTabs, browserServers }) => {
    const counterUrl = browserServers.sites.static.url('/counter.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, counterUrl)
    await page.waitForLoaded(counterUrl)

    await page.fill('#field', 'half filled')
    // A wheel event that lands before the view takes input is dropped by Chromium: turn again until the page moves.
    await page.waitForInputReady()
    await expect
      .poll(async () => {
        await page.wheel(PAGE_AREA.width / 2, PAGE_AREA.height / 2, 600)
        return page.eval<number>('window.scrollY')
      }, { timeout: 15_000, message: 'scrolled down' })
      .toBeGreaterThan(0)
    // A wheel scroll animates: wait until two reads agree before taking the position.
    let last = -1
    await expect
      .poll(async () => {
        const now = await page.eval<number>('window.scrollY')
        const settled = now === last
        last = now
        return settled
      }, { message: 'scroll settled' })
      .toBe(true)
    const scrollY = last

    // Another editor tab becomes active: this tab is hidden (detached, not destroyed).
    const other = await browserTabs.open()
    await browserTabs.hide(page.tabId)
    await expect.poll(async () => (await browserTabs.tabs()).find((t) => t.tabId === page.tabId)?.attached).toBe(false)
    const before = await page.eval<number>('window.__fixture.counter()')
    await expect
      .poll(() => page.eval<number>('window.__fixture.counter()'), { timeout: 30_000, message: 'hidden counter advances 10 steps' })
      .toBeGreaterThanOrEqual(before + 10)

    await browserTabs.hide(other.tabId)
    await browserTabs.show(page.tabId)
    await expect.poll(async () => (await browserTabs.tabs()).find((t) => t.tabId === page.tabId)?.attached).toBe(true)
    expect(await page.eval('document.getElementById("field").value')).toBe('half filled')
    expect(await page.eval('window.scrollY')).toBe(scrollY)
    expect(await page.eval('window.__fixture.loads()')).toBe(1)
    const shown = await page.eval<number>('window.__fixture.counter()')
    await expect.poll(() => page.eval<number>('window.__fixture.counter()')).toBeGreaterThan(shown)
  })

  test('025-AC-013 DevTools opens in its own window and closes with the tab', async ({ browserTabs, browserServers }) => {
    const url = browserServers.sites.static.url('/index.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)

    // The toolbar button (F12 from the page is routed in commit 13).
    await browserTabs.devTools(page.tabId)
    await browserTabs.waitForState(page.tabId, { devToolsOpen: true })
    const tab = (await browserTabs.tabs()).find((t) => t.tabId === page.tabId)!
    expect(tab.devToolsOpen).toBe(true)
    expect(tab.devToolsId).not.toBeNull()
    // The front end lives in the tab's session: it was expected, not refused and closed.
    const frontEnd = (await browserTabs.browserSessionContents()).find((c) => c.id === tab.devToolsId)
    expect(frontEnd).toMatchObject({ devToolsFrontEnd: true, registeredView: false })
    expect(frontEnd!.url).toMatch(/^devtools:\/\//)

    await browserTabs.close(page.tabId)
    await expect.poll(async () => (await browserTabs.tabs()).some((t) => t.tabId === page.tabId)).toBe(false)
    await expect
      .poll(async () => (await browserTabs.browserSessionContents()).some((c) => c.id === tab.devToolsId))
      .toBe(false)
  })

  test('input harness: sendInputEvent reaches before-input-event and before-mouse-event; CDP input is probed', async ({
    browserTabs,
    browserServers,
    appWithTestProject
  }) => {
    const url = browserServers.sites.static.url('/events.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    await page.waitForInputReady()
    await page.startInputProbe()

    await page.click(40, 40)
    await page.key('A')
    await page.waitFor(`window.__fixture.count('keydown') > 0 && window.__fixture.count('pointerdown') > 0`, 'page saw the input')
    const viaSendInput = await page.inputProbeCounts()
    expect(viaSendInput.keyboard).toBeGreaterThanOrEqual(2)
    expect(viaSendInput.mouseTypes).toEqual(expect.arrayContaining(['mouseDown', 'mouseUp']))

    // Probe: does input injected over Playwright's CDP connection fire before-mouse-event?
    const viewPage = appWithTestProject.windows().find((p) => p.url() === url)
    const before = await page.inputProbeCounts()
    let cdpResult = 'the browser view is not a Playwright page'
    if (viewPage !== undefined) {
      const downs = await page.eval<number>(`window.__fixture.count('pointerdown')`)
      await viewPage.mouse.click(60, 60)
      await page.waitFor(`window.__fixture.count('pointerdown') > ${downs}`, 'page saw the CDP click')
      const after = await page.inputProbeCounts()
      cdpResult = `before-mouse-event fired ${after.mouse - before.mouse} time(s) for a Playwright/CDP click`
    }
    test.info().annotations.push({ type: 'probe', description: cdpResult })
    console.log(`[input probe] sendInputEvent: ${JSON.stringify(viaSendInput)}; CDP: ${cdpResult}`)
  })
})

/*
 * 025-FR-024 user agent. NOT TITLED 025-AC-024: the criterion needs the page,
 * a worker and a popup, and only the page passes. The worker and popup tests
 * are `test.fail()` – they run with the full assertions and turn red once the
 * product is fixed; then drop `test.fail()` and title one test `025-AC-024 …`.
 */
test.describe('025-FR-024 the user agent and client hints (part of 025-AC-024)', () => {
  test('on a page: navigator.userAgent, userAgentData brands and Sec-CH-UA carry the Chromium version and no Electron or Erfana token', async ({
    browserTabs,
    browserServers
  }) => {
    const { page, major } = await secureTab(browserTabs, browserServers)
    const url = browserServers.sites.static.url('/__headers', { secure: true })
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    expectNavigationClean('page navigation', JSON.parse(await page.eval<string>('document.body.innerText')) as Record<string, string>, major)
    expectChromium('page', await page.eval<Presented>(PRESENTED_EXPR), major)
  })

  test('in a dedicated worker: the same, read inside the worker and from its own request', async ({ browserTabs, browserServers }) => {
    test.fail(true, 'Product gap (2026-11-03): a dedicated worker\'s requests carry no Sec-CH-UA header; its navigator is correct')
    const { page, major } = await secureTab(browserTabs, browserServers)
    const url = browserServers.sites.static.url('/plain.html', { secure: true })
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    const fromWorker = await page.eval<Presented & { error?: string }>(
      `new Promise((resolve) => { const w = new Worker('/ua-worker.js'); w.onmessage = (e) => resolve(e.data); w.onerror = (e) => resolve({ error: String(e.message) }) })`
    )
    expect(fromWorker.error).toBeUndefined()
    expectChromium('worker', fromWorker, major)
  })

  test('in a popup (window.open, opener kept): the same, on its navigation, its navigator and its own request', async ({ browserTabs, browserServers }) => {
    test.fail(true, 'Product bug (2026-11-03): a popup presents Electron\'s default user agent ("… ERFANA/<version> … Electron/<version> …") on its first navigation and in navigator.userAgent')
    const app = browserTabs.app
    const { page, major } = await secureTab(browserTabs, browserServers)
    const url = browserServers.sites.static.url(`/popups.html?popup=${encodeURIComponent('/__headers')}`, { secure: true })
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    await page.waitForInputReady()
    await page.clickSelector('#open-default')
    await expect
      .poll(async () => (await testHook<HookPopup[]>(app, 'popup', 'popups'))[0]?.committedUrl ?? '', { message: 'the popup committed /__headers' })
      .toContain('/__headers?via=default')
    const [popup] = await testHook<HookPopup[]>(app, 'popup', 'popups')
    const inPopup = <T,>(code: string): Promise<T> => testHook<T>(app, 'popup', 'popupExec', popup!.pageWebContentsId, code)
    await expect.poll(() => inPopup<string>('document.readyState'), { message: 'the popup loaded' }).toBe('complete')
    expectNavigationClean('popup navigation', JSON.parse(await inPopup<string>('document.body.innerText')) as Record<string, string>, major)
    expectChromium('popup', await inPopup<Presented>(PRESENTED_EXPR), major)
  })
})
