// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Site requests of the browser tabs, main side (spec 025, 025-FR-019,
 * 025-FR-020, 025-FR-054; solution design § 3.3 step 3, § 3.5; ADR 0009
 * decision 7).
 *
 * One instance per process. It is the `site` of two owners:
 *
 * - **The sessions.** `browserSessionPolicy.hardenBrowserSession` sends every
 *   permission request and check, every screen-sharing request and every
 *   download of a browser session here (`SessionSiteHooks`).
 *   Each is matched to its tab by `webContents`; one that no tab owns (the
 *   DevTools front end, a page this module does not know) is refused.
 * - **The tabs.** `BrowserTabService` attaches each tab
 *   ({@link BrowserSite.attachTab}) with an outlet to the owning window. The
 *   tab gets its strip (`TabStrip`), its permission broker (`TabPermissions`)
 *   and its download counters. A committed main-frame navigation or a crash
 *   withdraws the strip's prompts (denied) and starts a new page load; the
 *   tab's `destroyed` or {@link TabSiteLink.detach} withdraws them for good.
 *
 * What is decided where:
 *
 * - `allow` permissions are granted, `deny` ones refused, by the class table
 *   of `browserSessionPolicy` – no prompt either way;
 * - `allowWithNotice` (fullscreen, pointer lock) is granted to a tab and
 *   shows the 4-second notice naming the origin; refused anywhere else;
 * - `ask` permissions go to the tab's broker, which saves decisions in the
 *   project's {@link BrowserPermissionStore} (signed file, or memory only
 *   with no signing key);
 * - screen sharing is asked for like a permission and never saved; once
 *   allowed, the source chooser (`chooseScreenSource`) picks the stream.
 *   With no chooser wired, screen sharing is refused without a prompt.
 */
