// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser window open, popups, the leave-page prompt and the page
 * right-click menu, main side (spec 025 commits 12e–g; 025-AC-011, 025-AC-074,
 * 025-AC-075 – main-observable parts).
 *
 * Tabs are driven through `window.api.browserTab` from Erfana's window (the
 * browser UI comes in commit 18); strip rows, `tabAdded` and `contextMenu`
 * events are recorded there. Main-side facts come from the test hooks
 * (`browserHook`, `browserPopupHook`). Presses reach the page through
 * main-side `sendInputEvent`, so they are user activations for the popup
 * blocker. The 500 ms input guard is passed on the test clock. Condition-based
 * waits only.
 */
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import type { BrowserTabPage } from './pages/browser-tab.page'
import type { BrowserPagePage } from './pages/browser-page.page'

const WAIT_MS = 15_000

type Rec = Record<string, unknown>

interface Recorder {
  __popRec?: { strip: Rec[]; tabAdded: Rec[]; menus: Rec[] }
  api: { browserTab: Record<string, (...args: unknown[]) => unknown> }
}

interface HookPopup {
  hostWebContentsId: number
  pageWebContentsId: number
  openerTabId: string
  title: string
  committedUrl: string | null
  contentWidth: number
  contentHeight: number
  hostKind: string | null
  channels: Record<string, boolean>
}

/** Record strip, tabAdded and contextMenu events in Erfana's window. Idempotent. */
async function installRecorders(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as Recorder
    if (w.__popRec) return
    const rec = { strip: [] as Rec[], tabAdded: [] as Rec[], menus: [] as Rec[] }
    w.__popRec = rec
    w.api.browserTab['onStrip']!((e: Rec) => rec.strip.push(e))
    w.api.browserTab['onTabAdded']!((e: Rec) => rec.tabAdded.push(e))
    w.api.browserTab['onContextMenu']!((e: Rec) => rec.menus.push(e))
  })
}

function recorded(window: Page, kind: 'strip' | 'tabAdded' | 'menus'): Promise<Rec[]> {
  return window.evaluate((k) => (window as unknown as Recorder).__popRec?.[k as 'strip'] ?? [], kind)
}

/** Call `window.api.browserTab.<method>(...args)` in Erfana's window. */
function bridge<T = unknown>(window: Page, method: string, ...args: unknown[]): Promise<T> {
  return window.evaluate(
    ([name, callArgs]) => (window as unknown as Recorder).api.browserTab[name as string]!(...(callArgs as unknown[])),
    [method, args] as const
  ) as Promise<T>
}

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

const popups = (app: ElectronApplication): Promise<HookPopup[]> => hook(app, 'popup', 'popups')
const advance = (app: ElectronApplication, ms: number): Promise<void> => hook(app, 'clock', 'advance', ms)

/** The newest strip `add` row of `kind` for `tabId`, once it shows. */
async function waitForRow(window: Page, tabId: string, kind: string): Promise<Rec> {
  await expect
    .poll(async () => (await recorded(window, 'strip')).some((e) => e['tabId'] === tabId && e['op'] === 'add' && (e['row'] as Rec)['kind'] === kind), {
      timeout: WAIT_MS,
      message: `a ${kind} row for ${tabId}`
    })
    .toBe(true)
  const adds = (await recorded(window, 'strip')).filter((e) => e['tabId'] === tabId && e['op'] === 'add' && (e['row'] as Rec)['kind'] === kind)
  return adds[adds.length - 1]!['row'] as Rec
}

/** Open a tab on `url` and wait until the page is loaded and takes input. */
async function openOn(browserTabs: BrowserTabPage, url: string): Promise<BrowserPagePage> {
  await installRecorders(browserTabs.window)
  const page = await browserTabs.open()
  await browserTabs.navigate(page.tabId, url)
  await page.waitForLoaded(url)
  await page.waitForInputReady()
  return page
}

async function waitForTabOn(browserTabs: BrowserTabPage, via: string): Promise<string> {
  await expect
    .poll(async () => (await browserTabs.tabs()).some((t) => t.url.includes(`via=${via}`)), { timeout: WAIT_MS, message: `a tab for ${via}` })
    .toBe(true)
  return (await browserTabs.tabs()).find((t) => t.url.includes(`via=${via}`))!.tabId
}

