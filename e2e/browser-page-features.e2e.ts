// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser page features, main side (spec 025 commit 12h): the
 * load-error page and Reload, the crashed page and the hung-page notice, find
 * in page, zoom per site, width presets in their clipping parent, Clear
 * browsing data and Forget, and the address history.
 *
 * Tabs are driven through `window.api.browserTab` from Erfana's window (the
 * browser UI comes in commit 18); main-side facts come from the test hooks
 * (`browserHook`, `browserPageHook`). Condition-based waits only.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { PAGE_AREA, type BrowserTabPage } from './pages/browser-tab.page'

const IS_MAC = process.platform === 'darwin'
const MOD = IS_MAC ? 'meta' : 'control'
const WAIT_MS = 15_000

type Rec = Record<string, unknown>

interface PageRecorder {
  __pageRec?: { find: Record<string, Rec>; strip: Record<string, Rec[]>; pick: Record<string, Rec[]> }
  api: { browserTab: Record<string, (...args: unknown[]) => unknown> }
}

/** Record find results, strip events and pick events in Erfana's window. Idempotent. */
async function installRecorders(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as PageRecorder
    if (w.__pageRec) return
    const rec = { find: {} as Record<string, Rec>, strip: {} as Record<string, Rec[]>, pick: {} as Record<string, Rec[]> }
    w.__pageRec = rec
    const on = (name: string, cb: (e: Rec) => void): unknown => w.api.browserTab[name]!(cb)
    on('onFindResult', (e) => (rec.find[e['tabId'] as string] = e))
    on('onStrip', (e) => (rec.strip[e['tabId'] as string] ??= []).push(e))
    on('onPick', (e) => (rec.pick[e['tabId'] as string] ??= []).push(e))
  })
}

function recorded<T>(window: Page, kind: 'find' | 'strip' | 'pick', tabId: string): Promise<T> {
  return window.evaluate(([k, id]) => (window as unknown as PageRecorder).__pageRec?.[k as 'find']?.[id as string] ?? null, [
    kind,
    tabId
  ] as const) as Promise<T>
}

/** Call `window.api.browserTab.<method>(...args)` in Erfana's window. */
function bridge<T = unknown>(window: Page, method: string, ...args: unknown[]): Promise<T> {
  return window.evaluate(
    ([name, callArgs]) => (window as unknown as PageRecorder).api.browserTab[name as string]!(...(callArgs as unknown[])),
    [method, args] as const
  ) as Promise<T>
}

/** Call `page.<name>(...args)` on the main-process hooks. */
async function pageHook<T>(app: ElectronApplication, name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [hookName, hookArgs]) => {
      const hooks = (globalThis as unknown as { __erfanaTestHooks?: { page?: Record<string, (...a: unknown[]) => unknown> } })
        .__erfanaTestHooks
      if (!hooks?.page) throw new Error('Page test hooks are not installed (build with npm run build:e2e)')
      return hooks.page[hookName as string]!(...(hookArgs as unknown[]))
    },
    [name, args] as const
  )) as T
}

/** Wait until the newest state event for `tabId` matches `expected` (any state field, `loadError` included). */
async function waitForState(tabs: BrowserTabPage, tabId: string, expected: Rec): Promise<Rec> {
  await expect.poll(async () => (await tabs.lastState(tabId)) as unknown as Rec, { timeout: WAIT_MS }).toMatchObject(expected)
  return (await tabs.lastState(tabId)) as unknown as Rec
}

/** A loopback port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Show a tab's page at `area` with the page area `clip` (window CSS px). */
let seq = 1_000_000
function placeIn(window: Page, tabId: string, bounds: Rec, clip: Rec): Promise<unknown> {
  seq += 1
  return bridge(window, 'setBounds', { tabId, bounds, seq, ack: false, visible: true, clip })
}

