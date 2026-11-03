// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser key and mouse routing, main side (spec 025 commit 13;
 * 025-AC-014, 025-AC-019, 025-AC-061, 025-AC-062, 025-AC-065, 025-AC-071).
 *
 * There is no browser UI yet (commits 17–19), so these tests check what main
 * does and sends: which keys and clicks the page receives, which keys reach
 * the owning window as `browser-tab:forwardedKey` actions, pick-mode events,
 * the click guard and the first-click rule. The renderer acting on a
 * forwarded action is the UI commit's part of each criterion.
 *
 * Input goes through main-side `sendInputEvent` (S-27). Every "nothing
 * reaches the page" step sends a sentinel key the page does receive, waits
 * until it is logged, and only then asserts nothing came before it.
 * Condition-based waits only.
 */
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/browserHarness'
import type { BrowserPagePage } from './pages/browser-page.page'
import { PAGE_AREA, type BrowserTabPage } from './pages/browser-tab.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { BrowserSendUi } from './pages/browser-send.page'
import { BROWSER_TEST_IDS } from '../src/renderer/src/components/Panels/BrowserPanel/browserTestIds'

type Modifier = 'shift' | 'control' | 'alt' | 'meta'

const IS_MAC = process.platform === 'darwin'
/** Ctrl/Cmd: Cmd on macOS, Ctrl elsewhere. */
const MOD: Modifier = IS_MAC ? 'meta' : 'control'
const WAIT_MS = 15_000

/** One event the window received on `forwardedKey` or `pick`. */
interface WindowEvent {
  channel: 'forwardedKey' | 'pick'
  tabId: string
  action?: string
  kind?: string
  on?: boolean
  note?: string
}

/** The window-side recorder's globals. */
interface Recorder {
  __browserKeyEvents?: WindowEvent[]
  __windowKeydowns?: string[]
  api: {
    browserTab: {
      onForwardedKey(cb: (e: { tabId: string; action: string }) => void): () => void
      onPick(cb: (e: { tabId: string; kind: string }) => void): () => void
      toolbarFocus(tabId: string, focused: boolean): void
    }
  }
}

/** Call `<hook>.<name>(...args)` on the main-process test hooks. */
async function mainHook<T>(app: ElectronApplication, hook: 'browserInput' | 'clock', name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [hookName, fnName, fnArgs]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there
      const hooks = (globalThis as any).__erfanaTestHooks
      if (!hooks?.[hookName as string]) throw new Error('Test hooks are not installed (build with npm run build:e2e)')
      return hooks[hookName as string][fnName as string](...(fnArgs as unknown[]))
    },
    [hook, name, args] as const
  )) as T
}

/** Record every forwarded key and pick event the window receives, and the window's own keydowns. Idempotent. */
async function installRecorder(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const w = window as unknown as Recorder
    if (w.__browserKeyEvents) return
    const events: WindowEvent[] = []
    w.__browserKeyEvents = events
    w.__windowKeydowns = []
    w.api.browserTab.onForwardedKey((e) => events.push({ channel: 'forwardedKey', ...e }))
    w.api.browserTab.onPick((e) => events.push({ channel: 'pick', ...e }))
    window.addEventListener('keydown', (e) => w.__windowKeydowns!.push(e.key), true)
  })
}

async function windowEvents(appWindow: Page, tabId: string): Promise<WindowEvent[]> {
  return appWindow.evaluate(
    (id) => ((window as unknown as Recorder).__browserKeyEvents ?? []).filter((e) => e.tabId === id),
    tabId
  )
}

async function forwardedActions(appWindow: Page, tabId: string): Promise<string[]> {
  return (await windowEvents(appWindow, tabId)).filter((e) => e.channel === 'forwardedKey').map((e) => e.action!)
}

