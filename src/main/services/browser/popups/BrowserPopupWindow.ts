// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One popup window a page opened, main side (spec 025, 025-FR-011 rule 2;
 * ADR 0011 decision 9; solution design § 3.1 `BrowserPopupWindow`; spec
 * change S-22).
 *
 * Built in the window-open policy's `createWindow`, around the `webContents`
 * Chromium created for an opener-keeping `window.open` – so the page keeps
 * its `window.opener` link and shares the opener's session (the project's
 * profile). The `webContents` is already a registered browser view
 * (`browserSessionRegistry.expectPageWindow`).
 *
 * - **Host window** of kind `browserPopup` (`ipc/appWebContents.ts`): its own
 *   renderer may use only the `browser-tab:popup*` channels. It reserves
 *   {@link BrowserPopupWindowDeps.stripHeight} above the page for the popup's
 *   origin strip and prompt rows, so the requested content size is the
 *   page's. The host loads the strip's renderer (`loadHost`, commit 18) and
 *   is told `browser-tab:popupChanged` after each commit.
 * - **Size and position** (`windowFeatures.ts`): the requested content size,
 *   clamped; every requested position ignored, so the popup opens where the
 *   operating system (Electron: centred) puts it. A window larger than the
 *   work area once its frame is known is shrunk to fit. A page's own
 *   `resizeTo` / `moveTo` (`content-bounds-updated`) is refused and its size
 *   re-clamped; its position is never applied.
 * - **Title** "{host} – Erfana" from the committed address only, never the
 *   page title; "about:blank – opened by {origin}" before the first commit.
 * - **Navigation policy**: the `page` source of `browserNavigationPolicy`
 *   for the page, its frames and redirects; a served local folder is never
 *   reached from a popup (S-7).
 * - **CDP**: a popup-kind session (`cdp/BrowserCdpSession.ts`), through
 *   {@link BrowserPopupWindowDeps.attachCdp}.
 * - **Closes** when its page closes itself, when the user closes the window,
 *   and when the tab that opened it closes ({@link BrowserPopupWindow.close}).
 *   No leave-page prompt when Erfana closes it (S-31).
 */
import type { NavigationSource } from '../../../../shared/ipc/browser-tab-schema'
import { BROWSER_TAB_POPUP_EVENTS } from '../../../../shared/ipc/browser-tab-channels'
import { popupWindowTitle, type RegistrableDomainResolver } from '../../../../shared/browser/originFormat'
import { logger } from '../../LoggingService'
import { checkNavigation, type AppAddresses, type FrameKind } from '../browserNavigationPolicy'
import { hardenBrowserContents } from '../browserSessionPolicy'
import { popupContentSize, reclampContentSize, type PopupSizeLimits, type Size, type WindowFeatures } from './windowFeatures'

type Listener = (...args: unknown[]) => void

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The popup page's `webContents`, as far as the popup uses it. */
export interface PopupContents {
  readonly id: number
  on(event: string, listener: Listener): unknown
  once(event: string, listener: Listener): unknown
  isDestroyed(): boolean
  getURL(): string
  close(options?: { waitForBeforeUnload: boolean }): void
  setWindowOpenHandler(handler: never): void
}

/** The page view the popup shows its page in. */
export interface PopupPageView {
  readonly webContents: PopupContents
  setBounds(bounds: Rect): void
}

/** The popup's host window (an Electron `BrowserWindow`). */
export interface PopupHost {
  readonly id: number
  readonly webContents: {
    readonly id: number
    isDestroyed(): boolean
    once(event: 'destroyed', listener: () => void): unknown
    /** Tells the host's strip renderer that the committed address changed (commit 18). */
    send?(channel: string, payload: unknown): void
  }
  readonly contentView: { addChildView(view: never): void }
  isDestroyed(): boolean
  setTitle(title: string): void
  setContentSize(width: number, height: number): void
  getContentSize(): number[]
  getBounds(): Rect
  show(): void
  center(): void
  destroy(): void
  on(event: string, listener: Listener): unknown
}

