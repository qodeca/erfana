// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview view lifecycle owner (Issue #74, work item 39; design §1.4, §5).
 *
 * The single-view MANAGER: it owns the "one live view, replace-not-refuse for the
 * same panel" policy (X20 + NEW-9), builds the sealed session (item 38) and the
 * per-view failure log, then delegates all per-view behaviour to `PreviewLiveView`
 * (bounds/pipeline/swap/lifecycle/teardown live there so each file stays under the
 * 500-line cap).
 *
 *  - Every panel may hold its OWN live view (sd-074b D5). A second `open` with
 *    the SAME panelId replaces (a main-renderer reload cannot strand the view
 *    and lock out opens); the same panelId from a DIFFERENT window is refused
 *    with `PREVIEW_VIEW_LIMIT_REACHED`, because panel ids are path-derived and
 *    would otherwise collide across windows.
 *  - At most `PREVIEW.MAX_LIVE_VIEWS` run at once: opening beyond that suspends
 *    the least recently active preview to its still frame, and the renderer
 *    re-opens it when its tab is activated again.
 *  - `applyApprovedHosts` (§5(c)), `destroyAll` (AC21 global-off) and
 *    `onProjectChanged` (§5(f)) route through here to the single live view.
 *
 * Trust model: the previewed page is untrusted and reaches Erfana only through
 * the sealed session's chokepoints; the project path is resolved main-side
 * (`getProjectPath`), never taken from the renderer (NEW-8).
 */

