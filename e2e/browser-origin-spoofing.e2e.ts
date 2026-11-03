// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser, origin spoofing (spec 025, issue #448 DoD § 4: each
 * attack that works becomes a regression test; record:
 * `specs/spec-t4-025-built-in-browser/verification/attacker-pass.md`).
 *
 * Every test names its finding (F1–F7) or probe (P1–P5). The attacks run
 * against Erfana's own surfaces – the address bar at rest and while edited,
 * the editor-tab label, the popup's origin strip and OS title – driven through
 * Erfana's DOM (`BrowserTabUiPage`); main-side facts come from the test hooks.
 *
 * Hosts are `*.test` names mapped to the fixture servers (`serve.ts`), so a
 * long or look-alike host is just another name for the same loopback server.
 * Condition-based waits only.
 */
import type { ElectronApplication, Locator } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import { BrowserTabUiPage, type BrowserPanelUi } from './pages/browser-tab-ui.page'
import { EXEC_ACTION_CAP_MS, installBoundedExec, type BoundedExecGlobal } from './utils/bounded-exec'

const WAIT_MS = 15_000
/** A window wide enough for the whole origin, whatever width an earlier test left it at. */
const WIDE_WINDOW_PX = 1600

/** 180 characters of subdomain labels in front of the registrable domain `evil.test`. */
const LONG_HOST = [
  'accounts.google.com',
  'secure-login-verification-service',
  'session-renewal-required-now',
  'account-recovery-department',
  'customer-support-portal-access',
  'evil.test'
].join('.')

/** A page with no `<title>`, so the editor tab shows the host. */
const NO_TITLE_PAGE = '<!doctype html><meta charset="utf-8"><p id="ready">No title here</p>'

/** In a cross-origin frame: a button that opens a blank popup and writes it, with no navigation. */
const FRAME_OPENER_PAGE = `<!doctype html><meta charset="utf-8"><title>frame</title>
<button id="open" style="position:fixed;left:0;top:0;width:200px;height:80px;margin:0">open</button>
<script>document.getElementById('open').addEventListener('click', function () {
  window.__clicks = (window.__clicks || 0) + 1
  var w = window.open('')
  if (w) w.document.write('<!doctype html><title>Written</title><h1>Written by a frame</h1>')
})</script>`

/** Call `<group>.<name>(...args)` on the main-process hooks. */
async function hook<T>(app: ElectronApplication, group: string, name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [g, n, a]) => {
      const hooks = (globalThis as unknown as { __erfanaTestHooks?: Record<string, Record<string, (...x: unknown[]) => unknown>> })
        .__erfanaTestHooks
      if (!hooks?.[g as string]) throw new Error('Test hooks are not installed (build with npm run build:e2e)')
      return hooks[g as string]![n as string]!(...(a as unknown[]))
    },
    [group, name, args] as const
  )) as T
}

interface HookPopup {
  pageWebContentsId: number
  title: string
  committedUrl: string | null
  contentWidth: number
}

const popups = (app: ElectronApplication): Promise<HookPopup[]> => hook(app, 'popup', 'popups')

/** Give Erfana's window at least {@link WIDE_WINDOW_PX} of content width (the panels keep their layout). */
async function widenWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, wide) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (win === undefined) throw new Error('No visible window')
    const [w, h] = win.getContentSize()
    if (w < wide) win.setContentSize(wide, h)
  }, WIDE_WINDOW_PX)
}

/** A hold key unique to this test run (`/__hold/<key>`). */
function holdKey(name: string): string {
  const info = test.info()
  return `${name}-${info.workerIndex}-${info.repeatEachIndex}-${info.retry}`
}

/** Load `url` through the address bar, wait until the page takes input, and leave the bar at rest. */
async function loadPage(panel: BrowserPanelUi, url: string): Promise<void> {
  await panel.load(url)
  await panel.waitForState({ committedUrl: url, loading: false })
  const page = await panel.page()
  await page.waitForLoaded(url)
  await page.waitForInputReady()
  await atRest(panel)
}

/**
 * Leave the address bar at rest: Esc restores the address and hands focus to
 * the page, and the field lets go of focus with it, so the resting display
 * shows with no click elsewhere.
 */
async function atRest(panel: BrowserPanelUi): Promise<void> {
  await panel.addressBar.press('Escape')
  await expect(panel.addressBar).not.toBeFocused({ timeout: WAIT_MS })
  await expect(panel.addressDisplay).toBeVisible({ timeout: WAIT_MS })
}

