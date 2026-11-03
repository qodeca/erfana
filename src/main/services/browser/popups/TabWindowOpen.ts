// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The window-open policy of one browser tab and the popups it opened (spec
 * 025, 025-FR-011; solution design § 3.5 `browserWindowOpen`, § 3.4; spec
 * changes S-7, S-22, S-30).
 *
 * Every `window.open`, `target="_blank"` link, middle-click and form with a
 * target reaches the page's window-open handler, which this module builds:
 *
 * 1. **Address** under the `page` source (`browserNavigationPolicy`):
 *    `http`/`https`, or `about:blank` for a new window; a served local folder
 *    is never opened by a page (S-7). Anything else is refused, with no row.
 * 2. **Popup blocker** (rule 3): the page needs an unused user activation
 *    and room in the tab's rate (`popupActivation.ts`), unless its site has
 *    a pop-up exception (**Always allow for this site**). A blocked open
 *    shows "Pop-up blocked" in the tab's strip (`popupBlockedRow.ts`).
 * 3. **Tab or window** (rules 1–2, S-30). The handler cannot tell a
 *    `target="_blank"` link from an opener-keeping `window.open(url)`: both
 *    arrive as `foreground-tab` with no features (measured on Electron 44).
 *    So an allowed open lets Chromium create the `webContents` (expected by
 *    the session registry), and `createWindow` decides by what Chromium
 *    created: no `window.opener` (`noopener`, `noreferrer`, a link – links
 *    imply `noopener` – or a middle-click) → a **tab**, adopting that
 *    `webContents` (`BrowserTabService.createFromPage`); an opener kept → a
 *    **popup window** (`BrowserPopupWindow`). The child's settings are the
 *    frozen browser settings, set through `overrideBrowserWindowOptions`
 *    (025-NFR-001), so features cannot loosen them.
 *
 * A popup's own opens follow the same rules, with the opening tab's rate and
 * strip; their tabs open as page-opened tabs of that tab.
 */
