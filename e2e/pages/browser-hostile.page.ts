// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The hostile-page suite of the built-in browser (spec 025, 025-NFR-001,
 * 025-AC-046): one hostile fixture page per attack
 * (`e2e/fixtures/browser/hostile/`), its canary report, and Erfana's side of
 * the outcome – the tab's committed address, the windows and `webContents`
 * that exist, what main was asked to open through `shell`.
 *
 * - **Canary.** A hostile page records each attempt through `canary.js`;
 *   {@link HostileSuite.report} waits until every attempt settled and returns
 *   them with their detail, so a failing assertion names what leaked.
 * - **Sentinel.** "Nothing happened" is asserted only after a sentinel the
 *   page does receive: a real click (main-side `sendInputEvent`) on a button
 *   the suite adds, which the page counts ({@link HostileSuite.sentinel}).
 * - **Stayed.** {@link HostileSuite.expectStayed} – after an attempt to
 *   navigate away, main reports the tab idle on the same address, the
 *   sentinel arrives, and the page's own marker survives (the same document).
 *
 * Condition-based waits only.
 */
import { expect, type ElectronApplication } from '@playwright/test'
import type { BrowserFixtureServers } from '../fixtures/browser/serve'
import { browserHook, testHook, type BrowserPagePage } from './browser-page.page'
import type { BrowserTabPage } from './browser-tab.page'
import { EXEC_ACTION_CAP_MS, installBoundedExec, type BoundedExecGlobal } from '../utils/bounded-exec'

export interface CanaryAttempt {
  name: string
  outcome: string
  detail: string
}

export interface CanaryReport {
  status: string
  attempts: CanaryAttempt[]
}

/** What `shell` was asked to open, recorded instead of opened. */
export interface ShellOpens {
  external: string[]
  paths: string[]
  shown: string[]
}

interface HookPopup {
  readonly pageWebContentsId: number
  readonly openerTabId: string
  readonly committedUrl: string | null
  readonly hostKind: string | null
  readonly channels: Record<string, boolean>
}

const READ_RESULTS = `({ status: document.getElementById('result').dataset.status,
  attempts: window.__canary.results.map(r => ({ name: r.name, outcome: r.outcome, detail: r.detail })) })`

/** Attempts that got something, as `name – detail` lines (empty when none leaked). */
export function leaks(report: CanaryReport, normal: readonly string[] = []): string[] {
  return report.attempts
    .filter((a) => a.outcome === 'leaked' && !normal.includes(a.name))
    .map((a) => `${a.name} – ${a.detail}`)
}

export class HostileSuite {
  private marker = 0

  constructor(
    readonly tabs: BrowserTabPage,
    readonly servers: BrowserFixtureServers
  ) {}

  get app(): ElectronApplication {
    return this.tabs.app
  }

  /** A hostile fixture's address. */
  url(pathname: string, options?: { host?: string; secure?: boolean }): string {
    return this.servers.sites.hostile.url(pathname, options)
  }

  /** Open a tab on the hostile page `url` and wait until it loaded. */
  async open(url: string): Promise<BrowserPagePage> {
    const page = await this.tabs.open()
    await this.tabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    return page
  }

  /** Trust the test CA in every browser session (HTTPS fixtures, a service worker's secure context). */
  async trustTestCa(): Promise<void> {
    expect(await testHook<number>(this.app, 'site', 'trustTestCa', this.servers.tls.caPem)).toBeGreaterThan(0)
  }

  /** Wait until every attempt settled, then read the report. */
  async report(page: BrowserPagePage): Promise<CanaryReport> {
    await page.waitFor(`document.getElementById('result')?.dataset.done === 'true'`, 'canary settled')
    return page.eval<CanaryReport>(READ_RESULTS)
  }

  /**
   * Once `ready` holds in the page, settle what never answered as blocked
   * (`__canary.finish()` – a refused frame may fire no event) and read the report.
   */
  async finish(page: BrowserPagePage, ready: string, message: string): Promise<CanaryReport> {
    await page.waitFor(ready, message)
    await page.eval('window.__canary.finish()')
    return page.eval<CanaryReport>(READ_RESULTS)
  }

  /** A real click the page counts: everything sent to the page before it has been handled. */
  async sentinel(page: BrowserPagePage): Promise<void> {
    const before = await page.eval<number>(`(() => {
      let b = document.getElementById('e2e-sentinel')
      if (!b) {
        window.__e2eSentinel = 0
        b = document.createElement('button')
        b.id = 'e2e-sentinel'
        b.type = 'button'
        b.textContent = 'sentinel'
        b.style.cssText = 'position:fixed;left:8px;bottom:8px;width:48px;height:32px;z-index:2147483647'
        b.addEventListener('click', () => { window.__e2eSentinel += 1 })
        document.body.appendChild(b)
      }
      return window.__e2eSentinel
    })()`)
    await page.clickSelector('#e2e-sentinel')
    await page.waitFor(`window.__e2eSentinel === ${before + 1}`, 'sentinel click reached the page')
  }

