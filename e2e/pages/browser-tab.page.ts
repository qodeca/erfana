// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser tabs, driven the way the renderer drives them: through the
 * preload bridge `window.api.browserTab` from Erfana's own window (spec 025
 * solution design § 8, § 12, T22). There is no browser UI yet (commit 17), so
 * this POM is the renderer's stand-in: it creates tabs, places them with
 * `setBounds`, navigates, and records every `browser-tab:state` event the
 * window receives.
 *
 * Main-side facts – which tabs exist, DevTools, every `webContents` in a
 * browser session – come from the test hooks (`browserHook`).
 */
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { BrowserPagePage, browserHook, type BrowserSessionContents, type HookTab } from './browser-page.page'

/** The fields of a `browser-tab:state` event the tests read. */
export interface TabState {
  tabId: string
  committedUrl: string | null
  pendingUrl: string | null
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  erfanaPage: string | null
  devToolsOpen: boolean
}

/** Where tests place a shown tab's page, in the window's CSS px. */
export const PAGE_AREA = { x: 320, y: 80, width: 860, height: 620 } as const

const STATE_WAIT_MS = 15_000

/** The renderer-side recorder of state events (installed once per window). */
interface Recorder {
  __browserTabStates?: Record<string, TabState>
  __browserTabRecorder?: () => void
}

export class BrowserTabPage {
  private seq = 0

  constructor(
    readonly app: ElectronApplication,
    readonly window: Page
  ) {}

  /** Record every state event this window receives, newest per tab. Idempotent. */
  async installRecorder(): Promise<void> {
    await this.window.evaluate(() => {
      const w = window as unknown as Recorder & { api: { browserTab: { onState(cb: (s: TabState) => void): () => void } } }
      if (w.__browserTabRecorder) return
      w.__browserTabStates = {}
      w.__browserTabRecorder = w.api.browserTab.onState((state) => {
        w.__browserTabStates![state.tabId] = state
      })
    })
  }

  /** Open a tab through the bridge; fails with the main process's message if it is refused. */
  async create(panelId = `e2e-${Date.now()}`): Promise<string> {
    await this.installRecorder()
    const response = (await this.window.evaluate(
      (id) => (window as unknown as { api: { browserTab: { create(p: string): Promise<unknown> } } }).api.browserTab.create(id),
      panelId
    )) as { tabId: string } | { error: string }
    if ('error' in response) throw new Error(`browser-tab:create refused: ${response.error}`)
    return response.tabId
  }

  /** A tab and its page, shown in {@link PAGE_AREA}. */
  async open(): Promise<BrowserPagePage> {
    const tabId = await this.create()
    await this.show(tabId)
    return this.page(tabId)
  }

  page(tabId: string): BrowserPagePage {
    return new BrowserPagePage(this.app, tabId)
  }

  navigate(tabId: string, input: string, source: 'address' | 'history' | 'terminalLink' | 'contextMenuLink' = 'address'): Promise<unknown> {
    return this.call('navigate', { tabId, input, source })
  }

  history(tabId: string, step: 'back' | 'forward' | 'reload' | 'stop'): Promise<unknown> {
    return this.call('history', tabId, step)
  }

  devTools(tabId: string): Promise<unknown> {
    return this.call('devTools', tabId)
  }

  close(tabId: string): Promise<unknown> {
    return this.call('close', tabId)
  }

  /** Show the tab's page in {@link PAGE_AREA}. */
  show(tabId: string): Promise<unknown> {
    return this.setBounds(tabId, true)
  }

  /** Hide the tab, as when another editor tab becomes active. */
  hide(tabId: string): Promise<unknown> {
    return this.setBounds(tabId, false)
  }

  /** Show the tab's page at `bounds`, as when a row above the page appears or goes (window CSS px). */
  moveTo(tabId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<unknown> {
    this.seq += 1
    return this.call('setBounds', { tabId, bounds: { ...bounds }, seq: this.seq, ack: false, visible: true, clip: { ...bounds } })
  }

  /** The newest state event the window received for `tabId`, or `null`. */
  async lastState(tabId: string): Promise<TabState | null> {
    return this.window.evaluate((id) => (window as unknown as Recorder).__browserTabStates?.[id] ?? null, tabId)
  }

  /** Wait until the newest state event for `tabId` matches `expected`. */
  async waitForState(tabId: string, expected: Partial<TabState>): Promise<TabState> {
    await expect.poll(() => this.lastState(tabId), { timeout: STATE_WAIT_MS }).toMatchObject(expected)
    return (await this.lastState(tabId))!
  }

  /** The tabs main holds now (test hook). */
  tabs(): Promise<HookTab[]> {
    return browserHook(this.app, 'tabs')
  }

  /** Every `webContents` in a browser session (test hook). */
  browserSessionContents(): Promise<BrowserSessionContents[]> {
    return browserHook(this.app, 'browserSessionContents')
  }

  private setBounds(tabId: string, visible: boolean): Promise<unknown> {
    this.seq += 1
    const request = { tabId, bounds: { ...PAGE_AREA }, seq: this.seq, ack: false, visible, clip: { ...PAGE_AREA } }
    return this.call('setBounds', request)
  }

  /** Call `window.api.browserTab.<method>(...args)` in Erfana's window. */
  private call(method: string, ...args: unknown[]): Promise<unknown> {
    return this.window.evaluate(
      ([name, callArgs]) =>
        (window as unknown as { api: { browserTab: Record<string, (...a: unknown[]) => unknown> } }).api.browserTab[
          name as string
        ](...(callArgs as unknown[])),
      [method, args] as const
    )
  }
}
