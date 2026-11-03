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
 *   create path (S2). Called by `site/browserWindowOpen.ts` (commit 12e);
 *   until then every window open is denied.
 * - **Teardown.** A closing window closes its tabs (`closeWindow`, wired where
 *   the preview's is); a project switch or close closes the old project's tabs
 *   in the `closeViews` stage of `BrowserProjectTeardown`. Nothing is stored,
 *   so nothing is restored (025-FR-006).
 * - **Site requests** (025-FR-019, 025-FR-020): each tab is attached to the
 *   `site` (`permissions/BrowserSite.ts`) before its first page loads; its
 *   strip rows and download notices go to the owning window, and
 *   {@link BrowserTabService.answerStrip} takes the answers back.
 */
import type { Session, WebContentsView } from 'electron'
import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import {
  NoticeEventSchema,
  StripEventSchema,
  TabAddedEventSchema,
  TabStateEventSchema,
  type CreateResponse,
  type StripAnswer
} from '../../../shared/ipc/browser-tab-schema'
import type { RegistrableDomainResolver } from '../../../shared/browser/originFormat'
import { isSamePath } from '../../utils/pathCompare'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import type { ProjectSessionSnapshot } from '../session/ProjectSession'
import { BrowserProfileError } from './browserProfileGuards'
import type { AppAddresses } from './browserNavigationPolicy'
import { BrowserTab, type BrowserTabCdpHook, type TabHost } from './BrowserTab'
import type { BrowserSite, TabSiteLink } from './permissions/BrowserSite'
import type { AnswerResult } from './permissions/tabStrip'

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
  /** Build the page view in `session` through `browserSessionRegistry.createView`. */
  readonly createView: (session: Session) => WebContentsView
  /** `browserSessionRegistry.expectDevTools`. */
  readonly expectDevTools: (session: Session) => () => void
  readonly appAddresses: () => AppAddresses
  readonly resolveDomain: RegistrableDomainResolver
  readonly attachCdp?: BrowserTabCdpHook
  /** Permission prompts, notices and downloads; without it the session policy refuses them. */
  readonly site?: Pick<BrowserSite, 'attachTab' | 'showDownload'>
}

/** Mints `browser-tab-<n>`, the id shape `BrowserTabIdSchema` accepts. */
const MAX_TAB_COUNTER = 999_999_999

export class BrowserTabService {
  private readonly tabs = new Map<string, BrowserTab>()
  private readonly hostOf = new WeakMap<BrowserTab, TabHost>()
  private readonly siteOf = new WeakMap<BrowserTab, TabSiteLink>()
  private counter = 0

  constructor(private readonly deps: BrowserTabServiceDeps) {}

  /** Open an empty tab for `panelId` in `host`, or say why it cannot open. */
  async create(host: TabHost, panelId: string): Promise<CreateResponse> {
    let profile: TabProfile
    try {
      profile = await this.deps.openProfile()
    } catch (error) {
      logger.error('Browser tab could not open its profile', redactedLogError(error))
      return { error: error instanceof BrowserProfileError ? error.message : 'The browser could not start for this project' }
    }
    if (host.isDestroyed()) return { error: 'The window closed' }
    const project = this.deps.currentProject()
    if (project === null || !isSamePath(project.realRoot, profile.projectRoot, project.caseSensitive)) {
      return { error: 'The project changed while the browser was starting' }
    }
    const tab = this.openTab(host, panelId, profile, project.caseSensitive)
    // The empty tab's first state: no address, Back and Forward disabled.
    this.sendState(tab)
    return { tabId: tab.id }
  }

  /**
   * A tab the page in `openerTabId` opened, created in main under the `page`
   * source and announced to the owning window (S2). Returns the new tab's id,
   * or `null` when the opener is gone or `url` is refused.
   */
  createFromPage(openerTabId: string, url: string, background: boolean): string | null {
    const opener = this.tabs.get(openerTabId)
    if (opener === undefined || opener.contents.isDestroyed()) return null
    const host = this.hostOf.get(opener)
    if (host === undefined || host.isDestroyed()) return null
    const profile: TabProfile = { projectRoot: opener.projectRoot, session: opener.contents.session }
    const tab = this.openTab(host, null, profile, opener.caseSensitive)
    const result = tab.navigateForPage(url)
    if ('refused' in result) {
      this.closeTab(tab)
      return null
    }
    this.send(host, BROWSER_TAB_EVENTS.tabAdded, TabAddedEventSchema, { tabId: tab.id, openerTabId, background })
    return tab.id
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
  answerStrip(windowId: number, tabId: string, requestId: string, answer: StripAnswer): AnswerResult | null {
    const tab = this.tabOf(windowId, tabId)
    if (tab === null) return null
    return this.siteOf.get(tab)?.answerStrip(requestId, answer) ?? 'unknown'
  }

  /** **Show in folder** for a download announced to `windowId`. */
  showDownload(windowId: number, downloadId: string): boolean {
    return this.deps.site?.showDownload(windowId, downloadId) ?? false
  }

  /** Every live tab, for the test hooks. */
  list(): readonly BrowserTab[] {
    return [...this.tabs.values()]
  }

  /** Close `tabId` when `windowId` owns it. */
  close(windowId: number, tabId: string): void {
    const tab = this.tabOf(windowId, tabId)
    if (tab !== null) this.closeTab(tab)
  }

  /** Close every tab of a window that is closing. */
  closeWindow(windowId: number): void {
    for (const tab of this.list()) if (tab.windowId === windowId) this.closeTab(tab)
  }

  /** Close every tab of the project at `projectRoot` (teardown stage `closeViews`). */
  closeProject(projectRoot: string): void {
    for (const tab of this.list()) {
      if (isSamePath(tab.projectRoot, projectRoot, tab.caseSensitive)) this.closeTab(tab)
    }
  }

  private openTab(host: TabHost, panelId: string | null, profile: TabProfile, caseSensitive: boolean): BrowserTab {
    const session = profile.session as Session
    this.deps.prepareSession(session)
    const view = this.deps.createView(session)
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
      attachCdp: this.deps.attachCdp,
      onStateChange: (changed) => this.sendState(changed),
      onDestroyed: (gone) => this.forget(gone)
    })
    this.tabs.set(tab.id, tab)
    this.hostOf.set(tab, host)
    const site = this.deps.site?.attachTab(tab, {
      strip: (event) => this.send(host, BROWSER_TAB_EVENTS.strip, StripEventSchema, event),
      notice: (event) => this.send(host, BROWSER_TAB_EVENTS.notice, NoticeEventSchema, event),
      parentWindow: () => (host.isDestroyed() ? null : host)
    })
    if (site !== undefined) this.siteOf.set(tab, site)
    return tab
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
    if (this.tabs.get(tab.id) === tab) this.tabs.delete(tab.id)
    this.siteOf.get(tab)?.detach()
    this.siteOf.delete(tab)
  }

  private sendState(tab: BrowserTab): void {
    const host = this.hostOf.get(tab)
    if (host !== undefined) this.send(host, BROWSER_TAB_EVENTS.state, TabStateEventSchema, tab.state())
  }

  /** Send `payload` to the owning window only, after checking it against its schema. */
  private send(
    host: TabHost,
    channel: string,
    schema: { safeParse(value: unknown): { success: boolean } },
    payload: unknown
  ): void {
    if (host.isDestroyed() || host.webContents.isDestroyed()) return
    if (!schema.safeParse(payload).success) {
      logger.error('Dropped a browser tab event that does not match its schema', undefined, { channel })
      return
    }
    host.webContents.send(channel, payload)
  }
}