/** The keydowns the page logged (`events.html`: "Meta+l KeyL"), oldest first. */
async function pageKeydowns(page: BrowserPagePage): Promise<string[]> {
  return page.eval<string[]>(`window.__fixture.log.filter(e => e.type === 'keydown').map(e => e.detail)`)
}

/** Send the sentinel `x` and wait until the page logged it: everything sent before it has been routed. */
async function sentinel(page: BrowserPagePage): Promise<void> {
  const before = (await pageKeydowns(page)).filter((k) => k.startsWith('x ')).length
  await page.key('x')
  await page.waitFor(
    `window.__fixture.log.filter(e => e.type === 'keydown' && e.detail.startsWith('x ')).length > ${before}`,
    'sentinel logged'
  )
}

/** Open `events.html` in a fresh tab with page focus. */
async function openEventsPage(browserTabs: BrowserTabPage, url: string): Promise<BrowserPagePage> {
  const page = await browserTabs.open()
  await browserTabs.navigate(page.tabId, url)
  await page.waitForLoaded(url)
  await installRecorder(browserTabs.window)
  await page.clickSelector('#text')
  await page.waitFor(`document.activeElement === document.getElementById('text')`, 'text field focused')
  await page.eval(`window.__fixture.clear(); 0`)
  return page
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('built-in browser key and mouse routing (main side)', () => {
  test('025-AC-061 with page focus the page keeps Erfana app shortcuts and nothing is forwarded', async ({
    browserTabs,
    browserServers,
    windowWithTestProject
  }) => {
    // Positive control: in the editor the same key is Erfana's – Ctrl/Cmd+K wraps the selection in a link.
    // (Ctrl/Cmd+P has no binding in Erfana and Ctrl/Cmd+Shift+N is a menu accelerator Playwright cannot press:
    // their controls are the manual pass.)
    await new ProjectTreePage(windowWithTestProject).clickFileByName('test.md')
    await new EditorPanelPage(windowWithTestProject).setViewMode('editor')
    const editor = new MonacoPage(windowWithTestProject, new KeyboardHelper(windowWithTestProject))
    await editor.setContent('word')
    await editor.selectAll()
    await windowWithTestProject.keyboard.press(`${IS_MAC ? 'Meta' : 'Control'}+k`)
    await expect.poll(() => editor.getContent(), { timeout: WAIT_MS }).toMatch(/^\[word\]\(/)

    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    const shortcuts: Array<[string, Modifier[]]> = [
      ['s', [MOD]],
      ['k', [MOD]],
      ['p', [MOD]],
      ['n', [MOD, 'shift']]
    ]
    for (const [key, modifiers] of shortcuts) await page.key(key, modifiers)
    await sentinel(page)
    const logged = (await pageKeydowns(page)).map((k) => k.split(' ')[0]!.toLowerCase())
    const prefix = IS_MAC ? 'meta' : 'ctrl'
    expect(logged).toEqual([`${prefix}+s`, `${prefix}+k`, `${prefix}+p`, `${prefix}+shift+n`, 'x'])
    expect(await forwardedActions(browserTabs.window, page.tabId)).toEqual([])
  })

  test('025-AC-014 browser and reserved keys from page focus are forwarded and never reach the page', async ({
    browserTabs,
    browserServers
  }) => {
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    const keys: Array<[string, Modifier[], string]> = [
      ['l', [MOD], 'focusAddress'],
      ['r', [MOD], 'reload'],
      ['F5', [], 'reload'],
      ['w', [MOD], 'closeTab'],
      ['t', [MOD], 'newTab'],
      IS_MAC ? ['[', ['meta'], 'back'] : ['Left', ['alt'], 'back'],
      IS_MAC ? [']', ['meta'], 'forward'] : ['Right', ['alt'], 'forward'],
      ['F12', [], 'devTools'],
      ['f', [MOD], 'find'],
      ['F6', [], 'focusNextZone'],
      ['F6', ['shift'], 'focusPreviousZone'],
      ['Tab', ['control'], 'nextEditorTab'],
      ['Tab', ['control', 'shift'], 'previousEditorTab']
    ]
    const expected: string[] = []
    for (const [key, modifiers, action] of keys) {
      await page.key(key, modifiers)
      await sentinel(page)
      expected.push(action)
      await expect.poll(() => forwardedActions(browserTabs.window, page.tabId), { timeout: WAIT_MS }).toEqual(expected)
    }
    // Only the sentinels reached the page.
    expect((await pageKeydowns(page)).every((k) => k.startsWith('x '))).toBe(true)
    expect(await pageKeydowns(page)).toHaveLength(keys.length)
  })

  test('the auto-repeats and key-up of a consumed key never reach the page', async ({ browserTabs, browserServers, appWithTestProject }) => {
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    await page.eval(`document.addEventListener('keyup', (e) => window.__fixture.record('keyup', e.key), true); 0`)
    await mainHook(appWithTestProject, 'browserInput', 'keyWithRepeats', page.tabId, 'F6', [], 3)
    await sentinel(page)
    await page.waitFor(`window.__fixture.count('keyup') > 0`, 'sentinel key-up logged')
    const log = await page.eval<Array<{ type: string; detail: string }>>(`window.__fixture.log.map(e => ({ type: e.type, detail: e.detail }))`)
    expect(log.filter((e) => e.detail.includes('F6'))).toEqual([])
    expect(await forwardedActions(browserTabs.window, page.tabId)).toEqual(['focusNextZone'])
  })

  test('025-AC-062 pick mode from Cmd/Ctrl+E: the page receives no key, Enter and Esc are handled, find still opens', async ({
    browserTabs,
    browserServers,
    appWithTestProject
  }) => {
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    await page.key('e', [MOD])
    await expect
      .poll(async () => (await windowEvents(browserTabs.window, page.tabId)).filter((e) => e.channel === 'pick'), { timeout: WAIT_MS })
      .toEqual([{ channel: 'pick', tabId: page.tabId, kind: 'mode', on: true }])

    for (const [key, modifiers] of [['a', []], ['s', [MOD]], ['n', [MOD, 'shift']], ['Up', []], ['Down', ['alt']]] as Array<[string, Modifier[]]>) {
      await page.key(key, modifiers)
    }
    // Enter with nothing highlighted: the note, and no capture.
    await page.key('Enter')
    await expect
      .poll(async () => (await windowEvents(browserTabs.window, page.tabId)).some((e) => e.kind === 'note' && e.note === 'moveTheMouse'), {
        timeout: WAIT_MS
      })
      .toBe(true)
    await page.key('f', [MOD])
    await expect.poll(() => forwardedActions(browserTabs.window, page.tabId), { timeout: WAIT_MS }).toEqual(['find'])
    expect((await mainHook<{ pick: boolean }>(appWithTestProject, 'browserInput', 'routingState', page.tabId)).pick).toBe(true)

    await page.key('Escape')
    await expect
      .poll(async () => (await windowEvents(browserTabs.window, page.tabId)).filter((e) => e.kind === 'mode').map((e) => e.on), {
        timeout: WAIT_MS
      })
      .toEqual([true, false])
    // Pick mode is off: the sentinel is the first key the page sees.
    await sentinel(page)
    expect(await pageKeydowns(page)).toEqual(['x KeyX'])
  })

  test('025-AC-062 with focus from outside the tab, the first click in pick mode only focuses the page; the second picks', async ({
    browserTabs,
    browserServers,
    appWithTestProject
  }) => {
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    const input = <T>(name: string, ...args: unknown[]): Promise<T> => mainHook<T>(appWithTestProject, 'browserInput', name, page.tabId, ...args)
    await page.key('e', [MOD])
    await expect.poll(() => input<{ pick: boolean }>('routingState').then((s) => s.pick), { timeout: WAIT_MS }).toBe(true)

    await input('focusAppWindow')
    await expect.poll(() => input<{ focus: string }>('routingState').then((s) => s.focus), { timeout: WAIT_MS }).toBe('out')
    await page.eval(`window.__fixture.clear(); 0`)

    await page.clickSelector('#target-button')
    await expect.poll(() => input<{ focus: string }>('routingState').then((s) => s.focus), { timeout: WAIT_MS }).toBe('page')
    const afterFirst = await input<{ focus: string; capturing: boolean }>('routingState')
    expect(afterFirst).toMatchObject({ focus: 'page', capturing: false })

    await page.clickSelector('#target-button')
    await expect.poll(() => input<{ capturing: boolean }>('routingState').then((s) => s.capturing), { timeout: WAIT_MS }).toBe(true)
    // Pick blocking: neither click reached the page.
    expect(await page.eval<number>(`window.__fixture.count('pointerdown') + window.__fixture.count('mousedown') + window.__fixture.count('click')`)).toBe(0)
  })

  test('025-AC-061 a page click within 500 ms of a row shift is not delivered; one at 500 ms on the test clock is', async ({
    browserTabs,
    browserServers,
    appWithTestProject
  }) => {
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    const centre = await page.eval<{ x: number; y: number }>(
      `(() => { const r = document.getElementById('text').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
    )
    const clickNow = (): Promise<{ sentAt: number; guardUntil: number }> =>
      mainHook(appWithTestProject, 'browserInput', 'clickNow', page.tabId, centre.x, centre.y)
    const guardUntil = (): Promise<number> =>
      mainHook<{ clickGuardUntil: number }>(appWithTestProject, 'browserInput', 'routingState', page.tabId).then((s) => s.clickGuardUntil)

    // A strip row inserts above the page while the pointer is over it: the page moves down 40 px.
    // The click is sent in the same main-process call that reads the clock, so a slow round trip
    // cannot push it past the guard unnoticed; a run that was too slow shifts again (bounded).
    let dropped: { sentAt: number; guardUntil: number } | null = null
    for (let attempt = 0; attempt < 5 && dropped === null; attempt += 1) {
      const previous = await guardUntil()
      await page.waitForInputReady()
      await browserTabs.moveTo(page.tabId, { ...PAGE_AREA, y: PAGE_AREA.y + (attempt % 2 === 0 ? 40 : 0), height: PAGE_AREA.height - 40 })
      await expect.poll(guardUntil, { timeout: WAIT_MS }).toBeGreaterThan(previous)
      await page.eval(`window.__fixture.clear(); 0`)
      const click = await clickNow()
      await sentinel(page)
      if (click.sentAt < click.guardUntil) dropped = click
    }
    expect(dropped, 'a click inside the guard was sent').not.toBeNull()
    expect(await page.eval<number>(`window.__fixture.count('mousedown') + window.__fixture.count('click')`)).toBe(0)

    // 500 ms later on the test clock: the same click is delivered.
    await mainHook(appWithTestProject, 'clock', 'advance', 500)
    const late = await clickNow()
    expect(late.sentAt).toBeGreaterThanOrEqual(late.guardUntil)
    await page.waitFor(`window.__fixture.count('click') === 1`, 'late click delivered')
  })

  test('025-AC-065 with toolbar focus, browser keys on Erfana\'s window are taken from the renderer and forwarded; typing is not', async ({
    browserTabs,
    browserServers,
    appWithTestProject
  }) => {
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    const appWindow = browserTabs.window
    await appWindow.evaluate((id) => (window as unknown as Recorder).api.browserTab.toolbarFocus(id, true), page.tabId)
    await expect
      .poll(() => mainHook<{ focus: string }>(appWithTestProject, 'browserInput', 'routingState', page.tabId).then((s) => s.focus), {
        timeout: WAIT_MS
      })
      .toBe('toolbar')
    await appWindow.evaluate(() => {
      ;(window as unknown as Recorder).__windowKeydowns!.length = 0
    })

    const windowKey = (key: string, modifiers: Modifier[] = []): Promise<unknown> =>
      mainHook(appWithTestProject, 'browserInput', 'windowKey', page.tabId, key, modifiers)
    await windowKey('l', [MOD])
    await windowKey('e', [MOD])
    await windowKey(IS_MAC ? '[' : 'Left', IS_MAC ? ['meta'] : ['alt'])
    await windowKey('x')
    await expect
      .poll(() => appWindow.evaluate(() => (window as unknown as Recorder).__windowKeydowns!), { timeout: WAIT_MS })
      .toEqual(['x'])
    expect(await forwardedActions(appWindow, page.tabId)).toEqual(['focusAddress', 'back'])
    expect((await mainHook<{ pick: boolean }>(appWithTestProject, 'browserInput', 'routingState', page.tabId)).pick).toBe(false)

    await appWindow.evaluate((id) => (window as unknown as Recorder).api.browserTab.toolbarFocus(id, false), page.tabId)
    await expect
      .poll(() => mainHook<{ focus: string }>(appWithTestProject, 'browserInput', 'routingState', page.tabId).then((s) => s.focus), {
        timeout: WAIT_MS
      })
      .toBe('out')
  })

  test('025-AC-019 Esc in page full screen exits it before the page receives it', async ({ browserTabs, browserServers, appWithTestProject }) => {
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    await mainHook(appWithTestProject, 'browserInput', 'execWithGesture', page.tabId, `document.getElementById('outer').requestFullscreen().then(() => true)`)
    await page.waitFor(`document.fullscreenElement !== null`, 'page in full screen')
    await page.key('Escape')
    await page.waitFor(`document.fullscreenElement === null`, 'full screen left')
    await sentinel(page)
    expect(await pageKeydowns(page)).toEqual(['x KeyX'])
  })

  test('025-AC-061 on macOS the Edit roles work in a page text field', async ({ browserTabs, browserServers }) => {
    test.skip(!IS_MAC, 'macOS Edit-menu roles')
    const page = await openEventsPage(browserTabs, browserServers.sites.static.url('/events.html'))
    await page.type('hello')
    await page.waitFor(`document.getElementById('text').value === 'hello'`, 'typed')
    await page.key('a', ['meta'])
    await page.waitFor(
      `(() => { const t = document.getElementById('text'); return t.selectionStart === 0 && t.selectionEnd === 5 })()`,
      'Cmd+A selected all'
    )
    await page.key('z', ['meta'])
    await page.waitFor(`document.getElementById('text').value !== 'hello'`, 'Cmd+Z undid the typing')
    await page.key('z', ['meta', 'shift'])
    await page.waitFor(`document.getElementById('text').value === 'hello'`, 'Cmd+Shift+Z redid it')
    // The roles ran in main: the page saw none of the keys.
    expect((await pageKeydowns(page)).filter((k) => k.startsWith('Meta+'))).toEqual([])
  })
})

/** The keydowns the page logged, with a capture-phase logger installed on any fixture page. */
const LOG_KEYS = `addEventListener('keydown', (e) => window.__fixture.record('keydown', e.key), true); window.__fixture.clear(); 0`

test.describe('built-in browser key routing in the tab (renderer and main)', () => {
  test('025-AC-061 F6 and Shift+F6 from the page land on the address bar, the strip row and the pick row; with a strip prompt and the find row open F6 cycles every zone both ways; the page logs none', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const { panel, pick } = send
    await panel.load(browserServers.sites.static.url('/popups.html'))
    await panel.waitForState({ loading: false })
    const page = await panel.page()
    await page.waitForLoaded(browserServers.sites.static.url('/popups.html'))
    await page.eval(LOG_KEYS)
    const keyboard = windowWithTestProject.keyboard
    /** Give the page keyboard focus, as a click in it does. */
    const focusPage = async (): Promise<void> => {
      await page.clickSelector('h1')
      await expect.poll(() => send.routingFocus(), { timeout: WAIT_MS }).toBe('page')
    }

    // F6 with page focus: the address bar.
    await focusPage()
    await page.key('F6')
    await expect(panel.addressBar).toBeFocused()
    // Shift+F6 with page focus and no strip row: the pick row's last control (the target chooser).
    await focusPage()
    await page.key('F6', ['shift'])
    await expect(pick.target).toBeFocused()

    // A strip prompt: Shift+F6 from the page lands on its last control.
    await page.eval('window.__fixture.openMany(6)')
    const row = panel.stripRow('popupBlocked')
    await expect(row).toBeVisible({ timeout: WAIT_MS })
    const rowButtons = row.getByRole('button')
    await focusPage()
    await page.key('F6', ['shift'])
    await expect(rowButtons.last()).toBeFocused()

    // The find row too; then the whole cycle from the address bar, forward and back.
    await focusPage()
    await page.key('f', [MOD])
    await expect(panel.findField).toBeFocused()
    await panel.addressBar.focus()
    const findControls = panel.findRow.locator('button:not([disabled]), input:not([disabled])')
    const forward = [pick.pickButton, rowButtons.first(), findControls.first()]
    for (const expected of forward) {
      await keyboard.press('F6')
      await expect(expected).toBeFocused()
    }
    await keyboard.press('F6')
    await expect.poll(() => send.routingFocus(), { timeout: WAIT_MS }).toBe('page')
    await page.key('F6')
    await expect(panel.addressBar).toBeFocused()

    // Back: the page, then each zone's last control, then the navigation row's last control (More).
    await keyboard.press('Shift+F6')
    await expect.poll(() => send.routingFocus(), { timeout: WAIT_MS }).toBe('page')
    await page.key('F6', ['shift'])
    await expect(findControls.last()).toBeFocused()
    for (const expected of [rowButtons.last(), pick.target, panel.tool('More')]) {
      await keyboard.press('Shift+F6')
      await expect(expected).toBeFocused()
    }

    expect(await page.eval<string[]>(`window.__fixture.log.filter(e => e.type === 'keydown').map(e => e.detail)`)).toEqual([])
  })

  test('025-AC-065 a toolbar tooltip shown by keyboard focus takes the first Esc alone and the second Esc returns to the page; one shown by hover goes with the Esc that ends pick mode', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const { panel, pick } = send
    await send.load(browserServers.sites.static.url('/events.html'))
    const page = await panel.page()
    const keyboard = windowWithTestProject.keyboard
    // One bubble, drawn inside the pick row's band for both toolbar rows (design R2-H5).
    const tooltip = pick.row.getByTestId(BROWSER_TEST_IDS.TOOLBAR_TOOLTIP)
    const focusPage = async (): Promise<void> => {
      await page.clickSelector('#text')
      await expect.poll(() => send.routingFocus(), { timeout: WAIT_MS }).toBe('page')
    }
    const pressed = (): Promise<string | null> => pick.pickButton.getAttribute('aria-pressed')
    /** Esc once: only the tooltip goes. Esc again: focus returns to the page; pick mode is unchanged. */
    const twoPressEsc = async (control: Locator, wantPressed: string): Promise<void> => {
      await expect(control).toBeFocused()
      await expect(tooltip).toBeVisible({ timeout: WAIT_MS })
      await keyboard.press('Escape')
      await expect(tooltip).toHaveCount(0)
      await expect(control).toBeFocused()
      expect(await pressed()).toBe(wantPressed)
      expect(await send.routingFocus()).toBe('toolbar')
      await keyboard.press('Escape')
      await expect.poll(() => send.routingFocus(), { timeout: WAIT_MS }).toBe('page')
      expect(await pressed()).toBe(wantPressed)
    }

    // Reload, reached by Tab (Shift+Tab back from the address bar).
    await focusPage()
    await page.key('l', [MOD])
    await expect(panel.addressBar).toBeFocused()
    await keyboard.press('Shift+Tab')
    const reload = panel.tool('Reload')
    await expect(tooltip).toContainText('Reload (')
    await twoPressEsc(reload, 'false')

    // Pick element with pick mode off, then on.
    for (const on of [false, true]) {
      await focusPage()
      if (on) {
        await page.key('e', [MOD])
        await expect(pick.pickButton).toHaveAttribute('aria-pressed', 'true')
      }
      await page.key('F6')
      await expect(panel.addressBar).toBeFocused()
      await keyboard.press('F6')
      await expect(tooltip).toContainText(on ? 'Stop picking' : 'Pick element (')
      await twoPressEsc(pick.pickButton, String(on))
    }

    // The pick row's last control, the target chooser, by Shift+F6 from the page: the same two presses.
    await focusPage()
    await page.key('F6', ['shift'])
    await expect(tooltip).toContainText(/Picked elements are sent to this terminal|Open a terminal and start your agent there/)
    await twoPressEsc(pick.target, 'true')

    // Hover only, page focus, pick mode on: the page's Esc ends pick mode and the tooltip goes in the same press.
    await focusPage()
    await pick.pickButton.hover()
    await expect(tooltip).toContainText('Stop picking', { timeout: WAIT_MS })
    await page.key('Escape')
    await expect(pick.pickButton).toHaveAttribute('aria-pressed', 'false')
    await expect(tooltip).toHaveCount(0)
  })

  test('025-AC-071 from page focus, Ctrl/Cmd+L then Tab leaves the browser tab after its last toolbar control; Ctrl+Tab selects the next editor tab', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const { panel } = send
    const url = browserServers.sites.static.url('/events.html')
    await send.load(url)
    const page = await panel.page()
    await page.clickSelector('#text')
    await expect.poll(() => send.routingFocus(), { timeout: WAIT_MS }).toBe('page')

    await page.key('l', [MOD])
    await expect(panel.addressBar).toBeFocused()
    // The tab's controls in Tab order, ending at the last one before the page.
    const lastControl = await panel.root.evaluate((root) => {
      const page = root.querySelector('[data-testid="browser-page-placeholder"]')
      const tabbable = [...root.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]')].filter(
        (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.getClientRects().length > 0 && !(page?.contains(el) ?? false)
      )
      const last = tabbable[tabbable.length - 1]
      last?.setAttribute('data-e2e-last-control', 'true')
      return last?.getAttribute('aria-label') ?? last?.textContent ?? ''
    })
    expect(lastControl).not.toBe('')
    const inTab = (): Promise<boolean> => panel.root.evaluate((root) => root.contains(document.activeElement))
    let presses = 0
    let previousWasLast = false
    while (await inTab()) {
      previousWasLast = await panel.root.evaluate(() => document.activeElement?.getAttribute('data-e2e-last-control') === 'true')
      await windowWithTestProject.keyboard.press('Tab')
      presses += 1
      expect(presses, 'Tab leaves the browser tab within its controls').toBeLessThan(40)
    }
    expect(previousWasLast, `focus left from the last toolbar control (${lastControl})`).toBe(true)
    expect(await send.routingFocus()).toBe('out')

    // Ctrl+Tab from page focus: the next editor tab.
    const tabId = await panel.tabId()
    const nextTabId = await (await send.ui.openWithButton()).tabId()
    await send.ui.editorTabFor(0).click()
    await expect(panel.root).toHaveAttribute('data-browser-tab-id', tabId)
    await page.clickSelector('#text')
    await expect.poll(() => send.routingFocus(), { timeout: WAIT_MS }).toBe('page')
    await page.key('Tab', ['control'])
    await expect(panel.root).toHaveAttribute('data-browser-tab-id', nextTabId)
  })
})
