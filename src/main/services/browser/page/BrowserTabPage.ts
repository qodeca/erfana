// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One browser tab's page features, main side (spec 025, 025-FR-008,
 * 025-FR-012, 025-FR-056, 025-FR-059, 025-FR-063; solution design § 3.5
 * `browserLoadErrors`, `browserCrash`, `browserFind`, `browserZoom`,
 * `browserWidthPreset`, `browserHistory`; commit 12h).
 *
 * Attached by `BrowserTabService` before the tab's first page loads; it
 * listens to the page's `webContents` and tells the owning window through
 * the service:
 *
 * - **Load errors** (025-FR-059): a failed main-frame load shows the
 *   load-error page (`tabPageState.ts`); whether the user started it is
 *   read when the navigation starts, before the tab drops its pending
 *   address. A certificate failure the certificate page took (025-FR-021)
 *   stays that page's: **Back to safety** without history leaves the empty
 *   tab, not a load-error page.
 * - **Crash** (025-FR-056): the page's process crashed or was killed – the
 *   crashed page shows, pick mode ends without sending, the hung notice goes.
 *   The reason is logged. A crashed frame from another process stays blank;
 *   nothing to do here.
 * - **Hang** (025-FR-056): the tab CDP session's hang probe says when the
 *   page is hung; the notice row ({@link HungNotice}) shows and pick mode
 *   ends. **Wait** re-arms the probe; **Reload** ends the hung process
 *   (`forcefullyCrashRenderer`, as Electron documents for hung pages) and
 *   reloads once `render-process-gone` says it ended – other tabs of the
 *   same site share that process and end with it.
 * - **Find** (025-FR-008): `findInPage` and `stopFindInPage`; every
 *   `found-in-page` result goes out as `browser-tab:findResult`.
 * - **Zoom and width presets** (025-FR-008, 025-FR-012) are per site, so the
 *   project-wide `BrowserPages` decides the level; this tab applies it.
 * - **Commits** go to `BrowserPages` for the history and the site's zoom.
 *
 * Every navigation to a new document clears the load-error and crashed
 * pages and the hung notice.
 */
import type { Clock } from '../../../../shared/clock'
import { zoomFactorOf, zoomPercentOf, type ZoomStep } from '../../../../shared/browser/zoomSteps'
import type { WidthPresetId } from '../../../../shared/browser/widthPresets'
import type { LoadErrorPage } from '../../../../shared/ipc/browser-tab-page-schema'
import type { StripAnswer, StripEvent, TabStateEvent } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import type { HangProbeEvent } from '../cdp/browserHangProbe'
import type { AnswerResult } from '../permissions/tabStrip'
import { HungNotice } from './hungNotice'
import { logLoadFailure } from './loadFailureLog'
import { loadErrorFor, type PageFacts } from './tabPageState'

type Listener = (...args: unknown[]) => void

/**
 * The isolated world session storage is cleared in: storage is per origin,
 * shared by every world, and the page cannot replace this world's
 * `sessionStorage`. Distinct from the input's (996) and the preview's (997–999).
 */
export const CLEAR_SESSION_STORAGE_WORLD_ID = 995
const CLEAR_SESSION_STORAGE_SCRIPT = 'try { sessionStorage.clear() } catch (e) {}'

/** The page `webContents` surface the page features use. */
export interface PageContents {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  isDestroyed(): boolean
  findInPage(text: string, options: { forward: boolean; findNext: boolean }): number
  stopFindInPage(action: 'clearSelection'): void
  getZoomFactor(): number
  setZoomFactor(factor: number): void
  forcefullyCrashRenderer(): void
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>
}

/** What the page features need of a `BrowserTab`. */
export interface PageTab {
  readonly id: string
  readonly projectRoot: string
  readonly caseSensitive: boolean
  readonly contents: PageContents
  readonly viewFrame: { readonly widthPreset: WidthPresetId; setPreset(preset: WidthPresetId): void }
  hasPendingUserNavigation(): boolean
  history(step: 'reload'): void
  state(): Pick<TabStateEvent, 'committedUrl' | 'erfanaPage'>
}

/** The tab CDP session's hang events (`cdp/BrowserCdpSession.ts`, through the tab's CDP link). */
export interface PageHangSource {
  onHang(listener: (event: HangProbeEvent) => void): () => void
  /** **Wait**: close the notice; it shows again after another 5 s if the page still hangs. */
  waitHang(): void
}

