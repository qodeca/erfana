// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One live preview view (Issue #74, work item 39; design §1.4, §5).
 *
 * Encapsulates everything that hangs off a single sealed `WebContentsView` —
 * bounds, the rate-limited post-load pipeline, the CSS hot-swap, the four
 * lifecycle events, find/export and a bounded teardown — so `PreviewViewService`
 * stays a thin single-view MANAGER and each file stays under the 500-line cap.
 *
 * The service owns the "only one, replace-not-refuse" policy and hands a fully
 * factory-built session to this class, which wires the per-view collaborators
 * (watch coordinator, reload policy, find controller) and the lifecycle listeners.
 *
 * Trust model: the previewed page is untrusted; every signal it drives here
 * (failure strings, still frames, find counts) is bounded, coalesced DATA.
 */

import { basename, dirname, relative, resolve, sep } from 'node:path'
import { open } from 'node:fs/promises'

import { ErrorCode } from '../../../shared/errors'
import { PREVIEW } from '../../../shared/constants'
import { logger } from '../LoggingService'
import type {
  PdfExportResult,
  PreviewBounds,
  PreviewEmitters,
  PreviewFailureInput,
  PreviewFailureType
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
import type { IPreviewFailureLog } from './PreviewFailureLog'
import type {
  PreviewSession,
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import {
  INITIAL_BACKDROP_STATE,
  READ_PAGE_BACKDROP_SCRIPT,
  argbToCss,
  backdropColor,
  nextBackdropState,
  toArgb,
  type BackdropEvent,
  type BackdropState
} from './previewBackdrop'
import { extractStaticLinks } from './linkExtract'
import { buildCacheBustHref, buildCssSwapScript } from './previewCssSwap'
import { clampAndZoomBounds } from './previewBoundsClamp'
import { wirePreviewLifecycle, type PreviewFileWatcherHandle } from './previewViewLifecycle'
import { createPreviewLinkBridge, type PreviewLinkBridge } from './previewLinkBridge'

/**
 * Isolated world for reading the page's own paper. Distinct from the CSS-swap
 * world so a hung swap script cannot block the backdrop read.
 */
const BACKDROP_WORLD_ID = 998

/** A non-main isolated world for the CSS-swap script (§1.4: page cannot shadow it). */
const SWAP_WORLD_ID = 999

/** The slice of a `BrowserWindow` a live view uses. Structural for tests. */
export interface PreviewWindowLike {
  /**
   * `BrowserWindow.id`. Stored with the registry entry because panel ids are
   * path-derived, so two windows previewing the same file mint the same id
   * (sd-074b §4.2).
   */
  readonly id: number
  readonly contentView: {
    addChildView(view: PreviewViewHandle): void
    removeChildView(view: PreviewViewHandle): void
  }
  getContentBounds(): { x: number; y: number; width: number; height: number }
}

/** Shared (non-per-view) collaborators a live view needs. */
export interface PreviewLiveViewDeps {
  readonly emit: PreviewEmitters
  readonly stillFrameCache: IPreviewStillFrameCache
  readonly exportController: IPreviewExportController
  readonly registry: Pick<IPreviewRootRegistry, 'rebuildCsp' | 'revoke'>
  readonly storageSeal: { purge(session: PreviewSessionLike): Promise<void> }
  readonly hostBlockNotifier: IPreviewHostBlockNotifier
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
  readonly createEntryWatcher: (
    filePath: string,
    handlers: { onChange(): void; onUnlink(): void; onError(error: unknown): void }
  ) => PreviewFileWatcherHandle
  readonly getZoomFactor: () => number
  readonly now: () => number
  readonly readEntryHtml?: (filePath: string) => Promise<string>
  readonly onForwardedShortcut?: (panelId: string, key: string) => void
  readonly platform?: NodeJS.Platform
  /**
   * Hand a vetted URL to the OS browser (sd-074b §5.5). Injected rather than
   * importing `shell` here, so link routing is unit-testable without Electron.
   * Absent means external links are refused and badged.
   */
  readonly openExternal?: (url: string) => Promise<void>
}

/** What the manager hands to a new live view. */
export interface PreviewLiveViewParams {
  readonly panelId: string
  readonly projectPath: string
  readonly entryFilePath: string
  readonly window: PreviewWindowLike
  readonly initialBounds: PreviewBounds
  readonly session: PreviewSession
  readonly failureLog: IPreviewFailureLog
  readonly deps: PreviewLiveViewDeps
}

/**
 * Read at most `PREVIEW.MAX_ENTRY_HTML_BYTES` of the entry HTML for static-link
 * discovery. Bounding the read bounds the synchronous parse5 parse that follows,
 * so a large or generated entry file cannot freeze the main thread on reload.
 */
async function readEntryHtmlBounded(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(PREVIEW.MAX_ENTRY_HTML_BYTES)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    return buffer.toString('utf8', 0, total)
  } finally {
    await handle.close()
  }
}

/** Build an `erfana-preview://<token>/<enc rel>` URL for an absolute local path. */
function buildPreviewUrl(token: string, realRoot: string, absPath: string): string {
  const rel = relative(realRoot, absPath).split(sep).map(encodeURIComponent).join('/')
  return `erfana-preview://${token}/${rel}`
}

export class PreviewLiveView {
  readonly panelId: string
  readonly projectPath: string

  private readonly view: PreviewViewHandle
  private readonly wc: PreviewWebContentsHandle
  private readonly session: PreviewSessionLike
  private readonly token: string
  private readonly realRoot: string
  private readonly entryFilePath: string
  private readonly window: PreviewWindowLike
  private readonly failureLog: IPreviewFailureLog
  private readonly deps: PreviewLiveViewDeps
  private readonly readEntryHtml: (filePath: string) => Promise<string>
  private readonly watchCoordinator: IPreviewWatchCoordinator
  private readonly reloadPolicy: IPreviewReloadPolicy
  private readonly findController: IPreviewFindController
  private readonly lifecycle: { dispose(): Promise<void> }
  private readonly factoryTeardown: () => void
  private readonly linkBridge: PreviewLinkBridge

  private lastBoundsSeq = -1
  private lastBounds: PreviewBounds | null = null
  private swapVersion = 0
  // Negative-infinity so the FIRST post-load pipeline always clears the rate-limit
  // window and runs immediately; subsequent runs are gated to one per interval.
  private lastPipelineAt = Number.NEGATIVE_INFINITY
  private trailingTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private closing = false
  /** Which backdrop the view is showing, and whether its first load is still ahead. */
  private backdrop: BackdropState = INITIAL_BACKDROP_STATE
  /** The page's own resolved paper, once read; `null` until then. */
  private pageBackdrop: string | null = null

  constructor(params: PreviewLiveViewParams) {
    this.panelId = params.panelId
    this.projectPath = params.projectPath
    this.entryFilePath = params.entryFilePath
    this.window = params.window
    this.failureLog = params.failureLog
    this.deps = params.deps
    this.readEntryHtml = params.deps.readEntryHtml ?? readEntryHtmlBounded

    this.view = params.session.view
    this.wc = params.session.view.webContents
    this.session = params.session.session
    this.token = params.session.token
    this.realRoot = params.session.realRoot
    this.factoryTeardown = params.session.teardown

    this.watchCoordinator = this.deps.createWatchCoordinator(this.realRoot, (paths) =>
      this.onWatchChanged(paths)
    )
    this.reloadPolicy = this.deps.createReloadPolicy((decision) =>
      this.handleReloadDecision(decision)
    )
    this.findController = this.deps.createFindController(this.wc, (count) =>
      this.deps.emit.findResult({
        panelId: this.panelId,
        requestId: 0,
        matches: count.total,
        activeMatchOrdinal: count.activeOrdinal
      })
    )

    this.linkBridge = createPreviewLinkBridge(
      {
        panelId: this.panelId,
        token: this.token,
        realRoot: this.realRoot,
        windowId: params.window.id,
        currentUrl: buildPreviewUrl(this.token, this.realRoot, this.entryFilePath)
      },
      {
        requestOpenFile: (sourcePanelId, filePath, anchor, windowId) =>
          this.deps.emit.openFileRequested(sourcePanelId, filePath, anchor, windowId),
        openExternal: (url) =>
          this.deps.openExternal?.(url) ?? Promise.reject(new Error('No external opener')),
        recordFailure: (input) => this.failureLog.record(input)
      }
    )

    this.lifecycle = wirePreviewLifecycle(
      {
        webContents: this.wc,
        entryFilePath: this.entryFilePath,
        createEntryWatcher: this.deps.createEntryWatcher,
        platform: this.deps.platform
      },
      {
        onRenderProcessGone: (reason) => {
          this.moveBackdrop('crashed')
          this.onCrash(reason ?? 'crashed')
        },
        onUnresponsive: () => this.onCrash('unresponsive'),
        onDidFinishLoad: () => this.schedulePipeline(),
        // Backdrop transitions are SIBLINGS of the post-load pipeline, never
        // routed through it: `schedulePipeline` is rate-limited and drops events
        // during a save burst, and a dropped transition leaves the page
        // unreadable.
        onDidStartLoading: () => this.moveBackdrop('start-loading'),
        onDidStopLoading: () => void this.onLoadSettled(),
        onDidFailLoad: () => void this.onLoadSettled('fail-load'),
        // Route the entry change through the same coalescing reload policy the
        // subresources use, so an entry+stylesheet save collapses to ONE reload
        // decision instead of racing an immediate reload against a CSS swap.
        onEntryChange: () => this.reloadPolicy.record(this.entryFilePath),
        onEntryDeleted: () => this.onEntryDeleted(),
        onForwardedShortcut: (key) => this.deps.onForwardedShortcut?.(this.panelId, key),
        onConsoleMessage: (input) => this.onConsoleMessage(input),
        onLinkActivated: (payload) => this.linkBridge.handleActivation(payload),
        onNavigationAttempt: (url) => this.linkBridge.handleWillNavigate(url)
      }
    )

    this.window.contentView.addChildView(this.view)
    const dip = this.computeBounds(params.initialBounds)
    if (dip !== null) {
      this.lastBounds = dip
      this.view.setBounds(dip)
    }
    this.applyBackdrop()
  }

  /**
   * Advance the backdrop state machine and repaint if the colour moved.
   *
   * @param event - The lifecycle edge that fired.
   */
  private moveBackdrop(event: BackdropEvent): void {
    const next = nextBackdropState(this.backdrop, event)
    if (next === this.backdrop) {
      return
    }
    this.backdrop = next
    this.applyBackdrop()
  }

  /**
   * Paint the current backdrop on the native view and tell the renderer, so the
   * DOM placeholder behind the view carries the identical value.
   */
  private applyBackdrop(): void {
    if (this.isDefunct) {
      return
    }
    const argb = backdropColor(this.backdrop, this.pageBackdrop)
    this.view.setBackgroundColor(argb)
    const css = argbToCss(argb)
    if (css !== null) {
      this.deps.emit.backdropChanged(this.panelId, css)
    }
  }

  /**
   * A load terminated — by success, by failure, or by the page calling
   * `window.stop()`. Read the page's own paper, then hand it the backdrop.
   *
   * The read runs in its own isolated world, so the page cannot shadow
   * `getComputedStyle`, and its result is parsed strictly by `toArgb`: the value
   * crosses a trust boundary and is interpolated into a colour, so anything
   * unrecognised falls back rather than being passed through.
   */
  private async onLoadSettled(event: BackdropEvent = 'stop-loading'): Promise<void> {
    if (this.isDefunct) {
      return
    }
    try {
      const raw = await this.wc.executeJavaScriptInIsolatedWorld(BACKDROP_WORLD_ID, [
        { code: READ_PAGE_BACKDROP_SCRIPT }
      ])
      this.pageBackdrop = toArgb(raw)
    } catch {
      // A page that refuses to be measured gets the browser default.
      this.pageBackdrop = null
    }
    if (this.isDefunct) {
      return
    }
    // Move AFTER the read so the repaint carries the resolved paper rather than
    // flashing the fallback white and correcting a frame later.
    this.backdrop = nextBackdropState(this.backdrop, event)
    this.applyBackdrop()
  }

  /** Emit `loading` and navigate to the entry file. Failures surface via events. */
  async load(): Promise<void> {
    this.deps.emit.loadStateChanged(this.panelId, 'loading', 0)
    try {
      await this.wc.loadURL(buildPreviewUrl(this.token, this.realRoot, this.entryFilePath))
    } catch {
      // A load failure surfaces through the lifecycle events; do not throw here.
    }
  }

  /**
   * True once torn down, closing, or the webContents is gone; guards late
   * external calls.
   *
   * `closing` matters because `boundedDestroy` calls `wc.close()` and then waits
   * up to `PREVIEW.CLOSE_TIMEOUT_MS` — a full second during which the contents
   * is going away but `isDestroyed()` still answers `false` (sd-074b §4.4).
   */
  private get isDefunct(): boolean {
    return this.destroyed || this.closing || this.wc.isDestroyed()
  }

  setBounds(bounds: PreviewBounds, seq: number): void {
    if (this.isDefunct) {
      return
    }
    if (seq <= this.lastBoundsSeq) {
      return
    }
    this.lastBoundsSeq = seq
    const dip = this.computeBounds(bounds)
    if (dip === null) {
      return
    }
    this.lastBounds = dip
    this.view.setBounds(dip)
  }

  /**
   * Show or hide the native view.
   *
   * ORDERING IS THE HARD PART. The hide path captures a still frame first, which
   * is a real async round trip, while the show path is entirely synchronous. So
   * a hide that started earlier can finish LATER than a show that started after
   * it — open an overlay and dismiss it quickly and the late hide wins, leaving
   * the view hidden while `OverlayGuardService` has already recorded it visible.
   * Because that guard only re-sends on a CHANGE, nothing corrects it and the
   * panel stays on its placeholder until some unrelated transition (F10).
   *
   * `wantedVisible` is the last state anyone asked for. The hide re-reads it
   * after the capture and stands down if a show overtook it. The call is also
   * fire-and-forget from `ipcMain.on`, so nothing else serialises these.
   */
  private wantedVisible = false

  async setVisibility(visible: boolean): Promise<void> {
    if (this.isDefunct) {
      return
    }
    this.wantedVisible = visible

    if (visible) {
      // Re-adding an already-present child reorders it topmost (design §5(d)).
      this.window.contentView.addChildView(this.view)
      this.view.setVisible(true)
      return
    }
    // Capture BEFORE hiding — the capturer count keeps the page live mid-capture.
    await this.deps.stillFrameCache.captureIfStale(
      this.wc,
      this.panelId,
      this.lastBounds ?? { x: 0, y: 0, width: 0, height: 0 }
    )

    // A show landed while we were capturing, or the view died. Either way this
    // hide is stale; the frame we just captured is still worth keeping.
    if (this.wantedVisible || this.isDefunct) {
      return
    }

    const frame = this.deps.stillFrameCache.get(this.panelId)
    if (frame !== undefined) {
      this.deps.emit.stillFrameChanged(this.panelId, frame)
    }
    this.view.setVisible(false)
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

  reload(ignoreCache: boolean): void {
    this.doReload(ignoreCache)
  }

  swapStylesheet(relPath: string): Promise<boolean> {
    return this.doSwap(resolve(dirname(this.entryFilePath), relPath))
  }

  async applyApprovedHosts(hosts: readonly string[]): Promise<void> {
    if (this.isDefunct) {
      return
    }
    // §5(c): rebuild the CSP on the registry entry, purge, clear failures, reload.
    this.deps.registry.rebuildCsp(this.token, hosts)
    await this.deps.storageSeal.purge(this.session)
    // Re-check AFTER the await: the purge yields, and a teardown starting in
    // that window would otherwise leave `failureLog.clear()` re-emitting into a
    // dropped log and `reloadIgnoringCache()` reaching a closing WebContents.
    if (this.isDefunct) {
      return
    }
    this.failureLog.clear()
    this.wc.reloadIgnoringCache()
  }

  find(text: string, options: PreviewFindOptions): void {
    if (this.isDefunct) {
      return
    }
    this.findController.find(text, options)
  }

  stopFind(): void {
    if (this.isDefunct) {
      return
    }
    this.findController.clearHighlights()
  }

  exportPdf(suggestedName: string): Promise<PdfExportResult> {
    return this.deps.exportController.exportToPdf(this.wc, suggestedName)
  }

  /** Zoom-convert + clamp a CSS-px rect to the window content rect (§4.3). */
  private computeBounds(cssRect: PreviewBounds): PreviewBounds | null {
    const content = this.window.getContentBounds()
    return clampAndZoomBounds(
      cssRect,
      { width: content.width, height: content.height },
      this.deps.getZoomFactor()
    )
  }

  /** A watched subresource changed — feed each path to the reload policy. */
  private onWatchChanged(paths: readonly string[]): void {
    if (this.destroyed) {
      return
    }
    for (const path of paths) {
      this.reloadPolicy.record(path)
    }
  }

  /** The reload policy classified a burst: swap one stylesheet or full reload. */
  private handleReloadDecision(decision: ReloadDecision): void {
    if (this.destroyed) {
      return
    }
    this.deps.stillFrameCache.invalidate(this.panelId)
    if (decision.action === 'swap') {
      void this.doSwap(decision.changedPath)
    } else {
      this.doReload(false)
    }
  }

  private doReload(ignoreCache: boolean): void {
    if (this.destroyed) {
      return
    }
    if (ignoreCache) {
      this.wc.reloadIgnoringCache()
    } else {
      this.wc.reload()
    }
  }

  /** Hot-swap a stylesheet in an isolated world; any non-`true` outcome reloads. */
  private async doSwap(absPath: string): Promise<boolean> {
    const base = buildPreviewUrl(this.token, this.realRoot, absPath)
    this.swapVersion += 1
    const script = buildCssSwapScript(base, buildCacheBustHref(base, this.swapVersion))

    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<'timeout'>((res) => {
      timer = setTimeout(() => res('timeout'), PREVIEW.SWAP_TIMEOUT_MS)
    })
    const swap = this.wc
      .executeJavaScriptInIsolatedWorld(SWAP_WORLD_ID, [{ code: script }])
      .then((value) => value, () => 'error' as const)

    const outcome = await Promise.race([swap, timeout])
    if (timer !== null) {
      clearTimeout(timer)
    }
    if (outcome === true) {
      return true
    }
    // Timeout, throw, `false` or a non-boolean ⇒ fall back to a full reload.
    if (!this.destroyed) {
      this.wc.reload()
    }
    return false
  }

  /** The rate-limited post-load pipeline scheduler (§1.4). */
  private schedulePipeline(): void {
    if (this.destroyed) {
      return
    }
    const elapsed = this.deps.now() - this.lastPipelineAt
    if (elapsed >= PREVIEW.RELOAD_MIN_INTERVAL_MS) {
      void this.runPipeline()
    } else if (this.trailingTimer === null) {
      // One trailing run at the window's end; further did-finish-loads are dropped.
      this.trailingTimer = setTimeout(() => {
        this.trailingTimer = null
        void this.runPipeline()
      }, PREVIEW.RELOAD_MIN_INTERVAL_MS - elapsed)
    }
  }

  /** One post-load pipeline: read entry → extract links → set watch → emit ready. */
  private async runPipeline(): Promise<void> {
    if (this.destroyed) {
      return
    }
    this.lastPipelineAt = this.deps.now()

    let html: string
    try {
      html = await this.readEntryHtml(this.entryFilePath)
    } catch {
      // A missing entry surfaces via the entry-file unlink event, not here.
      return
    }
    if (this.destroyed) {
      return
    }

    const dir = dirname(this.entryFilePath)
    const candidates = extractStaticLinks(html).map((link) => resolve(dir, link))
    const result = await this.watchCoordinator.setWatchSet(candidates)
    if (this.destroyed) {
      return
    }
    this.deps.stillFrameCache.invalidate(this.panelId)
    this.deps.emit.loadStateChanged(this.panelId, 'ready', result.dropped.length)
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
    this.recordFailureAndFail(
      'missing-local-file',
      basename(this.entryFilePath),
      ErrorCode.PREVIEW_LOCAL_FILE_MISSING
    )
  }

  private recordFailureAndFail(
    type: PreviewFailureType,
    resourceUrlOrHost: string,
    reasonCode: ErrorCode
  ): void {
    this.failureLog.record({ type, resourceUrlOrHost, reasonCode })
    this.deps.emit.loadStateChanged(this.panelId, 'failed', 0)
  }

  /**
   * Tear down the view. `immediate` destroys the webContents straight away
   * (project switch / dispose / replace); `bounded` races `close()` against
   * `PREVIEW.CLOSE_TIMEOUT_MS` before forcing `destroy()` (a user tab close, X21).
   */
  async teardown(mode: 'immediate' | 'bounded'): Promise<void> {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    if (this.trailingTimer !== null) {
      clearTimeout(this.trailingTimer)
      this.trailingTimer = null
    }

    // EVERY step is individually guarded and the destroy is in a `finally`.
    // Before this, `lifecycle.dispose()` and `watchCoordinator.dispose()` were
    // awaited bare: a throw from either (a chokidar `close()` rejecting, say)
    // skipped the token revoke, the still-frame invalidate AND `wc.destroy()`,
    // while `this.destroyed` was already latched at the top — leaving a
    // permanently inert object holding a live WebContents and a registry token.
    // Under the multi-view registry that also strands the panel id forever,
    // because every re-open would take the replace branch and re-await this
    // same dead teardown (sd-074b §4.1).
    await this.disposeCollaborators().finally(async () => {
      if (mode === 'bounded') {
        await this.boundedDestroy()
      } else if (!this.wc.isDestroyed()) {
        this.wc.destroy()
      }
    })
  }

  /**
   * Release every collaborator this view owns. Each step is isolated so one
   * failure cannot skip the rest; failures are logged, never rethrown, because
   * a teardown that reports an error is still a teardown that must complete.
   */
  private async disposeCollaborators(): Promise<void> {
    const step = (label: string, run: () => void): void => {
      try {
        run()
      } catch (error) {
        logger.warn('Preview teardown step failed', {
          panelId: this.panelId,
          step: label,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    const asyncStep = async (label: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run()
      } catch (error) {
        logger.warn('Preview teardown step failed', {
          panelId: this.panelId,
          step: label,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    step('removeChildView', () => this.window.contentView.removeChildView(this.view))
    await asyncStep('lifecycle.dispose', () => this.lifecycle.dispose())
    step('factoryTeardown', () => this.factoryTeardown())
    await asyncStep('watchCoordinator.dispose', () => this.watchCoordinator.dispose())
    step('linkBridge.dispose', () => this.linkBridge.dispose())
    step('reloadPolicy.dispose', () => this.reloadPolicy.dispose())
    step('findController.dispose', () => this.findController.dispose())
    step('failureLog.drop', () => this.failureLog.drop())
    step('stillFrameCache.invalidate', () => this.deps.stillFrameCache.invalidate(this.panelId))
    step('registry.revoke', () => this.deps.registry.revoke(this.token))
    await asyncStep('storageSeal.purge', () => this.deps.storageSeal.purge(this.session))
  }

  /** Race `close()` against `CLOSE_TIMEOUT_MS`, then force `destroy()` (X21). */
  private boundedDestroy(): Promise<void> {
    this.closing = true
    const wc = this.wc
    return new Promise<void>((resolvePromise) => {
      if (wc.isDestroyed()) {
        resolvePromise()
        return
      }
      let settled = false
      const finish = (): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        resolvePromise()
      }
      const timer = setTimeout(() => {
        if (!wc.isDestroyed()) {
          wc.destroy()
        }
        finish()
      }, PREVIEW.CLOSE_TIMEOUT_MS)
      wc.once('destroyed', (() => finish()) as (...args: never[]) => void)
      try {
        wc.close()
      } catch {
        if (!wc.isDestroyed()) {
          wc.destroy()
        }
        finish()
      }
    })
  }
}
