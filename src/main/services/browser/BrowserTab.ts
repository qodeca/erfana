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
 *   baseline, so the tab sets its own handler; the service replaces it in the
 *   same tick with the popup policy (`popups/TabWindowOpen.ts`).
 * - **Leave-page prompt** (025-FR-058): every load the user starts arms
 *   {@link BrowserTabDeps.armLeave} with a way to repeat it first.
 * - **Navigation policy** (S2). What the user starts goes through
 *   {@link BrowserTab.navigate} and {@link BrowserTab.history}; what the page
 *   starts – a link, a script, a form, a redirect, a frame – is checked by
 *   `tabNavigationGuard.ts` under the `page` source and cancelled when not allowed.
 * - **Pending and committed address** (025-FR-002). A pending address exists
 *   only for a navigation the user started; it goes when the document
 *   commits, when the page starts its own navigation, and on abort, an error,
 *   a load that ends without a commit (HTTP 204, a download) and Stop (S21).
 * - **Hidden tabs keep their page** (025-FR-007, ADR 0011 decision 3): a
 *   hidden tab's view is detached from the window, never destroyed.
 * - **DevTools** (025-FR-013) open detached and close with the tab; the
 *   session registry is told to expect the front end Chromium creates in this
 *   tab's session, which it would otherwise close as unregistered.
 * - **Local files** (025-FR-005 rule 1, ADR 0012 option 4) load from their
 *   served folder ({@link BrowserTab.navigateLocal}); every load the user
 *   starts – the open, Reload, Back, Forward – arms its exact address, so only
 *   those get the folder's origin; the bar shows `file://<path>`. A tab the
 *   page opened never loads a local file (S-7). The pending load into a
 *   folder is tracked until it commits (`local/tabLocalLoad.ts`, ADR 0012
 *   amendment 2026-11-04).
 *
 * The tab-kind CDP session (`cdp/BrowserCdpSession.ts`) attaches before the
 * first load through {@link BrowserTabCdpHook}; the tab never touches the debugger.
 */
import type { BrowserWindow, Session, WebContents, WebContentsView } from 'electron'
import type { NavigationSource, TabStateEvent } from '../../../shared/ipc/browser-tab-schema'
import { BROWSER_URL_MAX_CHARS } from '../../../shared/ipc/browser-tab-schema'
import { originParts, withoutUserInfo, type RegistrableDomainResolver } from '../../../shared/browser/originFormat'
import { sanitizePageText } from '../../../shared/browser/pageText'
import { logger } from '../LoggingService'
import type { RectLike } from '../preview/previewBoundsClamp'
import { TabViewFrame, type ClipView } from './page/TabViewFrame'
import { checkNavigation, isUserStarted, securityStateOf, type AppAddresses, type NavigationRefusal } from './browserNavigationPolicy'
import { guardPageNavigation } from './tabNavigationGuard'
import { TabLocalLoad } from './local/tabLocalLoad'
import { hardenBrowserContents } from './browserSessionPolicy'
import type { TabCertificateState } from './site/browserCertificates'

/** Chromium's net error for a navigation that was cancelled (Stop, or replaced). */
const ERR_ABORTED = -3

/** The window a tab lives in: its content view holds the page view. */
export type TabHost = Pick<BrowserWindow, 'id' | 'isDestroyed' | 'getContentBounds' | 'contentView' | 'webContents'>

