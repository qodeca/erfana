// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The whole pick-and-send flow of one built-in browser tab, as a user drives
 * it (spec 025, 025-FR-025 to 025-FR-031, 025-FR-053, 025-FR-054,
 * 025-FR-065, 025-NFR-011): Erfana's controls through the DOM by role and
 * name, the page through main-side `webContents.sendInputEvent` (S-27), and
 * what main holds through the `pick` test hook.
 *
 * Builds on {@link BrowserPickUi} (the row, panel and dialog) and
 * {@link PickDriver} (pointer, keys and the hook reads). Adds:
 *
 * - the panel's header controls (Parent, Child, the ancestor path, ×) and the
 *   dialog's field and buttons;
 * - the status slot as the user reads it (visible clauses, joined by " · "),
 *   and a recorder that timestamps every change of it, so a note's duration
 *   is measured from when it showed to when it went – no timer decides;
 * - raw input to the page (right button, double click, drag, auto-repeat);
 * - {@link AgentTerminal}: the app's terminal with `cat` in front – a stub
 *   agent that echoes what it is sent.
 *
 * Condition-based waits only.
 *
 * ```ts
 * const flow = await PickFlow.open(app, window)
 * await flow.load(url)
 * await flow.pickButton.click()
 * await flow.pickByClick('#save-label', 'span#save-label ')
 * ```
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { BrowserTabUiPage, type BrowserPanelUi } from './browser-tab-ui.page'
import { BrowserPickUi } from './browser-pick-ui.page'
import { mainHook, PICK_WAIT_MS, type Box, type HookPickState, type PickDriver } from './browser-pick.page'
import { browserHook, testHook } from './browser-page.page'
import { TerminalPage } from './terminal.page'
import { EXEC_ACTION_CAP_MS, EXEC_READ_CAP_MS, installBoundedExec, type BoundedExecGlobal } from '../utils/bounded-exec'

export { PICK_WAIT_MS }

/** The platform's pick modifier for `sendInputEvent`, and the label `formatShortcut` renders. */
export const IS_MAC = process.platform === 'darwin'
export const MOD = IS_MAC ? 'meta' : 'control'
export const PICK_KEY_LABEL = IS_MAC ? '⌘E' : 'Ctrl+E'

/** One `webContents.sendInputEvent` argument (page CSS px at zoom 100%). */
export type PageInput = Record<string, unknown> & { type: string }

/** What {@link PickFlow.outlineBand} reads: the live outline's band, natively and as main drew it. Screen DIP. */
export interface OutlineBandRead {
  /** The page view on the screen. */
  view: Box
  /** Every band window over the page's window: shown or not, where, and its strip views (surface DIP). */
  windows: Array<{ visible: boolean; bounds: Box; views: Array<{ visible: boolean; rect: Box }> }>
  /** What main drew (surface bounds, strips in draw order with their tone, the colours), or null. */
  hook: { bounds: Box; strips: Array<{ tone: 'ink' | 'paper'; rect: Box }>; colours: { ink: string; paper: string } } | null
}

/** One change of the status slot, stamped with the window's `performance.now()`. */
export interface StatusChange {
  t: number
  text: string
}

interface StatusRecorder {
  __pickStatusLog?: Record<string, StatusChange[]>
}

/** The status slot's text as the user reads it: visible clauses joined by " · ", chips after. */
function readStatus(root: Element | null): string {
  if (root === null) return ''
  const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).display !== 'none'
  const banner = root.querySelector('.erf-brw-banner-line')
  if (banner === null) return (root.textContent ?? '').trim()
  const first = banner.querySelector('.erf-brw-banner-line__first')
  const parts: string[] = []
  if (first !== null) parts.push((first.textContent ?? '').trim())
  for (const more of banner.querySelectorAll('.erf-brw-banner-line__more')) {
    if (visible(more) && getComputedStyle(more).display !== 'none') parts.push((more.textContent ?? '').trim())
  }
  if (first === null && parts.length === 0) parts.push((banner.textContent ?? '').trim())
  return parts.join(' · ')
}

/** The pick-and-send flow of one browser panel. */
export class PickFlow {
  readonly ui: BrowserPickUi

  constructor(
    readonly app: ElectronApplication,
    readonly window: Page,
    readonly panel: BrowserPanelUi
  ) {
    this.ui = new BrowserPickUi(panel, app)
  }

  /** Open a new browser tab with the New browser tab button. */
  static async open(app: ElectronApplication, window: Page): Promise<PickFlow> {
    const panel = await new BrowserTabUiPage(app, window).openWithButton()
    return new PickFlow(app, window, panel)
  }