/** Where the tab's page events go: the owning window, through the service. */
export interface TabPageOutlet {
  strip(event: StripEvent): void
  findResult(event: { tabId: string; active: number; total: number }): void
  /** The facts changed: send the tab's state again. */
  stateChanged(): void
  /** End pick mode without sending (crash, hang). */
  endPick(): void
}

/** The project-wide side: per-site zoom and the history (`BrowserPages`). */
export interface TabPageSite {
  /** The tab committed a new document. */
  committed(page: BrowserTabPage): void
  /** A zoom key or button on the tab. */
  zoom(page: BrowserTabPage, step: ZoomStep): void
}

export interface BrowserTabPageDeps {
  readonly tab: PageTab
  readonly outlet: TabPageOutlet
  readonly site: TabPageSite
  readonly clock: Pick<Clock, 'now'>
  readonly hang: PageHangSource | null
  /** Mints strip row ids; random by default. */
  readonly newRowId?: () => string
}

/** `did-fail-load`'s arguments after the event. */
type FailLoadArgs = [code: number, description: string, url: string, isMainFrame: boolean]

export class BrowserTabPage {
  private failedUrl: string | null = null
  private loadError: LoadErrorPage | null = null
  private crashed = false
  /** Whether the main-frame navigation in progress was started by the user. */
  private userStarted = false
  /** Set while Erfana ends a hung page's process to reload it: no crashed page then. */
  private killingForReload = false
  private readonly hung: HungNotice
  private readonly listeners: Array<[string, Listener]> = []
  private unlistenHang: (() => void) | null = null
  private detached = false