import type { HandlerDetails, WebContents, WindowOpenHandlerResponse } from 'electron'
import type { Clock } from '../../../../shared/clock'
import { originParts, type RegistrableDomainResolver } from '../../../../shared/browser/originFormat'
import type { StripAnswer, StripEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import { checkNavigation, type AppAddresses } from '../browserNavigationPolicy'
import { siteOrigin } from '../permissions/sitePermissions'
import type { AnswerResult } from '../permissions/tabStrip'
import { ActivationTracker, OpenRateLimit, type ActivationContents } from './popupActivation'
import { PopupBlockedRow, type BlockedOpen } from './popupBlockedRow'
import { parseWindowFeatures, type WindowFeatures } from './windowFeatures'

/** The address a new window may start at besides `http`/`https` (025-FR-005 rule 4). */
const NEW_WINDOW_BLANK = 'about:blank'

/** The page `webContents` an open comes from. */
export interface OpenerContents extends ActivationContents {
  readonly session: object
  getURL(): string
}

/** An open that becomes a popup window. */
export interface PopupRequest {
  readonly contents: WebContents
  readonly features: WindowFeatures
  /**
   * Who opened it, named in the popup's title and strip until its first
   * commit: the origin of the frame that called `window.open` (a frame
   * inside the page names itself, not the top page), or the page's address
   * when Chromium gives no frame. `"null"` for an opaque-origin frame.
   */
  readonly openerUrl: string
}

/** The origin of the frame that opened `created`, else the opener page's address. */
function openingOrigin(created: WebContents, opener: OpenerContents): string {
  let origin: unknown
  try {
    origin = created.opener?.origin
  } catch {
    // A frame already disposed throws on access; the page's address still names the opener.
    origin = null
  }
  return typeof origin === 'string' && origin !== '' ? origin : opener.getURL()
}

export interface TabWindowOpenDeps {
  readonly tabId: string
  readonly clock: Pick<Clock, 'now'>
  readonly resolveDomain: RegistrableDomainResolver
  readonly appAddresses: () => AppAddresses
  readonly isLocalAddress: (url: string) => boolean
  /** Whether the site `origin` has a pop-up exception; false until the project's store loaded. */
  readonly isExcepted: (origin: string) => boolean
  /** **Always allow for this site**. */
  readonly saveException: (origin: string) => void
  /** `browserSessionRegistry.expectPageWindow`. */
  readonly expectPageWindow: (session: object) => () => void
  /** `browserSessionRegistry.isRegisteredView`. */
  readonly isRegisteredView: (contents: WebContents) => boolean
  /** Runs `fn` after the current open settled (withdraws an unused expectation). */
  readonly defer: (fn: () => void) => void
  /** The frozen browser settings for a page-opened `webContents` (no session: it shares the opener's). */
  readonly childPreferences: () => Record<string, unknown>
  /**
   * Open a page-opened tab of this tab: `adopt` is the `webContents` Chromium
   * created (it loads `url` itself), or `null` to create one that loads `url`.
   * Returns whether a tab opened.
   */
  readonly openTab: (url: string, background: boolean, adopt: WebContents | null) => boolean
  readonly openPopup: (request: PopupRequest) => void
  readonly emitStrip: (event: StripEvent) => void
  readonly newRowId?: () => string
}

export type WindowOpenHandler = (details: HandlerDetails) => WindowOpenHandlerResponse

export class TabWindowOpen {
  private readonly rate: OpenRateLimit
  private readonly row: PopupBlockedRow
  private readonly trackers: ActivationTracker[] = []

  constructor(private readonly deps: TabWindowOpenDeps) {
    this.rate = new OpenRateLimit(deps.clock)
    this.row = new PopupBlockedRow({
      tabId: deps.tabId,
      clock: deps.clock,
      emit: deps.emitStrip,
      newId: deps.newRowId,
      openOnce: (open) => {
        if (!deps.openTab(open.url, false, null)) logger.warn('A blocked pop-up could not be opened')
      },
      alwaysAllow: (origin) => {
        if (origin !== '') deps.saveException(origin)
      }
    })
  }

  /**
   * The handler for `contents` (the tab's page, or one of its popups), with
   * its own activation tracker. `track` starts counting presses at once; a
   * tab passes `false` and calls {@link startTracking} after its input
   * routers attached, so a press they drop is not counted.
   */
  handlerFor(contents: OpenerContents, track: boolean): { handler: WindowOpenHandler; startTracking: () => void } {
    const tracker = new ActivationTracker(this.deps.clock)
    this.trackers.push(tracker)
    const startTracking = (): void => tracker.listen(contents)
    if (track) startTracking()
    return { handler: (details) => this.decide(details, contents, tracker), startTracking }
  }

  /** A strip answer; `null` when `requestId` is not the "Pop-up blocked" row. */
  answerStrip(requestId: string, answer: StripAnswer): AnswerResult | null {
    return this.row.answer(requestId, answer)
  }

  /** The tab's page committed a new document: the row goes. */
  newDocument(): void {
    this.row.hide()
  }

  /** The tab closed. */
  detach(): void {
    this.row.hide()
    for (const tracker of this.trackers.splice(0)) tracker.unlisten()
  }

  private decide(details: HandlerDetails, contents: OpenerContents, tracker: ActivationTracker): WindowOpenHandlerResponse {
    const url = details.url
    if (!this.addressAllowed(url)) {
      logger.warn('Refused a window a page tried to open', { disposition: details.disposition })
      return { action: 'deny' }
    }
    const site = siteOrigin(contents.getURL())
    const excepted = site !== null && this.deps.isExcepted(site)
    if (!excepted && !(tracker.isActive() && this.rate.hasRoom())) {
      logger.debug('Blocked a pop-up', { activated: tracker.isActive() })
      this.row.blocked(this.blockedOpen(url, site))
      return { action: 'deny' }
    }
    tracker.consume()
    this.rate.record()
    const features = parseWindowFeatures(details.features)
    const background = details.disposition === 'background-tab'
    this.deps.defer(this.deps.expectPageWindow(contents.session))
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: { show: false, webPreferences: this.deps.childPreferences() },
      createWindow: (options) => this.create(options, url, features, background, contents)
    }
  }

  /** `createWindow`: a tab when the new page has no opener, a popup window when it keeps one. */
  private create(options: object, url: string, features: WindowFeatures, background: boolean, opener: OpenerContents): WebContents {
    const created = (options as { webContents?: WebContents }).webContents
    if (created === undefined) throw new Error('A page-opened window arrived without its webContents')
    if (!this.deps.isRegisteredView(created)) {
      // The registry refused it and closes it; nothing is built around it.
      logger.error('A page-opened window was not registered as a browser view')
      return created
    }
    if (features.noopener || created.opener === null) {
      if (!this.deps.openTab(url, background, created)) created.close({ waitForBeforeUnload: false })
      return created
    }
    this.deps.openPopup({ contents: created, features, openerUrl: openingOrigin(created, opener) })
    return created
  }

  private addressAllowed(url: string): boolean {
    if (url === NEW_WINDOW_BLANK) return true
    if (this.deps.isLocalAddress(url)) return false
    return checkNavigation(url, 'page', 'main', this.deps.appAddresses()).allowed
  }

  private blockedOpen(url: string, site: string | null): BlockedOpen {
    const parts = site === null ? null : originParts(site, this.deps.resolveDomain)
    const requester: StripRow['requester'] = parts === null ? undefined : { origin: parts, inside: null }
    return { url, siteOrigin: site ?? '', requester }
  }
}