  tabId(): Promise<string> {
    return this.panel.tabId()
  }

  /**
   * Load `url` through the address bar and wait until it loaded. With
   * `pointer` (the default) the page is then shown to take pointer input –
   * which moves the mouse over it; pass `false` for a page the mouse never
   * touched.
   */
  async load(url: string, options: { pointer?: boolean } = {}): Promise<void> {
    await this.panel.load(url)
    await this.panel.waitForState({ committedUrl: url, loading: false })
    const page = await this.panel.page()
    await page.waitForLoaded(url)
    // A late web font reflows text, which moves elements between a read of their box and a hover.
    await page.waitFor(`document.fonts.status === 'loaded'`, 'fonts loaded')
    if (options.pointer !== false) await page.waitForInputReady()
  }

  driver(): Promise<PickDriver> {
    return this.ui.driver()
  }

  // ── Erfana's controls ───────────────────────────────────────────────────

  get pickButton(): Locator {
    return this.ui.pickButton
  }

  get status(): Locator {
    return this.ui.status
  }

  get still(): Locator {
    return this.ui.still
  }

  get actions(): Locator {
    return this.ui.actions
  }

  get dialog(): Locator {
    return this.ui.dialog
  }

  /** The pick row's target button. */
  get target(): Locator {
    return this.ui.target
  }

  action(name: string): Locator {
    return this.ui.action(name)
  }

  get parentButton(): Locator {
    return this.actions.getByRole('button', { name: 'Parent element', exact: true })
  }

  get childButton(): Locator {
    return this.actions.getByRole('button', { name: 'Child element', exact: true })
  }

  get path(): Locator {
    return this.actions.getByRole('navigation', { name: 'Element path' })
  }

  /** A name in the ancestor path (a button that moves the pick there). */
  crumb(name: string): Locator {
    return this.path.getByRole('button', { name, exact: true })
  }

  /** The element chip: "{name} · {size}". */
  get chip(): Locator {
    return this.path.locator('[aria-current="true"]')
  }

  get closeButton(): Locator {
    return this.actions.getByRole('button', { name: 'Close – nothing is sent', exact: true })
  }

  /** The panel's header note (refinement ends, "That element is gone"). */
  get panelNote(): Locator {
    return this.actions.locator('.erf-brw-actions__note')
  }

  /** The panel's target button (the last Tab stop before ×). */
  get panelTarget(): Locator {
    return this.actions.getByRole('button', { name: /target terminal/ })
  }

  get dialogField(): Locator {
    return this.dialog.getByRole('textbox')
  }

  get dialogSend(): Locator {
    return this.dialog.getByRole('button', { name: 'Send', exact: true })
  }

  get dialogCancel(): Locator {
    return this.dialog.getByRole('button', { name: 'Cancel', exact: true })
  }

  get dialogBack(): Locator {
    return this.dialog.getByRole('button', { name: 'Back to actions', exact: true })
  }

  /** The send notice's buttons in the status slot. */
  get showTerminal(): Locator {
    return this.status.getByRole('button', { name: 'Show terminal', exact: true })
  }

  get openCapture(): Locator {
    return this.status.getByRole('button', { name: 'Open capture', exact: true })
  }

  /** The page area's frame (`erf-brw-frame--pick` while picking with focus in the tab). */
  get frame(): Locator {
    return this.panel.root.locator('.erf-brw-frame')
  }

  /** The "Page paused" / "Still image" chip in the status slot. */
  get statusChip(): Locator {
    return this.status.locator('.erf-brw-tag')
  }

  /** The pick row's width in CSS px. */
  async rowWidth(): Promise<number> {
    return this.ui.row.evaluate((el) => el.getBoundingClientRect().width)
  }