/** The served local folders, as a tab uses them (`local/LocalFileServers.ts`). */
export interface TabLocalFiles {
  isLocalAddress(url: string): boolean
  /** Arm `url` for one Erfana-started top-level load. */
  arm(url: string): void
  /** `file://<path>` for a served address, or `null`. */
  displayAddress(url: string): string | null
  /** The served folders' gate (`LocalFileServers.allowsRequest`), for what the page navigates. */
  allowsRequest(request: { url: string; resourceType: string; topUrl: string | null; contentsId?: number }): boolean
  /** Record the tab's pending top-level load (`null`, or a non-served address, clears it). */
  setPendingLoad(contentsId: number, url: string | null): void
  /** The tab's pending load ended; with `url`, only when that address is the pending one. */
  endPendingLoad(contentsId: number, url?: string): void
}

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
  /**
   * Told when a shown page's top edge moved – a row above it appeared or
   * went – for the click guard (025-FR-047, `input/BrowserTabInput.ts`).
   */
  readonly onPageMoved?: () => void
  /** Served local folders; without them no local file loads. */
  readonly local?: TabLocalFiles
  /** The page view's clipping parent for width presets (ADR 0011 decision 6); without it the view goes straight into the window. */
  readonly createClip?: () => ClipView
  /** Told before each load the user starts, with a way to repeat it (`dialogs/leavePage.ts`). */
  readonly armLeave?: (repeat: () => void) => void
}

/** A `navigate` answer: started, or refused by 025-FR-005. */
export type NavigateResult = { readonly ok: true } | { readonly refused: NavigationRefusal }

export type HistoryStep = 'back' | 'forward' | 'reload' | 'stop'

/** An address for the renderer: no user info (no `accounts.example.com@` before the host, even while edited), capped. */
function capUrl(url: string | null): string | null {
  if (url === null || url === '') return null
  const shown = withoutUserInfo(url)
  return shown.length > BROWSER_URL_MAX_CHARS ? shown.slice(0, BROWSER_URL_MAX_CHARS) : shown
}

export class BrowserTab {
  readonly id: string
  readonly panelId: string | null
  readonly windowId: number
  readonly projectRoot: string
  readonly caseSensitive: boolean
  readonly contents: WebContents
  /** Arms and the pending load into a served folder (`local/tabLocalLoad.ts`). */
  private readonly localLoad: TabLocalLoad
  private readonly deps: BrowserTabDeps
  private committedUrl: string | null = null
  private pendingUrl: string | null = null
  private title = ''
  /** The page view in its window: shown, hidden, placed for the width preset (`page/TabViewFrame.ts`). */
  readonly viewFrame: TabViewFrame
  private withdrawDevTools: (() => void) | null = null
  private cdp: BrowserTabCdpLink | null = null
  private closed = false
  /** The certificate warning page and the address bar's warning sign (025-FR-021, `site/browserCertificates.ts`). */
  private certificate: TabCertificateState = { warning: null, sign: null }

  constructor(deps: BrowserTabDeps) {
    this.deps = deps
    this.id = deps.id
    this.panelId = deps.panelId
    this.windowId = deps.host.id
    this.projectRoot = deps.projectRoot
    this.caseSensitive = deps.caseSensitive
    this.contents = deps.view.webContents
    this.localLoad = new TabLocalLoad(deps.local, this.contents.id)
    this.viewFrame = new TabViewFrame({
      host: deps.host,
      view: deps.view,
      clip: deps.createClip?.() ?? null,
      onShown: (shown) => {
        this.cdp?.setVisible(shown)
        if (!shown) this.keepKeyboardInWindow()
      },
      onPageMoved: () => this.deps.onPageMoved?.()
    })
    this.contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    hardenBrowserContents(this.contents)
    guardPageNavigation(this.contents, {
      appAddresses: deps.appAddresses,
      local: deps.local,
      committedUrl: () => this.committedUrl,
      contentsId: this.contents.id
    })
    this.listenForLoadState()
    this.listenForDevTools()
    this.contents.once('destroyed', () => this.handleDestroyed())
    this.cdp = deps.attachCdp?.(this.contents) ?? null
  }

