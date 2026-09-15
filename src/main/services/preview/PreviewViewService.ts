// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview view lifecycle owner (Issue #74, work item 39; design §1.4, §5).
 *
 * The single-view MANAGER: it owns the "one live view, replace-not-refuse for the
 * same panel" policy (X20 + NEW-9), builds the sealed session (item 38) and the
 * per-view page scopes, then delegates all per-view behaviour to `PreviewLiveView`
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
 *  - A window-edge drag holds the window's previews hidden until they settle
 *    (issue #124): one hold per window, kept by `createResizeHoldRegistry`.
 *
 * Trust model: the previewed page is untrusted and reaches Erfana only through
 * the sealed session's chokepoints; the project path is resolved main-side
 * (`getProjectPath`), never taken from the renderer (NEW-8).
 */

import { ErrorCode } from '../../../shared/errors'
import type {
  PdfExportResult,
  PreviewBounds,
  PreviewOpenResult
} from '../../../shared/ipc/preview-types'
import type { PreviewFindOptions } from './PreviewFindController'
import type { PreviewSession } from './PreviewSessionFactory'
import {
  PreviewLiveView,
  type PreviewLiveViewDeps,
  type PreviewWindowLike
} from './PreviewLiveView'
import { PreviewViewRegistry } from './PreviewViewRegistry'
import { createNoViewDropLog } from './previewBoundsDropLog'
import { createPageScopeHolder, createPreviewPageScope } from './previewPageScope'
import { createPreviewPanelState } from './previewPanelState'
import { createPreviewViewEviction } from './previewViewEviction'
import { createPreviewViewFocus } from './previewViewFocus'
import { createPreviewViewNavigation } from './previewViewNavigation'
import { createResizeHoldRegistry, type PreviewResizeHoldRegistry } from './previewResizeHold'
import type {
  IPreviewViewService,
  PreviewFindExportService,
  PreviewOpenRequest,
  PreviewViewDeps
} from './previewViewTypes'

export type { PreviewWindowLike } from './PreviewLiveView'
export type { IPreviewViewService, PreviewFindExportService, PreviewOpenRequest, PreviewViewDeps }

export class PreviewViewService implements IPreviewViewService, PreviewFindExportService {
  /** Live views plus the two-part staleness guard over them (sd-074b §4.2). */
  private readonly registry = new PreviewViewRegistry()
  /** Each panel's zoom level, which outlives its live view (`previewPanelState.ts`). */
  private readonly panelState = createPreviewPanelState()
  /** The live-view budget: suspends the least recently active previews. */
  private readonly eviction = createPreviewViewEviction({
    registry: this.registry,
    onSuspended: (panelId) => this.deps.emit.loadStateChanged(panelId, 'suspended', 0)
  })
  /** Same-tab moves, history steps and resume (issue #124, `previewViewNavigation.ts`). */
  private readonly navigation = createPreviewViewNavigation({
    registry: this.registry,
    panelState: this.panelState,
    checkEligibility: () => this.deps.checkEligibility
  })
  /** `preview:navigate` (issue #124): checked and started by the navigation half. */
  readonly navigate = this.navigation.navigate
  /** `preview:focusPage` (issue #124, QG-8 U1): the keyboard route into the page. */
  readonly focusPage = createPreviewViewFocus({ registry: this.registry })
  /** Drop point M4: a push for a panel with no live view (issue #124, `previewBoundsDropLog.ts`). */
  private readonly noViewDrops = createNoViewDropLog(() => this.deps.now())
  /** Each window's resize hold (issue #124, `previewResizeHold.ts`), dropped with the window. */
  private readonly resizeHolds: PreviewResizeHoldRegistry
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
      openExternal: deps.openExternal,
      checkEligibility: deps.checkEligibility
    }
    this.resizeHolds = createResizeHoldRegistry({
      views: (windowId) =>
        this.registry
          .all()
          .filter((entry) => entry.windowId === windowId)
          .map(({ view }) => ({ panelId: view.panelId, target: view.resizeHoldTarget() })),
      emit: deps.emit,
      now: () => deps.now()
    })
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
    // Pushes that race this open are expected again: a fresh M4 trail at info.
    this.noViewDrops.forget(panelId)

    if (existing !== null) {
      // Same panel, same window: replace. Remove BEFORE awaiting so a rejecting
      // teardown cannot strand the entry.
      this.registry.remove(panelId)
      await existing.view.teardown('immediate')
      if (this.registry.isStale(claim)) {
        return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED }
      }
    }

    // One holder per view, created before the session (issue #124, WI-29): the
    // page on screen and, while main loads another, a pending one. Each page
    // carries its own failure log, blocked-host ledger and CSP dedupe, so a new
    // page resets all three together. The session, the refusal sink and the live
    // view look the page up at every write; none of them keeps one.
    const pageScopes = createPageScopeHolder(() =>
      createPreviewPageScope({
        panelId,
        emit: this.deps.emit,
        createFailureLog: this.deps.createFailureLog
      })
    )

    let session: PreviewSession
    try {
      session = await this.deps.sessionFactory.create({
        projectPath,
        pageScopes: () => pageScopes,
        // A network-layer refusal belongs to the page on screen.
        onBlocked: (kind, host, url, approvable, resourceKind) =>
          pageScopes.committed().reportBlocked(kind, host, url, approvable, resourceKind)
      })
    } catch {
      // A seal/build failure means no view was produced (design §5(a)).
      pageScopes.dispose()
      return { ok: false, errorCode: ErrorCode.PREVIEW_CSP_INVALID }
    }

    // Main's own page on a resume, else the renderer's (issue #124, RS6).
    const start = await this.navigation.startingPage(req, session.realRoot, projectPath)

    if (this.registry.isStale(claim) || window.isDestroyed()) {
      // Superseded while the session was building (project switch, global-off, a
      // close, or a newer open) — or the WINDOW closed: `closeWindow` finds no
      // installed entry for an open still parked here and moves no generation,
      // so without this check the open resumed and built a view against a
      // destroyed window (#83). Discard rather than install a stale view.
      pageScopes.dispose()
      await this.discardSession(session)
      return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED }
    }

    if (!start.ok) {
      // A resume whose own page, and the tab's own, both failed the navigation
      // gate (QG-7 item 11): there is no page this panel may show, so no view
      // is installed and the tab shows its failed state.
      pageScopes.dispose()
      await this.discardSession(session)
      return { ok: false, errorCode: start.errorCode }
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
        entryFilePath: start.filePath,
        window,
        initialBounds: req.bounds,
        session,
        pageScopes,
        navigation: start.navigation,
        deps: this.liveViewDeps
      })
    } catch {
      pageScopes.dispose()
      await this.discardSession(session)
      return { ok: false, errorCode: ErrorCode.PREVIEW_CSP_INVALID }
    }

    this.registry.install(panelId, live, window.id)
    this.noViewDrops.installed(panelId)

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
    const remembered = this.panelState.zoomLevel(panelId)
    if (remembered !== 0) {
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

    // Never rejects: housekeeping for OTHER panels must not change this answer.
    await this.eviction.enforceBudget(panelId)
    return { ok: true }
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
    // Purges (bounded) and hands the partition back for reuse; never rejects.
    await session.release()
  }

  async close(panelId: string): Promise<void> {
    // Invalidate UNCONDITIONALLY, before looking for a view: an `open` for this
    // panel may be suspended on `sessionFactory.create` with nothing installed
    // yet, and the renderer sends `close` on every panel unmount. Without this
    // the open would install a view for a panel that no longer exists, and
    // nothing would ever reap it (sd-074b §4.1).
    this.registry.invalidateOpen(panelId)
    // The per-panel records die with the panel (`previewPanelState.ts`, M4's log).
    this.panelState.forget(panelId)
    this.noViewDrops.forget(panelId)
    const live = this.registry.remove(panelId)
    if (live !== null) {
      await live.teardown('bounded')
    }
  }

  setBounds(
    panelId: string,
    bounds: PreviewBounds,
    seq: number,
    ack = false,
    settled = false
  ): void {
    const entry = this.registry.entry(panelId)
    if (entry === null) {
      // Dropped – and therefore unconfirmed, which is the honest answer: the view
      // is not where the renderer thinks it is. Logged as M4, rate-capped.
      this.noViewDrops.report(panelId, bounds, seq)
      return
    }
    // Only bounds that reached the view count for a resize hold, so a view is
    // never shown at bounds that predate the drag's end.
    if (!entry.view.setBounds(bounds, seq, ack)) {
      return
    }
    this.resizeHolds.boundsApplied(entry.windowId, panelId, settled)
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

  setResizeHold(windowId: number, held: boolean): void {
    this.resizeHolds.set(windowId, held)
  }

  /** Zoom the previewed page; the level outlives the view (`previewPanelState.ts`). */
  async setZoom(panelId: string, step: number): Promise<void> {
    const next = this.panelState.stepZoom(panelId, step)
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

    // Nothing is cleared here (WI-29): each view reloads through `startPageLoad`,
    // and the reload's new page brings its own empty ledger, log and CSP dedupe,
    // so every host it refuses again is news to the reader.
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
    // The window's resize hold goes with it, timers and all – even with no view
    // left to drain (RX2-4).
    this.resizeHolds.closeWindow(windowId)
    const entries = this.registry.drainWindow(windowId)
    if (entries.length === 0) {
      return
    }
    for (const entry of entries) {
      this.registry.invalidateOpen(entry.view.panelId)
      this.noViewDrops.forget(entry.view.panelId)
    }
    await Promise.allSettled(entries.map((entry) => entry.view.teardown('immediate')))
  }

  async onProjectChanged(_oldPath: string | null, _newPath: string | null): Promise<void> {
    await this.teardownAll()
    // A partition must not carry from project A to project B, purged or not.
    this.deps.sessionFactory.forgetRecycled()
  }

  async dispose(): Promise<void> {
    this.resizeHolds.dispose()
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
