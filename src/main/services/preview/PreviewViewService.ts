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

import { ErrorCode } from '../../../shared/errors'
import { PREVIEW } from '../../../shared/constants'
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
import type { IPreviewHostBlockNotifier } from './PreviewHostBlockNotifier'
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
  setBounds(panelId: string, bounds: PreviewBounds, seq: number): void
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
 * wiring. `registry`, `getProjectPath` and `hostBlockNotifier` are added because
 * §5(c)/§5(f)/§5(c-block) route through them and §4.4 omitted them.
 */
export interface PreviewViewDeps {
  readonly sessionFactory: IPreviewSessionFactory
  readonly registry: Pick<IPreviewRootRegistry, 'rebuildCsp' | 'revoke'>
  readonly stillFrameCache: IPreviewStillFrameCache
  readonly exportController: IPreviewExportController
  readonly storageSeal: { purge(session: PreviewSessionLike): Promise<void> }
  readonly hostBlockNotifier: IPreviewHostBlockNotifier
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
      hostBlockNotifier: deps.hostBlockNotifier,
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
      this.releaseProjectIfLast(existing.view.projectPath)
      if (this.registry.isStale(claim)) {
        return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED }
      }
    }

    const failureLog = this.deps.createFailureLog((failures, truncated) =>
      this.deps.emit.failuresChanged(panelId, failures, truncated)
    )

    const onBlocked = (
      kind: PreviewFailureType,
      host: string,
      _url: string,
      approvable: boolean
    ): void => {
      failureLog.record({ type: kind, resourceUrlOrHost: host, reasonCode: ErrorCode.UNKNOWN_ERROR })
      if (approvable && this.deps.hostBlockNotifier.shouldNotify(projectPath, host)) {
        this.deps.emit.hostBlocked(panelId, host, approvable)
      }
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
        deps: this.liveViewDeps
      })
    } catch {
      failureLog.drop()
      await this.discardSession(session)
      return { ok: false, errorCode: ErrorCode.PREVIEW_CSP_INVALID }
    }

    this.registry.install(panelId, live, window.id)
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
      this.releaseProjectIfLast(projectPath)
      return { ok: false, errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED }
    }

    await this.enforceLiveViewBudget(panelId)
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

    const view = this.registry.remove(panelId)
    if (view === null) {
      return
    }
    // Hiding captures the still frame and emits it, so the suspended tab shows
    // the page as it was rather than an empty placeholder.
    //
    // The capture is real I/O and can reject. The entry is already out of the
    // registry at this point, so a throw that skipped the teardown would leave a
    // live renderer process with no owner, unreachable by `close()`, and the
    // renderer would never see `suspended` — leaving that tab permanently dead
    // (lens review F8).
    //
    // The rejection is SWALLOWED rather than rethrown. Suspending is
    // housekeeping the caller did not ask for — it happens inside someone else's
    // `open` — so a failed screenshot must not fail their open. The cost of
    // losing the frame is a placeholder-coloured tab, which is what a preview
    // with no frame already shows.
    try {
      await view.setVisibility(false)
    } catch {
      // Nothing actionable: the view is being destroyed on the next line.
    }
    await view.teardown('immediate')
    this.releaseProjectIfLast(view.projectPath)
    this.deps.emit.loadStateChanged(panelId, 'suspended', 0)
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
    const live = this.registry.remove(panelId)
    if (live !== null) {
      await live.teardown('bounded')
      this.releaseProjectIfLast(live.projectPath)
    }
  }

  setBounds(panelId: string, bounds: PreviewBounds, seq: number): void {
    this.registry.get(panelId)?.setBounds(bounds, seq)
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
    await live.setVisibility(visible)
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
    // `allSettled` over a snapshot: one view failing (or being torn down
    // mid-flight) must not stop the others from getting the rebuilt CSP.
    await Promise.allSettled(targets.map((target) => target.view.applyApprovedHosts(hosts)))
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
    const projects = new Set(entries.map((entry) => entry.view.projectPath))
    await Promise.allSettled(entries.map((entry) => entry.view.teardown('immediate')))
    for (const projectPath of projects) {
      this.releaseProjectIfLast(projectPath)
    }
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
  private releaseProjectIfLast(projectPath: string): void {
    if (this.registry.countForProject(projectPath) === 0) {
      this.deps.hostBlockNotifier.clear(projectPath)
    }
  }

  private async teardownAll(): Promise<void> {
    // Invalidate every in-flight open FIRST: one may be mid-`create` with
    // nothing installed, and must not install a view for the state being torn
    // down.
    this.registry.bumpGeneration()
    const entries = this.registry.drain()
    const projects = new Set(entries.map((entry) => entry.view.projectPath))
    await Promise.allSettled(entries.map((entry) => entry.view.teardown('immediate')))
    for (const projectPath of projects) {
      this.releaseProjectIfLast(projectPath)
    }
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewViewService(deps: PreviewViewDeps): IPreviewViewService {
  return new PreviewViewService(deps)
}