  /**
   * Resize Erfana's window so the browser tab (its pick row) is `width` CSS
   * px wide, and wait until the row reports it.
   */
  async setTabWidth(width: number): Promise<void> {
    if (Math.abs((await this.rowWidth()) - width) > 0.5) {
      const delta = Math.round((await this.rowWidth()) - width)
      await this.app.evaluate(({ BrowserWindow }, d) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setMinimumSize(200, 200)
        const [w, h] = win.getSize()
        win.setSize(w - d, h)
      }, delta)
      // Until the layout settles: two reads in a row agree.
      let last = -1
      await expect
        .poll(
          async () => {
            const now = await this.rowWidth()
            const settled = now === last
            last = now
            return settled
          },
          { timeout: PICK_WAIT_MS, intervals: [100, 200, 300] }
        )
        .toBe(true)
    }
    // The editor area stops shrinking at the other panels' minimum sizes: the tab itself is then held to `width`.
    if (Math.abs((await this.rowWidth()) - width) > 0.5) {
      const row = await this.rowWidth()
      await this.panel.root.evaluate(
        (el, [w, rowNow]) => {
          const root = el as HTMLElement
          const chrome = root.getBoundingClientRect().width - rowNow
          root.style.width = `${w + chrome}px`
          root.style.flex = '0 0 auto'
        },
        [width, row] as const
      )
    }
    await expect.poll(() => this.rowWidth(), { timeout: PICK_WAIT_MS }).toBeCloseTo(width, 0)
  }

  /** The status slot's text as the user reads it. */
  async statusText(): Promise<string> {
    return this.status.evaluate(readStatus)
  }

  async expectStatus(expected: string | RegExp): Promise<void> {
    await expect.poll(() => this.statusText(), { timeout: PICK_WAIT_MS }).toEqual(expected instanceof RegExp ? expect.stringMatching(expected) : expected)
  }

  // ── The status recorder ─────────────────────────────────────────────────

  /** Start timestamping every change of the status slot's visible text. */
  async recordStatus(): Promise<void> {
    const tabId = await this.tabId()
    await this.status.evaluate(
      (root, [id, readSource]) => {
        const w = window as unknown as StatusRecorder
        w.__pickStatusLog ??= {}
        const log: StatusChange[] = []
        w.__pickStatusLog[id] = log
        // The reader is shared with the Node side as source text.
        const read = new Function(`return (${readSource})`)() as (el: Element) => string
        const push = (): void => {
          const text = read(root)
          if (log.length === 0 || log[log.length - 1].text !== text) log.push({ t: performance.now(), text })
        }
        push()
        new MutationObserver(push).observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
      },
      [tabId, readStatus.toString()] as const
    )
  }

  async statusLog(): Promise<StatusChange[]> {
    const tabId = await this.tabId()
    return this.window.evaluate((id) => (window as unknown as StatusRecorder).__pickStatusLog?.[id] ?? [], tabId)
  }

  /**
   * How long the status slot read `text` (first time it showed after
   * `after`), waiting until it went. Measured on the window's clock.
   */
  async shownFor(text: string, after = 0): Promise<number> {
    const span = async (): Promise<number | null> => {
      const log = (await this.statusLog()).slice(after)
      const start = log.findIndex((c) => c.text === text)
      if (start < 0) return null
      const end = log.findIndex((c, i) => i > start && c.text !== text)
      return end < 0 ? null : log[end].t - log[start].t
    }
    await expect.poll(span, { timeout: PICK_WAIT_MS, message: `status "${text}" shown and gone` }).not.toBeNull()
    return (await span())!
  }

  // ── Main's state ────────────────────────────────────────────────────────

  async state(): Promise<HookPickState> {
    return mainHook(this.app, 'pick', 'state', await this.tabId())
  }

  async highlightLabel(): Promise<string | null> {
    return (await mainHook<{ label: string } | null>(this.app, 'pick', 'highlight', await this.tabId()))?.label ?? null
  }

  async waitForActive(active: boolean): Promise<void> {
    await expect.poll(async () => (await this.state()).active, { timeout: PICK_WAIT_MS }).toBe(active)
  }

  async waitForFrozen(frozen: boolean): Promise<void> {
    await expect.poll(async () => (await this.state()).frozen, { timeout: PICK_WAIT_MS }).toBe(frozen)
  }

  async isPageFocused(): Promise<boolean> {
    return testHook<boolean>(this.app, 'browserInput', 'isPageFocused', await this.tabId())
  }

  async routing(): Promise<Record<string, unknown>> {
    return testHook(this.app, 'browserInput', 'routingState', await this.tabId())
  }

  /** Main's routing has keyboard focus in the page (the window is the OS key window under `needsOsFocus`). */
  async waitForPageFocus(): Promise<void> {
    await expect.poll(async () => (await this.routing()).focus, { timeout: PICK_WAIT_MS }).toBe('page')
  }

  /**
   * Move OS keyboard focus from the page's native view to Erfana's own
   * window, as a real click on Erfana's UI does (Playwright's clicks land in
   * the DOM only and leave the native focus in the page). Follow it with the
   * click on the control.
   */
  async focusErfana(): Promise<void> {
    await testHook(this.app, 'browserInput', 'focusAppWindow', await this.tabId())
    await expect.poll(async () => (await this.routing()).focus, { timeout: PICK_WAIT_MS }).not.toBe('page')
  }

  /**
   * Move main's test clock past the click guard and the double-click window
   * of the last confirming click (025-FR-047, 025-FR-049), so the next page
   * click counts – instead of waiting them out.
   */
  async passClickWindows(): Promise<void> {
    const routing = (await this.routing()) as { clickGuardUntil: number; ignoreClicksUntil: number }
    const now = await testHook<number>(this.app, 'clock', 'now')
    const until = Math.max(routing.clickGuardUntil, routing.ignoreClicksUntil)
    if (until >= now) await testHook(this.app, 'clock', 'advance', until - now + 1)
  }

  // ── Input to the page (main-side sendInputEvent) ────────────────────────

  /** Send raw input events to the page's `webContents`, in order. */
  async input(events: PageInput[]): Promise<void> {
    const id = (await (await this.panel.hookTab())).webContentsId
    await this.app.evaluate(
      ({ webContents }, [contentsId, list]) => {
        const contents = webContents.fromId(contentsId as number)
        if (contents === undefined || contents === null) throw new Error('The page is gone')
        for (const e of list as PageInput[]) contents.sendInputEvent(e as unknown as Parameters<typeof contents.sendInputEvent>[0])
      },
      [id, events] as const
    )
  }

  async move(x: number, y: number): Promise<void> {
    await this.input([{ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }])
  }

  /** Press and release `button` at (`x`, `y`); `count` 2 sends the second click of a double click too. */
  async click(x: number, y: number, button: 'left' | 'right' = 'left', count = 1): Promise<void> {
    const at = { x: Math.round(x), y: Math.round(y) }
    const events: PageInput[] = [{ type: 'mouseMove', ...at }]
    for (let i = 1; i <= count; i++) {
      events.push({ type: 'mouseDown', ...at, button, clickCount: i }, { type: 'mouseUp', ...at, button, clickCount: i })
    }
    await this.input(events)
  }

  async key(keyCode: string, modifiers: string[] = []): Promise<void> {
    await browserHook(this.app, 'key', await this.tabId(), keyCode, modifiers)
  }

  /** Press `keyCode` with `repeats` auto-repeats, then release it – to the page. */
  async keyWithRepeats(keyCode: string, repeats: number): Promise<void> {
    await testHook(this.app, 'browserInput', 'keyWithRepeats', await this.tabId(), keyCode, [], repeats)
  }

  /** Ctrl/Cmd+E to the page. */
  async pickKey(): Promise<void> {
    await this.key('e', [MOD])
  }

  /** The CSS-px box of `selector` in the page. */
  async rect(selector: string): Promise<Box> {
    return (await this.driver()).rect(selector)
  }

  /** Hover the centre of `selector` and wait until the highlight label starts with `prefix`. */
  async hover(selector: string, prefix: string): Promise<Box> {
    const driver = await this.driver()
    const box = await driver.rect(selector)
    const { x, y } = await this.aim(box)
    // A page that never had the pointer may drop the first move (not ready for hit testing): send it again until it shows.
    let step = 0
    await expect
      .poll(
        async () => {
          await this.move(x + (step++ % 2), y)
          return (await this.highlightLabel()) ?? ''
        },
        { timeout: PICK_WAIT_MS, message: `highlight ${prefix}` }
      )
      .toMatch(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    return box
  }

  /** Trust the fixtures' test CA in the browser session (the tab must exist), for `https://*.test` pages. */
  async trustTestCa(caPem: string): Promise<void> {
    await this.tabId()
    expect(await testHook<number>(this.app, 'site', 'trustTestCa', caPem)).toBeGreaterThan(0)
  }

  /**
   * In pick mode: hover `selector`, click it, and wait for the panel. When
   * keyboard focus came back to the tab from elsewhere (the terminal), the
   * first page click only gives the page focus (025-FR-048): that click is
   * made first, and shown to pick nothing.
   */
  /** The centre of the part of `box` inside the page's viewport (an element taller than the view is aimed at what shows). */
  async aim(box: Box): Promise<{ x: number; y: number }> {
    const view = await this.eval<{ width: number; height: number }>('({ width: innerWidth, height: innerHeight })')
    const left = Math.max(box.x, 0)
    const top = Math.max(box.y, 0)
    const right = Math.min(box.x + box.width, view.width)
    const bottom = Math.min(box.y + box.height, view.height)
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) }
  }

  async pickByClick(selector: string, prefix: string): Promise<Box> {
    await this.waitForActive(true)
    const box = await this.hover(selector, prefix)
    const at = await this.aim(box)
    const routing = await this.routing()
    if (routing.focus !== 'page' || routing.firstClickOnlyFocuses === true) {
      await this.click(at.x, at.y)
      await expect
        .poll(async () => {
          const now = await this.routing()
          return now.focus === 'page' && now.firstClickOnlyFocuses === false
        }, { timeout: PICK_WAIT_MS })
        .toBe(true)
      expect((await this.state()).capture, 'the focusing click picked nothing').toBeNull()
      await this.passClickWindows()
    }
    // A new pick is never part of the double click that confirmed the last one (025-FR-049).
    await this.passClickWindows()
    await this.click(at.x, at.y)
    await expect(this.actions).toBeVisible({ timeout: PICK_WAIT_MS })
    return box
  }

  /** In pick mode: hover `selector`, press Ctrl/Cmd+E, and wait for the panel and the freeze. */
  async pickByShortcut(selector: string, prefix: string): Promise<Box> {
    await this.waitForActive(true)
    const box = await this.hover(selector, prefix)
    await this.pickKey()
    await expect(this.actions).toBeVisible({ timeout: PICK_WAIT_MS })
    await this.waitForFrozen(true)
    return box
  }

  /**
   * The live page as painted now (`webContents.capturePage`, engine overlay
   * included), as an RGBA reader in page CSS px.
   */
  async livePaint(): Promise<(x: number, y: number) => [number, number, number]> {
    const id = (await this.panel.hookTab()).webContentsId
    await installBoundedExec(this.app)
    const shot = await this.app.evaluate(
      async ({ webContents }, { contentsId, capMs }) => {
        const { __erfanaE2eExec: exec } = globalThis as unknown as BoundedExecGlobal
        const contents = webContents.fromId(contentsId)
        if (contents === undefined || contents === null) throw new Error('The page is gone')
        const image = await contents.capturePage()
        const size = image.getSize()
        const bitmap = image.toBitmap()
        return { width: size.width, height: size.height, data: bitmap.toString('base64'), cssWidth: await exec<number>(contents, 'innerWidth', capMs, 'livePaint') }
      },
      { contentsId: id, capMs: EXEC_READ_CAP_MS }
    )
    const data = Buffer.from(shot.data, 'base64')
    const scale = shot.width / (shot.cssWidth as number)
    // Skia's native order: BGRA.
    return (x, y) => {
      const i = (Math.round(y * scale) * shot.width + Math.round(x * scale)) * 4
      return [data[i + 2], data[i + 1], data[i]]
    }
  }

  /**
   * Erfana's window as painted now (the still image and Erfana's surfaces),
   * as an RGB reader in the window's CSS px.
   */
  async windowPaint(): Promise<(x: number, y: number) => [number, number, number]> {
    await installBoundedExec(this.app)
    const shot = await this.app.evaluate(async ({ BrowserWindow }, capMs) => {
      const { __erfanaE2eExec: exec } = globalThis as unknown as BoundedExecGlobal
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const image = await contents.capturePage()
      const size = image.getSize()
      return { width: size.width, data: image.toBitmap().toString('base64'), cssWidth: await exec<number>(contents, 'innerWidth', capMs, 'windowPaint') }
    }, EXEC_READ_CAP_MS)
    const data = Buffer.from(shot.data, 'base64')
    const scale = shot.width / shot.cssWidth
    return (x, y) => {
      const i = (Math.round(y * scale) * shot.width + Math.round(x * scale)) * 4
      return [data[i + 2], data[i + 1], data[i]]
    }
  }

  /**
   * The live pick outline as the user sees it: Erfana's band (ADR 0007
   * decision 6, amended 2026-11-05), a click-through child window of the
   * page's window holding one plain `View` per strip. The band never shows
   * in the page's `capturePage` (by design), so it is read natively, main-side:
   * the page view's place on the screen (window content bounds plus the
   * offsets of the views it sits in), every band window over that window
   * with its visibility, content bounds and strip views, and the tones and
   * colours main drew them in (the `pick` hook's `band`; a `View` has no
   * colour getter). All in screen DIP. `hook` is null when no band is drawn
   * (nothing outlined, or the engine's fallback outline on Wayland).
   */
  async outlineBand(): Promise<OutlineBandRead> {
    const tabId = await this.tabId()
    const contentsId = (await this.panel.hookTab()).webContentsId
    const native = await this.app.evaluate(({ BaseWindow, WebContentsView }, id) => {
      type Rect = { x: number; y: number; width: number; height: number }
      const find = (view: Electron.View, ox: number, oy: number): Rect | null => {
        const b = view.getBounds()
        const x = ox + b.x
        const y = oy + b.y
        if (view instanceof WebContentsView && view.webContents.id === id) return { x, y, width: b.width, height: b.height }
        for (const child of view.children) {
          const found = find(child, x, y)
          if (found !== null) return found
        }
        return null
      }
      for (const host of BaseWindow.getAllWindows()) {
        if (host.isDestroyed()) continue
        const content = host.getContentBounds()
        const view = find(host.contentView, 0, 0)
        if (view === null) continue
        // The band's window has no webContents: a BaseWindow, not a BrowserWindow.
        const bands = host
          .getChildWindows()
          .filter((w) => !w.isDestroyed() && !('webContents' in w))
          .map((w) => ({
            visible: w.isVisible(),
            bounds: w.getContentBounds(),
            views: w.contentView.children.map((v) => ({ visible: v.getVisible(), rect: v.getBounds() }))
          }))
        return { view: { x: content.x + view.x, y: content.y + view.y, width: view.width, height: view.height }, bands }
      }
      throw new Error(`No window holds the page view of web contents ${id}`)
    }, contentsId)
    const hook = await mainHook<OutlineBandRead['hook']>(this.app, 'pick', 'band', tabId)
    return { view: native.view, windows: native.bands, hook }
  }

  /**
   * Record the page's `Debugger.paused` and `Debugger.resumed` events, per
   * session (`''` for the top document), as they reach the page's debugger
   * in main. Listening only: nothing is sent and nothing runs in the page.
   */
  async watchPauses(): Promise<void> {
    const id = (await this.panel.hookTab()).webContentsId
    await this.app.evaluate(({ webContents }, contentsId) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test-only record on main's globalThis
      const g = globalThis as any
      g.__pickPauses ??= {}
      const log: Array<{ method: string; session: string }> = (g.__pickPauses[contentsId] = [])
      webContents.fromId(contentsId)!.debugger.on('message', (_event, method, _params, sessionId) => {
        if (method === 'Debugger.paused' || method === 'Debugger.resumed') log.push({ method, session: sessionId ?? '' })
      })
    }, id)
  }

  /**
   * Record every `method` command Erfana's debugger session sends to this tab
   * from now on, with its session (`''` the top document) and params. Erfana's
   * session is the only caller of the tab's `debugger.sendCommand` (a unit
   * test pins that), so the record is Erfana's own state at the protocol level.
   */
  async watchCommands(method: string): Promise<void> {
    const id = (await this.panel.hookTab()).webContentsId
    await this.app.evaluate(({ webContents }, { contentsId, name }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test-only record on main's globalThis
      const g = globalThis as any
      g.__pickCommands ??= {}
      const log: Array<{ session: string; params: unknown }> = (g.__pickCommands[`${contentsId}|${name}`] = [])
      const dbg = webContents.fromId(contentsId)!.debugger
      const send = dbg.sendCommand.bind(dbg)
      dbg.sendCommand = (m: string, params?: object, sessionId?: string) => {
        if (m === name) log.push({ session: sessionId ?? '', params })
        return send(m, params, sessionId)
      }
    }, { contentsId: id, name: method })
  }

  /** The `method` commands {@link watchCommands} recorded, in order. */
  async commands(method: string): Promise<Array<{ session: string; params: unknown }>> {
    const id = (await this.panel.hookTab()).webContentsId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test-only record on main's globalThis
    return this.app.evaluate((_e, key) => [...((globalThis as any).__pickCommands?.[key] ?? [])], `${id}|${method}`)
  }

  /** The events {@link watchPauses} recorded. */
  async pauses(): Promise<Array<{ method: string; session: string }>> {
    const id = (await this.panel.hookTab()).webContentsId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test-only record on main's globalThis
    return this.app.evaluate((_e, contentsId) => [...((globalThis as any).__pickPauses?.[contentsId] ?? [])], id)
  }

  /** Run `code` in the (possibly cross-site) frame whose URL contains `frameUrl`, through main. */
  async frameEval<T>(frameUrl: string, code: string): Promise<T> {
    const id = (await this.panel.hookTab()).webContentsId
    await installBoundedExec(this.app)
    return (await this.app.evaluate(
      ({ webContents }, { contentsId, part, source, capMs }) => {
        const { __erfanaE2eExec: exec } = globalThis as unknown as BoundedExecGlobal
        const frame = webContents.fromId(contentsId)!.mainFrame.framesInSubtree.find((f) => f.url.includes(part))
        if (frame === undefined) throw new Error(`No frame with ${part}`)
        return exec(frame, source, capMs, `frameEval ${part}`)
      },
      { contentsId: id, part: frameUrl, source: code, capMs: EXEC_ACTION_CAP_MS }
    )) as T
  }

  /** Whether the page's audio is muted (`webContents.isAudioMuted`). */
  async audioMuted(): Promise<boolean> {
    const id = (await this.panel.hookTab()).webContentsId
    return this.app.evaluate(({ webContents }, contentsId) => webContents.fromId(contentsId)!.isAudioMuted(), id)
  }

  /** Run `code` in the page's main world. */
  async eval<T>(code: string): Promise<T> {
    return (await this.panel.page()).eval<T>(code)
  }

  /** The page's `__fixture.log` types, in order. */
  async pageLog(): Promise<Array<{ type: string; detail: string }>> {
    return this.eval('window.__fixture.log.map(e => ({ type: e.type, detail: e.detail }))')
  }

  /** The held capture's id (main). */
  async captureId(): Promise<string> {
    await expect.poll(async () => (await this.state()).capture?.id ?? null, { timeout: PICK_WAIT_MS }).not.toBeNull()
    return (await this.state()).capture!.id
  }
}

