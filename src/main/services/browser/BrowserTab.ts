// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One browser tab: the owner of its page view and `webContents` (spec 025,
 * 025-FR-002, 025-FR-003, 025-FR-005, 025-FR-007, 025-FR-013; solution design
 * § 3.1, § 3.4; panel findings S2, A4, S21).
 *
 * Built by `BrowserTabService` right after `browserSessionRegistry.createView`
 * registered the view, in the same tick, so everything below is in place
 * before the first page loads:
 *
 * - **Window open: deny all** (A4). The registered id skips the app-wide
 *   baseline, so the tab sets its own handler; page-opened tabs and popups
 *   arrive with `site/browserWindowOpen.ts` (commit 12e).
 * - **Navigation policy** (S2). What the user starts goes through
 *   {@link BrowserTab.navigate} and {@link BrowserTab.history}; what the page
 *   starts – a link, a script, a form, a redirect, a frame – is checked here
 *   under the `page` source and cancelled when its scheme is not allowed.
 * - **Pending and committed address** (025-FR-002). A pending address exists
 *   only for a navigation the user started; it goes when the document
 *   commits, when the page starts its own navigation, and on abort, an error,
 *   a load that ends without a commit (HTTP 204, a download) and Stop (S21).
 * - **Hidden tabs keep their page** (025-FR-007, ADR 0011 decision 3): a
 *   hidden tab's view is detached from the window, never destroyed.
 * - **DevTools** (025-FR-013) open in a detached window and close with the
 *   tab. Chromium creates the DevTools front end in this tab's session, so the
 *   tab tells the session registry to expect it first (it would otherwise be
 *   refused and closed as an unregistered browser-session `webContents`).
 *
 * The tab-kind CDP session (`cdp/BrowserCdpSession.ts`) attaches here, before
 * the first load, through {@link BrowserTabCdpHook}; the tab never touches the
 * debugger itself.
 */
import type { BrowserWindow, Session, WebContents, WebContentsView } from 'electron'
import type { NavigationSource, TabStateEvent } from '../../../shared/ipc/browser-tab-schema'
import { BROWSER_URL_MAX_CHARS } from '../../../shared/ipc/browser-tab-schema'
import { originParts, type RegistrableDomainResolver } from '../../../shared/browser/originFormat'
import { sanitizePageText } from '../../../shared/browser/pageText'
import { logger } from '../LoggingService'
import { clampAndZoomBounds, type RectLike } from '../preview/previewBoundsClamp'
import {
  checkNavigation,
  isUserStarted,
  securityStateOf,
  type AppAddresses,
  type FrameKind,
  type NavigationRefusal
} from './browserNavigationPolicy'
import { hardenBrowserContents } from './browserSessionPolicy'

/** Chromium's net error for a navigation that was cancelled (Stop, or replaced). */
const ERR_ABORTED = -3

/** The window a tab lives in: its content view holds the page view. */
export type TabHost = Pick<BrowserWindow, 'id' | 'isDestroyed' | 'getContentBounds' | 'contentView' | 'webContents'>

/** What a tab tells its CDP session (`cdp/BrowserCdpSession.ts`). */
export interface BrowserTabCdpLink {
  /** Shown or hidden: the hang probe runs every second only on a shown tab. */
  setVisible(visible: boolean): void
  detach(): void
}

/**
 * Where the tab's CDP session attaches. Called once, after the tab's
 * listeners are in place and before its first page loads; `null` when no
 * session could attach (the tab works without one).
 */
export type BrowserTabCdpHook = (contents: WebContents) => BrowserTabCdpLink | null

export interface BrowserTabDeps {
  readonly id: string
  /** The renderer panel that asked for the tab; `null` for a tab the page opened. */
  readonly panelId: string | null
  readonly host: TabHost
  readonly view: WebContentsView
  /** The project's canonical root and case rule, for project teardown. */
  readonly projectRoot: string
  readonly caseSensitive: boolean
  readonly appAddresses: () => AppAddresses
  readonly resolveDomain: RegistrableDomainResolver
  /** `browserSessionRegistry.expectDevTools`. */
  readonly expectDevTools: (session: Session) => () => void
  /** Told after every change of what {@link BrowserTab.state} returns. */
  readonly onStateChange: (tab: BrowserTab) => void
  /** Told once when the page's `webContents` is gone, whoever closed it. */
  readonly onDestroyed: (tab: BrowserTab) => void
  readonly attachCdp?: BrowserTabCdpHook
}

/** A `navigate` answer: started, or refused by 025-FR-005. */
export type NavigateResult = { readonly ok: true } | { readonly refused: NavigationRefusal }

export type HistoryStep = 'back' | 'forward' | 'reload' | 'stop'

function capUrl(url: string | null): string | null {
  if (url === null || url === '') return null
  return url.length > BROWSER_URL_MAX_CHARS ? url.slice(0, BROWSER_URL_MAX_CHARS) : url
}