import {
  mergeBlockedKinds,
  type PreviewBlockedKind
} from '../../../shared/ipc/previewBlockedKind'
import { ErrorCode } from '../../../shared/errors'
import { PREVIEW } from '../../../shared/constants'
import { logger } from '../LoggingService'
import type {
  PdfExportResult,
  PreviewBounds,
  PreviewEmitters,
  PreviewFailureType,
  PreviewOpenResult
} from '../../../shared/ipc/preview-types'
import type { IPreviewRootRegistry } from './PreviewRootRegistry'
import type { IPreviewStillFrameCache } from './PreviewStillFrameCache'
import type { IPreviewExportController } from './PreviewExportController'
import type { IPreviewWatchCoordinator } from './PreviewWatchCoordinator'
import type { IPreviewReloadPolicy, ReloadDecision } from './PreviewReloadPolicy'
import type {
  IPreviewFindController,
  PreviewFindCount,
  PreviewFindOptions
} from './PreviewFindController'
import type { IPreviewFailureLog, PreviewFailureEmit } from './PreviewFailureLog'
import type {
  IPreviewSessionFactory,
  PreviewSession,
  PreviewSessionLike,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import type { PreviewFileWatcherHandle } from './previewViewLifecycle'
import {
  PreviewLiveView,
  type PreviewLiveViewDeps,
  type PreviewWindowLike
} from './PreviewLiveView'
import { PreviewViewRegistry } from './PreviewViewRegistry'

export type { PreviewWindowLike } from './PreviewLiveView'

/**
 * One panel's ledger of what has been reported blocked, and at whose expense.
 *
 * TWO MAPS, ONE OBJECT, deliberately. They have to be cleared together — see
 * `applyApprovedHosts` — and a pair of parallel `Map`s on the service was an
 * invitation to clear one and forget the other, which would leave a hostname
 * that had spent its sub-budget before an approval unable to report anything
 * after the reload. Holding them in one record makes "clear the ledger" a single
 * act rather than a convention.
 */
interface PanelBlockedLedger {
  /** Blocked ORIGIN -> the kinds it has been refused for. */
  readonly kindsByOrigin: Map<string, PreviewBlockedKind[]>
  /** Hostname -> how many of its origins are already in `kindsByOrigin`. */
  readonly originsPerHost: Map<string, number>
}

/**
 * The hostname inside a reported blocked identity.
 *
 * The identity is normally an origin (`https://cdn.example.com:8443`), but not
 * always: `previewFilterDecision` still reports a bare hostname for an
 * `insecure-scheme` refusal, the filter's timeout sweep reports whatever
 * `hostOf` salvaged from the URL, and either can be the empty string. So this
 * has to accept both shapes rather than assume the origin form.
 *
 * `new URL` rather than string surgery on the last colon: an IPv6 authority is
 * `https://[::1]:8443`, and `lastIndexOf(':')` on that returns a host of
 * `[::1]` on a good day and `[:` on a bad one. Anything that does not parse is
 * already a bare hostname and is used as-is.
 */
function hostOfBlockedIdentity(identity: string): string {
  try {
    const { hostname } = new URL(identity)
    return hostname === '' ? identity : hostname
  } catch {
    return identity
  }
}

/** A `preview:open` request (mirrors `PreviewOpenRequestSchema`, §4.2). */
export interface PreviewOpenRequest {
  panelId: string
  filePath: string
  bounds: PreviewBounds
}

/** The public lifecycle surface (design §1.4 `IPreviewViewService`). */
export interface IPreviewViewService {
  open(req: PreviewOpenRequest, window: PreviewWindowLike): Promise<PreviewOpenResult>
  close(panelId: string): Promise<void>
  setBounds(panelId: string, bounds: PreviewBounds, seq: number, ack?: boolean): void
  setVisibility(panelId: string, visible: boolean, reason: string): Promise<void>
  reload(panelId: string, opts?: { ignoreCache?: boolean }): Promise<void>
  /** Zoom the previewed page by `step` levels, or back to 100% with `0`. */
  setZoom(panelId: string, step: number): Promise<void>
  /** Tear down every preview hosted by a window that is closing. */
  closeWindow(windowId: number): Promise<void>
  /**
   * Zoom whichever previewed page holds keyboard focus.
   *
   * @returns `true` when a preview took it, so the View menu falls through to
   * the host window only when none did.
   */
  zoomFocused(step: number): Promise<boolean>
  swapStylesheet(panelId: string, relPath: string): Promise<boolean>
  applyApprovedHosts(panelId: string, hosts: readonly string[]): Promise<void>
  destroyAll(reason: string): Promise<void>
  onProjectChanged(oldPath: string | null, newPath: string | null): Promise<void>
  dispose(): Promise<void>
}

/**
 * The find/export surface the find/export IPC handlers drive on the service.
 * Declared here in the service layer (not the ipc layer) so `PreviewViewService`
 * can `implements` it and the compiler verifies these methods — the handlers and
 * the graph import it from here rather than the other way around.
 */
export interface PreviewFindExportService {
  find(panelId: string, text: string, options: PreviewFindOptions): void
  stopFind(panelId: string): void
  exportPdf(panelId: string, suggestedName: string): Promise<PdfExportResult>
}

/**
 * Injected dependencies (design §4.4 `PreviewViewDeps`).
 *
 * Reconciliation with §4.4: the per-view collaborators (watch coordinator, reload
 * policy, find controller, failure log) are injected as FACTORIES, not instances,
 * because each binds to per-view data absent at service-construction time (a
 * coordinator to the new project's realRoot, a find controller to the new view's
 * webContents). The built modules ARE such factories, so this is the natural
 * wiring. `registry`, `getProjectPath` and `getAllowedHosts` are added because
 * §5(c)/§5(f)/§5(c-block) route through them and §4.4 omitted them.
 */
export interface PreviewViewDeps {
  readonly sessionFactory: IPreviewSessionFactory
  readonly registry: Pick<IPreviewRootRegistry, 'rebuildCsp' | 'revoke'>
  readonly stillFrameCache: IPreviewStillFrameCache
  readonly exportController: IPreviewExportController
  readonly storageSeal: { purge(session: PreviewSessionLike): Promise<void> }
  /**
   * The project's approved hosts, read main-side.
   *
   * A narrow reader rather than the whole allowlist store: this service only
   * needs to TELL the renderer what is approved, and handing it `approveHost`
   * would put the write path within reach of code that has no business writing.
   * Correct at install time because `PreviewSessionFactory.create` awaits
   * `allowlistStore.load()` as its very first step.
   */
  readonly getAllowedHosts: () => readonly string[]
  readonly emit: PreviewEmitters
  readonly createWatchCoordinator: (
    realRoot: string,
    onChanged: (paths: readonly string[]) => void
  ) => IPreviewWatchCoordinator
  readonly createReloadPolicy: (
    onDecision: (decision: ReloadDecision) => void
  ) => IPreviewReloadPolicy
  readonly createFindController: (
    wc: PreviewWebContentsHandle,
    onCount: (count: PreviewFindCount) => void
  ) => IPreviewFindController
  readonly createFailureLog: (onEmit: PreviewFailureEmit) => IPreviewFailureLog
  readonly createEntryWatcher: (
    filePath: string,
    handlers: { onChange(): void; onUnlink(): void; onError(error: unknown): void }
  ) => PreviewFileWatcherHandle
  readonly getProjectPath: () => string | null
  readonly getZoomFactor: () => number
  readonly now: () => number
  /** Read the entry HTML for the post-load pipeline; defaults to `fs.readFile`. */
  readonly readEntryHtml?: (filePath: string) => Promise<string>
  /** Route a forwarded accelerator (§1.9) to the renderer; defaults to a no-op. */
  readonly onForwardedShortcut?: (panelId: string, key: string) => void
  readonly platform?: NodeJS.Platform
  /** Hand a vetted external URL to the OS browser (sd-074b §5.5). */
  readonly openExternal?: (url: string) => Promise<void>
}

export class PreviewViewService implements IPreviewViewService, PreviewFindExportService {
  /** Live views plus the two-part staleness guard over them (sd-074b §4.2). */
  private readonly registry = new PreviewViewRegistry()
  /**
   * Page zoom per panel, surviving the view itself.
   *
   * A preview evicted by the live-view budget is torn down and rebuilt when its
   * tab returns, so a level held on the view would reset every time the reader
   * looked away.
   */
  /**
   * Per-panel record of what each blocked origin was refused for, and of how
   * much of the per-view budget each hostname has spent.
   *
   * Lives here rather than in `open()`'s closure only so `applyApprovedHosts`
   * can clear it across a reload. Entries are dropped with their panel.
   */
  private readonly blockedByPanel = new Map<string, PanelBlockedLedger>()

  private readonly zoomLevels = new Map<string, number>()
  private readonly liveViewDeps: PreviewLiveViewDeps

  constructor(private readonly deps: PreviewViewDeps) {
    // The subset a live view needs; the manager keeps `sessionFactory`,
    // `createFailureLog` and `getProjectPath` for `open`.
    this.liveViewDeps = {
      emit: deps.emit,
      stillFrameCache: deps.stillFrameCache,
      exportController: deps.exportController,
      registry: deps.registry,
      storageSeal: deps.storageSeal,
      createWatchCoordinator: deps.createWatchCoordinator,
      createReloadPolicy: deps.createReloadPolicy,
      createFindController: deps.createFindController,
      createEntryWatcher: deps.createEntryWatcher,
      getZoomFactor: deps.getZoomFactor,
      now: deps.now,
      readEntryHtml: deps.readEntryHtml,
      onForwardedShortcut: deps.onForwardedShortcut,
      platform: deps.platform,
      openExternal: deps.openExternal
    }
  }

  async open(req: PreviewOpenRequest, window: PreviewWindowLike): Promise<PreviewOpenResult> {
    const projectPath = this.deps.getProjectPath()
    if (projectPath === null) {
      return { ok: false, errorCode: ErrorCode.PROJECT_NOT_FOUND }
    }

    const { panelId } = req
    const existing = this.registry.entry(panelId)
    if (existing !== null && existing.windowId !== window.id) {
      // Same path, two windows, therefore the same panel id. Replacing would
      // destroy the other window's running view; refuse instead.
      return {
        ok: false,
        errorCode: ErrorCode.PREVIEW_VIEW_LIMIT_REACHED,
        holderPanelId: panelId
      }
    }

    // Claim the open. Every await below re-checks it, so a close, a project
    // switch, the global off-switch or a newer open for this panel makes this
    // one abandon rather than install a stale view.
    const claim = this.registry.claimOpen(panelId)

    if (existing !== null) {
      // Same panel, same window: replace. Remove BEFORE awaiting so a rejecting
      // teardown cannot strand the entry.
      this.registry.remove(panelId)
      await existing.view.teardown('immediate')
      if (this.registry.isStale(claim)) {
        return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED }
      }
    }

    const failureLog = this.deps.createFailureLog((failures, truncated) =>
      this.deps.emit.failuresChanged(panelId, failures, truncated)
    )

    // What each blocked ORIGIN has been refused FOR. One origin is commonly
    // refused for several things, and reporting only the first would label an
    // origin that will run scripts as "font".
    //
    // Held on the SERVICE, keyed by panel, not in this closure — because
    // `applyApprovedHosts` has to be able to clear it. See the comment there:
    // an approval reloads the page, the page is refused all over again, and a
    // dedupe map that outlived the reload would swallow every remaining host.
    const ledger: PanelBlockedLedger = {
      kindsByOrigin: new Map<string, PreviewBlockedKind[]>(),
      originsPerHost: new Map<string, number>()
    }
    this.blockedByPanel.set(panelId, ledger)

    const onBlocked = (
      kind: PreviewFailureType,
      // An ORIGIN from both feeds now — `previewFilterDecision` returns one as
      // its blocked identity and the CSP bridge reports the same shape — except
      // on the `insecure-scheme` and timeout paths, which still carry a bare
      // hostname. Named for what it can be rather than for the common case.
      originOrHost: string,
      _url: string,
      approvable: boolean,
      resourceKind: PreviewBlockedKind = 'other'
    ): void => {
      failureLog.record({
        type: kind,
        resourceUrlOrHost: originOrHost,
        reasonCode: ErrorCode.UNKNOWN_ERROR
      })

      // `mergeBlockedKinds` returns null only when the set is UNCHANGED, and
      // adding a kind to an empty set always changes it — so there is no
      // "first sighting" branch to write here. One used to exist and was
      // unreachable.
      const merged = mergeBlockedKinds(ledger.kindsByOrigin.get(originOrHost) ?? [], resourceKind)

      // NOTHING NEW TO SAY. The failure log above already recorded the event, so
      // this is only about the renderer's host list, and that list has not
      // changed. Without this return a page pulling forty assets from one host
      // sent forty identical messages — `PreviewRequestFilter` calls back per
      // blocked REQUEST and de-duplicates nothing — which is the flood the
      // design's coalescing rule exists to prevent. `failuresChanged` obeyed
      // that rule; this channel never did.
      if (merged === null) return

      if (!ledger.kindsByOrigin.has(originOrHost)) {
        // THE BOUND. Distinct entries per view, capped. The three-toast budget
        // that used to sit here bounded TOASTS, not this list, so once the emit
        // became unconditional there was no bound at all. An entry past the cap
        // is not listed and therefore not approvable — which is the same one-way
        // door the old cap had, except this one is stated, matches the CSP
        // path's own MAX_ORIGINS_PER_VIEW, and the renderer is told the list is
        // truncated instead of silently showing a short one.
        if (ledger.kindsByOrigin.size >= PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW) {
          return
        }

        // THE SUB-BOUND, and the reason the bound above is still worth having.
        // The entry is an ORIGIN now, so `http://localhost:1` … `:50` are fifty
        // of them and would fill the per-view budget before the page's real
        // blocked CDN is ever seen — dropped, never emitted, never approvable.
        // Capping what one hostname may spend keeps room for the hosts a reader
        // can actually act on. It has to be here, where the entry is RECORDED:
        // trimming rows in the renderer is far too late for an event that was
        // never sent.
        const hostname = hostOfBlockedIdentity(originOrHost)
        const spentForHost = ledger.originsPerHost.get(hostname) ?? 0
        if (spentForHost >= PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST) {
          return
        }
        ledger.originsPerHost.set(hostname, spentForHost + 1)
      }

      ledger.kindsByOrigin.set(originOrHost, merged)
      this.deps.emit.hostBlocked(
        panelId,
        originOrHost,
        approvable,
        merged,
        ledger.kindsByOrigin.size >= PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW
      )
    }

    let session: PreviewSession
    try {
      session = await this.deps.sessionFactory.create({
        projectPath,
        recordFailure: (input) => failureLog.record(input),
        onBlocked
      })
    } catch {
      // A seal/build failure means no view was produced (design §5(a)).
      failureLog.drop()
      return { ok: false, errorCode: ErrorCode.PREVIEW_CSP_INVALID }
    }

    if (this.registry.isStale(claim)) {
      // Superseded while the session was building (project switch, global-off, a
      // close, or a newer open): discard it rather than install a stale view.
      failureLog.drop()
      await this.discardSession(session)
      return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED }
    }

    // The constructor does REAL work that can throw — it builds the watch
    // coordinator, the find controller and a chokidar entry watcher, and calls
    // `window.contentView.addChildView`. If the host window closed during the
    // `create()` await above, that last call throws against a destroyed
    // BrowserWindow. Unguarded, the session built one line earlier would never
    // be discarded: its token stays resolvable and keeps serving file reads for
    // the life of the process (lens review F9).
    let live: PreviewLiveView
    try {
      live = new PreviewLiveView({
        panelId,
        projectPath,
        entryFilePath: req.filePath,
        window,
        initialBounds: req.bounds,
        session,
        failureLog,
        deps: this.liveViewDeps,
        // The CSP half of the blocked-host signal. Chromium refuses an
        // unapproved host in the RENDERER, so `onBeforeRequest` — and therefore
        // the Approve prompt — never sees it; the preload reports it instead and
        // it lands here, on the identical sink, sharing the failure type, the
        // toast budget and the dedupe rule.
        onBlockedHost: (host, url, approvable, resourceKind) =>
          onBlocked('blocked-host', host, url, approvable, resourceKind)
      })
    } catch {
      failureLog.drop()
      await this.discardSession(session)
      return { ok: false, errorCode: ErrorCode.PREVIEW_CSP_INVALID }
    }

    this.registry.install(panelId, live, window.id)

    // Seed the renderer with what this project has ALREADY approved.
    //
    // Without this the band can only ever show hosts blocked in this session, so
    // a project whose allowlist was filled yesterday — or one that arrived with a
    // cloned repository, already carrying approvals nobody in this room made —
    // shows "0 allowed" and looks untouched. `docs/security.md` residual risk 5
    // concedes that clone case; this is the first thing anywhere that surfaces it.
    //
    // Safe against subscribe ordering for the same reason `loadStateChanged` is:
    // `preview:open` is an `invoke`, so main cannot reply before the renderer's
    // mount commit has run its effects, and the band subscribes in that commit.
    this.deps.emit.allowlistChanged(panelId, this.deps.getAllowedHosts())

    // Re-apply a zoom the reader set before this panel last slept. Applied
    // BEFORE the load so the first paint is already at the right scale.
    const remembered = this.zoomLevels.get(panelId)
    if (remembered !== undefined && remembered !== 0) {
      live.setZoomLevel(remembered)
    }
    await live.load()

    // `load()` is an await like any other: re-check before leaving it running.
    //
    // Identity FIRST, then staleness. `suspend()` removes the entry without
    // moving the generation or this panel's sequence, so a staleness-only check
    // would let this call report success for a view that is no longer installed
    // (F8).
    if (this.registry.get(panelId) !== live || this.registry.isStale(claim)) {
      if (this.registry.get(panelId) === live) {
        this.registry.remove(panelId)
      }
      await live.teardown('immediate')
      return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED }
    }

    /*
     * Housekeeping for OTHER panels must never change this open's answer.
     *
     * `enforceLiveViewBudget` suspends the least recently used previews, which
     * runs after `registry.install` and after `live.load()` — so this panel is
     * already open and painting. Letting a failure while tidying up someone
     * else's view propagate turned it into `{ ok: false, UNKNOWN_ERROR }`, the
     * renderer took its `openFailed` branch and showed the failed banner, and
     * because that branch does not send `preview:close`, a fully live, visible
     * `WebContentsView` went on painting over a panel whose renderer believed
     * the open had failed.
     *
     * The cost of swallowing it is one preview over budget until the next open.
     */
    try {
      await this.enforceLiveViewBudget(panelId)
    } catch (error) {
      logger.warn('Preview live-view budget enforcement failed', {
        panelId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return { ok: true }
  }

  /**
   * Suspend the least recently active previews until at most
   * `PREVIEW.MAX_LIVE_VIEWS` remain live. The panel just opened or activated is
   * never a candidate.
   */
  private async enforceLiveViewBudget(keepPanelId: string): Promise<void> {
    const candidates = this.registry.evictionCandidates(PREVIEW.MAX_LIVE_VIEWS, keepPanelId)
    for (const panelId of candidates) {
      await this.suspend(panelId)
    }
  }

  /**
   * Tear a live view down but leave its panel open, showing the still frame it
   * had. The renderer re-opens it when the tab is activated again, which is the
   * exit state the original single-view design lacked (sd-074 §10).
   */
  private async suspend(panelId: string): Promise<void> {
    // Invalidate the panel's open claim, exactly as `close()` does. Without it,
    // an `open` for this panel parked on `await live.load()` resumes, finds
    // `isStale` false — neither the generation nor this panel's sequence moved —
    // and reports `{ ok: true }` for a panel that no longer has a view (lens
    // review F8).
    this.registry.invalidateOpen(panelId)
    // Drop the panel's blocked-host ledger with the panel. `open()` replaces it
    // anyway, so this only matters for a panel that is closed and never
    // reopened — but a map that only ever grows is the kind of leak nobody
    // notices until a long session.
    this.blockedByPanel.delete(panelId)

    const view = this.registry.remove(panelId)
    if (view === null) {
      return
    }
    // Hiding EMITS the still frame — it does not start one. Captures happen at
    // `'ready'`, while the view is drawn; the first clause of this sentence used
    // to say "starts the still-frame capture", which sent a reader looking for a
    // capture on this line and away from the one actually in flight.
    //
    // The entry is already out of the registry at this point, so anything that
    // threw past the teardown below would leave a live renderer process with no
    // owner, unreachable by `close()`, and the renderer would never see
    // `suspended` — leaving that tab permanently dead (lens review F8).
    view.setVisibility(false)
    // The ONE place that waits for a capture, and what it waits for is whatever
    // `'ready'` started and has not finished. `setVisibility` deliberately waits
    // for nothing: a hide must never sit behind I/O, because the native view eats
    // clicks meant for whatever overlay just opened. Here there is no overlay and
    // no pointer to steal, and `teardown` destroys the `webContents` on the next
    // line — so without this the capture would race its own subject and a
    // suspended panel would wake with no picture.
    //
    // Cannot reject: `whenCaptureSettled` absorbs a failed capture, because the
    // only question it answers is whether Chromium is still reading this page.
    await view.whenCaptureSettled()

    /*
     * `finally`, because the comment above is only half-true otherwise.
     *
     * It says anything that threw past the teardown would leave a live renderer
     * with no owner and a tab that never sees `suspended` — and then guards only
     * the wait. `teardown` can reject too: `disposeCollaborators` is fully
     * guarded, but the `.finally` callback that calls `wc.destroy()` is not.
     *
     * A throw there was the worse half of the same fault. The registry entry is
     * already gone, so `close()` cannot reach the view; `'suspended'` never
     * arrives, so the renderer's `loadState` stays `'ready'` and its resume
     * effect never fires; the overlay guard keeps sending `setVisibility` for a
     * panel main now drops silently, and therefore sends no `visibilityApplied`
     * for the reconciler to correct against. Nothing recovers until unmount.
     *
     * Emitting `'suspended'` regardless is the honest report: the view IS gone
     * from the registry either way, and the renderer's resume path is the only
     * thing that can put it back.
     */
    try {
      await view.teardown('immediate')
    } finally {
      this.deps.emit.loadStateChanged(panelId, 'suspended', 0)
    }
  }

  /** Tear down a session that was built but never installed as a live view. */
  private async discardSession(session: PreviewSession): Promise<void> {
    session.teardown()
    if (!session.view.webContents.isDestroyed()) {
      session.view.webContents.destroy()
    }
    // A live view revokes its token on teardown; a never-installed session must
    // do it here or the registry entry leaks.
    this.deps.registry.revoke(session.token)
    try {
      await this.deps.storageSeal.purge(session.session)
    } catch {
      // A purge failure on a session being discarded is not recoverable.
    }
  }

  async close(panelId: string): Promise<void> {
    // Invalidate UNCONDITIONALLY, before looking for a view: an `open` for this
    // panel may be suspended on `sessionFactory.create` with nothing installed
    // yet, and the renderer sends `close` on every panel unmount. Without this
    // the open would install a view for a panel that no longer exists, and
    // nothing would ever reap it (sd-074b §4.1).
    this.registry.invalidateOpen(panelId)
    // Both per-panel ledgers die with the panel. `suspend()` drops the blocked
    // hosts but deliberately KEEPS the zoom, so a resumed tab comes back at the
    // size the reader chose — which meant nothing ever removed a zoom entry, and
    // `close()` left both behind. Neither is large; both are maps that only ever
    // grew, across every file previewed in a session and every project switch.
    this.blockedByPanel.delete(panelId)
    this.zoomLevels.delete(panelId)
    const live = this.registry.remove(panelId)
    if (live !== null) {
      await live.teardown('bounded')
    }
  }

  setBounds(panelId: string, bounds: PreviewBounds, seq: number, ack = false): void {
    // A panel with no live view drops the push silently, as it always has — and
    // therefore sends no confirmation either, which is the honest answer: the
    // view is not where the renderer thinks it is.
    this.registry.get(panelId)?.setBounds(bounds, seq, ack)
  }

  async setVisibility(panelId: string, visible: boolean, _reason: string): Promise<void> {
    const live = this.registry.get(panelId)
    if (live === null) {
      return
    }
    if (visible) {
      // Becoming visible is the activation signal the eviction order uses.
      this.registry.touch(panelId)
    }
    // NOT awaited, because there is nothing to await: `setVisibility` returns
    // `void` and applies the change in this tick, which is the whole point — a
    // hide that waits leaves a native view eating clicks meant for the overlay
    // that just opened. The `await` that used to be here was a no-op that read
    // like the opposite of the rule it sits under.
    live.setVisibility(visible)
  }

  /**
   * Zoom the previewed page, and remember the level for this panel.
   *
   * The level is held by the SERVICE, not the view: a preview that sleeps past
   * the live-view budget is torn down and rebuilt when its tab comes back, so a
   * level stored on the view would silently reset. Held here it survives
   * suspend/resume and a same-panel reopen, which is what a reader who zoomed in
   * to read something expects.
   */
  async setZoom(panelId: string, step: number): Promise<void> {
    const current = this.zoomLevels.get(panelId) ?? 0
    const next =
      step === 0
        ? 0
        : Math.min(PREVIEW.MAX_ZOOM_LEVEL, Math.max(PREVIEW.MIN_ZOOM_LEVEL, current + step))
    this.zoomLevels.set(panelId, next)
    this.registry.get(panelId)?.setZoomLevel(next)
  }

  /**
   * Zoom whichever previewed page currently holds keyboard focus.
   *
   * @returns `true` when a preview handled it, so the caller can fall through to
   * the host window's own zoom when it did not.
   */
  async zoomFocused(step: number): Promise<boolean> {
    const focused = this.registry.all().find((entry) => entry.view.isFocused())
    if (focused === undefined) {
      return false
    }
    await this.setZoom(focused.view.panelId, step)
    return true
  }

  async reload(panelId: string, opts?: { ignoreCache?: boolean }): Promise<void> {
    this.registry.get(panelId)?.reload(opts?.ignoreCache ?? false)
  }

  async swapStylesheet(panelId: string, relPath: string): Promise<boolean> {
    return (await this.registry.get(panelId)?.swapStylesheet(relPath)) ?? false
  }

  /**
   * Apply an approved host to EVERY live view of the approving panel's project,
   * not just the approving panel.
   *
   * The allowlist host set is shared and every session's request filter reads it
   * live, while only a CSP rebuild lets the page actually use the host. Applying
   * to one view would open the network filter for all of them while their CSPs
   * still forbade it — an inconsistency that exists today and that a second
   * preview would expose (sd-074b §4.4).
   */
  async applyApprovedHosts(panelId: string, hosts: readonly string[]): Promise<void> {
    const entry = this.registry.entry(panelId)
    if (entry === null) {
      return
    }
    const targets = this.registry.ofProject(entry.view.projectPath)

    /*
     * Clear the per-host dedupe BEFORE the reload, for every affected view.
     *
     * This is the same defect `cspViolationBridge.reset()` exists for, one layer
     * up. An approval reloads the page, the CSP refuses the still-unapproved
     * hosts all over again — and a dedupe map that survived the reload would
     * swallow every one of them as "already seen", while the failure log they
     * would have appeared in has just been emptied. Approving one host would
     * make every other blocked host vanish from the band and become
     * unapprovable, recoverable only by closing and reopening the panel.
     *
     * The network filter cannot compensate: the whole premise of the CSP bridge
     * is that a refusal in the renderer never reaches `onBeforeRequest`.
     */
    for (const target of targets) {
      const targetLedger = this.blockedByPanel.get(target.view.panelId)
      targetLedger?.kindsByOrigin.clear()
      // The sub-cap ledger goes with it, always. A hostname that spent its five
      // origins before the approval would otherwise be barred from reporting
      // anything after the reload — the same swallowing defect this clear
      // exists to prevent, one level down.
      targetLedger?.originsPerHost.clear()
    }
    // `allSettled` over a snapshot: one view failing (or being torn down
    // mid-flight) must not stop the others from getting the rebuilt CSP.
    await Promise.allSettled(targets.map((target) => target.view.applyApprovedHosts(hosts)))

    // Tell EVERY view of this project, including one whose rebuild rejected: the
    // allowlist genuinely did change for the project, and a view that failed to
    // rebuild is defunct anyway. This is how a second panel learns of an approval
    // made in the first.
    //
    // Known gap, deliberately not closed here: the early return above means that
    // if the approving panel closes between Confirm and this handler, no sibling
    // is told. It self-heals on the sibling's next open. The fix is NOT to accept
    // a project path from the renderer — `allowlist-handlers.ts` resolves the root
    // main-side on purpose, and widening that would hand an untrusted caller the
    // choice of which project it is approving for.
    for (const target of targets) {
      this.deps.emit.allowlistChanged(target.view.panelId, hosts)
    }
  }

  async destroyAll(_reason: string): Promise<void> {
    await this.teardownAll()
  }

  /**
   * Tear down every preview hosted by a window that is closing.
   *
   * WHY THIS EXISTS RATHER THAN A LIVENESS GUARD. On quit the window is destroyed
   * first (`index.ts` — `mainWindowRef.destroy()` then `app.quit()`), and only
   * afterwards does `before-quit` dispose the preview handlers. So every view was
   * torn down against a dead window and logged
   * `Preview teardown step failed { step: 'removeChildView' }` on every clean
   * exit. Guarding the detach against `isDestroyed()` would have silenced that
   * warning while leaving the real gap: nothing reaped a window's views when the
   * WINDOW went away, which is latent with one window and a leak with two.
   *
   * Draining here closes both — there is nothing left to detach by the time the
   * app-level disposer runs. `index.ts` already does exactly this for watchers,
   * terminals and git.
   */
  async closeWindow(windowId: number): Promise<void> {
    const entries = this.registry.drainWindow(windowId)
    if (entries.length === 0) {
      return
    }
    for (const entry of entries) {
      this.registry.invalidateOpen(entry.view.panelId)
    }
    await Promise.allSettled(entries.map((entry) => entry.view.teardown('immediate')))
  }

  async onProjectChanged(_oldPath: string | null, _newPath: string | null): Promise<void> {
    await this.teardownAll()
  }

  async dispose(): Promise<void> {
    await this.teardownAll()
  }

  /** Start / advance a find-in-page on a live view. */
  find(panelId: string, text: string, options: PreviewFindOptions): void {
    this.registry.get(panelId)?.find(text, options)
  }

  /** Clear find highlights on a live view. */
  stopFind(panelId: string): void {
    this.registry.get(panelId)?.stopFind()
  }

  /** Export a live view to PDF. */
  async exportPdf(panelId: string, suggestedName: string): Promise<PdfExportResult> {
    const live = this.registry.get(panelId)
    if (live === null) {
      return { ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED }
    }
    return live.exportPdf(suggestedName)
  }

  /**
   * Release the project's blocked-host toast budget once its LAST view is gone.
   *
   * The budget is per project and used to be cleared by whichever view happened
   * to tear down first, which wiped a sibling preview's dedupe state and let an
   * already-suppressed host toast again (sd-074b §4.5).
   */

  private async teardownAll(): Promise<void> {
    // Invalidate every in-flight open FIRST: one may be mid-`create` with
    // nothing installed, and must not install a view for the state being torn
    // down.
    this.registry.bumpGeneration()
    const entries = this.registry.drain()
    await Promise.allSettled(entries.map((entry) => entry.view.teardown('immediate')))
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewViewService(deps: PreviewViewDeps): IPreviewViewService {
  return new PreviewViewService(deps)
}