async function waitForPopupCount(app: ElectronApplication, count: number): Promise<HookPopup[]> {
  await expect.poll(async () => (await popups(app)).length, { timeout: WAIT_MS, message: `${count} popups` }).toBe(count)
  return popups(app)
}

test.describe('built-in browser window open and popups (025-AC-011)', () => {
  test('025-AC-011 _blank link, middle-click and noopener open tabs; the opener-keeping opens are popups', async ({
    browserTabs,
    browserServers
  }) => {
    const app = browserTabs.app
    const url = browserServers.sites.static.url('/popups.html', { host: 'staging.test' })
    const page = await openOn(browserTabs, url)

    await page.clickSelector('#blank-link')
    const blankTab = await waitForTabOn(browserTabs, 'blank-link')
    const plain = await page.eval<{ x: number; y: number }>(
      `(() => { const r = document.getElementById('plain-link').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
    )
    await hook(app, 'popup', 'clickButton', page.tabId, plain.x, plain.y, 'middle')
    await waitForTabOn(browserTabs, 'plain-link')
    await page.clickSelector('#open-noopener')
    await waitForTabOn(browserTabs, 'noopener')
    // Each is a page-opened tab announced to the owning window (createFromPage), never a popup window.
    await expect.poll(async () => (await recorded(browserTabs.window, 'tabAdded')).filter((e) => e['openerTabId'] === page.tabId).length).toBe(3)
    expect((await recorded(browserTabs.window, 'tabAdded')).find((e) => e['tabId'] === blankTab)).toMatchObject({ background: false })
    expect(await popups(app)).toHaveLength(0)

    // A sign-in popup: its own window, 500 × 600 content, opener kept, title from the committed host.
    await page.clickSelector('#open-auth')
    const [auth] = await waitForPopupCount(app, 1)
    await expect.poll(async () => (await popups(app))[0]?.committedUrl ?? '').toContain('via=auth')
    const shown = (await popups(app))[0]!
    expect(Math.abs(shown.contentWidth - 500)).toBeLessThanOrEqual(1)
    expect(Math.abs(shown.contentHeight - 600)).toBeLessThanOrEqual(1)
    expect(shown.title).toMatch(/^staging\.test(:\d+)? – Erfana$/)
    expect(shown.openerTabId).toBe(page.tabId)
    expect(await hook(app, 'popup', 'popupExec', auth!.pageWebContentsId, 'window.opener !== null')).toBe(true)

    // ADR 0011 decision 9: the host is a browserPopup window and reaches only the popup channels.
    expect(shown.hostKind).toBe('browserPopup')
    expect(shown.channels).toEqual({
      'browser-tab:popupStrip': true,
      'browser-tab:popupAnswer': true,
      'browser-tab:popupClose': true,
      'browser-tab:create': false,
      'terminal:create': false
    })

    // The popup posts to its opener and closes; a cookie it set is the opener's too (one profile).
    await hook(app, 'popup', 'popupExec', auth!.pageWebContentsId, `document.getElementById('send-ok').click()`)
    await page.waitFor(`document.getElementById('opener-message').textContent === 'ok'`, 'the opener got "ok"')
    expect(await page.eval<string>(`document.getElementById('opener-cookie').textContent`)).toContain('popup_cookie=set-in-popup')
    await waitForPopupCount(app, 0)

    // window.open(url) with no features keeps its opener: an 800 × 600 popup.
    await page.clickSelector('#open-default')
    const [plainPopup] = await waitForPopupCount(app, 1)
    expect(Math.abs(plainPopup!.contentWidth - 800)).toBeLessThanOrEqual(1)
    expect(Math.abs(plainPopup!.contentHeight - 600)).toBeLessThanOrEqual(1)
    expect(await hook(app, 'popup', 'popupExec', plainPopup!.pageWebContentsId, 'window.opener !== null')).toBe(true)

    // Closing the opener tab closes its popup.
    await browserTabs.close(page.tabId)
    await waitForPopupCount(app, 0)
  })

  test('025-AC-011 popup sizes: a huge request fits the work area, a narrow one is raised to 320 px', async ({
    browserTabs,
    browserServers
  }) => {
    const app = browserTabs.app
    const page = await openOn(browserTabs, browserServers.sites.static.url('/popups.html'))

    await page.clickSelector('#open-big')
    const [big] = await waitForPopupCount(app, 1)
    const area = await hook<{ width: number; height: number }>(app, 'popup', 'workArea', page.tabId)
    expect(big!.contentWidth).toBeLessThanOrEqual(area.width)
    expect(big!.contentHeight).toBeLessThanOrEqual(area.height)

    await page.clickSelector('#open-narrow')
    await waitForPopupCount(app, 2)
    const narrow = (await popups(app)).find((p) => p.pageWebContentsId !== big!.pageWebContentsId)!
    expect(narrow.contentWidth).toBe(320)
    expect(Math.abs(narrow.contentHeight - 400)).toBeLessThanOrEqual(1)

    // A requested position is ignored (S-22): the popup still opens, at the default place.
    await page.clickSelector('#open-over-toolbar')
    await waitForPopupCount(app, 3)
  })

  test('025-AC-011 opens without a user action are blocked with "Pop-up blocked"; Allow once opens one after the guard', async ({
    browserTabs,
    browserServers
  }) => {
    const app = browserTabs.app
    const window = browserTabs.window
    const page = await openOn(browserTabs, browserServers.sites.static.url('/popups.html'))

    const results = await page.eval<boolean[]>('window.__fixture.openMany(6)')
    expect(results).toEqual([false, false, false, false, false, false])
    const row = await waitForRow(window, page.tabId, 'popupBlocked')
    expect(row['text']).toBe('Pop-up blocked')
    expect(row['answers']).toEqual(['allowOnce', 'alwaysAllow', 'dismiss'])
    expect(await popups(app)).toHaveLength(0)
    expect((await browserTabs.tabs()).length).toBe(1)

    // Inside the input guard the answer is ignored; after it, Allow once opens the blocked address as a tab.
    await bridge(window, 'answerStrip', { tabId: page.tabId, requestId: row['requestId'], answer: 'allowOnce' })
    expect((await browserTabs.tabs()).length).toBe(1)
    await advance(app, 500)
    await bridge(window, 'answerStrip', { tabId: page.tabId, requestId: row['requestId'], answer: 'allowOnce' })
    await waitForTabOn(browserTabs, 'auto-5')
    expect(await popups(app)).toHaveLength(0)
  })

  test('025-AC-011 six user-activated opens in a minute: five open, the sixth is blocked; a minute later one opens', async ({
    browserTabs,
    browserServers
  }) => {
    const app = browserTabs.app
    const page = await openOn(browserTabs, browserServers.sites.static.url('/popups.html'))
    for (let i = 1; i <= 5; i += 1) {
      await page.clickSelector('#open-one')
      await waitForPopupCount(app, i)
    }
    await page.clickSelector('#open-one')
    await waitForRow(browserTabs.window, page.tabId, 'popupBlocked')
    await page.waitFor(`window.__fixture.log.some((e) => e.type === 'blocked' && e.detail === 'user-6')`, 'the sixth open was refused')
    expect(await popups(app)).toHaveLength(5)

    await advance(app, 60_000)
    await page.clickSelector('#open-one')
    await waitForPopupCount(app, 6)
  })

  test('025-AC-011 Always allow for this site lets that site open without a row; another site is still blocked', async ({
    browserTabs,
    browserServers
  }) => {
    const app = browserTabs.app
    const window = browserTabs.window
    const page = await openOn(browserTabs, browserServers.sites.static.url('/popups.html', { host: 'staging.test' }))
    await page.eval('window.__fixture.openMany(1)')
    const row = await waitForRow(window, page.tabId, 'popupBlocked')
    await advance(app, 500)
    await bridge(window, 'answerStrip', { tabId: page.tabId, requestId: row['requestId'], answer: 'alwaysAllow' })
    await waitForTabOn(browserTabs, 'auto-0')

    // The same site now opens without a user action and without a row.
    const rowsBefore = (await recorded(window, 'strip')).length
    expect(await page.eval<boolean[]>('window.__fixture.openMany(1)')).toEqual([true])
    await waitForPopupCount(app, 1)
    expect((await recorded(window, 'strip')).slice(rowsBefore).filter((e) => e['op'] === 'add')).toHaveLength(0)

    // A second site still gets "Pop-up blocked".
    const other = await openOn(browserTabs, browserServers.sites.static.url('/popups.html', { host: 'other.test' }))
    expect(await other.eval<boolean[]>('window.__fixture.openMany(1)')).toEqual([false])
    await waitForRow(window, other.tabId, 'popupBlocked')
  })
})

test.describe('built-in browser leave-page prompt (025-AC-075)', () => {
  test('025-AC-075 a page with beforeunload asks "Leave this page?" on close; Stay keeps the tab, Leave closes it', async ({
    browserTabs,
    browserServers
  }) => {
    const app = browserTabs.app
    const window = browserTabs.window
    const page = await openOn(browserTabs, browserServers.sites.static.url('/dialogs.html'))
    // Chromium asks only after a user gesture on the page.
    await page.clickSelector('#beforeunload')
    await page.waitFor(`document.getElementById('beforeunload').checked === true`, 'beforeunload armed')

    await bridge(window, 'close', page.tabId)
    const row = await waitForRow(window, page.tabId, 'leavePage')
    expect(String(row['text'])).toContain('Leave this page? Changes may not be saved')
    expect(row['answers']).toEqual(['leave', 'stay'])
    expect(row['takesFocus']).toBe(true)
    await advance(app, 500)
    await bridge(window, 'answerStrip', { tabId: page.tabId, requestId: row['requestId'], answer: 'stay' })
    expect((await browserTabs.tabs()).some((t) => t.tabId === page.tabId)).toBe(true)
    expect(await page.eval<boolean>(`document.getElementById('beforeunload').checked`)).toBe(true)

    // Asked again; Leave closes the tab.
    const before = (await recorded(window, 'strip')).length
    await bridge(window, 'close', page.tabId)
    await expect
      .poll(async () => (await recorded(window, 'strip')).slice(before).some((e) => e['op'] === 'add' && (e['row'] as Rec)['kind'] === 'leavePage'))
      .toBe(true)
    const again = (await recorded(window, 'strip')).slice(before).find((e) => e['op'] === 'add')!['row'] as Rec
    await advance(app, 500)
    await bridge(window, 'answerStrip', { tabId: page.tabId, requestId: again['requestId'], answer: 'leave' })
    await expect.poll(async () => (await browserTabs.tabs()).some((t) => t.tabId === page.tabId), { timeout: WAIT_MS }).toBe(false)
  })

  test('025-AC-075 Reload asks too, and Leave reloads; a page without beforeunload closes at once', async ({ browserTabs, browserServers }) => {
    const app = browserTabs.app
    const window = browserTabs.window
    const page = await openOn(browserTabs, browserServers.sites.static.url('/dialogs.html'))
    await page.clickSelector('#beforeunload')
    await page.waitFor(`document.getElementById('beforeunload').checked === true`, 'beforeunload armed')

    await browserTabs.history(page.tabId, 'reload')
    const row = await waitForRow(window, page.tabId, 'leavePage')
    await advance(app, 500)
    await bridge(window, 'answerStrip', { tabId: page.tabId, requestId: row['requestId'], answer: 'leave' })
    await page.waitFor(`document.readyState === 'complete' && window.__fixture.count('beforeunload') === 0`, 'the page reloaded')

    await bridge(window, 'close', page.tabId)
    await expect.poll(async () => (await browserTabs.tabs()).some((t) => t.tabId === page.tabId), { timeout: WAIT_MS }).toBe(false)
  })
})

test.describe('built-in browser page right-click menu (025-AC-074)', () => {
  const MENU_PAGE = `
    document.body.innerHTML = '<p id="text">Some selectable words</p>'
      + '<a id="link" href="/page-b.html?via=menu" style="display:inline-block;padding:20px">A link</a>'
      + '<img id="img" src="/favicon.svg" width="64" height="64">'
      + '<input id="field" value="editable">';
    0`

  async function centre(page: BrowserPagePage, selector: string): Promise<{ x: number; y: number }> {
    return page.eval(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
    )
  }

  async function menuAt(app: ElectronApplication, window: Page, page: BrowserPagePage, selector: string): Promise<Rec> {
    const before = (await recorded(window, 'menus')).length
    const at = await centre(page, selector)
    await hook(app, 'popup', 'clickButton', page.tabId, at.x, at.y, 'right')
    await expect.poll(async () => (await recorded(window, 'menus')).length, { timeout: WAIT_MS, message: `a menu on ${selector}` }).toBeGreaterThan(before)
    return (await recorded(window, 'menus')).at(-1)!
  }

  test('025-AC-074 menu items for a link, an image, a selection and an editable field', async ({ browserTabs, browserServers }) => {
    const app = browserTabs.app
    const window = browserTabs.window
    const page = await openOn(browserTabs, browserServers.sites.static.url('/plain.html'))
    await page.eval(MENU_PAGE)
    await page.waitFor(`document.getElementById('img').complete`, 'the image loaded')

    // On macOS a right-click also selects the word under the pointer, which adds Copy; the rest is fixed.
    // Pick this element shows on every page menu now that pick is wired (025-FR-025).
    const withoutCopy = (menu: Rec): unknown[] => (menu['items'] as unknown[]).filter((item) => item !== 'copy')
    const onLink = await menuAt(app, window, page, '#link')
    expect(onLink['tabId']).toBe(page.tabId)
    expect(withoutCopy(onLink)).toEqual(['reload', 'selectAll', 'openLinkInNewTab', 'openLinkInSystemBrowser', 'copyLinkAddress', 'pickThisElement', 'inspect'])
    expect(onLink['linkOrigin']).toMatchObject({ kind: 'web' })

    const onImage = await menuAt(app, window, page, '#img')
    expect(withoutCopy(onImage)).toEqual(['reload', 'selectAll', 'copyImage', 'openImageInNewTab', 'pickThisElement', 'inspect'])

    const onField = await menuAt(app, window, page, '#field')
    expect(withoutCopy(onField)).toEqual(['reload', 'paste', 'selectAll', 'pickThisElement', 'inspect'])

    await page.eval(`(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('text')); getSelection().removeAllRanges(); getSelection().addRange(r); return 0 })()`)
    const onSelection = await menuAt(app, window, page, '#text')
    expect(onSelection['items']).toEqual(['reload', 'copy', 'selectAll', 'pickThisElement', 'inspect'])
  })

  test('025-AC-074 Open link in new tab, in system browser, Copy link address, Select all and Inspect do what they name', async ({
    browserTabs,
    browserServers
  }) => {
    const app = browserTabs.app
    const window = browserTabs.window
    const page = await openOn(browserTabs, browserServers.sites.static.url('/plain.html'))
    await page.eval(MENU_PAGE)

    const link = await menuAt(app, window, page, '#link')
    await bridge(window, 'contextAction', { tabId: page.tabId, menuId: link['menuId'], action: 'openLinkInNewTab' })
    const opened = await waitForTabOn(browserTabs, 'menu')
    expect((await recorded(window, 'tabAdded')).find((e) => e['tabId'] === opened)).toMatchObject({ openerTabId: page.tabId, background: false })
    // A menu takes one action: the same id does nothing more.
    await bridge(window, 'contextAction', { tabId: page.tabId, menuId: link['menuId'], action: 'openLinkInNewTab' })

    const copy = await menuAt(app, window, page, '#link')
    await bridge(window, 'contextAction', { tabId: page.tabId, menuId: copy['menuId'], action: 'copyLinkAddress' })
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('/page-b.html?via=menu')

    // Open link in system browser goes through the checked external-open path (stubbed here).
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __externalOpens: string[] }
      g.__externalOpens = []
      shell.openExternal = async (target: string) => {
        g.__externalOpens.push(target)
      }
    })
    const external = await menuAt(app, window, page, '#link')
    await bridge(window, 'contextAction', { tabId: page.tabId, menuId: external['menuId'], action: 'openLinkInSystemBrowser' })
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { __externalOpens: string[] }).__externalOpens))
      .toEqual([expect.stringContaining('/page-b.html?via=menu')])

    const all = await menuAt(app, window, page, '#text')
    await bridge(window, 'contextAction', { tabId: page.tabId, menuId: all['menuId'], action: 'selectAll' })
    await page.waitFor(`getSelection().toString().includes('Some selectable words')`, 'everything selected')

    const inspect = await menuAt(app, window, page, '#img')
    await bridge(window, 'contextAction', { tabId: page.tabId, menuId: inspect['menuId'], action: 'inspect' })
    await expect.poll(async () => (await browserTabs.tabs()).find((t) => t.tabId === page.tabId)?.devToolsOpen, { timeout: WAIT_MS }).toBe(true)

    // An item the menu did not offer is refused: no tab opens from the image menu's link action.
    const tabsBefore = (await browserTabs.tabs()).length
    const image = await menuAt(app, window, page, '#img')
    await bridge(window, 'contextAction', { tabId: page.tabId, menuId: image['menuId'], action: 'openLinkInNewTab' })
    expect((await browserTabs.tabs()).length).toBe(tabsBefore)
  })
})