/** Whether `inner`'s box lies fully inside `outer`'s horizontally (half a pixel of rounding allowed). */
async function insideHorizontally(inner: Locator, outer: Locator): Promise<boolean> {
  const [i, o] = [await inner.boundingBox(), await outer.boundingBox()]
  if (i === null || o === null || i.width === 0) return false
  return i.x >= o.x - 0.5 && i.x + i.width <= o.x + o.width + 0.5
}

/**
 * Run `code` main-side in the frame whose URL holds `key` (or the main frame
 * when `key` is null), bounded. A frame's own `executeJavaScript` does not
 * wait for a pending load, as the tab's does.
 */
async function frameExec<T>(
  app: ElectronApplication,
  webContentsId: number,
  key: string | null,
  code: string,
  userGesture = false
): Promise<T> {
  await installBoundedExec(app)
  return (await app.evaluate(
    async ({ webContents }, [id, k, script, gesture, capMs]) => {
      const exec = (globalThis as unknown as BoundedExecGlobal).__erfanaE2eExec
      const main = webContents.fromId(id as number)?.mainFrame
      const frame = k === null ? main : main?.framesInSubtree.find((f) => f.url.includes(k as string))
      if (frame === undefined) throw new Error(`No frame for ${String(k)}`)
      return exec(frame, script as string, capMs as number, 'frameExec', gesture as boolean)
    },
    [webContentsId, key, code, userGesture, EXEC_ACTION_CAP_MS] as const
  )) as T
}

/** How many clicks the frame whose URL holds `key` counted (`window.__clicks`). */
async function frameClicks(app: ElectronApplication, webContentsId: number, key: string): Promise<number> {
  return Number(await frameExec(app, webContentsId, key, 'window.__clicks || 0'))
}

/** Click `selector` in the frame whose URL holds `key`, as a user gesture. */
async function clickInFrame(app: ElectronApplication, webContentsId: number, key: string, selector: string): Promise<void> {
  await frameExec(app, webContentsId, key, `document.querySelector(${JSON.stringify(selector)}).click()`, true)
}

/** The centre of `selector` in page CSS px. */
async function centre(panel: BrowserPanelUi, selector: string): Promise<{ x: number; y: number }> {
  return (await panel.page()).eval(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
  )
}

