// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * New tabs, popup windows and the popup blocker of every browser tab, main
 * side (spec 025, 025-FR-011, 025-FR-023; ADR 0011 decision 9; commit 12e).
 *
 * One instance per process:
 *
 * - **Per tab** ({@link BrowserPopups.attachTab}): the tab's window-open
 *   policy (`TabWindowOpen.ts`) – the handler for its page and for each of
 *   its popups, its "Pop-up blocked" row and its open rate.
 * - **Popup windows** (`BrowserPopupWindow.ts`), by the id of their host
 *   window's renderer, so the `browser-tab:popup*` handlers find the popup
 *   from the sender alone. A tab's popups close when the tab closes.
 * - **Pop-up exceptions per project** (`popupExceptionStore.ts`), opened when
 *   the project's first tab attaches and cleared by Clear and Forget.
 */
import type { WebContents } from 'electron'
import type { Clock } from '../../../../shared/clock'
import type { RegistrableDomainResolver } from '../../../../shared/browser/originFormat'
import type { StripAnswer, StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import type { AppAddresses } from '../browserNavigationPolicy'
import type { PurposeSigner } from '../browserProfileMarker'
import type { AnswerResult } from '../permissions/tabStrip'
import { BrowserPopupWindow, type BrowserPopupWindowDeps, type PopupContents } from './BrowserPopupWindow'
import { PopupExceptionStore } from './popupExceptionStore'
import { TabWindowOpen, type OpenerContents, type PopupRequest, type WindowOpenHandler } from './TabWindowOpen'
import type { Size } from './windowFeatures'

/** What a popup window needs from the app (`browserAppSetup.ts` builds the Electron parts). */
export type PopupWindowFactory = Pick<
  BrowserPopupWindowDeps,
  'createHost' | 'createView' | 'registerHost' | 'attachCdp' | 'stripHeight' | 'originMinWidth'
> & {
  /** The work area of the screen the opening page's window is on. */
  readonly workArea: (tabId: string) => Size
}

export interface BrowserPopupsDeps {
  readonly clock: Pick<Clock, 'now'>
  readonly signer: PurposeSigner
  readonly homeDir: string
  readonly resolveDomain: RegistrableDomainResolver
  readonly appAddresses: () => AppAddresses
  readonly isLocalAddress: (url: string) => boolean
  readonly expectPageWindow: (session: object) => () => void
  readonly isRegisteredView: (contents: WebContents) => boolean
  readonly childPreferences: () => Record<string, unknown>
  readonly windows: PopupWindowFactory
  /** Runs `fn` after the current open settled; `setTimeout(fn, 0)` by default. */
  readonly defer?: (fn: () => void) => void
  readonly newRowId?: () => string
}

/** The tab a policy is attached to. */
export interface PopupTabRef {
  readonly id: string
  readonly projectRoot: string
}

/** Where a tab's opens go: its strip, and its page-opened tabs (`BrowserTabService.createFromPage`). */
export interface PopupTabOutlet {
  strip(event: StripEvent): void
  openTab(url: string, background: boolean, adopt: WebContents | null): boolean
}

/** What the tab service holds for an attached tab. */
export interface TabPopupLink {
  /** The handler for the tab's own page; call `startTracking` once its input routers attached. */
  handlerFor(contents: OpenerContents): { handler: WindowOpenHandler; startTracking: () => void }
  answerStrip(requestId: string, answer: StripAnswer): AnswerResult | null
  /** The tab's page committed a new document. */
  newDocument(): void
  /** The tab closed: its popups close, its row goes. */
  detach(): void
}

export class BrowserPopups {
  private readonly stores = new Map<string, Promise<PopupExceptionStore>>()
  private readonly loaded = new Map<string, PopupExceptionStore>()
  private readonly popupsByHost = new Map<number, BrowserPopupWindow>()

  constructor(private readonly deps: BrowserPopupsDeps) {}

  /** Attach a new tab's window-open policy, before its first page loads. */
  attachTab(tab: PopupTabRef, outlet: PopupTabOutlet): TabPopupLink {
    void this.storeFor(tab.projectRoot)
    const open: TabWindowOpen = new TabWindowOpen({
      tabId: tab.id,
      clock: this.deps.clock,
      resolveDomain: this.deps.resolveDomain,
      appAddresses: this.deps.appAddresses,
      isLocalAddress: this.deps.isLocalAddress,
      isExcepted: (origin) => this.loaded.get(tab.projectRoot)?.allows(origin) ?? false,
      saveException: (origin) => {
        void this.storeFor(tab.projectRoot).then((store) => store.add(origin))
      },
      expectPageWindow: this.deps.expectPageWindow,
      isRegisteredView: this.deps.isRegisteredView,
      defer: this.deps.defer ?? ((fn) => void setTimeout(fn, 0)),
      childPreferences: this.deps.childPreferences,
      openTab: (url, background, adopt) => outlet.openTab(url, background, adopt),
      openPopup: (request) => this.openPopup(tab.id, request, open),
      emitStrip: (event) => outlet.strip(event),
      newRowId: this.deps.newRowId
    })
    return {
      handlerFor: (contents) => open.handlerFor(contents, false),
      answerStrip: (requestId, answer) => open.answerStrip(requestId, answer),
      newDocument: () => open.newDocument(),
      detach: () => {
        open.detach()
        for (const popup of this.popupsOf(tab.id)) popup.close()
      }
    }
  }

  /** The popup whose host window's renderer is `webContentsId` (a `browser-tab:popup*` sender). */
  popupByHost(webContentsId: number): BrowserPopupWindow | null {
    return this.popupsByHost.get(webContentsId) ?? null
  }

  /** The open popups of `tabId`. */
  popupsOf(tabId: string): BrowserPopupWindow[] {
    return [...this.popupsByHost.values()].filter((p) => p.openerTabId === tabId)
  }

  /** Every open popup, for the test hooks. */
  list(): readonly BrowserPopupWindow[] {
    return [...this.popupsByHost.values()]
  }

  /** Forget the pop-up exceptions of the project at `projectRoot` (025-FR-023). Never rejects. */
  async clearExceptions(projectRoot: string): Promise<void> {
    const store = this.stores.get(projectRoot)
    if (store !== undefined) await (await store).clear()
  }

  private storeFor(projectRoot: string): Promise<PopupExceptionStore> {
    let store = this.stores.get(projectRoot)
    if (store === undefined) {
      store = PopupExceptionStore.open(projectRoot, this.deps.homeDir, this.deps.signer)
      void store.then((opened) => this.loaded.set(projectRoot, opened))
      this.stores.set(projectRoot, store)
    }
    return store
  }

  private openPopup(tabId: string, request: PopupRequest, open: TabWindowOpen): void {
    const windows = this.deps.windows
    // The host's id is read once: a destroyed webContents cannot be asked for it.
    let hostId: number | null = null
    try {
      const popup = new BrowserPopupWindow({
        openerTabId: tabId,
        openerUrl: request.openerUrl,
        contents: request.contents as unknown as PopupContents,
        features: request.features,
        workArea: () => windows.workArea(tabId),
        stripHeight: windows.stripHeight,
        originMinWidth: windows.originMinWidth,
        resolveDomain: this.deps.resolveDomain,
        appAddresses: this.deps.appAddresses,
        isLocalAddress: this.deps.isLocalAddress,
        createHost: windows.createHost,
        createView: windows.createView,
        registerHost: windows.registerHost,
        attachCdp: windows.attachCdp,
        windowOpenHandler: (contents) => open.handlerFor(contents as unknown as OpenerContents, true).handler,
        onClosed: (gone) => {
          if (hostId !== null && this.popupsByHost.get(hostId) === gone) this.popupsByHost.delete(hostId)
        }
      })
      hostId = popup.host.webContents.id
      this.popupsByHost.set(hostId, popup)
    } catch (error) {
      logger.error('A popup window could not open', error instanceof Error ? error : undefined)
      if (!request.contents.isDestroyed()) request.contents.close({ waitForBeforeUnload: false })
    }
  }
}