/** What the popup tells its popup-kind CDP session. */
export interface PopupCdpLink {
  detach(): void
}

/** The host window's construction options this module decides. */
export interface PopupHostOptions {
  readonly contentSize: Size
  readonly title: string
}

export interface BrowserPopupWindowDeps {
  /** The tab whose page (or popup) opened this one; the popup closes with it. */
  readonly openerTabId: string
  /** The opener page's address, named in the title until the first commit. */
  readonly openerUrl: string
  /** The `webContents` Chromium created for the popup (registered, opener kept). */
  readonly contents: PopupContents
  readonly features: Pick<WindowFeatures, 'width' | 'height'>
  /** The screen's work area the popup opens on. */
  readonly workArea: () => Size
  /** The strip above the page: 0 until the popup's renderer exists (commit 18). */
  readonly stripHeight: number
  /** The width the origin strip needs (badge word, registrable domain, port); 0 until commit 18 measures it. */
  readonly originMinWidth: number
  readonly resolveDomain: RegistrableDomainResolver
  readonly appAddresses: () => AppAddresses
  /** Whether `url` is a served local folder's address – never reached from a popup (S-7). */
  readonly isLocalAddress: (url: string) => boolean
  /** Build the host window (a `BrowserWindow` with a dark background and no preload yet). */
  readonly createHost: (options: PopupHostOptions) => PopupHost
  /** Build the page view around `contents` (adopting it keeps the opener link). */
  readonly createView: (contents: PopupContents) => PopupPageView
  /** Register the host's renderer as an Erfana window of kind `browserPopup`. */
  readonly registerHost: (host: PopupHost) => void
  /** Load the origin strip's renderer into the host (commit 18); without it the strip area stays empty. */
  readonly loadHost?: (host: PopupHost) => void
  /** The window-open handler of the popup's own page (025-FR-011: a popup's opens follow the same rules). */
  readonly windowOpenHandler: (contents: PopupContents) => unknown
  /** Attach the popup-kind CDP session before the popup's first load; `null` without one. */
  readonly attachCdp?: (contents: PopupContents) => PopupCdpLink | null
  /** Told once, when the popup is gone. */
  readonly onClosed: (popup: BrowserPopupWindow) => void
}

/** The page source's frame rule for each navigation event. */
type PreventableEvent = { preventDefault(): void }

export class BrowserPopupWindow {
  readonly openerTabId: string
  readonly contents: PopupContents
  readonly host: PopupHost
  private readonly view: PopupPageView
  private readonly limits: PopupSizeLimits
  private committedUrl: string | null = null
  private cdp: PopupCdpLink | null = null
  private closed = false

  constructor(private readonly deps: BrowserPopupWindowDeps) {
    this.openerTabId = deps.openerTabId
    this.contents = deps.contents
    this.limits = { workArea: deps.workArea(), stripHeight: deps.stripHeight, originMinWidth: deps.originMinWidth }
    const content = popupContentSize(deps.features, this.limits)
    this.host = deps.createHost({
      contentSize: { width: content.width, height: content.height + deps.stripHeight },
      title: popupWindowTitle(null, deps.openerUrl, deps.resolveDomain)
    })
    deps.registerHost(this.host)
    deps.loadHost?.(this.host)
    this.view = deps.createView(deps.contents)
    this.host.contentView.addChildView(this.view as never)
    this.placeView()
    this.listenToHost()
    this.listenToPage()
    deps.contents.setWindowOpenHandler(deps.windowOpenHandler(deps.contents) as never)
    hardenBrowserContents(deps.contents as unknown as Parameters<typeof hardenBrowserContents>[0])
    this.cdp = deps.attachCdp?.(deps.contents) ?? null
    this.host.show()
    this.fitToWorkArea()
  }

  /** The committed address, or `null` before the first commit. */
  get committed(): string | null {
    return this.committedUrl
  }

  /** The work area the popup's size was clamped to. */
  get workArea(): Size {
    return this.limits.workArea
  }