export class BrowserTab {
  readonly id: string
  readonly panelId: string | null
  readonly windowId: number
  readonly projectRoot: string
  readonly caseSensitive: boolean
  readonly contents: WebContents
  private readonly deps: BrowserTabDeps
  private committedUrl: string | null = null
  private pendingUrl: string | null = null
  private title = ''
  private attached = false
  private lastBoundsSeq = -1
  private withdrawDevTools: (() => void) | null = null
  private cdp: BrowserTabCdpLink | null = null
  private closed = false

  constructor(deps: BrowserTabDeps) {
    this.deps = deps
    this.id = deps.id
    this.panelId = deps.panelId
    this.windowId = deps.host.id
    this.projectRoot = deps.projectRoot
    this.caseSensitive = deps.caseSensitive
    this.contents = deps.view.webContents
    this.contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    hardenBrowserContents(this.contents)
    this.listenForPageNavigation()
    this.listenForLoadState()
    this.listenForDevTools()
    this.contents.once('destroyed', () => this.handleDestroyed())
    this.cdp = deps.attachCdp?.(this.contents) ?? null
  }

  /** Load `url` for a navigation the user started (`source` is never `page`). */
  navigate(url: string, source: Exclude<NavigationSource, 'page'>): NavigateResult {
    const verdict = checkNavigation(url, source, 'main', this.deps.appAddresses())
    if (!verdict.allowed) {
      logger.warn('Refused a browser tab navigation', { source, reason: verdict.reason })
      return { refused: verdict.reason }
    }
    this.load(url, source)
    return { ok: true }
  }

  /**
   * Load `url` for the page itself – a tab the page opened (`createFromPage`).
   * Checked under the `page` source; never shows a pending address.
   */
  navigateForPage(url: string): NavigateResult {
    const verdict = checkNavigation(url, 'page', 'main', this.deps.appAddresses())
    if (!verdict.allowed) return { refused: verdict.reason }
    this.load(url, 'page')
    return { ok: true }
  }

  /** Back, Forward, Reload or Stop (025-FR-003). */
  history(step: HistoryStep): void {
    const history = this.contents.navigationHistory
    if (step === 'stop') {
      this.contents.stop()
      this.setPending(null)
      return
    }
    if (step === 'reload') {
      this.setPending(this.committedUrl)
      this.contents.reload()
      return
    }
    const offset = step === 'back' ? -1 : 1
    const canGo = step === 'back' ? history.canGoBack() : history.canGoForward()
    if (!canGo) return
    const target = history.getEntryAtIndex(history.getActiveIndex() + offset)
    this.setPending(target?.url ?? null)
    if (step === 'back') history.goBack()
    else history.goForward()
  }

  /**
   * Place or hide the page (the renderer's `bounds` push). A push older than
   * the last applied one is dropped. Hidden – or a rectangle that clamps to
   * nothing – detaches the view: the page keeps running, unseen (025-FR-007).
   */
  applyBounds(bounds: RectLike, seq: number, visible: boolean): void {
    if (this.closed || seq <= this.lastBoundsSeq) return
    this.lastBoundsSeq = seq
    const host = this.deps.host
    if (host.isDestroyed()) return
    const content = host.getContentBounds()
    const dip = visible ? clampAndZoomBounds(bounds, content, host.webContents.getZoomFactor()) : null
    if (dip === null) {
      this.detach()
      return
    }
    this.deps.view.setBounds(dip)
    if (!this.attached) {
      host.contentView.addChildView(this.deps.view)
      this.attached = true
      this.cdp?.setVisible(true)
    }
    // TODO(spec 025 commit 16): answer `ack` once the native-view guard needs
    // the repaint confirmation (`previewLiveBounds.confirmRepaint`'s pattern).
  }

  /** Move keyboard focus into the page; only a shown page can take it. */
  focusPage(): void {
    if (this.attached && !this.contents.isDestroyed()) this.contents.focus()
  }

  /**
   * Toggle DevTools in its own window, or – with `inspectAt` (page CSS px) –
   * open it on the element there (025-FR-013).
   */
  devTools(inspectAt?: { x: number; y: number }): void {
    if (inspectAt === undefined && this.contents.isDevToolsOpened()) {
      this.contents.closeDevTools()
      return
    }
    if (!this.contents.isDevToolsOpened()) {
      this.expectDevTools()
      this.contents.openDevTools({ mode: 'detach', activate: true })
    }
    if (inspectAt !== undefined) this.contents.inspectElement(Math.round(inspectAt.x), Math.round(inspectAt.y))
  }

  /** Whether the view is in its window now. */
  isAttached(): boolean {
    return this.attached
  }