  /** Mark the current document, so {@link expectStayed} can tell it is still the same one. */
  async mark(page: BrowserPagePage): Promise<string> {
    this.marker += 1
    const token = `stay-${this.marker}`
    await page.eval(`window.__e2eStay = ${JSON.stringify(token)}; 0`)
    return token
  }

  /** The tab is idle on `url`, the sentinel arrived, and the marked document is still the one shown. */
  async expectStayed(page: BrowserPagePage, url: string, token: string, what: string): Promise<void> {
    await this.tabs.waitForState(page.tabId, { loading: false })
    await this.sentinel(page)
    await this.tabs.waitForState(page.tabId, { committedUrl: url, pendingUrl: null, loading: false })
    expect(await page.eval(`window.__e2eStay === ${JSON.stringify(token)} && location.href === ${JSON.stringify(url)}`), what).toBe(true)
  }

  /** Replace `shell.openExternal`, `shell.openPath` and `shell.showItemInFolder` with recorders. */
  async recordShellOpens(): Promise<void> {
    await this.app.evaluate(({ shell }) => {
      const store = globalThis as unknown as { __e2eShellOpens: ShellOpens }
      store.__e2eShellOpens = { external: [], paths: [], shown: [] }
      shell.openExternal = async (target: string) => {
        store.__e2eShellOpens.external.push(target)
      }
      shell.openPath = async (target: string) => {
        store.__e2eShellOpens.paths.push(target)
        return ''
      }
      shell.showItemInFolder = (target: string) => {
        store.__e2eShellOpens.shown.push(target)
      }
    })
  }

  shellOpens(): Promise<ShellOpens> {
    return this.app.evaluate(() => (globalThis as unknown as { __e2eShellOpens: ShellOpens }).__e2eShellOpens)
  }

  windowCount(): Promise<number> {
    return browserHook<number>(this.app, 'windowCount')
  }

  popups(): Promise<HookPopup[]> {
    return testHook<HookPopup[]>(this.app, 'popup', 'popups')
  }

  /** Run `code` in a popup's page (bounded, main world). */
  popupExec<T>(pageWebContentsId: number, code: string): Promise<T> {
    return testHook<T>(this.app, 'popup', 'popupExec', pageWebContentsId, code)
  }

  /**
   * Run `code` in the frame of tab `tabId` whose URL holds `urlPart`, with a
   * user gesture – the worst case: the user clicked inside the frame.
   */
  async frameExec<T>(tabId: string, urlPart: string, code: string): Promise<T> {
    const contentsId = (await this.tabs.tabs()).find((t) => t.tabId === tabId)?.webContentsId
    if (contentsId === undefined) throw new Error(`No tab ${tabId}`)
    await installBoundedExec(this.app)
    return (await this.app.evaluate(
      async ({ webContents }, [id, part, js, capMs]) => {
        const { __erfanaE2eExec: exec } = globalThis as unknown as BoundedExecGlobal
        const contents = webContents.fromId(id as number)
        const frame = contents?.mainFrame.framesInSubtree.find((f) => f !== contents.mainFrame && f.url.includes(part as string))
        if (frame === undefined) throw new Error(`No frame at ${part as string}`)
        // With a user gesture in that frame; the bounded exec takes no gesture flag, so it wraps the frame.
        // eslint-disable-next-line no-restricted-syntax -- the call is bounded: it runs inside __erfanaE2eExec
        return exec({ executeJavaScript: (c: string) => frame.executeJavaScript(c, true) }, js as string, capMs as number, `frameExec ${part as string}`)
      },
      [contentsId, urlPart, code, EXEC_ACTION_CAP_MS] as const
    )) as T
  }

  /** Only the tabs' own pages and the pages of popup windows Erfana opened for them are in the browser session. */
  async expectOnlyTabsInBrowserSession(): Promise<void> {
    const popupPages = (await this.popups()).map((p) => p.pageWebContentsId)
    const ids = [...(await this.tabs.tabs()).map((t) => t.webContentsId), ...popupPages].sort()
    const inSession = await this.tabs.browserSessionContents()
    expect(inSession.map((c) => c.id).sort()).toEqual(ids)
    expect(inSession.every((c) => c.registeredView)).toBe(true)
  }
}