/**
 * The app's own terminal (the target terminal of every browser tab) with
 * `cat` in front: a non-shell foreground, as an agent is, that echoes every
 * prompt it is sent.
 */
export class AgentTerminal {
  readonly terminal: TerminalPage
  private terminalId: string | null = null

  constructor(
    private readonly window: Page,
    private readonly flow: PickFlow
  ) {
    this.terminal = new TerminalPage(window)
  }

  /** Open the terminal panel, start `cat`, and wait until the pick row names it. */
  /** The terminal's id (main). */
  get id(): string {
    if (this.terminalId === null) throw new Error('Start the terminal first')
    return this.terminalId
  }

  /** Open the terminal panel (its shell running) and learn its id. */
  async open(): Promise<void> {
    await this.terminal.open()
    this.terminalId = await this.window.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, untyped in e2e
      const listed = await (window as any).api.terminal.list()
      const ids: string[] = listed.success ? listed.terminals.map((t: { id: string }) => t.id) : []
      return ids[ids.length - 1] ?? null
    })
    if (this.terminalId === null) throw new Error('No terminal is open')
  }

  /**
   * Open the terminal panel and start `cat`; resolves once main reads it as
   * an agent. With `focus: false` the command goes through the terminal
   * bridge, so keyboard focus stays where it is (an open pick menu stays).
   */
  async start(options: { focus?: boolean } = {}): Promise<void> {
    if (this.terminalId === null) await this.open()
    if (options.focus === false) {
      await this.window.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, untyped in e2e
        (id) => (window as any).api.terminal.write(id, 'cat\r'),
        this.id
      )
    } else await this.terminal.sendCommand('cat')
    const driver = await this.flow.driver()
    await expect.poll(async () => (await driver.targetStatus(this.id)).kind, { timeout: PICK_WAIT_MS }).toBe('agent')
  }

  /** The terminal's text. */
  async text(): Promise<string> {
    return (await this.terminal.readScreen()).lines.join('\n')
  }

  /** How many times `needle` shows in the terminal. */
  async count(needle: string): Promise<number> {
    return (await this.text()).split(needle).length - 1
  }
}

