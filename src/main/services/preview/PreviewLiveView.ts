// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One live preview view (Issue #74, work item 39; design §1.4, §5).
 *
 * The service owns the "only one, replace-not-refuse" policy and hands a fully
 * factory-built session to this class. `previewLiveWiring` builds the view's
 * parts from it – the per-view collaborators (watch coordinator, reload policy,
 * find controller) and the lifecycle listeners – and this class owns them.
 *
 * Each piece of per-view state has one owner (issue #124, WI-1), and owners talk
 * only through the callbacks the wiring sets up: `previewLiveBounds` (last rect
 * and seq, the repaint confirmation), `previewLiveVisibility` (wanted
 * visibility, the capture chain), `previewLivePipeline` (post-load pipeline,
 * watch set, live reload), `previewLiveBackdrop` (the backdrop colour) and
 * `previewLiveTeardown` (no state), and `previewLivePage` (the page on screen
 * and the one load main has started). Per-page state – the failure log, the
 * blocked hosts, the CSP dedupe, the refused frames – lives in the page scopes
 * (`previewPageScope`), which the service creates and this class disposes.
 * The page can change inside the view (issue #124, WI-17b): `navigate` starts a
 * move the service checked, and `previewPageNavigator` keeps the panel's
 * history. This class keeps zoom, find, export, host approval, failure
 * reporting and the teardown order.
 *
 * Trust model: the previewed page is untrusted; every signal it drives here
 * (failure strings, still frames, find counts) is bounded, coalesced DATA.
 */

import { basename, dirname, resolve } from 'node:path'

import { ErrorCode } from '../../../shared/errors'
import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { withTimeout } from '../../utils/withTimeout'
import type {
  PdfExportResult,
  PreviewBounds,
  PreviewFailureInput,
  PreviewFailureType
} from '../../../shared/ipc/preview-types'
import type { PreviewFindOptions } from './PreviewFindController'
import { exportNameForPage } from './PreviewExportController'
import type { PreviewPageScopeHolder } from './previewPageScope'
import type {
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import type {
  PreviewLiveViewDeps,
  PreviewLiveViewParams,
  PreviewWindowLike
} from './previewLiveTypes'
import type { PreviewNavigationMove } from './previewPageNavigator'
import { wirePreviewLiveView, type PreviewLiveParts } from './previewLiveWiring'
import { teardownLiveView } from './previewLiveTeardown'
import type { PreviewResizeHoldTarget } from './previewResizeHold'

export type {
  PreviewLiveViewDeps,
  PreviewLiveViewParams,
  PreviewWindowLike
} from './previewLiveTypes'

/**
 * An error as a log line carries it: its name, plus `code` when it has one.
 * Never the message, which can quote a path or a preview URL (QG-7 S3).
 */
function errorFieldsOf(error: unknown): { error: string; code?: string } {
  if (!(error instanceof Error)) {
    return { error: typeof error }
  }
  const { code } = error as NodeJS.ErrnoException
  return typeof code === 'string' ? { error: error.name, code } : { error: error.name }
}

export class PreviewLiveView {
  readonly panelId: string
  readonly projectPath: string
  /** The real (symlink-resolved) project root this view serves; the navigation gate confines to it. */
  readonly realRoot: string

  private readonly view: PreviewViewHandle
  private readonly wc: PreviewWebContentsHandle
  private readonly session: PreviewSessionLike
  private readonly token: string
  private readonly window: PreviewWindowLike
  /** The view's page scopes: created by the service, disposed by `teardown`. */
  private readonly pageScopes: PreviewPageScopeHolder
  private readonly deps: PreviewLiveViewDeps
  /** The state owners and collaborators `previewLiveWiring` built for this view. */
  private readonly parts: PreviewLiveParts
  private readonly factoryTeardown: () => void
  /** Hands the partition back for reuse; called only once the page is destroyed. */
  private readonly sessionRelease: () => Promise<void>

  private destroyed = false
  private closing = false
  /** The page zoom last set, re-applied when a move lands (issue #124, part 3 §3.4). */
  private zoomLevel = 0

  constructor(params: PreviewLiveViewParams) {
    this.panelId = params.panelId
    this.projectPath = params.projectPath
    this.window = params.window
    this.pageScopes = params.pageScopes
    this.deps = params.deps

    this.view = params.session.view
    this.wc = params.session.view.webContents
    this.session = params.session.session
    this.token = params.session.token
    this.realRoot = params.session.realRoot
    this.factoryTeardown = params.session.teardown
    this.sessionRelease = params.session.release

    // Throws when the wiring throws, by which time the wiring has latched this
    // view destroyed and started unwinding what it built.
    this.parts = wirePreviewLiveView({
      params,
      isDefunct: () => this.isDefunct,
      isTornDown: () => this.destroyed,
      markDestroyed: () => {
        this.destroyed = true
      },
      onCrash: (reason) => this.onCrash(reason),
      onConsoleMessage: (input) => this.onConsoleMessage(input),
      onEntryDeleted: () => this.onEntryDeleted(),
      onMoveLanded: (failed) => this.onMoveLanded(failed)
    })
  }

  /**
   * Emit `loading` and navigate to the first page, at its history anchor: the
   * view's first load, which gets no pending page scope (its committed one is
   * new and empty). Failures surface via events.
   */
  async load(): Promise<void> {
    this.deps.emit.loadStateChanged(this.panelId, 'loading', 0)
    try {
      await this.parts.navigator.loadFirst(this.currentPage())
    } catch {
      // A load failure surfaces through the lifecycle events; do not throw here.
    }
  }

  /**
   * Start a same-tab move or history step the service checked (issue #124,
   * WI-17b). The navigator tells the renderer when it lands.
   *
   * @returns `false` when the view is going away or the load could not start.
   */
  navigate(move: PreviewNavigationMove): boolean {
    if (this.isDefunct) {
      return false
    }
    try {
      void this.parts.navigator.move(move)
      return true
    } catch (error) {
      logger.warn('Preview move could not start', {
        panelId: stablePathDigest(this.panelId),
        error: error instanceof Error ? error.name : typeof error
      })
      return false
    }
  }

  /** Whether a same-tab move or history step main started is still pending. */
  isNavigationPending(): boolean {
    return this.parts.navigator.isNavigationPending()
  }

  /**
   * True once torn down, closing, or the webContents is gone; guards late
   * external calls.
   *
   * `closing` matters because the bounded destroy calls `wc.close()` and then
   * waits up to `PREVIEW.CLOSE_TIMEOUT_MS` — a full second during which the
   * contents is going away but `isDestroyed()` still answers `false` (sd-074b §4.4).
   */
  private get isDefunct(): boolean {
    return this.destroyed || this.closing || this.wc.isDestroyed()
  }

  /** The page on screen (the committed page); every page-path read goes through here. */
  private currentPage(): string {
    return this.parts.page.currentPage()
  }

  /** Apply a renderer push. @returns whether it reached the view (a dropped push is logged). */
  setBounds(bounds: PreviewBounds, seq: number, ack = false): boolean {
    return this.parts.bounds.apply(bounds, seq, ack)
  }

  /** Resolve once every capture has settled. Teardown callers only, never an overlay path. */
  whenCaptureSettled(): Promise<void> {
    return this.parts.visibility.whenCaptureSettled()
  }

  /** Show or hide the native view. The hide is synchronous: see `previewLiveVisibility`. */
  setVisibility(visible: boolean): void {
    this.parts.visibility.set(visible)
  }

  /**
   * This view's visibility owner, for the window-edge resize hold: the state
   * machine in `previewResizeHold.ts` is the only caller of its `hold()` and
   * `release()` (issue #124, RA3-2).
   */
  resizeHoldTarget(): PreviewResizeHoldTarget {
    return this.parts.visibility
  }

  /**
   * Set the page's own zoom level (Chromium scale, 0 = 100%).
   *
   * Distinct from the host window's zoom, which `clampAndZoomBounds` applies to
   * the view's RECTANGLE: scaling the rectangle alone makes the page's text
   * relatively smaller, which is the opposite of what a reader pressing
   * Cmd/Ctrl-+ wants.
   */
  setZoomLevel(level: number): void {
    this.zoomLevel = level
    if (this.isDefunct) {
      return
    }
    this.wc.setZoomLevel(level)
  }

  /** The page's current zoom level, or 0 once the view is gone. */
  getZoomLevel(): number {
    return this.isDefunct ? 0 : this.wc.getZoomLevel()
  }

  /** Whether the previewed page currently holds keyboard focus. */
  isFocused(): boolean {
    return !this.isDefunct && this.wc.isFocused()
  }

  /**
   * Give the previewed page keyboard focus (issue #124, QG-8 U1).
   *
   * Refused while the view is defunct or not drawn: focus would go into a page
   * that is destroyed, or one hidden behind an overlay, a still frame or a
   * window-edge hold – in every case the reader would be typing at something
   * they cannot see, with Escape the only way back. `isDrawn()` is the same
   * "drawn" term the still-frame captures use, so a hold refuses too.
   *
   * @returns `true` when the page took focus.
   */
  focusPage(): boolean {
    if (this.isDefunct || !this.parts.visibility.isDrawn()) {
      return false
    }
    // Optional on the handle (the `ipc` precedent), so a test double that
    // predates this method refuses instead of throwing.
    if (typeof this.wc.focus !== 'function') {
      return false
    }
    this.wc.focus()
    return true
  }

  reload(ignoreCache: boolean): void {
    this.parts.pipeline.reload(ignoreCache)
  }

  swapStylesheet(relPath: string): Promise<boolean> {
    return this.parts.pipeline.swap(resolve(dirname(this.currentPage()), relPath))
  }

  async applyApprovedHosts(hosts: readonly string[]): Promise<void> {
    if (this.isDefunct) {
      return
    }
    // §5(c): rebuild the CSP on the registry entry, purge, reload.
    this.deps.registry.rebuildCsp(this.token, hosts)
    // Time-boxed, and skipped on failure rather than fatal: the purge is
    // belt-and-braces (the opaque origin is the seal, and the reload below
    // bypasses the cache), and on Windows an approval was seen to never come
    // back because this await never settled (2026-09-03).
    try {
      await withTimeout(
        this.deps.storageSeal.purge(this.session),
        PREVIEW.PURGE_TIMEOUT_MS,
        'Preview approval purge'
      )
    } catch (error) {
      logger.warn('Preview approval: purge did not complete; reloading anyway', {
        panelId: stablePathDigest(this.panelId),
        ...errorFieldsOf(error)
      })
    }
    // Re-check AFTER the await: the purge yields, and a teardown starting in
    // that window would otherwise start a load on a closing WebContents.
    if (this.isDefunct) {
      return
    }
    logger.info('Preview approval: reloading with the new allowlist', {
      panelId: stablePathDigest(this.panelId),
      count: hosts.length
    })
    // A page load like any other (WI-29), so nothing is reset by hand: when the
    // reload commits, its new page scope replaces the failure log, the
    // blocked-host ledger and the CSP dedupe together, and every host the reader
    // did NOT approve is refused, listed and approvable again. A reload that
    // never commits leaves the page as it was.
    void this.parts.page.startPageLoad(this.currentPage(), 'reload', () =>
      this.wc.reloadIgnoringCache()
    )
  }

  find(text: string, options: PreviewFindOptions): void {
    if (this.isDefunct) {
      return
    }
    this.parts.findController.find(text, options)
  }

  stopFind(): void {
    if (this.isDefunct) {
      return
    }
    this.parts.findController.clearHighlights()
  }

  /**
   * Export the page on screen to PDF. The save dialog suggests that page's
   * name – after a same-tab move, the page the tab moved to – and
   * `fallbackName` only when there is no page name. The request that leads
   * here carries only the panel id, so no name comes from the renderer (#124).
   */
  exportPdf(fallbackName: string): Promise<PdfExportResult> {
    const name = exportNameForPage(this.currentPage(), fallbackName)
    return this.deps.exportController.exportToPdf(this.wc, name, this.window.id)
  }

  /**
   * `render-process-gone` / `unresponsive`: mark failed, badge, keep Reload live.
   * Uses the distinct `render-crash` type carrying the crash reason, so a whole-
   * renderer crash or OOM reads differently from a page's uncaught JS exception.
   */
  private onCrash(reason: string): void {
    this.recordFailureAndFail('render-crash', reason, ErrorCode.UNKNOWN_ERROR)
  }

  /** A page `console-message` already classified into a failure input. */
  private onConsoleMessage(input: PreviewFailureInput): void {
    this.recordFailureAndFail(input.type, input.resourceUrlOrHost, input.reasonCode)
  }

  /** Entry-file unlink (and rename, which unlinks the old path): failed + deleted. */
  private onEntryDeleted(): void {
    // A deleted file's picture must not be what an evicted tab shows later.
    this.deps.stillFrameCache.invalidate(this.panelId)
    this.recordFailureAndFail(
      'missing-local-file',
      basename(this.currentPage()),
      ErrorCode.PREVIEW_LOCAL_FILE_MISSING
    )
  }

  /**
   * A move or history step landed (issue #124). The page keeps the reader's
   * zoom; one that committed with an error status is `failed` – the load-state
   * step of the entry-unlink path, with no second record: the handler already
   * listed the page in its badge (part 3 §3.5).
   */
  private onMoveLanded(failed: boolean): void {
    if (this.zoomLevel !== 0 && !this.isDefunct) {
      this.wc.setZoomLevel(this.zoomLevel)
    }
    if (failed) {
      this.deps.emit.loadStateChanged(this.panelId, 'failed', 0)
    }
  }

  private recordFailureAndFail(
    type: PreviewFailureType,
    resourceUrlOrHost: string,
    reasonCode: ErrorCode
  ): void {
    this.pageScopes.committed().recordFailure({ type, resourceUrlOrHost, reasonCode })
    this.deps.emit.loadStateChanged(this.panelId, 'failed', 0)
  }

  /**
   * Tear down the view. `immediate` destroys the webContents straight away
   * (project switch / dispose / replace); `bounded` races `close()` against
   * `PREVIEW.CLOSE_TIMEOUT_MS` before forcing `destroy()` (a user tab close, X21).
   * The order, and why, is `teardownLiveView`'s.
   *
   * Not `async`: it hands back the teardown's own promise, so a caller awaits
   * exactly what it awaited before the split.
   */
  teardown(mode: 'immediate' | 'bounded'): Promise<void> {
    if (this.destroyed) {
      return Promise.resolve()
    }
    this.destroyed = true
    this.parts.pipeline.cancel()
    return teardownLiveView({
      panelId: this.panelId,
      mode,
      window: this.window,
      view: this.view,
      wc: this.wc,
      collaborators: [
        { label: 'lifecycle.dispose', runAsync: () => this.parts.lifecycle.dispose() },
        { label: 'entryWatch.dispose', runAsync: () => this.parts.entryWatch.dispose() },
        { label: 'frameEvents.dispose', run: () => this.parts.frameEvents.dispose() },
        { label: 'freshness.dispose', run: () => this.parts.freshness.dispose() },
        { label: 'page.dispose', run: () => this.parts.page.dispose() },
        {
          label: 'watchCoordinator.dispose',
          runAsync: () => this.parts.watchCoordinator.dispose()
        },
        { label: 'linkBridge.dispose', run: () => this.parts.linkBridge.dispose() },
        { label: 'reloadPolicy.dispose', run: () => this.parts.reloadPolicy.dispose() },
        { label: 'findController.dispose', run: () => this.parts.findController.dispose() },
        // Where `failureLog.drop()` ran: both page scopes and their timers go,
        // the CSP dedupe with them, and nothing is emitted (RA3-1).
        { label: 'pageScopes.dispose', run: () => this.pageScopes.dispose() },
        {
          label: 'stillFrameCache.invalidate',
          run: () => this.deps.stillFrameCache.invalidate(this.panelId)
        },
        { label: 'registry.revoke', run: () => this.deps.registry.revoke(this.token) }
      ],
      onClosing: () => {
        this.closing = true
      },
      detach: this.factoryTeardown,
      release: this.sessionRelease
    })
  }
}
