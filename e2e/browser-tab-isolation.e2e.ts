// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Isolation of the built-in browser from Erfana (spec 025 commit 7,
 * 025-NFR-001): the IPC gate against a browser-session view at the renderer
 * entry (025-AC-068), and the first hostile pages of 025-AC-046 – IPC,
 * `window.electron`, custom schemes, the renderer entry and the dev-server
 * origin, popup escape.
 *
 * Each hostile page reports through its canary (`hostile/canary.js`); where a
 * page cannot see the outcome, Erfana's side is checked: the tab's address,
 * the windows and `webContents` that exist, the fixture servers' request log.
 * Clicks go through `sendInputEvent`, so the page gets a real user gesture.
 */
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from './fixtures/browserHarness'
import { browserHook } from './pages/browser-page.page'
import type { BrowserTabPage } from './pages/browser-tab.page'

/** The bundled renderer entry the e2e build loads (`out/renderer/index.html`). */
const RENDERER_ENTRY = pathToFileURL(path.join(__dirname, '..', 'out', 'renderer', 'index.html')).href

/** Only the tab's own page may exist in the browser session. */
async function expectOnlyTabsInBrowserSession(tabs: BrowserTabPage): Promise<void> {
  const ids = (await tabs.tabs()).map((t) => t.webContentsId).sort()
  const inSession = await tabs.browserSessionContents()
  expect(inSession.map((c) => c.id).sort()).toEqual(ids)
  expect(inSession.every((c) => c.registeredView)).toBe(true)
}

