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
 *  - A second `open` with a DIFFERENT panelId is refused with
 *    `PREVIEW_VIEW_LIMIT_REACHED` + the holder's panelId; the SAME panelId is a
 *    replace (a main-renderer reload cannot strand the view and lock out opens).
 *  - `applyApprovedHosts` (§5(c)), `destroyAll` (AC21 global-off) and
 *    `onProjectChanged` (§5(f)) route through here to the single live view.
 *
 * Trust model: the previewed page is untrusted and reaches Erfana only through
 * the sealed session's chokepoints; the project path is resolved main-side
 * (`getProjectPath`), never taken from the renderer (NEW-8).
 */

import { ErrorCode } from '../../../shared/errors'
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
}

export class PreviewViewService implements IPreviewViewService, PreviewFindExportService {
  private live: PreviewLiveView | null = null
  // Monotonic guard: every `open` claims the next value, and any concurrent open,
  // close, project switch or destroyAll advances it, so an `open` that suspends on
  // `sessionFactory.create` can detect it was superseded and discard its session
  // rather than install a view for a stale project (or leak one).
  private openEpoch = 0
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
      platform: deps.platform
    }
  }

  async open(req: PreviewOpenRequest, window: PreviewWindowLike): Promise<PreviewOpenResult> {
    const projectPath = this.deps.getProjectPath()
    if (projectPath === null) {
      return { ok: false, errorCode: ErrorCode.PROJECT_NOT_FOUND }
    }

    // Claim this open. The re-checks after each await below abandon it if the
    // epoch moved on in the meantime (NEW-9 single-view invariant, race-safe).
    const epoch = ++this.openEpoch

    if (this.live !== null) {
      // A DIFFERENT panel is refused with the holder id; the SAME panel replaces.
      if (this.live.panelId !== req.panelId) {
        return {
          ok: false,
          errorCode: ErrorCode.PREVIEW_VIEW_LIMIT_REACHED,
          holderPanelId: this.live.panelId
        }
      }
      await this.live.teardown('immediate')
      if (this.openEpoch !== epoch) {
        return { ok: false, errorCode: ErrorCode.PROJECT_NOT_FOUND }
      }
      this.live = null
    }

    const { panelId } = req
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

    if (this.openEpoch !== epoch) {
      // Superseded while the session was building (project switch, global-off, or
      // a newer open): discard it rather than install a stale-project view or let
      // a newer view be overwritten and leaked.
      failureLog.drop()
      await this.discardSession(session)
      return { ok: false, errorCode: ErrorCode.PROJECT_NOT_FOUND }
    }

    const live = new PreviewLiveView({
      panelId,
      projectPath,
      entryFilePath: req.filePath,
      window,
      initialBounds: req.bounds,
      session,
      failureLog,
      deps: this.liveViewDeps
    })
    this.live = live
    await live.load()
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
    try {
      await this.deps.storageSeal.purge(session.session)
    } catch {
      // A purge failure on a session being discarded is not recoverable.
    }
  }

  async close(panelId: string): Promise<void> {
    const live = this.forPanel(panelId)
    if (live !== null) {
      this.openEpoch += 1
      await live.teardown('bounded')
      this.live = null
    }
  }

  setBounds(panelId: string, bounds: PreviewBounds, seq: number): void {
    this.forPanel(panelId)?.setBounds(bounds, seq)
  }

  async setVisibility(panelId: string, visible: boolean, _reason: string): Promise<void> {
    await this.forPanel(panelId)?.setVisibility(visible)
  }

  async reload(panelId: string, opts?: { ignoreCache?: boolean }): Promise<void> {
    this.forPanel(panelId)?.reload(opts?.ignoreCache ?? false)
  }

  async swapStylesheet(panelId: string, relPath: string): Promise<boolean> {
    return (await this.forPanel(panelId)?.swapStylesheet(relPath)) ?? false
  }

  async applyApprovedHosts(panelId: string, hosts: readonly string[]): Promise<void> {
    await this.forPanel(panelId)?.applyApprovedHosts(hosts)
  }

  async destroyAll(_reason: string): Promise<void> {
    await this.teardownLive()
  }

  async onProjectChanged(_oldPath: string | null, _newPath: string | null): Promise<void> {
    await this.teardownLive()
  }

  async dispose(): Promise<void> {
    await this.teardownLive()
  }

  /** Start / advance a find-in-page on the live view. */
  find(panelId: string, text: string, options: PreviewFindOptions): void {
    this.forPanel(panelId)?.find(text, options)
  }

  /** Clear find highlights on the live view. */
  stopFind(panelId: string): void {
    this.forPanel(panelId)?.stopFind()
  }

  /** Export the live view to PDF. */
  async exportPdf(panelId: string, suggestedName: string): Promise<PdfExportResult> {
    const live = this.forPanel(panelId)
    if (live === null) {
      return { ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED }
    }
    return live.exportPdf(suggestedName)
  }

  /** The live view iff it holds `panelId`, else `null`. */
  private forPanel(panelId: string): PreviewLiveView | null {
    return this.live !== null && this.live.panelId === panelId ? this.live : null
  }

  private async teardownLive(): Promise<void> {
    // Advance the epoch UNCONDITIONALLY: an `open` may be mid-`create` with
    // `this.live` still null, and a project switch or global-off must still make
    // it abandon rather than install a view for the project being torn down.
    this.openEpoch += 1
    if (this.live !== null) {
      const live = this.live
      this.live = null
      await live.teardown('immediate')
    }
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewViewService(deps: PreviewViewDeps): IPreviewViewService {
  return new PreviewViewService(deps)
}
