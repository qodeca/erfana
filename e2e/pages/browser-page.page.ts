// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page inside a built-in browser tab (spec 025 solution design § 12, T2,
 * T22): reads and input, all through the main-process test hooks
 * (`src/main/testHooks/browserHook.ts`) reached by `app.evaluate`.
 *
 * Input goes through main-side `webContents.sendInputEvent` with points in
 * page CSS px, zoom-corrected in main – the path the input routers see
 * (S-27). Playwright's own page mouse is never used for a browser tab.
 *
 * Condition-based waits only: every `waitFor…` polls a read.
 */
import { expect, type ElectronApplication } from '@playwright/test'

/** The hook object as seen from a serialised `app.evaluate` callback. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks live on main's globalThis, untyped there
type Hooks = any

export interface HookTab {
  tabId: string
  windowId: number
  webContentsId: number
  url: string
  attached: boolean
  devToolsOpen: boolean
  devToolsId: number | null
}

export interface BrowserSessionContents {
  id: number
  url: string
  registeredView: boolean
  devToolsFrontEnd: boolean
}

/** How long a page condition may take to come true. */
const PAGE_WAIT_MS = 15_000

/** Call `browser.<name>(...args)` on the main-process hooks. */
export async function browserHook<T>(app: ElectronApplication, name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [hookName, hookArgs]) => {
      const hooks = (globalThis as Hooks).__erfanaTestHooks
      if (!hooks?.browser) throw new Error('Browser test hooks are not installed (build with npm run build:e2e)')
      return hooks.browser[hookName as string](...(hookArgs as unknown[]))
    },
    [name, args] as const
  )) as T
}

/** Call `<group>.<name>(...args)` on any main-process hook group (`site`, `popup`, `clock`, …). */
export async function testHook<T>(app: ElectronApplication, group: string, name: string, ...args: unknown[]): Promise<T> {
  return (await app.evaluate(
    async (_electron, [hookGroup, hookName, hookArgs]) => {
      const hooks = (globalThis as Hooks).__erfanaTestHooks
      if (!hooks?.[hookGroup as string]) throw new Error(`Test hooks "${hookGroup as string}" are not installed (build with npm run build:e2e)`)
      return hooks[hookGroup as string][hookName as string](...(hookArgs as unknown[]))
    },
    [group, name, args] as const
  )) as T
}

export class BrowserPagePage {
  constructor(
    private readonly app: ElectronApplication,
    readonly tabId: string
  ) {}

  /** Run `code` in the page's main world (bounded in main) and return its value. */
  eval<T>(code: string): Promise<T> {
    return browserHook<T>(this.app, 'exec', this.tabId, code)
  }

  /** The page's own `location.href`. */
  url(): Promise<string> {
    return this.eval<string>('location.href')
  }

  /** Wait until `code` evaluates truthy in the page; a page mid-navigation counts as "not yet". */
  async waitFor(code: string, message?: string): Promise<void> {
    await expect
      .poll(async () => this.eval<unknown>(code).catch(() => false), { timeout: PAGE_WAIT_MS, message: message ?? code })
      .toBeTruthy()
  }

  /** Wait until the page's URL equals `url` and its document finished loading. */
  async waitForLoaded(url: string): Promise<void> {
    await this.waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, `loaded ${url}`)
  }

  click(x: number, y: number): Promise<void> {
    return browserHook(this.app, 'click', this.tabId, x, y)
  }

  /**
   * Wait until the page takes pointer input. Chromium drops input that reaches
   * a view before it is ready for hit testing (seen right after a load), so a
   * mouse move is sent until the page reports one – no timer decides.
   */
  async waitForInputReady(): Promise<void> {
    await this.eval(
      `window.__e2eInputReady = false; addEventListener('mousemove', () => { window.__e2eInputReady = true }, { once: true, capture: true }); 0`
    )
    let step = 0
    await expect
      .poll(async () => {
        step += 1
        await browserHook(this.app, 'move', this.tabId, 2 + (step % 7), 2 + (step % 5))
        return this.eval<boolean>('window.__e2eInputReady === true')
      }, { timeout: PAGE_WAIT_MS, message: 'page takes pointer input' })
      .toBe(true)
  }

  /** Click the centre of the first element `selector` matches (scrolled into view first), once the page takes input. */
  async clickSelector(selector: string): Promise<{ x: number; y: number }> {
    await this.waitForInputReady()
    return browserHook(this.app, 'clickSelector', this.tabId, selector)
  }

  type(text: string): Promise<void> {
    return browserHook(this.app, 'type', this.tabId, text)
  }

  key(keyCode: string, modifiers: Array<'shift' | 'control' | 'alt' | 'meta'> = []): Promise<void> {
    return browserHook(this.app, 'key', this.tabId, keyCode, modifiers)
  }

  wheel(x: number, y: number, deltaY: number): Promise<void> {
    return browserHook(this.app, 'wheel', this.tabId, x, y, deltaY)
  }

  /** Click into `selector` and type `text` there. */
  async fill(selector: string, text: string): Promise<void> {
    await this.clickSelector(selector)
    await this.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`, `focus ${selector}`)
    await this.type(text)
    await this.waitFor(`document.querySelector(${JSON.stringify(selector)}).value === ${JSON.stringify(text)}`, `typed into ${selector}`)
  }

  startInputProbe(): Promise<void> {
    return browserHook(this.app, 'startInputProbe', this.tabId)
  }

  inputProbeCounts(): Promise<{ keyboard: number; mouse: number; mouseTypes: string[] }> {
    return browserHook(this.app, 'inputProbeCounts', this.tabId)
  }

  cookies(url: string): Promise<Array<{ name: string; value: string }>> {
    return browserHook(this.app, 'cookies', this.tabId, url)
  }

  /**
   * The settled outcome of a hostile page's canary (`hostile/canary.js`):
   * waits until every attempt settled, then returns the status and attempts.
   */
  async canary(): Promise<{ status: string; attempts: Array<{ name: string; outcome: string }> }> {
    await this.waitFor(`document.getElementById('result')?.dataset.done === 'true'`, 'canary settled')
    return this.eval(
      `({ status: document.getElementById('result').dataset.status,
          attempts: window.__canary.results.map(r => ({ name: r.name, outcome: r.outcome })) })`
    )
  }
}