  /** Load `url` for a navigation the user started (`source` is never `page`). */
  navigate(url: string, source: Exclude<NavigationSource, 'page'>): NavigateResult {
    const verdict = checkNavigation(url, source, 'main', this.deps.appAddresses())
    if (!verdict.allowed) {
      // `local-file` is the cue to open the file through its served folder, not a refusal yet.
      if (verdict.reason === 'local-file') logger.debug('Browser tab navigation names a local file', { source })
      else logger.warn('Refused a browser tab navigation', { source, reason: verdict.reason })
      return { refused: verdict.reason }
    }
    this.deps.armLeave?.(() => this.navigate(url, source))
    this.localLoad.end()
    this.load(url, source)
    return { ok: true }
  }

  /**
   * Load a served local file: `url` is the loopback address
   * `LocalFileServers.open` answered. Armed first, so the document gets the
   * folder's origin; shown as `file://<path>`.
   */
  navigateLocal(url: string, source: Exclude<NavigationSource, 'page'>): void {
    this.deps.armLeave?.(() => this.navigateLocal(url, source))
    this.localLoad.arm(url)
    this.load(url, source)
  }

  /**
   * Load `url` for the page itself – a tab the page opened (`createFromPage`).
   * Checked under the `page` source; never shows a pending address.
   */
  navigateForPage(url: string): NavigateResult {
    if (this.deps.local?.isLocalAddress(url)) return { refused: 'local-file' }
    const verdict = checkNavigation(url, 'page', 'main', this.deps.appAddresses())
    if (!verdict.allowed) return { refused: verdict.reason }
    this.localLoad.end()
    this.load(url, 'page')
    return { ok: true }
  }

  /** Back, Forward, Reload or Stop (025-FR-003). */
  history(step: HistoryStep): void {
    const history = this.contents.navigationHistory
    if (step === 'stop') {
      this.contents.stop()
      this.localLoad.end()
      this.setPending(null)
      return
    }
    if (step === 'reload') {
      this.deps.armLeave?.(() => this.history('reload'))
      this.localLoad.arm(this.committedUrl)
      this.setPending(this.committedUrl)
      this.contents.reload()
      return
    }
    const offset = step === 'back' ? -1 : 1
    const canGo = step === 'back' ? history.canGoBack() : history.canGoForward()
    if (!canGo) return
    this.deps.armLeave?.(() => this.history(step))
    const target = history.getEntryAtIndex(history.getActiveIndex() + offset)
    this.localLoad.arm(target?.url ?? null)
    this.setPending(target?.url ?? null)
    if (step === 'back') history.goBack()
    else history.goForward()
  }

  /**
   * Place or hide the page (the renderer's `bounds` push) inside the page
   * area `clip`, for the tab's width preset (`page/TabViewFrame.ts`). A push
   * older than the last applied one is dropped. Hidden – or a rectangle that
   * clamps to nothing – detaches the view: the page keeps running, unseen
   * (025-FR-007).
   *
   * @returns whether the page is shown after the push, or null when the push
   *   was dropped (stale, closed tab, gone window) – the `ack` answer
   */
  applyBounds(bounds: RectLike, seq: number, visible: boolean, clip: RectLike = bounds): boolean | null {
    if (this.closed) return null
    return this.viewFrame.push({ bounds, clip }, seq, visible)
  }

  /**
   * A page taken out of its window while it held keyboard focus would keep it
   * where nothing can be seen: the surface Erfana draws over its still image
   * (ADR 0011) – the prompt-actions panel, a menu – takes the keys instead.
   */
  private keepKeyboardInWindow(): void {
    const host = this.deps.host
    if (!this.contents.isDestroyed() && this.contents.isFocused() && !host.isDestroyed()) host.webContents.focus()
  }

  /** Move keyboard focus into the page; only a shown page can take it. */
  focusPage(): void {
    if (this.viewFrame.isAttached() && !this.contents.isDestroyed()) this.contents.focus()
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
    return this.viewFrame.isAttached()
  }

  /** Show the certificate warning page or the warning sign, or neither (`site/browserCertificates.ts`). */
  setCertificateState(state: TabCertificateState): void {
    this.certificate = state
    this.changed()
  }