test.describe('built-in browser page features', () => {
  test('025-AC-076 load-error page: focus by who started the load, and Reload once the server is up', async ({
    browserTabs,
    browserServers
  }) => {
    const port = await closedPort()
    const address = `http://localhost:${port}/`
    const page = await browserTabs.open()
    const tab = page.tabId

    // The user loads a closed port: the error page names the address and the error, focus on Reload.
    await browserTabs.navigate(tab, address)
    await waitForState(browserTabs, tab, {
      erfanaPage: 'loadError',
      committedUrl: address,
      loadError: { code: -102, focus: 'reload' },
      loading: false
    })

    // A closed port reached by the page's own script: focus goes to the heading instead.
    const other = await browserTabs.open()
    const start = browserServers.sites.static.url('/index.html')
    await browserTabs.navigate(other.tabId, start)
    await other.waitForLoaded(start)
    const port2 = await closedPort()
    await other.eval(`void setTimeout(() => { location.href = 'http://localhost:${port2}/' }, 0)`)
    await waitForState(browserTabs, other.tabId, { erfanaPage: 'loadError', loadError: { focus: 'heading' } })

    // The server starts; Reload loads the page.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>up</title><h1 id="up">up</h1>')
    })
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    try {
      await browserTabs.history(tab, 'reload')
      await waitForState(browserTabs, tab, { erfanaPage: null, committedUrl: address, loading: false })
      await page.waitFor(`document.getElementById('up') !== null`, 'the page loaded after Reload')
      expect((await browserTabs.lastState(tab)) as unknown as Rec).not.toHaveProperty('loadError')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('025-AC-072 a crashed page shows "This page crashed", ends pick mode, and Reload loads it', async ({
    browserTabs,
    browserServers,
    appWithTestProject,
    windowWithTestProject
  }) => {
    await installRecorders(windowWithTestProject)
    const url = browserServers.sites.static.url('/elements.html')
    const page = await browserTabs.open()
    const tab = page.tabId
    await browserTabs.navigate(tab, url)
    await page.waitForLoaded(url)

    // Pick mode on (Ctrl/Cmd+E from page focus).
    await page.waitForInputReady()
    await page.key('E', [MOD])
    await expect
      .poll(async () => (await recorded<Rec[] | null>(windowWithTestProject, 'pick', tab))?.some((e) => e['on'] === true), { timeout: WAIT_MS })
      .toBe(true)

    await pageHook(appWithTestProject, 'crash', tab)
    await waitForState(browserTabs, tab, { erfanaPage: 'crashed' })
    await expect
      .poll(async () => (await recorded<Rec[]>(windowWithTestProject, 'pick', tab)).at(-1), { timeout: WAIT_MS })
      .toMatchObject({ kind: 'mode', on: false })

    await browserTabs.history(tab, 'reload')
    await waitForState(browserTabs, tab, { erfanaPage: null, committedUrl: url, loading: false })
    await page.waitForLoaded(url)
  })

  test('025-AC-072 a hung page shows the notice; Wait closes it and it returns after another 5 s', async ({
    browserTabs,
    browserServers,
    windowWithTestProject
  }) => {
    test.setTimeout(90_000)
    await installRecorders(windowWithTestProject)
    const url = browserServers.sites.static.url('/hang.html')
    const page = await browserTabs.open()
    const tab = page.tabId
    await browserTabs.navigate(tab, url)
    await page.waitForLoaded(url)

    const rows = (): Promise<Rec[]> => recorded<Rec[] | null>(windowWithTestProject, 'strip', tab).then((r) => r ?? [])
    const hungAdds = async (): Promise<Rec[]> => (await rows()).filter((e) => e['op'] === 'add' && (e['row'] as Rec)['kind'] === 'hung')

    // The page loops for 16 s: the notice shows after 5 s without an answer.
    await page.eval('window.__fixture.hang(16000)')
    await expect.poll(async () => (await hungAdds()).length, { timeout: 20_000 }).toBe(1)
    const first = (await hungAdds())[0]!['row'] as Rec
    expect(first).toMatchObject({ text: 'This page is not responding.', answers: ['wait', 'reload'] })

    // Wait, after the strip's 500 ms input guard: the row goes, and returns 5 s later while the page still hangs.
    await expect
      .poll(
        async () => {
          await bridge(windowWithTestProject, 'answerStrip', { tabId: tab, requestId: first['requestId'], answer: 'wait' })
          return (await rows()).some((e) => e['op'] === 'withdraw' && e['requestId'] === first['requestId'])
        },
        { timeout: WAIT_MS }
      )
      .toBe(true)
    await expect.poll(async () => (await hungAdds()).length, { timeout: 20_000 }).toBe(2)

    // The page answers again: the notice goes by itself.
    const second = (await hungAdds())[1]!['row'] as Rec
    await expect
      .poll(async () => (await rows()).some((e) => e['op'] === 'withdraw' && e['requestId'] === second['requestId']), { timeout: 30_000 })
      .toBe(true)
    await page.waitFor(`document.getElementById('done').textContent === 'hang ended'`, 'the loop ended')
  })

  test('025-AC-008 find in page: 1 of 3, next and previous, 0 of 0, and the bar closes', async ({
    browserTabs,
    browserServers,
    windowWithTestProject
  }) => {
    await installRecorders(windowWithTestProject)
    const url = browserServers.sites.static.url('/find.html')
    const page = await browserTabs.open()
    const tab = page.tabId
    await browserTabs.navigate(tab, url)
    await page.waitForLoaded(url)
    const result = (): Promise<Rec | null> => recorded<Rec | null>(windowWithTestProject, 'find', tab)

    await bridge(windowWithTestProject, 'find', { tabId: tab, text: 'needle', forward: true, findNext: true })
    await expect.poll(result, { timeout: WAIT_MS }).toMatchObject({ active: 1, total: 3 })
    await bridge(windowWithTestProject, 'find', { tabId: tab, text: 'needle', forward: true, findNext: false })
    await expect.poll(result, { timeout: WAIT_MS }).toMatchObject({ active: 2, total: 3 })
    await bridge(windowWithTestProject, 'find', { tabId: tab, text: 'needle', forward: false, findNext: false })
    await expect.poll(result, { timeout: WAIT_MS }).toMatchObject({ active: 1, total: 3 })
    await bridge(windowWithTestProject, 'find', { tabId: tab, text: 'zzzznomatch', forward: true, findNext: true })
    await expect.poll(result, { timeout: WAIT_MS }).toMatchObject({ active: 0, total: 0 })

    // Closing the bar removes the highlights; a new search starts over.
    await bridge(windowWithTestProject, 'stopFind', tab)
    await bridge(windowWithTestProject, 'find', { tabId: tab, text: 'needle', forward: true, findNext: true })
    await expect.poll(result, { timeout: WAIT_MS }).toMatchObject({ active: 1, total: 3 })
  })

  test('025-AC-008 zoom steps per site: keys and buttons, the ends, reset, and two tabs on one site', async ({
    browserTabs,
    browserServers,
    appWithTestProject,
    windowWithTestProject
  }) => {
    const url = browserServers.sites.static.url('/index.html')
    const page = await browserTabs.open()
    const tab = page.tabId
    await browserTabs.navigate(tab, url)
    await page.waitForLoaded(url)
    const factor = (id: string): Promise<number> => pageHook<number>(appWithTestProject, 'zoomFactor', id)

    // Ctrl/Cmd+Plus from the page, then the button: 100% → 110% → 125%.
    await page.waitForInputReady()
    await page.key('=', [MOD])
    await expect.poll(() => factor(tab), { timeout: WAIT_MS }).toBeCloseTo(1.1, 5)
    await waitForState(browserTabs, tab, { zoomPercent: 110 })
    await bridge(windowWithTestProject, 'zoom', tab, 'in')
    await expect.poll(() => factor(tab), { timeout: WAIT_MS }).toBeCloseTo(1.25, 5)

    // A second tab on the same site shares the level.
    const second = await browserTabs.open()
    await browserTabs.navigate(second.tabId, browserServers.sites.static.url('/plain.html'))
    await second.waitForLoaded(browserServers.sites.static.url('/plain.html'))
    await expect.poll(() => factor(second.tabId), { timeout: WAIT_MS }).toBeCloseTo(1.25, 5)

    // Ctrl/Cmd+0 resets both.
    await page.key('0', [MOD])
    await expect.poll(() => factor(tab), { timeout: WAIT_MS }).toBeCloseTo(1, 5)
    await expect.poll(() => factor(second.tabId), { timeout: WAIT_MS }).toBeCloseTo(1, 5)

    // Plus at 500% and Minus at 25% do nothing.
    for (let i = 0; i < 12; i += 1) await bridge(windowWithTestProject, 'zoom', tab, 'in')
    await expect.poll(() => factor(tab), { timeout: WAIT_MS }).toBeCloseTo(5, 5)
    await bridge(windowWithTestProject, 'zoom', tab, 'in')
    await waitForState(browserTabs, tab, { zoomPercent: 500 })
    expect(await factor(tab)).toBeCloseTo(5, 5)
    for (let i = 0; i < 20; i += 1) await bridge(windowWithTestProject, 'zoom', tab, 'out')
    await expect.poll(() => factor(tab), { timeout: WAIT_MS }).toBeCloseTo(0.25, 5)
    await bridge(windowWithTestProject, 'zoom', tab, 'reset')
    await expect.poll(() => factor(tab), { timeout: WAIT_MS }).toBeCloseTo(1, 5)
  })

  test('025-AC-012 width presets: page widths, a narrow panel clips the view, and a preset resets the zoom', async ({
    browserTabs,
    browserServers,
    appWithTestProject,
    windowWithTestProject
  }) => {
    const url = browserServers.sites.static.url('/index.html')
    const page = await browserTabs.open()
    const tab = page.tabId
    await browserTabs.navigate(tab, url)
    await page.waitForLoaded(url)
    const innerWidth = (): Promise<number> => page.eval<number>('window.innerWidth')

    await bridge(windowWithTestProject, 'zoom', tab, 'in')
    await bridge(windowWithTestProject, 'zoom', tab, 'in')
    await waitForState(browserTabs, tab, { zoomPercent: 125 })

    await bridge(windowWithTestProject, 'widthPreset', tab, 'phone')
    await waitForState(browserTabs, tab, { widthPreset: 'phone', zoomPercent: 100 })
    await expect.poll(innerWidth, { timeout: WAIT_MS }).toBe(390)
    await bridge(windowWithTestProject, 'widthPreset', tab, 'tablet')
    await expect.poll(innerWidth, { timeout: WAIT_MS }).toBe(768)
    await bridge(windowWithTestProject, 'widthPreset', tab, 'full')
    await expect.poll(innerWidth, { timeout: WAIT_MS }).toBe(PAGE_AREA.width)

    // A panel narrower than the preset: the view keeps 390, its clipping parent is the panel.
    const narrow = { x: PAGE_AREA.x, y: PAGE_AREA.y, width: 300, height: PAGE_AREA.height }
    await bridge(windowWithTestProject, 'widthPreset', tab, 'phone')
    await placeIn(windowWithTestProject, tab, { ...narrow, width: 390 }, narrow)
    await expect.poll(innerWidth, { timeout: WAIT_MS }).toBe(390)
    await expect
      .poll(() => pageHook<{ clip: Rec; viewInClip: Rec } | null>(appWithTestProject, 'placement', tab), { timeout: WAIT_MS })
      .toMatchObject({ clip: { width: 300 }, viewInClip: { x: 0, width: 390 } })
    // Scrolled to the far right: the view's right edge meets the panel's, nothing is drawn outside.
    await placeIn(windowWithTestProject, tab, { ...narrow, x: narrow.x - 90, width: 390 }, narrow)
    await expect
      .poll(() => pageHook<{ viewInClip: Rec } | null>(appWithTestProject, 'placement', tab), { timeout: WAIT_MS })
      .toMatchObject({ viewInClip: { x: -90, width: 390 } })
  })

  test('025-AC-023 Clear browsing data: cookies and site data alone, a failed step is reported, and the tab reloads', async ({
    browserTabs,
    browserServers,
    appWithTestProject,
    windowWithTestProject
  }) => {
    const url = browserServers.sites.static.url('/index.html')
    const page = await browserTabs.open()
    const tab = page.tabId
    await browserTabs.navigate(tab, url)
    await page.waitForLoaded(url)
    await page.eval(`document.cookie = 'clearme=1; path=/; max-age=3600'; localStorage.setItem('token', 'abc'); sessionStorage.setItem('s', '1'); window.__beforeClear = true`)
    await expect.poll(async () => (await page.cookies(url)).some((c) => c.name === 'clearme'), { timeout: WAIT_MS }).toBe(true)
    await expect.poll(() => pageHook<string[]>(appWithTestProject, 'history', tab), { timeout: WAIT_MS }).toContain(url)

    const none = { cookies: false, cache: false, permissions: false, credentials: false, captures: false }
    const answer = await bridge<Rec>(windowWithTestProject, 'clearData', { ...none, cookies: true })
    expect(answer).toEqual({ failed: [] })
    await page.waitFor(`window.__beforeClear === undefined`, 'the tab reloaded')
    await expect.poll(async () => (await page.cookies(url)).some((c) => c.name === 'clearme'), { timeout: WAIT_MS }).toBe(false)
    expect(await page.eval(`localStorage.getItem('token')`)).toBeNull()
    expect(await page.eval(`sessionStorage.getItem('s')`)).toBeNull()
    // The reload committed the page again, so it is the only address left.
    expect(await pageHook<string[]>(appWithTestProject, 'history', tab)).toEqual([url])

    // A planted failure in Cached files is reported by kind; the other kind still clears.
    await page.eval(`document.cookie = 'again=1; path=/; max-age=3600'`)
    await pageHook(appWithTestProject, 'setClearFault', 'cache', 'fail')
    try {
      const failed = await bridge<Rec>(windowWithTestProject, 'clearData', { ...none, cookies: true, cache: true })
      expect(failed).toEqual({ failed: [{ category: 'cache', reason: 'failed' }] })
      await expect.poll(async () => (await page.cookies(url)).length, { timeout: WAIT_MS }).toBe(0)
    } finally {
      await pageHook(appWithTestProject, 'setClearFault', 'cache', null)
    }
  })

  test('025-AC-023 Forget closes the project\'s tabs and deletes .erfana/browser', async ({
    browserTabs,
    browserServers,
    testProject,
    windowWithTestProject
  }) => {
    const url = browserServers.sites.static.url('/index.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    const browserDir = path.join(testProject.path, '.erfana', 'browser')
    expect(fs.existsSync(browserDir)).toBe(true)

    const answer = await bridge<Rec>(windowWithTestProject, 'forget')
    expect(answer).toEqual({ deleted: process.platform === 'win32' ? expect.stringMatching(/deleted|pending/) : 'deleted' })
    await expect.poll(async () => (await browserTabs.tabs()).length, { timeout: WAIT_MS }).toBe(0)
    if (answer['deleted'] === 'deleted') expect(fs.existsSync(browserDir)).toBe(false)
  })

  test('025-AC-078 history: loaded addresses are suggested, the newest first, and local terminal addresses are announced', async ({
    browserTabs,
    browserServers,
    appWithTestProject,
    windowWithTestProject
  }) => {
    const urls = ['/index.html', '/plain.html', '/page-b.html'].map((p) => browserServers.sites.static.url(p))
    const page = await browserTabs.open()
    for (const url of urls) {
      await browserTabs.navigate(page.tabId, url)
      await page.waitForLoaded(url)
    }
    const suggest = (prefix: string): Promise<{ rows: Array<{ url: string }> }> => bridge(windowWithTestProject, 'suggest', prefix)
    await expect.poll(async () => (await suggest('')).rows.map((r) => r.url), { timeout: WAIT_MS }).toEqual([...urls].reverse())
    const host = new URL(urls[0]!).host
    expect((await suggest(`${host}/pla`)).rows.map((r) => r.url)).toEqual([urls[1]])

    // A dev server's address printed in a terminal of this window is announced once.
    const notices = await windowWithTestProject.evaluate(() => {
      const w = window as unknown as PageRecorder & { __localNotices?: string[] }
      w.__localNotices = []
      w.api.browserTab['onNotice']!((e: Rec) => {
        if (e['kind'] === 'localAddressSeen') w.__localNotices!.push(e['text'] as string)
      })
      return true
    })
    expect(notices).toBe(true)
    const rendererId = await appWithTestProject.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.id)
    await pageHook(appWithTestProject, 'terminalOutput', rendererId, 'e2e-term', '  Local: http://localhost:5173/\n')
    await pageHook(appWithTestProject, 'terminalOutput', rendererId, 'e2e-term', 'again http://localhost:5173/\n')
    await expect
      .poll(() => windowWithTestProject.evaluate(() => (window as unknown as { __localNotices?: string[] }).__localNotices), { timeout: WAIT_MS })
      .toEqual(['http://localhost:5173/'])
  })
})