test.describe('origin spoofing – attacker pass (issue #448)', () => {
  for (const width of [1280, 400, 360]) {
    test(`F1 a long subdomain never pushes the registrable domain out of the address bar at ${width} px`, async ({
      appWithTestProject,
      windowWithTestProject,
      browserServers
    }) => {
      const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
      const panel = await ui.openWithButton()
      await ui.setPanelWidth(panel, width)
      await loadPage(panel, browserServers.sites.static.url('/plain.html', { host: LONG_HOST }))

      await expect(panel.addressDomain).toHaveText('evil.test')
      await expect.poll(() => insideHorizontally(panel.addressDomain, panel.addressDisplay), { timeout: WAIT_MS }).toBe(true)
      // The scheme and the port stay too (Security rule 2, at every tier).
      await expect(panel.addressDisplay).toContainText(/^http:\/\/….*evil\.test:\d+/)
      const port = panel.addressParts.filter({ hasText: /^:\d+$/ })
      await expect.poll(() => insideHorizontally(port, panel.addressDisplay), { timeout: WAIT_MS }).toBe(true)
      // More stays whole on the row at every width (§ States › Tiers, OD-22); the tools that folded are not on it.
      await expect.poll(() => insideHorizontally(panel.tool('More'), panel.navigation), { timeout: WAIT_MS }).toBe(true)
      if (width < 1280) await expect(panel.tool('DevTools')).toBeHidden()
      else await expect(panel.tool('DevTools')).toBeVisible()
    })
  }

  test('F1 the editor-tab label of a long host shows its registrable domain', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const key = holdKey('long-label')
    const url = browserServers.sites.static.url(`/__hold/${key}`, { host: LONG_HOST })
    await panel.load(url)
    await browserServers.held.waitForRequest(key)
    browserServers.held.release(key, { body: NO_TITLE_PAGE })
    await panel.waitForState({ committedUrl: url, loading: false, title: '' })

    const label = ui.editorTabs.first().locator('.erf-brw-tab__label')
    const text = label.locator('.erf-brw-tab__fitted')
    await expect(text).toHaveText(/evil\.test$/)
    await expect.poll(() => insideHorizontally(text, label), { timeout: WAIT_MS }).toBe(true)
  })

  test('F1 a popup at its 320 px minimum shows the registrable domain of a long host', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const target = browserServers.sites.static.url('/popup-child.html', { host: LONG_HOST })
    await loadPage(panel, `${browserServers.sites.static.url('/popups.html')}?popup=${encodeURIComponent(target)}`)
    const at = await centre(panel, '#open-narrow')
    await hook(appWithTestProject, 'popup', 'clickButton', await panel.tabId(), at.x, at.y, 'left')

    const host = await ui.popupHost()
    const address = ui.popupAddress(host)
    await expect(address).toHaveValue(/^http:\/\/….*evil\.test:\d+\/popup-child\.html/, { timeout: WAIT_MS })
    expect((await popups(appWithTestProject))[0]!.contentWidth).toBeLessThanOrEqual(321)
    // The origin part of the value – everything up to the path – is drawn inside the field.
    const fits = await address.evaluate((el) => {
      const field = el as HTMLInputElement
      const value = field.value
      const origin = value.slice(0, value.indexOf('/', value.indexOf('evil.test')))
      const style = getComputedStyle(field)
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const room = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      return ctx.measureText(origin).width <= room
    })
    expect(fits).toBe(true)
  })

  test('F4 a popup its opener writes with no navigation reads "about:blank – opened by" the opener, not "Loading…"', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const opener = browserServers.sites.static.url('/popups.html', { host: 'staging.test' })
    await loadPage(panel, opener)
    const at = await centre(panel, '#open-blank-write')
    await hook(appWithTestProject, 'popup', 'clickButton', await panel.tabId(), at.x, at.y, 'left')

    const host = await ui.popupHost()
    const expected = `about:blank – opened by ${new URL(opener).origin}`
    await expect(ui.popupAddress(host)).toHaveValue(expected, { timeout: WAIT_MS })
    await expect.poll(async () => (await popups(appWithTestProject))[0]?.title, { timeout: WAIT_MS }).toBe(expected)
    expect(await hook(appWithTestProject, 'popup', 'popupExec', (await popups(appWithTestProject))[0]!.pageWebContentsId, 'document.title')).toBe('Written by opener')
  })

  test('F4 a popup opened from a cross-origin frame names that frame, not the top page', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await loadPage(panel, browserServers.sites.static.url('/plain.html'))
    const key = holdKey('frame-opener')
    const frameUrl = browserServers.sites.static.url(`/__hold/${key}`, { host: 'ads.test' })
    const page = await panel.page()
    await page.eval(`(() => {
      const f = document.createElement('iframe')
      f.src = ${JSON.stringify(frameUrl)}
      f.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:80px;border:0;z-index:2147483647'
      f.addEventListener('load', () => { window.__frameLoaded = true })
      document.body.appendChild(f)
      return true
    })()`)
    await browserServers.held.waitForRequest(key)
    browserServers.held.release(key, { body: FRAME_OPENER_PAGE })
    await page.waitFor('window.__frameLoaded === true', 'the cross-origin frame loaded')
    // A real press on the page counts for Erfana's pop-up blocker (main side); `sendInputEvent` does not
    // reach an out-of-process frame, so the frame's button is clicked there with a user gesture.
    await hook(appWithTestProject, 'popup', 'clickButton', await panel.tabId(), 100, 40, 'left')
    await clickInFrame(appWithTestProject, (await panel.hookTab()).webContentsId, key, '#open')
    expect(await frameClicks(appWithTestProject, (await panel.hookTab()).webContentsId, key)).toBe(1)

    const host = await ui.popupHost()
    const expected = `about:blank – opened by ${new URL(frameUrl).origin}`
    await expect(ui.popupAddress(host)).toHaveValue(expected, { timeout: WAIT_MS })
    await expect.poll(async () => (await popups(appWithTestProject))[0]?.title, { timeout: WAIT_MS }).toBe(expected)
  })

  test('F7 user info never reaches the address bar, at rest or while edited', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const plain = browserServers.sites.static.url('/plain.html')
    const withUser = plain.replace('http://', 'http://accounts.google.com:pw@')
    await panel.load(withUser)
    await panel.waitForState({ committedUrl: plain, loading: false })
    await atRest(panel)
    await expect(panel.addressDisplay).not.toContainText('@')
    await panel.addressBar.focus()
    await expect(panel.addressBar).toHaveValue(plain)
    await expect(panel.addressBar).not.toHaveValue(/@/)
  })

  test('P1 bidi: a right-to-left label beside a digit-led domain, port and path keeps the parts in order', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await widenWindow(appWithTestProject)
    // Arabic "مثال" in front of the digit-led registrable domain 163.test, then a port and a digit path.
    const url = `${browserServers.sites.static.url('/plain.html', { host: 'xn--mgbh0fb.163.test' })}?n=2024`
    await panel.load(url)
    await panel.waitForState({ loading: false })
    await atRest(panel)
    await expect(panel.addressDomain).toHaveText('163.test')
    const lefts = await panel.addressParts.evaluateAll((parts) => parts.map((p) => p.getBoundingClientRect().left))
    expect(lefts.length).toBeGreaterThanOrEqual(4)
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts)
    for (const part of await panel.addressParts.all()) {
      expect(await part.evaluate((el) => getComputedStyle(el).unicodeBidi)).toBe('isolate')
    }
  })

  test('P2 Stay on the leave-page prompt drops the pending address: the bar names the page that stayed', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await widenWindow(appWithTestProject)
    const stay = browserServers.sites.static.url('/dialogs.html')
    await loadPage(panel, stay)
    const page = await panel.page()
    await page.clickSelector('#beforeunload')
    await page.waitFor(`document.getElementById('beforeunload').checked === true`, 'beforeunload armed')

    await panel.load(browserServers.sites.static.url('/plain.html', { host: 'accounts.google.com.evil.test' }))
    await expect(panel.stripRow('leavePage')).toBeVisible({ timeout: WAIT_MS })
    await panel.answerRow('leavePage', 'Stay')
    await expect(panel.stripRow('leavePage')).toHaveCount(0, { timeout: WAIT_MS })
    await panel.waitForState({ committedUrl: stay, pendingUrl: null })
    await atRest(panel)
    await expect(panel.addressDomain).toHaveText('app.test')
    expect(await page.eval<string>('location.href')).toBe(stay)
  })

  test('P3 window.stop() during a load the user started never leaves the bar naming a page that is not shown', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const start = browserServers.sites.static.url('/plain.html')
    await loadPage(panel, start)
    const key = holdKey('stop')
    const target = browserServers.sites.static.url(`/__hold/${key}`, { host: 'bank.test' })
    await panel.load(target)
    await browserServers.held.waitForRequest(key)
    await panel.waitForState({ pendingUrl: target })

    // `webContents.executeJavaScript` waits for the pending load; the main frame's own does not.
    await frameExec(appWithTestProject, (await panel.hookTab()).webContentsId, null, '(() => { window.stop(); return true })()')
    // The page's stop either cancels the user's load (the request closes) or leaves it running.
    if (browserServers.held.heldCount(key) > 0) browserServers.held.release(key, { body: NO_TITLE_PAGE })
    await panel.waitForState({ pendingUrl: null, loading: false })
    const state = await (await panel.page()).eval<string>('location.href')
    const committed = (await ui.tabs.lastState(await panel.tabId()))!.committedUrl
    expect(committed).toBe(state)
  })

  test('P4 getURL() during a held load the user started is the committed address, not the pending one', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const start = browserServers.sites.static.url('/plain.html')
    await loadPage(panel, start)
    const key = holdKey('geturl')
    const target = browserServers.sites.static.url(`/__hold/${key}`, { host: 'bank.test' })
    await panel.load(target)
    await browserServers.held.waitForRequest(key)
    await panel.waitForState({ pendingUrl: target })

    expect((await panel.hookTab()).url).toBe(start)
    browserServers.held.release(key, { body: NO_TITLE_PAGE })
    await panel.waitForState({ committedUrl: target, loading: false })
  })

  test('P5 page full screen keeps the navigation row and the strip in view', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    await loadPage(panel, browserServers.sites.static.url('/events.html'))
    const page = await panel.page()
    await hook(appWithTestProject, 'browserInput', 'execWithGesture', page.tabId, `document.getElementById('outer').requestFullscreen().then(() => true)`)
    await page.waitFor('document.fullscreenElement !== null', 'page in full screen')

    await expect(panel.addressBar).toBeVisible()
    await expect(panel.navigation).toBeVisible()
    await expect(panel.strip).toContainText('Press Esc to exit', { timeout: WAIT_MS })
    const bar = await panel.addressBar.boundingBox()
    const area = await panel.placeholder.boundingBox()
    expect(bar).not.toBeNull()
    expect(area).not.toBeNull()
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(area!.y + 0.5)
    const fullScreenWindow = await appWithTestProject.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFullScreen()))
    expect(fullScreenWindow).toBe(false)
    await page.key('Escape')
    await page.waitFor('document.fullscreenElement === null', 'full screen left')
  })
})