  constructor(private readonly deps: BrowserTabPageDeps) {
    this.hung = new HungNotice({
      tabId: deps.tab.id,
      clock: deps.clock,
      emit: (event) => deps.outlet.strip(event),
      onWait: () => deps.hang?.waitHang(),
      onReload: () => this.reloadHungPage(),
      newId: deps.newRowId
    })
    this.listen('did-start-navigation', (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) this.newDocument()
    })
    this.listen('did-fail-load', (_event: unknown, ...[code, , url, isMainFrame]: FailLoadArgs) => {
      if (isMainFrame) this.loadFailed(code, url)
    })
    this.listen('render-process-gone', (_event: unknown, details: { reason: string; exitCode: number }) => {
      this.processGone(details)
    })
    this.listen('did-navigate', () => {
      this.killingForReload = false
      deps.site.committed(this)
    })
    this.listen('found-in-page', (_event: unknown, result: { activeMatchOrdinal?: number; matches?: number }) => {
      const total = Math.max(0, Math.trunc(result.matches ?? 0))
      const active = Math.min(Math.max(0, Math.trunc(result.activeMatchOrdinal ?? 0)), total)
      deps.outlet.findResult({ tabId: deps.tab.id, active, total })
    })
    this.unlistenHang = deps.hang?.onHang((event) => this.hangEvent(event)) ?? null
  }

  get tab(): PageTab {
    return this.deps.tab
  }

  /** What `decorateTabState` applies to the tab's state. */
  facts(): PageFacts {
    const contents = this.deps.tab.contents
    const zoomPercent = contents.isDestroyed() ? 100 : zoomPercentOf(contents.getZoomFactor())
    return { failedUrl: this.failedUrl, loadError: this.loadError, crashed: this.crashed, zoomPercent }
  }

  /** The address the bar shows now (the site's zoom key comes from it). */
  shownUrl(): string | null {
    return this.deps.tab.state().committedUrl
  }

  /**
   * Find `text` (025-FR-008). `findNext` keeps Electron's meaning: `true`
   * starts a new search (new text), `false` moves to the next or previous
   * match of the current one.
   */
  find(text: string, forward: boolean, findNext: boolean): void {
    const contents = this.deps.tab.contents
    if (!contents.isDestroyed()) contents.findInPage(text, { forward, findNext })
  }

  /** Close the find bar: the highlights go. */
  stopFind(): void {
    const contents = this.deps.tab.contents
    if (!contents.isDestroyed()) contents.stopFindInPage('clearSelection')
  }

  /** A zoom key or button (025-FR-008): the site's level steps. */
  zoom(step: ZoomStep): void {
    this.deps.site.zoom(this, step)
  }

  /** Apply a zoom level in percent to this tab's page. */
  applyZoom(percent: number): void {
    const contents = this.deps.tab.contents
    if (contents.isDestroyed()) return
    if (zoomPercentOf(contents.getZoomFactor()) !== percent) contents.setZoomFactor(zoomFactorOf(percent))
    this.deps.outlet.stateChanged()
  }

  /** A width preset (025-FR-012): the view takes the preset's width and the zoom resets to 100%. */
  widthPreset(preset: WidthPresetId): void {
    if (preset === this.deps.tab.viewFrame.widthPreset) return
    this.deps.tab.viewFrame.setPreset(preset)
    this.deps.site.zoom(this, 'reset')
    this.deps.outlet.stateChanged()
  }

  /**
   * After **Clear browsing data** (025-FR-023): pick mode ends without
   * sending or a notice, and a tab with a page reloads it. With site data
   * cleared, the top document's session storage is emptied first – the
   * session's own clearing cannot reach a live tab's, and a reload keeps it.
   * Never rejects.
   */
  async reloadAfterClear(siteDataCleared: boolean): Promise<void> {
    this.deps.outlet.endPick()
    const contents = this.deps.tab.contents
    if (contents.isDestroyed() || this.shownUrl() === null) return
    if (siteDataCleared) {
      await contents
        .executeJavaScriptInIsolatedWorld(CLEAR_SESSION_STORAGE_WORLD_ID, [{ code: CLEAR_SESSION_STORAGE_SCRIPT }])
        .catch((error: unknown) => {
          logger.warn('Browser tab session storage was not cleared', { error: error instanceof Error ? error.message : String(error) })
        })
    }
    if (!contents.isDestroyed()) this.deps.tab.history('reload')
  }

  /** An answer to a strip row; `null` when the row is not this tab's hung notice. */
  answerStrip(requestId: string, answer: StripAnswer): AnswerResult | null {
    return this.hung.answer(requestId, answer)
  }

  /** The tab closed: stop listening. */
  detach(): void {
    if (this.detached) return
    this.detached = true
    this.unlistenHang?.()
    this.unlistenHang = null
    this.hung.hide()
    const contents = this.deps.tab.contents
    if (contents.isDestroyed()) return
    for (const [event, listener] of this.listeners) contents.removeListener(event, listener)
  }

  /**
   * Listen to one `webContents` event. Electron types each event's arguments
   * in its own overload; the surface here is the emitter's untyped one, so
   * the listener's own argument types are asserted at this one place.
   */
  private listen<A extends unknown[]>(event: string, typed: (...args: A) => void): void {
    const listener = typed as unknown as Listener
    this.deps.tab.contents.on(event, listener)
    this.listeners.push([event, listener])
  }

  private newDocument(): void {
    // Read before the tab drops a pending address for a page-started navigation.
    this.userStarted = this.deps.tab.hasPendingUserNavigation()
    this.hung.hide()
    if (this.loadError === null && !this.crashed) return
    this.failedUrl = null
    this.loadError = null
    this.crashed = false
    this.deps.outlet.stateChanged()
  }

  private loadFailed(code: number, url: string): void {
    // A certificate failure the certificate page took (025-FR-021) is that page's, not a load error.
    if (this.deps.tab.state().erfanaPage === 'certificate') return
    const page = loadErrorFor(code, this.userStarted)
    if (page === null || url === '') return
    // Logs the full URL – a recorded exception, docs/technical-debt.md entry 68 (025-FR-042).
    logLoadFailure(code, url)
    this.failedUrl = url
    this.loadError = page
    this.deps.outlet.stateChanged()
  }

  private processGone(details: { reason: string; exitCode: number }): void {
    if (this.deps.tab.contents.isDestroyed()) return
    logger.warn('A browser tab page process ended', { reason: details.reason, exitCode: details.exitCode })
    this.hung.hide()
    this.deps.outlet.endPick()
    if (this.killingForReload) {
      // Reload once the hung process is gone: a reload sent while it is still
      // dying is lost with it, and the tab stays blank (commit 20 e2e).
      this.killingForReload = false
      this.deps.tab.history('reload')
      return
    }
    this.crashed = true
    this.deps.outlet.stateChanged()
  }

  private hangEvent(event: HangProbeEvent): void {
    if (event !== 'hung') {
      this.hung.hide()
      return
    }
    if (this.crashed) return
    logger.warn('A browser tab page is not responding')
    this.deps.outlet.endPick()
    this.hung.show()
  }

  private reloadHungPage(): void {
    const contents = this.deps.tab.contents
    if (contents.isDestroyed()) return
    this.killingForReload = true
    contents.forcefullyCrashRenderer()
  }
}