/** The keyboard methods the no-key trap replaces. */
const TRAPPED_KEYBOARD = ['press', 'down', 'up', 'type', 'insertText'] as const

/**
 * The no-key trap of 025-AC-083: once armed, any key press fails the test at
 * once – Playwright's `keyboard.press`/`down`/`up`/`type`/`insertText` in
 * Erfana's window throw, and a keyboard `sendInputEvent` to the page (S-27)
 * throws in main and is recorded. `fill` stays allowed (typing the
 * instruction is the one allowed key use, 025-NFR-011). Arm it after the
 * setup that types (starting the stub agent).
 */
export class NoKeyTrap {
  private constructor(
    private readonly app: ElectronApplication,
    private readonly window: Page,
    private readonly contentsId: number
  ) {}

  static async arm(app: ElectronApplication, window: Page, flow: PickFlow): Promise<NoKeyTrap> {
    const contentsId = (await flow.panel.hookTab()).webContentsId
    for (const method of TRAPPED_KEYBOARD) {
      ;(window.keyboard as unknown as Record<string, unknown>)[method] = async (): Promise<never> => {
        throw new Error(`no-key trap: keyboard.${method} in a pointer-only walk`)
      }
    }
    await app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id)!
      const g = globalThis as unknown as { __keyTrap?: Record<number, string[]> }
      g.__keyTrap = { ...g.__keyTrap, [id]: [] }
      const send = contents.sendInputEvent.bind(contents)
      contents.sendInputEvent = (event) => {
        if (/^(keyDown|keyUp|rawKeyDown|char)$/i.test(event.type)) {
          g.__keyTrap![id]!.push(event.type)
          throw new Error(`no-key trap: sendInputEvent ${event.type} in a pointer-only walk`)
        }
        send(event)
      }
    }, contentsId)
    return new NoKeyTrap(app, window, contentsId)
  }

  /** No keyboard event reached the page through `sendInputEvent` since the trap was armed. */
  async expectNoKeys(): Promise<void> {
    const seen = await this.app.evaluate((_e, id) => (globalThis as unknown as { __keyTrap?: Record<number, string[]> }).__keyTrap?.[id] ?? [], this.contentsId)
    expect(seen, 'keyboard sendInputEvent in a pointer-only walk').toEqual([])
  }

  /** Whether the window's keyboard is trapped (a control: the trap is armed). */
  async expectArmed(): Promise<void> {
    await expect(this.window.keyboard.press('a')).rejects.toThrow(/no-key trap/)
    await expect(this.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.sendInputEvent({ type: 'keyDown', keyCode: 'a' }), this.contentsId)).rejects.toThrow(
      /no-key trap/
    )
    // The control's own key is the one recorded: clear it.
    await this.app.evaluate((_e, id) => {
      ;(globalThis as unknown as { __keyTrap: Record<number, string[]> }).__keyTrap[id] = []
    }, this.contentsId)
  }
}

