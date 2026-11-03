// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page features of every browser tab in this process, project-wide side
 * (spec 025, 025-FR-008, 025-FR-012, 025-FR-023, 025-FR-063; solution design
 * § 3.5; commit 12h). Each tab's own side is `BrowserTabPage`.
 *
 * - **Zoom per site** (025-FR-008): a zoom step on one tab sets the level of
 *   its site in the project's `zoom.json` (`zoomStore.ts`) and applies it to
 *   every tab of that project on that site; a commit applies the site's
 *   level. A width preset change resets the site's level to 100% (025-FR-012).
 * - **History** (025-FR-063): every committed address of the project's tabs
 *   goes into its `history.json` (`historyStore.ts`); `suggest` matches it.
 * - **Clear browsing data** (025-FR-023) for the open project's session, then
 *   a reload of that project's open tabs – a pick menu or dialog closes
 *   without sending and without a notice; other projects' tabs never reload.
 * - **Forget** closes the project's tabs, clears the session and Erfana's
 *   in-memory decisions, then deletes `.erfana/browser/`.
 * - **Terminal addresses** (025-FR-063): local addresses printed in a
 *   terminal go to that terminal's window as `localAddressSeen` notices, for
 *   the empty tab; the list resets when the project changes.
 *
 * Stores are opened per project on the project's first tab – after the
 * profile service checked the profile – and kept for the run.
 */
import type { ZoomStep } from '../../../../shared/browser/zoomSteps'
import { nextZoomPercent, ZOOM_DEFAULT_PERCENT } from '../../../../shared/browser/zoomSteps'
import type { Clock } from '../../../../shared/clock'
import type { ClearDataCategory, ClearDataResponse, ForgetResponse } from '../../../../shared/ipc/browser-tab-page-schema'
import { BROWSER_SUGGEST_MAX_ROWS } from '../../../../shared/ipc/browser-tab-schema'
import { redactedLogError } from '../../../utils/redactUserInput'
import { logger } from '../../LoggingService'
import { BrowserProfileError } from '../browserProfileGuards'
import { CAPTURES_DIR_NAME } from '../browserProfilePaths'
import type { PurposeSigner } from '../browserProfileMarker'
import type { DeleteOutcome } from '../browserProfileDeletes'
import { clearBrowsingData, clearForForget, CLEAR_STEP_TIMEOUT_MS, type ClearableSession, type ClearTarget } from './browserClearData'
import { BrowserTabPage, type BrowserTabPageDeps, type PageHangSource, type PageTab, type TabPageOutlet } from './BrowserTabPage'
import { BrowserHistoryStore, suggestAddresses } from './historyStore'
import { TerminalLocalAddresses } from './terminalLocalAddressScan'
import { BrowserZoomStore, zoomKeyOf } from './zoomStore'

/** Erfana's own site decisions of a project, cleared with it (`permissions/BrowserSite.ts`). */
export interface SiteDecisions {
  clearCertificates(projectRoot: string): Promise<void>
  clearCredentials(projectRoot: string): Promise<void>
  clearPermissions(projectRoot: string): Promise<void>
}

/** The open project's profile, as `BrowserProfileService.openForTab` gives it. */
export interface PagesProfile {
  readonly projectRoot: string
  readonly session: object
}

export interface BrowserPagesDeps {
  readonly clock: Pick<Clock, 'now'>
  readonly signer: PurposeSigner
  /** The user's home folder, which holds each project's generation record. */
  readonly homeDir: string
  readonly site: SiteDecisions
  /** `BrowserProfileService.openForTab`: the open project's root and session. */
  readonly openProfile: () => Promise<PagesProfile>
  /** `BrowserProfileService.deleteBrowserData`. */
  readonly deleteBrowserData: (relBelowBrowser: readonly string[]) => Promise<DeleteOutcome>
  /** `BrowserTabService.closeProject`. */
  readonly closeProject: (projectRoot: string) => void
  /** Sends a `localAddressSeen` notice to the window whose renderer is `webContentsId`. */
  readonly noticeToRenderer?: (webContentsId: number, address: string) => void
  /** Mints strip row ids; random by default. */
  readonly newRowId?: () => string
  /** The clearing step timeout; a test seam. */
  readonly clearStepTimeoutMs?: number
}

/** A project's stores, opened once. */
interface ProjectStores {
  readonly zoom: Promise<BrowserZoomStore>
  readonly history: Promise<BrowserHistoryStore>
}

/** A test-build fault for one clearing step (`testHooks/browserPageHook.ts`). */
export type ClearFault = 'timeout' | 'fail'