  /** What the toolbar and the editor tab show (`browser-tab:state`). */
  state(): TabStateEvent {
    const shown = this.pendingUrl ?? this.committedUrl
    const history = this.contents.navigationHistory
    return {
      tabId: this.id,
      committedUrl: capUrl(this.committedUrl),
      pendingUrl: capUrl(this.pendingUrl),
      origin: shown === null ? null : originParts(shown, this.deps.resolveDomain),
      title: this.title,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      loading: this.contents.isLoading(),
      zoomPercent: 100,
      widthPreset: 'full',
      security: securityStateOf(shown),
      inUse: { camera: false, microphone: false, screen: false },
      erfanaPage: this.committedUrl === null && this.pendingUrl === null ? 'empty' : null,
      devToolsOpen: this.contents.isDevToolsOpened()
    }
  }

  /** Close DevTools, take the view out of its window and destroy the page. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.withdrawDevToolsExpectation()
    this.cdp?.detach()
    this.cdp = null
    this.detach()
    if (this.contents.isDestroyed()) return
    if (this.contents.isDevToolsOpened()) this.contents.closeDevTools()
    // No leave-page prompt when Erfana closes a tab (S-31).
    this.contents.close({ waitForBeforeUnload: false })
  }

  private load(url: string, source: NavigationSource): void {
    this.setPending(isUserStarted(source) ? url : null)
    this.contents.loadURL(url).catch((error: unknown) => {
      // Stop or a newer navigation rejects the older load with ERR_ABORTED;
      // every other failure is the page's own load error (did-fail-load).
      const code = (error as { errno?: unknown } | null)?.errno
      if (code !== ERR_ABORTED) logger.debug('Browser tab load ended without a commit', { errno: String(code) })
    })
  }

  private listenForPageNavigation(): void {
    const contents = this.contents
    contents.on('will-navigate', (details) => {
      this.refuseUnlessAllowed(details, details.url, 'main')
    })
    contents.on('will-frame-navigate', (details) => {
      if (!details.isMainFrame) this.refuseUnlessAllowed(details, details.url, 'frame')
    })
    contents.on('will-redirect', (details) => {
      this.refuseUnlessAllowed(details, details.url, details.isMainFrame ? 'main' : 'frame')
    })
  }

  private refuseUnlessAllowed(event: { preventDefault(): void }, url: string, frame: FrameKind): void {
    const verdict = checkNavigation(url, 'page', frame, this.deps.appAddresses(), this.pageOrigin())
    if (verdict.allowed) return
    event.preventDefault()
    logger.warn('Refused a page navigation in a browser tab', { frame, reason: verdict.reason })
  }

  private pageOrigin(): string | null {
    if (this.committedUrl === null) return null
    try {
      return new URL(this.committedUrl).origin
    } catch {
      return null
    }
  }

  private listenForLoadState(): void {
    const contents = this.contents
    contents.on('did-start-navigation', (details) => {
      // A navigation the page started drops the user's pending address.
      if (details.isMainFrame && !details.isSameDocument && details.initiator) this.setPending(null)
    })
    contents.on('did-navigate', (_event, url) => {
      this.committedUrl = url
      this.title = ''
      this.setPending(null, true)
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      this.committedUrl = url
      this.changed()
    })
    contents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) this.setPending(null, true)
    })
    contents.on('did-start-loading', () => this.changed())
    contents.on('did-stop-loading', () => this.setPending(null, true))
    contents.on('page-title-updated', (_event, title) => {
      this.title = sanitizePageText(title)
      this.changed()
    })
  }

  private listenForDevTools(): void {
    this.contents.on('devtools-opened', () => {
      this.withdrawDevToolsExpectation()
      this.changed()
    })
    this.contents.on('devtools-closed', () => {
      this.withdrawDevToolsExpectation()
      this.changed()
    })
  }

  private expectDevTools(): void {
    this.withdrawDevToolsExpectation()
    this.withdrawDevTools = this.deps.expectDevTools(this.contents.session)
  }

  private withdrawDevToolsExpectation(): void {
    this.withdrawDevTools?.()
    this.withdrawDevTools = null
  }

  private setPending(url: string | null, alwaysEmit = false): void {
    if (this.pendingUrl === url && !alwaysEmit) return
    this.pendingUrl = url
    this.changed()
  }

  private detach(): void {
    if (!this.attached) return
    this.attached = false
    this.cdp?.setVisible(false)
    const host = this.deps.host
    if (!host.isDestroyed()) host.contentView.removeChildView(this.deps.view)
  }

  private changed(): void {
    if (this.closed || this.contents.isDestroyed()) return
    this.deps.onStateChange(this)
  }

  private handleDestroyed(): void {
    this.closed = true
    this.withdrawDevToolsExpectation()
    this.cdp?.detach()
    this.cdp = null
    this.detach()
    this.deps.onDestroyed(this)
  }
}