/** The capture folder of a project. */
export function capturesDir(projectRoot: string): string {
  return path.join(projectRoot, '.erfana', 'browser', 'captures')
}

/** The context files written in `projectRoot`, oldest name first. */
export async function contextFiles(projectRoot: string): Promise<string[]> {
  return (await fs.readdir(capturesDir(projectRoot)).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).sort()
}

/** Every capture file (context, screenshot, crop) in `projectRoot`. */
export async function captureFiles(projectRoot: string): Promise<string[]> {
  return (await fs.readdir(capturesDir(projectRoot)).catch(() => [] as string[])).sort()
}

/** Wait for the context file `after` did not have, and return its text and its screenshot's path. */
export async function newCapture(projectRoot: string, after: readonly string[]): Promise<{ name: string; text: string; screenshot: string }> {
  await expect.poll(async () => (await contextFiles(projectRoot)).filter((f) => !after.includes(f)).length, { timeout: PICK_WAIT_MS }).toBe(1)
  const name = (await contextFiles(projectRoot)).find((f) => !after.includes(f))!
  const text = await fs.readFile(path.join(capturesDir(projectRoot), name), 'utf8')
  const shot = /^- Screenshot: (.+)$/m.exec(text)?.[1]
  if (shot === undefined) throw new Error(`${name} names no screenshot`)
  return { name, text, screenshot: path.join(projectRoot, shot) }
}