test.describe('built-in browser isolation', () => {
  test('025-AC-068 a tab refuses the renderer entry, and the IPC gate refuses a browser-session view at it', async ({
    browserTabs,
    windowWithTestProject
  }) => {
    const page = await browserTabs.open()
    expect(await browserTabs.navigate(page.tabId, RENDERER_ENTRY)).toEqual({ refused: 'app-entry' })
    expect(await browserTabs.lastState(page.tabId)).toMatchObject({ committedUrl: null, pendingUrl: null })

    // Control: Erfana's own window reaches the channel.
    await windowWithTestProject.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, untyped in e2e
      () => (window as any).api.settings.getRecentProjects()
    )

    // A view in the browser session, at the renderer entry, with Erfana's own preload.
    await browserHook(browserTabs.app, 'openIpcProbeView')
    try {
      const answer = await browserHook<{ ok: boolean; message: string }>(browserTabs.app, 'callIpcFromProbeView')
      expect(answer.ok).toBe(false)
      expect(answer.message).toMatch(/Untrusted sender for IPC channel "settings:getRecentProjects"/)
    } finally {
      await browserHook(browserTabs.app, 'closeIpcProbeView')
    }
  })

  test('025-AC-046 hostile page: calling Erfana IPC gets nothing', async ({ browserTabs, browserServers }) => {
    const url = browserServers.sites.hostile.url('/ipc.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    const canary = await page.canary()
    expect(canary.attempts.filter((a) => a.outcome === 'leaked')).toEqual([])
    expect(canary.status).toBe('blocked')
  })

  test('025-AC-046 hostile page: window.electron and Node globals are absent, popups included', async ({
    browserTabs,
    browserServers
  }) => {
    const url = browserServers.sites.hostile.url('/electron-bridge.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    const windows = await browserHook<number>(browserTabs.app, 'windowCount')

    await page.clickSelector('#open-probe-popup')
    await page.waitFor(`window.__canary.results.some(r => r.name === 'popup')`, 'popup attempt recorded')
    const canary = await page.canary()
    expect(canary.attempts.filter((a) => a.outcome === 'leaked')).toEqual([])
    expect(canary.attempts).toContainEqual({ name: 'popup', outcome: 'blocked' })
    expect(await browserHook<number>(browserTabs.app, 'windowCount')).toBe(windows)
    await expectOnlyTabsInBrowserSession(browserTabs)
  })

  test('025-AC-046 hostile page: custom schemes open nothing and leave the page in place', async ({
    browserTabs,
    browserServers
  }) => {
    const url = browserServers.sites.hostile.url('/custom-scheme.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    const windows = await browserHook<number>(browserTabs.app, 'windowCount')
    const links = await page.eval<number>(`document.querySelectorAll('#links a').length`)
    expect(links).toBeGreaterThan(0)

    for (let i = 0; i < links; i += 1) {
      await page.eval(`window.__clickedScheme = ${i}`)
      await page.clickSelector(`#scheme-link-${i}`)
      // The page is still there and still this document: the marker survives.
      await page.waitFor(`window.__clickedScheme === ${i} && location.href === ${JSON.stringify(url)}`, `link ${i} refused`)
    }
    for (let i = 0; i < links; i += 1) {
      await page.eval(`window.__canary.navigateTo(${i})`)
      await page.waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, `script navigation ${i} refused`)
    }
    const canary = await page.canary()
    expect(canary.attempts.filter((a) => a.outcome === 'leaked')).toEqual([])
    expect(await browserHook<number>(browserTabs.app, 'windowCount')).toBe(windows)
    expect((await browserTabs.lastState(page.tabId))?.committedUrl).toBe(url)
    await expectOnlyTabsInBrowserSession(browserTabs)
  })

  test('025-AC-046 hostile page: the renderer entry and the dev-server origin are refused', async ({
    browserTabs,
    browserServers
  }) => {
    const { hostile } = browserServers.sites
    // A fixture origin stands in for the dev server (the e2e build has none).
    const devOrigin = hostile.url('', { host: 'devserver.test' })
    await browserHook(browserTabs.app, 'setDevServerOrigin', devOrigin)
    browserServers.clearRequests()

    const url = hostile.url(
      `/renderer-entry.html?entry=${encodeURIComponent(RENDERER_ENTRY)}&dev=${encodeURIComponent(`${devOrigin}/`)}`
    )
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    // Frames and fetches of both get nothing; a frame that never answers is settled as blocked.
    await page.waitFor(`document.querySelectorAll('#frames iframe').length === 2`, 'both frames tried')
    await page.eval('window.__canary.finish()')
    const canary = await page.canary()
    expect(canary.attempts.filter((a) => a.outcome === 'leaked')).toEqual([])

    // Top-level navigations by the page: refused, the page stays.
    for (const kind of ['entry', 'dev']) {
      await page.eval(`window.__canary.navigateTo(${JSON.stringify(kind)})`)
      await page.waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, `navigate ${kind}`)
    }
    // The user typing them: refused with the app-entry rule.
    expect(await browserTabs.navigate(page.tabId, `${devOrigin}/`)).toEqual({ refused: 'app-entry' })
    expect(await browserTabs.navigate(page.tabId, RENDERER_ENTRY)).toEqual({ refused: 'app-entry' })

    expect(browserServers.requests.filter((r) => r.host.startsWith('devserver.test'))).toEqual([])
    expect((await browserTabs.lastState(page.tabId))?.committedUrl).toBe(url)
  })

  test('025-AC-046 hostile page: popups cannot open, so nothing escapes through them', async ({
    browserTabs,
    browserServers
  }) => {
    const url = browserServers.sites.hostile.url('/popup-escape.html')
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    const windows = await browserHook<number>(browserTabs.app, 'windowCount')

    await page.clickSelector('#open-popups')
    await page.waitFor(`window.__canary.results.some(r => r.name === 'popups opened')`, 'popups attempted')
    const opened = await page.eval<string>(
      `document.querySelector('#attempts li[data-name="popups opened"]').textContent`
    )
    expect(opened).toContain('false,false')
    const canary = await page.canary()
    expect(canary.attempts.filter((a) => a.outcome === 'leaked')).toEqual([])
    expect(await browserHook<number>(browserTabs.app, 'windowCount')).toBe(windows)
    await expectOnlyTabsInBrowserSession(browserTabs)
  })
})