const projectKey = (root: string, caseSensitive: boolean): string => (caseSensitive ? root : root.toLowerCase())

export class BrowserPages {
  private readonly pages = new Set<BrowserTabPage>()
  private readonly stores = new Map<string, ProjectStores>()
  private readonly terminalAddresses = new TerminalLocalAddresses()
  /** Faults the e2e hooks plant in clearing steps; empty outside tests. */
  readonly clearFaults = new Map<ClearDataCategory, ClearFault>()

  constructor(private readonly deps: BrowserPagesDeps) {}

  /** Attach a new tab's page features, before its first page loads. */
  attachTab(tab: PageTab, outlet: TabPageOutlet, hang: PageHangSource | null): BrowserTabPage {
    this.storesOf(tab.projectRoot, tab.caseSensitive)
    const deps: BrowserTabPageDeps = {
      tab,
      outlet,
      hang,
      clock: this.deps.clock,
      newRowId: this.deps.newRowId,
      site: { committed: (page) => this.committed(page), zoom: (page, step) => this.zoom(page, step) }
    }
    const page = new BrowserTabPage(deps)
    this.pages.add(page)
    return page
  }

  /** The tab closed. */
  detachTab(page: BrowserTabPage): void {
    page.detach()
    this.pages.delete(page)
  }

  /**
   * History rows for typed text (025-FR-063), most recent first; every row
   * for empty text (the empty tab shows the first 8). `[]` before the
   * project's first tab opened its stores.
   */
  async suggest(projectRoot: string, caseSensitive: boolean, typed: string): Promise<string[]> {
    const stores = this.stores.get(projectKey(projectRoot, caseSensitive))
    if (stores === undefined) return []
    return suggestAddresses((await stores.history).list(), typed, BROWSER_SUGGEST_MAX_ROWS)
  }

  /** **Clear browsing data** for the open project (025-FR-023). Never rejects. */
  async clearData(categories: ReadonlySet<ClearDataCategory>): Promise<ClearDataResponse> {
    let profile: PagesProfile
    try {
      profile = await this.deps.openProfile()
    } catch (error) {
      logger.error('Clear browsing data could not reach the project profile', redactedLogError(error))
      return { error: error instanceof BrowserProfileError ? error.message : 'The browser data could not be reached' }
    }
    const failed = await clearBrowsingData(categories, this.clearTarget(profile, true), this.timeoutMs())
    const siteDataCleared = categories.has('cookies') && !failed.some((f) => f.category === 'cookies')
    await Promise.all(this.projectPages(profile.projectRoot).map((page) => page.reloadAfterClear(siteDataCleared)))
    return { failed }
  }

  /** **Forget this project's browser data** (025-FR-023). Never rejects. */
  async forget(): Promise<ForgetResponse> {
    let profile: PagesProfile
    try {
      profile = await this.deps.openProfile()
    } catch (error) {
      logger.error('Forget could not reach the project profile', redactedLogError(error))
      return { error: error instanceof BrowserProfileError ? error.message : 'The browser data could not be reached', path: null }
    }
    this.deps.closeProject(profile.projectRoot)
    await clearForForget(this.clearTarget(profile, false), this.timeoutMs())
    await this.forgetStores(profile.projectRoot)
    try {
      return { deleted: await this.deps.deleteBrowserData([]) }
    } catch (error) {
      logger.error('Forget could not delete the browser folder', redactedLogError(error))
      if (error instanceof BrowserProfileError) return { error: error.message, path: error.relPath || null }
      return { error: 'The browser folder could not be deleted', path: null }
    }
  }

  /** One chunk of a terminal's output (`TerminalService` `data`), from the window whose renderer is `webContentsId`. */
  terminalOutput(webContentsId: number, terminalId: string, data: string): void {
    for (const address of this.terminalAddresses.scan(terminalId, data)) this.deps.noticeToRenderer?.(webContentsId, address)
  }

  /** A terminal ended: its unfinished line is dropped. */
  terminalGone(terminalId: string): void {
    this.terminalAddresses.terminalGone(terminalId)
  }

  /** The local addresses seen this run, first seen first. */
  localAddresses(): string[] {
    return this.terminalAddresses.list()
  }

  /** The project changed: the terminal addresses start over. */
  projectChanged(): void {
    this.terminalAddresses.reset()
  }

