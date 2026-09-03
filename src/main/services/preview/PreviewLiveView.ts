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
import { withTimeout } from '../../utils/withTimeout'
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
import type { PreviewBlockedKind } from '../../../shared/ipc/previewBlockedKind'
import { createPreviewLinkBridge, type PreviewLinkBridge } from './previewLinkBridge'
import {
  createPreviewCspViolationBridge,
  type PreviewCspViolationBridge
} from './previewCspViolationBridge'

/**
 * Isolated world for reading the page's own paper. Distinct from the CSS-swap
 * world so a hung swap script cannot block the backdrop read.
 */
const BACKDROP_WORLD_ID = 998

/** A non-main isolated world for the CSS-swap script (§1.4: page cannot shadow it). */
const SWAP_WORLD_ID = 999

/**
 * Isolated world for the bounds-repaint confirmation. Distinct from the backdrop
 * and CSS-swap worlds so a long-running swap cannot delay it.
 */
const BOUNDS_ACK_WORLD_ID = 997

/**
 * Resolve once the page has produced a frame at its current size.
 *
 * Two frames, not one: the first can be one already scheduled before the resize
 * reached the page, so only the second is certainly after it.
 */
const REPAINTED_SCRIPT = `new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.innerHeight)))
})`

/** The slice of a `BrowserWindow` a live view uses. Structural for tests. */
export interface PreviewWindowLike {
  /**
   * Whether the host window is gone.
   *
   * REQUIRED, not optional. An optional member fails open — every existing test
   * fake omitted it, and the production object arrives through an unchecked
   * `as PreviewWindowLike` cast in `lifecycle-handlers.ts`, so a typo would pass
   * silently and the guard would never run. Belt-and-braces beside the
   * per-window drain in `PreviewViewService.closeWindow`, which is what actually
   * stops a view outliving its window.
   */
  isDestroyed(): boolean
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
   * Hand a vetted URL to the OS browser (sd-074b §5.5), asking on the window
   * this view belongs to. Injected rather than importing `shell` here, so link
   * routing is unit-testable without Electron. Absent means external links are
   * refused and badged.
   */
  readonly openExternal?: (url: string, windowId: number) => Promise<void>
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
  /**
   * Report a remote host the page's CSP refused.
   *
   * The SAME sink `PreviewSessionFactory` is given for network-layer refusals,
   * so a CSP refusal and a filter refusal share one failure type, one toast
   * budget and one dedupe rule.
   *
   * REQUIRED, not optional. An optional sink fails open in precisely the shape
   * of the defect it exists to fix — a missing wire would mean CSP refusals go
   * unreported and the Approve prompt never appears, silently. There is exactly
   * one construction site in the codebase, so required costs nothing and turns
   * a future missing wire into a compile error. (Same reasoning as
   * `isDestroyed` on `PreviewWindowLike`.)
   */
  readonly onBlockedHost: (
    host: string,
    url: string,
    approvable: boolean,
    kind: PreviewBlockedKind
  ) => void
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
  private readonly cspViolationBridge: PreviewCspViolationBridge

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
          this.deps.openExternal?.(url, this.window.id) ??
          Promise.reject(new Error('No external opener')),
        recordFailure: (input) => this.failureLog.record(input)
      }
    )

    this.cspViolationBridge = createPreviewCspViolationBridge({
      onBlockedHost: (host, url, approvable, kind) =>
        params.onBlockedHost(host, url, approvable, kind)
    })

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
        onNavigationAttempt: (url) => this.linkBridge.handleWillNavigate(url),
        onCspViolation: (payload) => this.cspViolationBridge.handleViolation(payload)
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

  setBounds(bounds: PreviewBounds, seq: number, ack = false): void {
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

    // Every path that returns EARLY above deliberately emits nothing. A caller
    // waiting on this confirmation must fall back safely on silence, and a
    // dropped push is exactly a case where it must: the view is not where the
    // renderer believes it is.
    if (ack) {
      void this.confirmRepaint(seq)
    }
  }

  /**
   * Tell the renderer once the PAGE has repainted at its new size.
   *
   * WHY THIS ASKS THE PAGE. The obvious confirmation is "`view.setBounds`
   * returned", which assumes a `WebContentsView`'s composited texture is clipped
   * to its bounds in that same frame. That could not be verified from inside the
   * app — `capturePage` on the host does NOT include native child views, so the
   * host cannot observe what the compositor did, and checking it properly would
   * need an OS-level screen grab behind a permission prompt. Rather than build a
   * security control on an unverifiable claim, this asks the page for something
   * directly observable: two animation frames, which cannot both run before the
   * resize has been applied to it.
   *
   * Isolated world, so a page cannot shadow `requestAnimationFrame` and answer
   * early on Erfana's behalf.
   *
   * The reported height is logged, never compared. The page's own zoom level
   * makes `innerHeight` differ from the DIP height by design, so an equality
   * check would fail on every zoomed preview; the frame count is the guarantee.
   *
   * Measured on Electron 39: ~17 ms for an idle page, ~120-139 ms for one doing
   * real work each frame, and NEVER for a page that refuses to yield. The last
   * case is why callers need a timeout — and why silence is safe to treat as
   * "assume it is still covering you": a page that never yields never repaints
   * either, so its stale texture really is still at the old geometry.
   */
  private async confirmRepaint(seq: number): Promise<void> {
    try {
      const height = await this.wc.executeJavaScriptInIsolatedWorld(BOUNDS_ACK_WORLD_ID, [
        { code: REPAINTED_SCRIPT }
      ])
      if (this.isDefunct || seq !== this.lastBoundsSeq) {
        // A newer push overtook this one; that push owns the confirmation.
        return
      }
      this.deps.emit.boundsApplied(this.panelId, seq)
      logger.debug('Preview bounds applied', { panelId: this.panelId, seq, height })
    } catch {
      // A page that tore down mid-frame, or a world that could not run. Silence
      // is the safe answer, and the caller already has to handle it.
    }
  }

  /**
   * Show or hide the native view.
   *
   * THE HIDE IS SYNCHRONOUS, AND THAT IS THE WHOLE POINT.
   *
   * A native view takes pointer input over its own rectangle, whatever the DOM
   * says. So every millisecond between "an overlay opened" and
   * `view.setVisible(false)` is a millisecond in which the previewed page is
   * eating clicks meant for a dialog that is already drawn on screen.
   *
   * This method used to `await` the still-frame capture BEFORE hiding. The
   * reported symptom was exact: a Delete confirmation appeared over a preview of
   * a very large page, and none of its buttons could be clicked — Escape worked,
   * because the keyboard does not route through the view. Trying again worked,
   * because the first capture was still in flight and `captureIfStale` skips
   * when one is, so the second hide reached `setVisible(false)` immediately.
   * A confirm dialog whose buttons respond on the second attempt is the worst
   * possible failure for a control that deletes a file.
   *
   * The capture is still started FIRST, and still not awaited: calling
   * `capturePage` raises the capturer count, which is what keeps the page
   * producing frames while the view is hidden, so starting it and hiding in the
   * same tick captures live pixels without anyone waiting.
   *
   * The previous frame is emitted up front so the placeholder is already showing
   * something at the moment the view disappears. Without it a hide would flash
   * the backdrop colour until the fresh capture landed.
   *
   * THE RACE THIS ALSO REMOVES. The old ordering comment described a real bug: a
   * hide that started earlier could finish LATER than a show that started after
   * it, leaving the view hidden while `OverlayGuardService` had recorded it
   * visible — and because that guard only re-sends on a CHANGE, nothing
   * corrected it and the panel stayed on its placeholder until some unrelated
   * transition. A synchronous hide cannot be overtaken, so that window is gone
   * rather than merely narrowed. `wantedVisible` survives because the capture's
   * TAIL is still async, and a frame captured for a hide that has since been
   * superseded must not be published as the panel's current picture.
   */
  /*
   * TRUE FROM BIRTH, because that is what the view actually is.
   *
   * The constructor adds the view to the window's content view and a fresh
   * `WebContentsView` is drawn unless something hides it, so starting this at
   * `false` described a state that never existed. It mattered once
   * `captureWhileVisible` began reading it: the load pipeline reaches `'ready'`
   * before the renderer's first `setVisibility(true)` has necessarily arrived,
   * so a `false` default meant the one capture that matters was skipped and
   * every hide published nothing.
   */
  private wantedVisible = true

  /**
   * Every still-frame capture this view has started that has not settled yet.
   *
   * Nothing on the interactive path waits for this — that is the whole point of
   * the synchronous hide. It exists for the ONE caller that legitimately must:
   * eviction, which hides a view and then destroys its `webContents` a line
   * later. Without somewhere to await, that teardown races the capture and a
   * suspended panel wakes up with no picture, which is exactly what the frame
   * was captured for.
   *
   * It ACCUMULATES rather than being replaced, and that is load-bearing. See
   * `captureWhileVisible`.
   */
  private pendingCapture: Promise<void> = Promise.resolve()

  /**
   * Resolve once every still-frame capture this view started has settled.
   *
   * For callers about to destroy this view. Never call it from an overlay path.
   *
   * Never rejects: `Promise.allSettled` absorbs a failed capture, because the
   * only question this answers is "is Chromium still reading this page?", and a
   * capture that failed is a capture that has stopped reading. A caller about to
   * call `destroy()` has nothing to do with the error either way, and a
   * rejection here would be an unhandled one on the ordinary path, where nobody
   * awaits this at all.
   */
  whenCaptureSettled(): Promise<void> {
    return this.pendingCapture
  }

  setVisibility(visible: boolean): void {
    if (this.isDefunct) {
      return
    }
    /*
     * `isDefunct` asks about the CONTENTS; this asks about the WINDOW, and the
     * show path below reaches through the window to `contentView.addChildView`.
     * Against a destroyed `BrowserWindow` that throws — and because the caller
     * `void`s an async method, it would surface as an unhandled rejection rather
     * than anything anyone sees.
     *
     * Deliberately NOT folded into `isDefunct`, which has fifteen call sites and
     * two that would change meaning: `setVisibility` would stop emitting
     * `visibilityApplied` (what the overlay guard reconciles against) and
     * `captureWhileVisible`'s `shouldKeep` would start discarding good frames.
     * The window is destroyed only in the gap between `BrowserWindow` teardown
     * and `drainWindow`, so every panel here is on its way out regardless; not
     * emitting is the honest answer, and it is scoped to the one method that
     * can actually throw.
     */
    if (this.window.isDestroyed()) {
      return
    }
    this.wantedVisible = visible

    if (visible) {
      // Re-adding an already-present child reorders it topmost (design §5(d)).
      this.window.contentView.addChildView(this.view)
      this.view.setVisible(true)
      this.deps.emit.visibilityApplied(this.panelId, true)
      return
    }

    // The frame captured while the page was on screen, published before the view
    // goes, so the hide is not a flash of empty backdrop.
    const frame = this.deps.stillFrameCache.get(this.panelId)
    if (frame !== undefined) {
      this.deps.emit.stillFrameChanged(this.panelId, frame)
    }

    this.view.setVisible(false)
    this.deps.emit.visibilityApplied(this.panelId, false)
  }

  /**
   * Refresh the still frame, from a view that is ON SCREEN.
   *
   * WHY NOT AT HIDE TIME, WHICH IS THE OBVIOUS PLACE. A hide must be
   * synchronous — a native view eats clicks meant for whatever overlay just
   * opened — so a capture at hide time is necessarily still running after
   * `setVisible(false)`. That left a `stayHidden` capture in flight across, and
   * after, the hide, which is a state this code never used to enter, and it
   * lines up with a reported fault where the page never came back: the panel
   * went flat black and stayed that way.
   *
   * Whether a capture overlapping `View.setVisible(false)` settles at all, or
   * leaves the page non-painting afterwards, is runtime Chromium behaviour this
   * repo cannot answer. So it does not do it. Captures happen only while the
   * view is drawn, and the hide publishes what is already cached.
   *
   * The cost is stated rather than hidden: the picture is from the last capture,
   * not the last painted pixel, so a page that animates after load shows the
   * frame it had then. For a placeholder behind a permission list that is the
   * right trade — a slightly old picture beats a black rectangle, and beats a
   * class of bug nobody can reproduce.
   *
   * Never awaited by anything interactive. `whenCaptureSettled` exists for
   * eviction, which destroys the page a line later.
   */
  private captureWhileVisible(): void {
    if (this.isDefunct || !this.wantedVisible) return

    // Only the SIZE of `lastBounds` travels: its `x`/`y` are window-relative
    // DIPs for `setBounds` and mean nothing to `capturePage`, whose rect is
    // page-relative.
    const capture = this.deps.stillFrameCache.captureIfStale(
      this.wc,
      this.panelId,
      { width: this.lastBounds?.width ?? 0, height: this.lastBounds?.height ?? 0 },
      // A hide DURING the capture means the result describes a page that was on
      // its way out. Keeping it would overwrite a good frame with a partial one.
      { shouldKeep: () => this.wantedVisible && !this.isDefunct }
    )

    /*
     * CHAIN, NEVER REPLACE — the assignment used to be `this.pendingCapture =`
     * on the call above, and that quietly made the barrier skippable.
     *
     * `captureIfStale` short-circuits to an ALREADY-RESOLVED promise in two
     * cases without starting anything: a capture is already in flight, or the
     * view has no size yet. Replacing the handle with one of those threw away
     * the only reference to the capture that was still running, so
     * `whenCaptureSettled()` resolved in a microtask and eviction destroyed the
     * `webContents` mid-`capturePage` — the precise state the whole
     * capture-while-visible design exists to avoid.
     *
     * It is reachable without anything exotic: a large page captures slowly, a
     * watched file is saved inside that window, the reload's pipeline calls this
     * again and is short-circuited, and the next view to open evicts this one.
     *
     * `allSettled` is deliberate. It waits for BOTH, so no handle can be lost,
     * and it cannot reject — see `whenCaptureSettled`.
     */
    const previous = this.pendingCapture
    this.pendingCapture = Promise.allSettled([previous, capture]).then(() => undefined)
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
        panelId: this.panelId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    // Re-check AFTER the await: the purge yields, and a teardown starting in
    // that window would otherwise leave `failureLog.clear()` re-emitting into a
    // dropped log and `reloadIgnoringCache()` reaching a closing WebContents.
    if (this.isDefunct) {
      return
    }
    this.failureLog.clear()
    // The dedupe is scoped to a page load, and this is a new one. Clearing the
    // log without clearing the bridge left every host the reader did NOT approve
    // swallowed as already-seen on the reload — gone from the badge and
    // unapprovable. See `PreviewCspViolationBridge.reset`.
    this.cspViolationBridge.reset()
    logger.info('Preview approval: reloading with the new allowlist', {
      panelId: this.panelId,
      count: hosts.length
    })
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
    return this.deps.exportController.exportToPdf(this.wc, suggestedName, this.window.id)
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
    // The page has painted and the watch set is established: the one moment we
    // know the view is showing something worth photographing.
    this.captureWhileVisible()
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

    // Skip only when the window is genuinely gone. A throw from a LIVE window is
    // a real signal — `close()`, budget eviction, replace-on-reopen, the global
    // off-switch and a project switch all detach while the window is alive — so
    // the guard is on window liveness, never on the step itself.
    if (!this.window.isDestroyed()) {
      step('removeChildView', () => this.window.contentView.removeChildView(this.view))
    }
    await asyncStep('lifecycle.dispose', () => this.lifecycle.dispose())
    step('factoryTeardown', () => this.factoryTeardown())
    await asyncStep('watchCoordinator.dispose', () => this.watchCoordinator.dispose())
    step('linkBridge.dispose', () => this.linkBridge.dispose())
    step('cspViolationBridge.dispose', () => this.cspViolationBridge.dispose())
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