  /** The popup's content size (the page view), for tests and the strip. */
  contentSize(): Size {
    const [width = 0, height = 0] = this.host.isDestroyed() ? [] : this.host.getContentSize()
    return { width, height: Math.max(0, height - this.deps.stripHeight) }
  }

  /** Close the popup without a leave-page prompt (opener tab closed, `popupClose`). */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.cdp?.detach()
    this.cdp = null
    if (!this.contents.isDestroyed()) this.contents.close({ waitForBeforeUnload: false })
    if (!this.host.isDestroyed()) this.host.destroy()
    this.deps.onClosed(this)
  }

  private placeView(): void {
    if (this.host.isDestroyed()) return
    const [width = 0, height = 0] = this.host.getContentSize()
    this.view.setBounds({ x: 0, y: this.deps.stripHeight, width, height: Math.max(0, height - this.deps.stripHeight) })
  }

  /** Shrink a window whose frame pushes it past the work area, then centre it again. */
  private fitToWorkArea(): void {
    if (this.host.isDestroyed()) return
    const bounds = this.host.getBounds()
    const area = this.limits.workArea
    const overW = Math.max(0, bounds.width - area.width)
    const overH = Math.max(0, bounds.height - area.height)
    if (overW === 0 && overH === 0) return
    const [width = 0, height = 0] = this.host.getContentSize()
    this.host.setContentSize(Math.max(1, width - overW), Math.max(1, height - overH))
    this.host.center()
    this.placeView()
  }

  private listenToHost(): void {
    this.host.on('resize', () => this.placeView())
    // The title is Erfana's: the host's own document never names it.
    this.host.on('page-title-updated', (event: unknown) => (event as PreventableEvent).preventDefault())
    this.host.on('closed', () => this.close())
  }

  private listenToPage(): void {
    const contents = this.contents
    contents.once('destroyed', () => this.close())
    contents.on('did-navigate', (_event: unknown, url: unknown) => {
      this.committedUrl = typeof url === 'string' && url !== '' ? url : null
      if (this.host.isDestroyed()) return
      this.host.setTitle(popupWindowTitle(this.committedUrl, this.deps.openerUrl, this.deps.resolveDomain))
      // The strip asks `popupStrip` again; the payload names nothing.
      if (!this.host.webContents.isDestroyed()) this.host.webContents.send?.(BROWSER_TAB_POPUP_EVENTS.popupChanged, {})
    })
    contents.on('content-bounds-updated', (event: unknown, bounds: unknown) => {
      // A page may not move its window; its size is re-clamped (ADR 0011 decision 9).
      ;(event as PreventableEvent).preventDefault()
      const requested = bounds as Rect
      const size = reclampContentSize({ width: requested.width, height: requested.height }, this.limits)
      if (!this.host.isDestroyed()) this.host.setContentSize(size.width, size.height + this.deps.stripHeight)
      this.placeView()
    })
    contents.on('will-navigate', (event: unknown, url: unknown) => this.refuseUnlessAllowed(event, url, 'main'))
    contents.on('will-frame-navigate', (event: unknown) => {
      const details = event as PreventableEvent & { url: string; isMainFrame: boolean }
      if (!details.isMainFrame) this.refuseUnlessAllowed(details, details.url, 'frame')
    })
    contents.on('will-redirect', (event: unknown) => {
      const details = event as PreventableEvent & { url: string; isMainFrame: boolean }
      this.refuseUnlessAllowed(details, details.url, details.isMainFrame ? 'main' : 'frame')
    })
  }

  private refuseUnlessAllowed(event: unknown, url: unknown, frame: FrameKind): void {
    const target = typeof url === 'string' ? url : ((event as { url?: unknown }).url as string | undefined) ?? ''
    const source: NavigationSource = 'page'
    const verdict = checkNavigation(target, source, frame, this.deps.appAddresses(), originOf(this.committedUrl))
    if (verdict.allowed && !this.deps.isLocalAddress(target)) return
    ;(event as PreventableEvent).preventDefault()
    logger.warn('Refused a page navigation in a browser popup', { frame, reason: verdict.allowed ? 'local-file' : verdict.reason })
  }
}

function originOf(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