/** The capture facts' numbers: the element box (top-level CSS px) and the device pixel ratio. */
export function captureBox(text: string): { box: Box; dpr: number } {
  const m = /^- Element box \(top-level viewport, CSS px\): x (-?[\d.]+), y (-?[\d.]+), width ([\d.]+), height ([\d.]+)$/m.exec(text)
  const dpr = /^- Device pixel ratio: ([\d.]+)$/m.exec(text)
  if (m === null || dpr === null) throw new Error('No element box or device pixel ratio in the context file')
  return { box: { x: +m[1], y: +m[2], width: +m[3], height: +m[4] }, dpr: +dpr[1] }
}

/** A PNG on disk, decoded in main (`nativeImage`): its size and an RGB reader in device px. */
export async function readPng(
  app: ElectronApplication,
  file: string
): Promise<{ width: number; height: number; at: (x: number, y: number) => [number, number, number] }> {
  const load = (): Promise<{ width: number; height: number; data: string }> =>
    app.evaluate(({ nativeImage }, f) => {
      const image = nativeImage.createFromPath(f)
      const size = image.getSize()
      return { width: size.width, height: size.height, data: image.toBitmap().toString('base64') }
    }, file)
  // The context file can land before the screenshot is fully written: wait for a whole bitmap.
  await expect
    .poll(async () => {
      const s = await load()
      return s.width > 0 && Buffer.from(s.data, 'base64').length === s.width * s.height * 4
    }, { timeout: PICK_WAIT_MS, message: `${file} fully written` })
    .toBe(true)
  const shot = await load()
  const data = Buffer.from(shot.data, 'base64')
  return {
    width: shot.width,
    height: shot.height,
    at: (x, y) => {
      const i = (Math.round(y) * shot.width + Math.round(x)) * 4
      return [data[i + 2], data[i + 1], data[i]]
    }
  }
}

/** `colour` within `tolerance` of `want` on every channel. */
export function near(colour: readonly number[], want: readonly number[], tolerance: number): boolean {
  return colour.every((v, i) => Math.abs(v - want[i]) <= tolerance)
}
