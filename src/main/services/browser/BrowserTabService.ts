// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser tabs of this process, by window (spec 025, 025-FR-001,
 * 025-FR-006, 025-FR-007, 025-FR-015; solution design § 3.1, § 3.4; panel
 * findings S2, A10).
 *
 * - **Create** (`browser-tab:create`): the open project's profile through
 *   `BrowserProfileService.openForTab` (guards, one process per project, the
 *   hardened session), then the view through the session registry – its id is
 *   registered while the constructor runs – then the {@link BrowserTab}, in
 *   the same tick, before any page loads.
 * - **Ownership.** A tab belongs to the window that created it. Every request
 *   names a tab and comes from a window; a tab of another window is refused
 *   as if unknown. Events go only to the owning window.
 * - **Page-opened tabs** are made here, in main, under the `page` source
 *   ({@link BrowserTabService.createFromPage}), and announced with
 *   `browser-tab:tabAdded`; they never round-trip through the renderer's
 *   create path (S2). Called by the popup policy (`popups/TabWindowOpen.ts`,
 *   commit 12e), which hands over the `webContents` Chromium created, and for
 *   **Open link in new tab** under the `contextMenuLink` source.
 * - **Window open, leave-page prompt, right-click menu** (025-FR-011,
 *   025-FR-057, 025-FR-058): attached per tab as `dialogs/TabPageExtras.ts`;
 *   a close the user asks for ({@link BrowserTabService.close}) lets the page
 *   ask to stay, Erfana's own closes never do (S-31).
 * - **Teardown.** A closing window closes its tabs (`closeWindow`, wired where
 *   the preview's is); a project switch or close closes the old project's tabs
 *   in the `closeViews` stage of `BrowserProjectTeardown`. Nothing is stored,
 *   so nothing is restored (025-FR-006).
 * - **Site requests** (025-FR-019, 025-FR-020): each tab is attached to the
 *   `site` (`permissions/BrowserSite.ts`) before its first page loads; its
 *   strip rows and download notices go to the owning window, and
 *   {@link BrowserTabService.answerStrip} takes the answers back.
 * - **Input** (025-FR-014, 025-FR-047 to 025-FR-052, ADR 0011 decisions
 *   11–16): each tab gets its key and mouse routers (`input/BrowserTabInput.ts`)
 *   before its first page loads; forwarded keys, page focus and pick-mode
 *   changes go to the owning window. Each window gets one listener for the
 *   browser keys while a tab's toolbar has focus (`input/appWindowBrowserKeys.ts`),
 *   which {@link BrowserTabService.toolbarFocus} points at that tab.
 * - **Local files** (025-FR-005 rule 1, 025-FR-010): {@link BrowserTabService.openLocalFile}
 *   serves the file's folder (`local/LocalFileServers.ts`) and loads it in
 *   the tab; a closing tab releases the folders it held.
 */
import type { Session, WebContents, WebContentsView } from 'electron'
import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import {
  FindResultEventSchema,
  ContextMenuEventSchema,
  NoticeEventSchema,
  StripEventSchema,
  TabAddedEventSchema,
  TabStateEventSchema,
  type ContextActionRequestSchema,
  type CreateResponse,
  type FocusOrigin,
  type NavigateResponse,
  type NavigationSource,
  type StripAnswer,
  type TabStateEvent
} from '../../../shared/ipc/browser-tab-schema'
import type { RegistrableDomainResolver } from '../../../shared/browser/originFormat'
import { pathToFileURL } from 'node:url'
import { isSamePath } from '../../utils/pathCompare'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import type { ProjectSessionSnapshot } from '../session/ProjectSession'
import { BrowserProfileError } from './browserProfileGuards'
import { isAppAddress, LOCAL_FILE_SOURCES, type AppAddresses } from './browserNavigationPolicy'
import { BrowserTab, type BrowserTabCdpHook, type BrowserTabCdpLink, type TabHost, type TabLocalFiles } from './BrowserTab'
import type { LocalFileServers } from './local/LocalFileServers'
import type { BrowserSite, TabSiteLink } from './permissions/BrowserSite'
import type { AnswerResult, StripFields } from './permissions/tabStrip'
import type { CertificateAnswerResult } from './site/browserCertificates'
import { AppWindowBrowserKeys } from './input/appWindowBrowserKeys'
import type { BrowserTabInput } from './input/BrowserTabInput'
import { newTabInput, type TabInputSetup } from './input/tabInputFactory'
import type { BrowserPages } from './page/BrowserPages'
import type { BrowserTabPage, PageHangSource } from './page/BrowserTabPage'
import { decorateTabState } from './page/tabPageState'
import type { ClipView } from './page/TabViewFrame'
import { TabPageExtras, type TabPageExtrasSetup } from './dialogs/TabPageExtras'
import type { ContextActionResult } from './contextMenu/TabContextMenu'
import type { z } from 'zod'
import { TabClosedEventSchema } from '../../../shared/ipc/browser-tab-chrome-schema'
import { KeyringStrip, type KeyringStripSetup } from './site/keyringStrip'
import { sendTabEvent } from './tabEventSend'

/** A tab's CDP link, with the hang probe's events for the page features when the session has them. */
export type TabCdpLink = BrowserTabCdpLink & Partial<PageHangSource>

export type { TabInputSetup } from './input/tabInputFactory'

/** What `openForTab` hands back that a tab needs. */
export interface TabProfile {
  readonly projectRoot: string
  readonly session: object
}

export interface BrowserTabServiceDeps {
  /** `BrowserProfileService.openForTab`. */
  readonly openProfile: () => Promise<TabProfile>
  /** The open project, to check it did not change while the profile opened. */
  readonly currentProject: () => Pick<ProjectSessionSnapshot, 'realRoot' | 'caseSensitive'> | null
  /** Per-session setup that must precede the first page (the app-address filter). */
  readonly prepareSession: (session: Session) => void
  /** Build the page view in `session` through `browserSessionRegistry.createView`; `adopt` is a page-opened `webContents` to show. */
  readonly createView: (session: Session, adopt?: WebContents) => WebContentsView
  /** `browserSessionRegistry.expectDevTools`. */
  readonly expectDevTools: (session: Session) => () => void
  readonly appAddresses: () => AppAddresses
  readonly resolveDomain: RegistrableDomainResolver
  readonly attachCdp?: (...args: Parameters<BrowserTabCdpHook>) => TabCdpLink | null
  /** Load errors, crash and hang notices, find, zoom, width presets and history (commit 12h); without it none of them. */
  readonly pages?: Pick<BrowserPages, 'attachTab' | 'detachTab'>
  /** The page view's clipping parent for width presets (ADR 0011 decision 6). */
  readonly createClip?: () => ClipView
  /** Permission prompts, notices and downloads; without it the session policy refuses them. */
  readonly site?: Pick<BrowserSite, 'attachTab' | 'showDownload'>
  /** Key and mouse routing; without it a tab's page receives every key and click. */
  readonly input?: TabInputSetup
  /** Served local folders; without them every local file is refused. */
  readonly local?: TabLocalFiles & Pick<LocalFileServers, 'open' | 'releaseTab'>
  /** Window open, the leave-page prompt and the right-click menu (commits 12e–g); without it window opens are denied. */
  readonly extras?: TabPageExtrasSetup
  /** The keyring notices of the project's first tab in this run (025-FR-018); without it none show. */
  readonly keyring?: KeyringStripSetup
}

/** The sources a local file opens from (`LOCAL_FILE_SOURCES`). */
export type LocalFileSource = Exclude<NavigationSource, 'page'>

/**
 * The toast text of a refused profile: the folder that failed, then why
 * (025-FR-016 – "an error toast shall name the path"). The path is the
 * project-relative level, never an absolute one; logs redact it.
 */
export function profileErrorText(error: BrowserProfileError): string {
  return error.relPath === '' ? error.message : `${error.relPath}: ${error.message}`
}

/** Mints `browser-tab-<n>`, the id shape `BrowserTabIdSchema` accepts. */
const MAX_TAB_COUNTER = 999_999_999

export class BrowserTabService {
  private readonly tabs = new Map<string, BrowserTab>()
  private readonly hostOf = new WeakMap<BrowserTab, TabHost>()
  private readonly siteOf = new WeakMap<BrowserTab, TabSiteLink>()
  private readonly inputOf = new WeakMap<BrowserTab, BrowserTabInput>()
  private readonly pageOf = new WeakMap<BrowserTab, BrowserTabPage>()
  private readonly extrasOf = new WeakMap<BrowserTab, TabPageExtras>()
  private readonly keyringOf = new WeakMap<BrowserTab, KeyringStrip>()
  private readonly windowKeys = new Map<number, AppWindowBrowserKeys>()
  private counter = 0

  constructor(private readonly deps: BrowserTabServiceDeps) {}

  /** Open an empty tab for `panelId` in `host`, or say why it cannot open. */
  async create(host: TabHost, panelId: string): Promise<CreateResponse> {
    let profile: TabProfile
    try {
      profile = await this.deps.openProfile()
    } catch (error) {
      logger.error('Browser tab could not open its profile', redactedLogError(error))
      return { error: error instanceof BrowserProfileError ? profileErrorText(error) : 'The browser could not start for this project' }
    }
    if (host.isDestroyed()) return { error: 'The window closed' }
    const project = this.deps.currentProject()
    if (project === null || !isSamePath(project.realRoot, profile.projectRoot, project.caseSensitive)) {
      return { error: 'The project changed while the browser was starting' }
    }
    const tab = this.openTab(host, panelId, profile, project.caseSensitive)
    // The empty tab's first state: no address, Back and Forward disabled.
    this.sendState(tab)
    if (this.deps.keyring !== undefined) {
      const keyring = new KeyringStrip(tab.id, (e) => sendTabEvent(host, BROWSER_TAB_EVENTS.strip, StripEventSchema, e), this.deps.keyring)
      this.keyringOf.set(tab, keyring)
      void keyring.start()
    }
    return { tabId: tab.id }
  }

  /**
   * A tab the page in `openerTabId` opened, created in main under the `page`
   * source and announced to the owning window (S2). `adopt` is the
   * `webContents` Chromium created for the open, which loads `url` itself
   * (the popup policy checked it); without it the tab loads `url`. Returns
   * the new tab's id, or `null` when the opener is gone or `url` is refused.
   */
  createFromPage(openerTabId: string, url: string, background: boolean, adopt: WebContents | null = null): string | null {
    const opener = this.tabs.get(openerTabId)
    if (opener === undefined || opener.contents.isDestroyed()) return null
    const host = this.hostOf.get(opener)
    if (host === undefined || host.isDestroyed()) return null
    const profile: TabProfile = { projectRoot: opener.projectRoot, session: opener.contents.session }
    const tab = this.openTab(host, null, profile, opener.caseSensitive, adopt ?? undefined)
    if (adopt === null && 'refused' in tab.navigateForPage(url)) {
      this.closeTab(tab)
      return null
    }
    sendTabEvent(host, BROWSER_TAB_EVENTS.tabAdded, TabAddedEventSchema, { tabId: tab.id, openerTabId, background })
    return tab.id
  }

  /**
   * Load the local file at `filePath` in `tabId` of `windowId`, through its
   * served folder (025-FR-005 rule 1): the address bar's `file://` input,
   * a history row, or **Open in browser tab** (025-FR-010). Never rejects.
   */
  async openLocalFile(windowId: number, tabId: string, filePath: string, source: LocalFileSource): Promise<NavigateResponse> {
    const tab = this.tabOf(windowId, tabId)
    if (tab === null) return { error: 'Request refused' }
    const local = this.deps.local
    if (local === undefined || !LOCAL_FILE_SOURCES.has(source)) return { refused: 'local-file' }
    try {
      if (isAppAddress(pathToFileURL(filePath).href, this.deps.appAddresses())) return { refused: 'app-entry' }
      const opened = await local.open({ tabId, projectRoot: tab.projectRoot, caseSensitive: tab.caseSensitive, filePath })
      if (!opened.ok) return { refused: opened.reason }
      if (this.tabs.get(tabId) !== tab) {
        local.releaseTab(tabId)
        return { error: 'The tab closed' }
      }
      tab.navigateLocal(opened.url, source)
      return { ok: true }
    } catch (error) {
      logger.error('Opening a local file in a browser tab failed', redactedLogError(error))
      return { error: 'The file could not be opened' }
    }
  }

  /** The tab `tabId` if it belongs to `windowId`; a tab of another window is refused. */
  tabOf(windowId: number, tabId: string): BrowserTab | null {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) return null
    if (tab.windowId !== windowId) {
      logger.warn('Refused a browser tab request from a window that does not own the tab')
      return null
    }
    return tab
  }

  /**
   * An answer to a strip row of `tabId` from `windowId` (`browser-tab:answerStrip`);
   * `null` when the window does not own the tab.
   */
  answerStrip(
    windowId: number,
    tabId: string,
    requestId: string,
    answer: StripAnswer,
    fields?: StripFields
  ): AnswerResult | null {
    const tab = this.tabOf(windowId, tabId)
    if (tab === null) return null
    const own =
      this.pageOf.get(tab)?.answerStrip(requestId, answer) ??
      this.extrasOf.get(tab)?.answerStrip(requestId, answer) ??
      this.keyringOf.get(tab)?.answer(requestId, answer) ??
      null
    if (own !== null) return own
    return this.siteOf.get(tab)?.answerStrip(requestId, answer, fields) ?? 'unknown'
  }

  /**
   * **Proceed anyway** or **Back to safety** on `tabId`'s certificate page from
   * `windowId` (`browser-tab:certificate`); `null` when the window does not own the tab.
   */
  answerCertificate(windowId: number, tabId: string, decisionId: string, proceed: boolean): CertificateAnswerResult | null {
    const tab = this.tabOf(windowId, tabId)
    if (tab === null) return null
    return this.siteOf.get(tab)?.answerCertificate(decisionId, proceed) ?? 'unknown'
  }

  /** Where keyboard focus comes from as it moves into `tabId`'s page (first-click rule). */
  focusOrigin(windowId: number, tabId: string, from: FocusOrigin): void {
    const tab = this.tabOf(windowId, tabId)
    if (tab !== null) this.inputOf.get(tab)?.reportFocusOrigin(from)
  }

  /** Whether `tabId`'s toolbar has keyboard focus; points the window's browser keys at it. */
  toolbarFocus(windowId: number, tabId: string, focused: boolean): void {
    const tab = this.tabOf(windowId, tabId)
    const input = tab === null ? undefined : this.inputOf.get(tab)
    if (input === undefined) return
    input.reportToolbarFocus(focused)
    const keys = this.windowKeys.get(windowId)
    if (focused) keys?.setTarget(input)
    else keys?.clearTarget(input)
  }

  /** The page features of `tabId` if it belongs to `windowId` (find, zoom, width preset); `null` otherwise. */
  pageFor(windowId: number, tabId: string): BrowserTabPage | null {
    const tab = this.tabOf(windowId, tabId)
    return tab === null ? null : (this.pageOf.get(tab) ?? null)
  }

  /** The input routing of `tab`, for the test hooks; `null` without routing. */
  inputFor(tab: BrowserTab): BrowserTabInput | null {
    return this.inputOf.get(tab) ?? null
  }

  /** **Show in folder** for a download announced to `windowId`. */
  showDownload(windowId: number, downloadId: string): boolean {
    return this.deps.site?.showDownload(windowId, downloadId) ?? false
  }

  /** Every live tab, for the test hooks. */
  list(): readonly BrowserTab[] {
    return [...this.tabs.values()]
  }

  /** **Open link in new tab** from `opener`'s menu: a user-started load under `contextMenuLink`. */
  private openLinkTab(opener: BrowserTab, url: string): void {
    const host = this.hostOf.get(opener)
    if (host === undefined || host.isDestroyed()) return
    const tab = this.openTab(host, null, { projectRoot: opener.projectRoot, session: opener.contents.session }, opener.caseSensitive)
    if ('refused' in tab.navigate(url, 'contextMenuLink')) return this.closeTab(tab)
    sendTabEvent(host, BROWSER_TAB_EVENTS.tabAdded, TabAddedEventSchema, { tabId: tab.id, openerTabId: opener.id, background: false })
  }

  /** `browser-tab:contextAction` on `tabId` from `windowId`; `null` when the window does not own the tab. */
  contextAction(windowId: number, tabId: string, request: Omit<z.infer<typeof ContextActionRequestSchema>, 'tabId'>): ContextActionResult | null {
    const tab = this.tabOf(windowId, tabId)
    return tab === null ? null : (this.extrasOf.get(tab)?.contextAction(request.menuId, request.action) ?? 'unknown')
  }

  /**
   * Close `tabId` of `windowId`. The user's close lets the page ask to stay
   * (025-FR-058); `byUser: false` (the editor tab is already gone) never asks
   * (S-31). Returns whether the window holds the tab; `tabClosed` follows once it is gone.
   */
  close(windowId: number, tabId: string, byUser = true): boolean {
    const tab = this.tabOf(windowId, tabId)
    if (tab === null) return false
    const extras = this.extrasOf.get(tab)
    if (extras === undefined || !byUser) this.closeTab(tab)
    else extras.closeByUser()
    return true
  }

  /** Close every tab of a window that is closing. */
  closeWindow(windowId: number): void {
    for (const tab of this.list()) if (tab.windowId === windowId) this.closeTab(tab)
    this.windowKeys.get(windowId)?.dispose()
    this.windowKeys.delete(windowId)
  }

  /** Close every tab of the project at `projectRoot` (teardown stage `closeViews`). */
  closeProject(projectRoot: string): void {
    for (const tab of this.list()) {
      if (isSamePath(tab.projectRoot, projectRoot, tab.caseSensitive)) this.closeTab(tab)
    }
  }

  private openTab(host: TabHost, panelId: string | null, profile: TabProfile, caseSensitive: boolean, adopt?: WebContents): BrowserTab {
    const session = profile.session as Session
    this.deps.prepareSession(session)
    const view = this.deps.createView(session, ...(adopt === undefined ? [] : [adopt]))
    let input: BrowserTabInput | null = null
    // The CDP link is made while the tab's constructor runs; the page features take its hang events.
    const cdp: { link: TabCdpLink | null } = { link: null }
    const attachCdp = this.deps.attachCdp
    const tab = new BrowserTab({
      id: this.nextId(),
      panelId,
      host,
      view,
      projectRoot: profile.projectRoot,
      caseSensitive,
      appAddresses: this.deps.appAddresses,
      resolveDomain: this.deps.resolveDomain,
      expectDevTools: this.deps.expectDevTools,
      attachCdp: attachCdp === undefined ? undefined : (contents) => (cdp.link = attachCdp(contents)),
      onStateChange: (changed) => this.sendState(changed),
      onDestroyed: (gone) => this.forget(gone),
      onPageMoved: () => input?.recordRowShift(),
      local: this.deps.local,
      createClip: this.deps.createClip,
      armLeave: (repeat) => this.extrasOf.get(tab)?.arm(repeat)
    })
    this.tabs.set(tab.id, tab)
    this.hostOf.set(tab, host)
    input = this.attachInput(tab, host)
    const site = this.deps.site?.attachTab(tab, {
      strip: (event) => sendTabEvent(host, BROWSER_TAB_EVENTS.strip, StripEventSchema, event),
      notice: (event) => sendTabEvent(host, BROWSER_TAB_EVENTS.notice, NoticeEventSchema, event),
      parentWindow: () => (host.isDestroyed() ? null : host)
    })
    if (site !== undefined) this.siteOf.set(tab, site)
    this.attachPage(tab, host, cdp.link)
    this.attachExtras(tab, host)
    return tab
  }

  /** Window open, leave-page prompt and right-click menu, after the input routers (`dialogs/TabPageExtras.ts`). */
  private attachExtras(tab: BrowserTab, host: TabHost): void {
    const setup = this.deps.extras
    if (setup === undefined) return
    const extras = new TabPageExtras(
      tab,
      {
        strip: (event) => sendTabEvent(host, BROWSER_TAB_EVENTS.strip, StripEventSchema, event),
        contextMenu: (event) => sendTabEvent(host, BROWSER_TAB_EVENTS.contextMenu, ContextMenuEventSchema, event),
        openTab: (url, background, adopt) => this.createFromPage(tab.id, url, background, adopt) !== null,
        openLink: (url) => this.openLinkTab(tab, url),
        forceClose: () => this.closeTab(tab),
        blocked: () => {
          const routing = this.inputOf.get(tab)?.state()
          return routing !== undefined && (routing.pick || routing.surface !== 'none')
        }
      },
      setup
    )
    this.extrasOf.set(tab, extras)
  }

  /** The tab's page features (`page/BrowserTabPage.ts`), before its first page loads. */
  private attachPage(tab: BrowserTab, host: TabHost, cdp: TabCdpLink | null): void {
    const pages = this.deps.pages
    if (pages === undefined) return
    const { onHang, waitHang } = cdp ?? {}
    const hang = onHang === undefined || waitHang === undefined ? null : { onHang, waitHang }
    const page = pages.attachTab(
      tab,
      {
        strip: (event) => sendTabEvent(host, BROWSER_TAB_EVENTS.strip, StripEventSchema, event),
        findResult: (event) => sendTabEvent(host, BROWSER_TAB_EVENTS.findResult, FindResultEventSchema, event),
        stateChanged: () => this.sendState(tab),
        endPick: () => this.inputOf.get(tab)?.dispatch({ type: 'endSilently' })
      },
      hang
    )
    this.pageOf.set(tab, page)
  }

  /** The tab's key and mouse routers, before its first page loads; `null` without routing. */
  private attachInput(tab: BrowserTab, host: TabHost): BrowserTabInput | null {
    const setup = this.deps.input
    if (setup === undefined) return null
    const input = newTabInput(tab, host, setup, (step) => this.pageOf.get(tab)?.zoom(step))
    this.inputOf.set(tab, input)
    if (!this.windowKeys.has(host.id) && !host.webContents.isDestroyed()) {
      this.windowKeys.set(host.id, new AppWindowBrowserKeys(host.webContents, setup.platform))
    }
    return input
  }

  private nextId(): string {
    this.counter = this.counter >= MAX_TAB_COUNTER ? 1 : this.counter + 1
    while (this.tabs.has(`browser-tab-${this.counter}`)) this.counter += 1
    return `browser-tab-${this.counter}`
  }

  private closeTab(tab: BrowserTab): void {
    this.forget(tab)
    try {
      tab.close()
    } catch (error) {
      logger.error('Closing a browser tab failed', redactedLogError(error))
    }
  }

  private forget(tab: BrowserTab): void {
    if (this.tabs.get(tab.id) === tab) {
      this.tabs.delete(tab.id)
      // The owning window removes the editor tab only now (commit 18).
      const host = this.hostOf.get(tab)
      if (host !== undefined) sendTabEvent(host, BROWSER_TAB_EVENTS.tabClosed, TabClosedEventSchema, { tabId: tab.id })
    }
    this.keyringOf.get(tab)?.detach()
    this.keyringOf.delete(tab)
    this.deps.local?.releaseTab(tab.id)
    this.siteOf.get(tab)?.detach()
    this.siteOf.delete(tab)
    const page = this.pageOf.get(tab)
    if (page !== undefined) this.deps.pages?.detachTab(page)
    this.pageOf.delete(tab)
    this.extrasOf.get(tab)?.detach()
    this.extrasOf.delete(tab)
    const input = this.inputOf.get(tab)
    if (input !== undefined) {
      this.windowKeys.get(tab.windowId)?.clearTarget(input)
      input.dispose()
      this.inputOf.delete(tab)
    }
  }

  /** `tab`'s state with its page features applied (load error, crash, zoom) – what the window gets. */
  stateOf(tab: BrowserTab): TabStateEvent {
    const page = this.pageOf.get(tab)
    return page === undefined ? tab.state() : decorateTabState(tab.state(), page.facts(), this.deps.resolveDomain)
  }

  private sendState(tab: BrowserTab): void {
    const host = this.hostOf.get(tab)
    if (host !== undefined) sendTabEvent(host, BROWSER_TAB_EVENTS.state, TabStateEventSchema, this.stateOf(tab))
  }
}