  /** Whether a navigation the user started is pending: a sign-in box for it takes focus (025-FR-022). */
  hasPendingUserNavigation(): boolean {
    return this.pendingUrl !== null
  }

  /** **Proceed anyway**: load `url` again as a user-started reload (025-FR-021). */
  reloadAt(url: string): void {
    this.navigate(url, 'reload')
  }

  /** **Back to safety** over the failed load's history entry (025-FR-021). */
  goBack(): void {
    this.history('back')
  }

  /** What the toolbar and the editor tab show (`browser-tab:state`). */
  state(): TabStateEvent {
    const committed = this.shownAddress(this.committedUrl)
    // A refused certificate load commits nothing and drops the pending address:
    // the warning page names the address that failed, and so does the bar (025-FR-021).
    const failed = this.certificate.warning === null ? null : (this.certificate.failedUrl ?? null)
    const pending = this.shownAddress(failed ?? this.pendingUrl)
    const shown = pending ?? committed
    const history = this.contents.navigationHistory
    return {
      tabId: this.id,
      committedUrl: capUrl(committed),
      pendingUrl: capUrl(pending),
      origin: shown === null ? null : originParts(shown, this.deps.resolveDomain),
      // The last page's title is not this address's: the tab is named after the failed host.
      title: failed === null ? this.title : '',
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      loading: this.contents.isLoading(),
      zoomPercent: 100,
      widthPreset: this.viewFrame.widthPreset,
      security: this.certificate.warning !== null ? 'warningUp' : (this.certificate.sign ?? securityStateOf(shown)),
      erfanaPage: this.erfanaPage(),
      ...(this.certificate.warning === null ? {} : { certificate: this.certificate.warning }),
      devToolsOpen: this.contents.isDevToolsOpened()
    }
  }

  /** The committed address whole – not capped like {@link state}'s – without user info; `file://` for a served file (**Open in system browser**). */
  pageAddress(): string | null {
    const shown = this.shownAddress(this.committedUrl)
    return shown === null ? null : withoutUserInfo(shown)
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

  /** What the bar shows for `url`: `file://<path>` for a served local address (S-6). */
  private shownAddress(url: string | null): string | null {
    if (url === null) return null
    return this.deps.local?.displayAddress(url) ?? url
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

  private listenForLoadState(): void {
    const contents = this.contents
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      this.localLoad.navigationStarted(details.url, Boolean(details.initiator), this.committedUrl)
      // A navigation the page started drops the user's pending address.
      if (details.initiator) this.setPending(null)
    })
    contents.on('did-navigate', (_event, url) => {
      this.localLoad.end()
      this.committedUrl = url
      this.title = ''
      this.setPending(null, true)
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      this.committedUrl = url
      this.changed()
    })
    contents.on('did-fail-load', (_event, _code, _description, url, isMainFrame) => {
      if (!isMainFrame) return
      // An older load replaced by the pending one fails too: it must not clear the newer one.
      this.localLoad.end(url)
      this.setPending(null, true)
    })
    contents.on('did-start-loading', () => this.changed())
    contents.on('did-stop-loading', () => {
      this.localLoad.end()
      this.setPending(null, true)
    })
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

  private erfanaPage(): TabStateEvent['erfanaPage'] {
    if (this.certificate.warning !== null) return 'certificate'
    return this.committedUrl === null && this.pendingUrl === null ? 'empty' : null
  }

  private setPending(url: string | null, alwaysEmit = false): void {
    if (this.pendingUrl === url && !alwaysEmit) return
    this.pendingUrl = url
    this.changed()
  }

  private detach(): void {
    this.viewFrame.detach()
  }

  private changed(): void {
    if (this.closed || this.contents.isDestroyed()) return
    this.deps.onStateChange(this)
  }

  private handleDestroyed(): void {
    this.closed = true
    this.localLoad.end()
    this.withdrawDevToolsExpectation()
    this.cdp?.detach()
    this.cdp = null
    this.detach()
    this.deps.onDestroyed(this)
  }
}