  private storesOf(projectRoot: string, caseSensitive: boolean): ProjectStores {
    const key = projectKey(projectRoot, caseSensitive)
    const existing = this.stores.get(key)
    if (existing !== undefined) return existing
    const { homeDir, signer } = this.deps
    const stores: ProjectStores = {
      zoom: BrowserZoomStore.open(projectRoot, homeDir, signer),
      history: BrowserHistoryStore.open(projectRoot, homeDir, signer)
    }
    this.stores.set(key, stores)
    return stores
  }

  private storesOfPage(page: BrowserTabPage): ProjectStores {
    return this.storesOf(page.tab.projectRoot, page.tab.caseSensitive)
  }

  /** A tab committed a document: record it, and apply its site's zoom level. */
  private committed(page: BrowserTabPage): void {
    const shown = page.shownUrl()
    const stores = this.storesOfPage(page)
    if (shown !== null) void stores.history.then((history) => history.record(shown))
    const site = zoomKeyOf(shown)
    if (site === null) {
      page.applyZoom(ZOOM_DEFAULT_PERCENT)
      return
    }
    void stores.zoom.then((zoom) => {
      if (this.pages.has(page) && zoomKeyOf(page.shownUrl()) === site) page.applyZoom(zoom.level(site))
    })
  }

  /** A zoom step on `page`: its site's level changes in every tab of the project on that site. */
  private zoom(page: BrowserTabPage, step: ZoomStep): void {
    const site = zoomKeyOf(page.shownUrl())
    const next = nextZoomPercent(page.facts().zoomPercent, step)
    if (site === null) {
      page.applyZoom(next)
      return
    }
    const sameSite = [...this.pages].filter(
      (other) => this.sameProject(other, page) && zoomKeyOf(other.shownUrl()) === site
    )
    for (const other of sameSite) other.applyZoom(next)
    void this.storesOfPage(page).zoom.then((zoom) => zoom.set(site, next))
  }

  private sameProject(a: BrowserTabPage, b: BrowserTabPage): boolean {
    return projectKey(a.tab.projectRoot, a.tab.caseSensitive) === projectKey(b.tab.projectRoot, b.tab.caseSensitive)
  }

  private projectPages(projectRoot: string): BrowserTabPage[] {
    return [...this.pages].filter((p) => projectKey(p.tab.projectRoot, p.tab.caseSensitive) === projectKey(projectRoot, p.tab.caseSensitive))
  }

  private async forgetStores(projectRoot: string): Promise<void> {
    for (const [key, stores] of [...this.stores]) {
      if (key !== projectKey(projectRoot, true) && key !== projectKey(projectRoot, false)) continue
      this.stores.delete(key)
      ;(await stores.zoom).forgetInMemory()
      ;(await stores.history).forgetInMemory()
    }
  }

  private clearTarget(profile: PagesProfile, withFaults: boolean): ClearTarget {
    const root = profile.projectRoot
    const site = this.deps.site
    const target: ClearTarget = {
      session: profile.session as ClearableSession,
      clearHistory: async () => {
        for (const [key, stores] of this.stores) {
          if (key === projectKey(root, true) || key === projectKey(root, false)) await (await stores.history).clear()
        }
      },
      clearPermissions: () => site.clearPermissions(root),
      clearCertificates: () => site.clearCertificates(root),
      clearCredentials: () => site.clearCredentials(root),
      deleteCaptures: () => this.deps.deleteBrowserData([CAPTURES_DIR_NAME])
    }
    return withFaults && this.clearFaults.size > 0 ? this.faulted(target) : target
  }

  /** `target` with the planted faults: a faulted kind's first step never settles or throws. */
  private faulted(target: ClearTarget): ClearTarget {
    const fault = (category: ClearDataCategory, step: () => Promise<void>) => (): Promise<void> => {
      const planted = this.clearFaults.get(category)
      if (planted === 'timeout') return new Promise<void>(() => undefined)
      if (planted === 'fail') return Promise.reject(new Error('planted clearing fault'))
      return step()
    }
    const session = target.session
    return {
      ...target,
      session: {
        clearStorageData: (options) => fault('cookies', () => session.clearStorageData(options))(),
        clearCache: fault('cache', () => session.clearCache()),
        clearAuthCache: () => session.clearAuthCache(),
        closeAllConnections: () => session.closeAllConnections()
      },
      clearPermissions: fault('permissions', target.clearPermissions),
      clearCredentials: fault('credentials', target.clearCredentials),
      deleteCaptures: fault('captures', async () => {
        await target.deleteCaptures()
      })
    }
  }

  private timeoutMs(): number {
    return this.deps.clearStepTimeoutMs ?? CLEAR_STEP_TIMEOUT_MS
  }
}