import type { Streams, WebContents, WebFrameMain } from 'electron'
import type { Clock } from '../../../../shared/clock'
import { formatOrigin, originParts, type RegistrableDomainResolver } from '../../../../shared/browser/originFormat'
import type { NoticeEvent, StripAnswer, StripEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import type { PurposeSigner } from '../browserProfileMarker'
import { permissionClass, type SessionSiteHooks } from '../browserSessionPolicy'
import { BrowserDownloads, type BrowserDownloadsDeps, type DownloadItemLike, type DownloadLoad, type DownloadTab } from '../downloads/BrowserDownloads'
import { BrowserPermissionStore } from './permissionStore'
import { lockNoticeText, requestingOrigin, siteOrigin, sitePermissionsFor, type PermissionRequestDetails } from './sitePermissions'
import { TabPermissions, type OriginDisplay, type PermissionAsk } from './tabPermissions'
import { TabStrip, type AnswerResult } from './tabStrip'

/** What the site needs of a tab. */
export interface SiteTabRef {
  readonly id: string
  readonly windowId: number
  /** The project's canonical root: the permission store is per project. */
  readonly projectRoot: string
  readonly contents: WebContents
}

/** Where a tab's site events go: the window that owns the tab. */
export interface TabSiteOutlet {
  strip(event: StripEvent): void
  notice(event: NoticeEvent): void
  /** The window a modal dialog belongs to; `null` once it closed. */
  parentWindow(): unknown
}

/** What the tab service holds for an attached tab. */
export interface TabSiteLink {
  /** `browser-tab:answerStrip`, after the handler checked the sender owns the tab. */
  answerStrip(requestId: string, answer: StripAnswer): AnswerResult
  /** The tab closed: its prompts are withdrawn (denied). */
  detach(): void
}

export interface BrowserSiteDeps {
  readonly clock: Clock
  readonly signer: PurposeSigner
  readonly resolveDomain: RegistrableDomainResolver
  readonly downloads: BrowserDownloadsDeps
  /** `webContents.fromFrame`: the page a screen-sharing request's frame belongs to. */
  readonly fromFrame: (frame: WebFrameMain) => WebContents | null | undefined
  /** The screen and window chooser shown after **Allow**; absent until it exists (screen sharing refused). */
  readonly chooseScreenSource?: (tabId: string, request: { securityOrigin: string }) => Promise<Streams | null>
  /** Mints strip row ids; random by default. */
  readonly newRowId?: () => string
}

interface AttachedTab {
  readonly ref: SiteTabRef
  readonly strip: TabStrip
  readonly load: DownloadLoad
  readonly downloadTab: DownloadTab
  readonly ready: Promise<TabPermissions>
  permissions: TabPermissions | null
  open: boolean
  readonly unlisten: () => void
}

export class BrowserSite implements SessionSiteHooks {
  private readonly tabs = new Map<number, AttachedTab>()
  private readonly stores = new Map<string, Promise<BrowserPermissionStore>>()
  private readonly downloads: BrowserDownloads
  private readonly display: OriginDisplay

  constructor(private readonly deps: BrowserSiteDeps) {
    this.downloads = new BrowserDownloads(deps.downloads)
    this.display = {
      text: (origin) => formatOrigin(origin, deps.resolveDomain) ?? origin,
      parts: (origin) => originParts(origin, deps.resolveDomain)
    }
  }

  /** Attach a new tab, before its first page loads. */
  attachTab(ref: SiteTabRef, outlet: TabSiteOutlet): TabSiteLink {
    const strip = new TabStrip({ tabId: ref.id, clock: this.deps.clock, emit: (e) => outlet.strip(e), newId: this.deps.newRowId })
    const load: DownloadLoad = { started: 0, decision: null }
    const contents = ref.contents
    const newLoad = (): void => this.newLoad(ref.contents.id)
    const crashed = (): void => strip.withdrawAll()
    const destroyed = (): void => this.detach(ref.contents.id)
    contents.on('did-navigate', newLoad)
    contents.on('render-process-gone', crashed)
    contents.once('destroyed', destroyed)
    const entry: AttachedTab = {
      ref,
      strip,
      load,
      permissions: null,
      open: true,
      ready: this.storeFor(ref.projectRoot).then((store) => {
        const permissions = new TabPermissions({ strip, store, display: this.display })
        entry.permissions = permissions
        return permissions
      }),
      downloadTab: {
        tabId: ref.id,
        windowId: ref.windowId,
        strip,
        load,
        isOpen: () => entry.open,
        requester: () => this.requesterOf(siteOrigin(entry.open ? contents.getURL() : null)),
        notice: (event) => outlet.notice(event),
        parentWindow: () => outlet.parentWindow()
      },
      unlisten: () => {
        if (contents.isDestroyed()) return
        contents.off('did-navigate', newLoad)
        contents.off('render-process-gone', crashed)
        contents.off('destroyed', destroyed)
      }
    }
    this.tabs.set(contents.id, entry)
    return {
      answerStrip: (requestId, answer) => (entry.open ? strip.answer(requestId, answer) : 'unknown'),
      detach: () => this.detach(contents.id)
    }
  }

  permissionRequest(
    contents: WebContents,
    permission: string,
    callback: (granted: boolean) => void,
    details: PermissionRequestDetails
  ): void {
    const cls = permissionClass(permission)
    if (cls === 'allow' || cls === 'deny') {
      if (cls === 'deny') logger.debug('Browser permission denied', { permission, path: 'request' })
      callback(cls === 'allow')
      return
    }
    const tab = this.tabs.get(contents.id)
    if (tab === undefined || !tab.open) {
      callback(false)
      return
    }
    if (cls === 'allowWithNotice') {
      callback(true)
      const origin = requestingOrigin(details) ?? siteOrigin(contents.getURL())
      const kind = permission === 'fullscreen' ? 'fullscreen' : 'pointerLock'
      if (origin !== null) tab.strip.notice(kind, lockNoticeText(kind, this.display.text(origin)), this.requesterOf(origin))
      return
    }
    const ask = this.askOf(contents, sitePermissionsFor(permission, details), requestingOrigin(details))
    if (ask === null) {
      callback(false)
      return
    }
    void tab.ready.then(
      (permissions) => permissions.request(ask, callback),
      () => callback(false)
    )
  }

  permissionCheck(
    contents: WebContents | null,
    permission: string,
    requesting: string,
    details: { embeddingOrigin?: string; mediaType?: 'video' | 'audio' | 'unknown' }
  ): boolean {
    const cls = permissionClass(permission)
    if (cls === 'allow' || cls === 'deny') return cls === 'allow'
    const tab = contents === null ? undefined : this.tabs.get(contents.id)
    if (contents === null || tab === undefined || !tab.open) return false
    if (cls === 'allowWithNotice') return true
    const mediaTypes = details.mediaType === 'video' || details.mediaType === 'audio' ? [details.mediaType] : []
    const top = siteOrigin(details.embeddingOrigin) ?? siteOrigin(contents.getURL())
    const from = siteOrigin(requesting)
    const permissions = sitePermissionsFor(permission, { mediaTypes })
    if (top === null || from === null || tab.permissions === null) return false
    return tab.permissions.check({ requesting: from, top, permissions })
  }

  displayMediaRequest(
    request: { frame: WebFrameMain | null; securityOrigin: string },
    callback: (streams: Streams | null) => void
  ): void {
    const choose = this.deps.chooseScreenSource
    const contents = request.frame === null ? null : (this.deps.fromFrame(request.frame) ?? null)
    const tab = contents === null ? undefined : this.tabs.get(contents.id)
    const ask = contents === null ? null : this.askOf(contents, ['screen'], siteOrigin(request.securityOrigin))
    if (choose === undefined || tab === undefined || !tab.open || ask === null) {
      callback(null)
      return
    }
    void tab.ready
      .then(
        (permissions) =>
          new Promise<boolean>((resolve) => {
            permissions.request(ask, resolve)
          })
      )
      .then((granted) => (granted ? choose(tab.ref.id, { securityOrigin: request.securityOrigin }) : null))
      .then(callback, (error: unknown) => {
        logger.warn('Screen sharing failed', { error: String(error) })
        callback(null)
      })
  }

  willDownload(event: { preventDefault(): void }, item: DownloadItemLike, contents: WebContents): void {
    const tab = this.tabs.get(contents.id)
    this.downloads.willDownload(event, item, tab === undefined || !tab.open ? null : tab.downloadTab)
  }

  /** **Show in folder** (`browser-tab:showDownload`) from `windowId`. */
  showDownload(windowId: number, downloadId: string): boolean {
    return this.downloads.showInFolder(windowId, downloadId)
  }

  /** Forget the saved permissions of the project at `projectRoot` (025-FR-023). Never rejects. */
  async clearPermissions(projectRoot: string): Promise<void> {
    const store = this.stores.get(projectRoot)
    if (store !== undefined) await (await store).clear()
  }

  private askOf(contents: WebContents, permissions: PermissionAsk['permissions'], requesting: string | null): PermissionAsk | null {
    const top = siteOrigin(contents.getURL())
    if (permissions.length === 0 || requesting === null || top === null) return null
    return { requesting, top, permissions }
  }

  private requesterOf(origin: string | null): StripRow['requester'] | undefined {
    if (origin === null) return undefined
    const parts = this.display.parts(origin)
    return parts === null ? undefined : { origin: parts, inside: null }
  }

  private storeFor(projectRoot: string): Promise<BrowserPermissionStore> {
    let store = this.stores.get(projectRoot)
    if (store === undefined) {
      store = BrowserPermissionStore.open(projectRoot, this.deps.signer)
      this.stores.set(projectRoot, store)
    }
    return store
  }

  private newLoad(contentsId: number): void {
    const tab = this.tabs.get(contentsId)
    if (tab === undefined) return
    tab.strip.withdrawAll()
    tab.permissions?.newLoad()
    tab.load.started = 0
    tab.load.decision = null
  }

  private detach(contentsId: number): void {
    const tab = this.tabs.get(contentsId)
    if (tab === undefined) return
    this.tabs.delete(contentsId)
    tab.open = false
    tab.unlisten()
    tab.strip.dispose()
  }
}
