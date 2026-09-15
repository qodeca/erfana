// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Construction and collaborator wiring for one live preview view (Issue #124,
 * WI-1; design §3 – the fallback split named for `PreviewLiveView.ts`).
 *
 * Owns no state. It builds the view's state owners (bounds, visibility, the
 * page, its navigator, pipeline, backdrop), then its collaborators (watch
 * coordinator, reload policy, find controller, link bridge, the page's own
 * file watch, lifecycle listeners, frame events, and the input watch that
 * keeps the still picture's freshness and the history's gesture clock – the
 * navigator reads that clock straight through, the rule is the watch's),
 * connects them to one another through callbacks, and hands the parts
 * back to the view, which owns their lifecycles from then on. What the page
 * reports that is the VIEW's business – a crash, a classified console failure,
 * a deleted entry, a move that landed – goes back through the owner's
 * callbacks. Per-page state is written into the page scopes (WI-29), each
 * writer looking up the committed page at the moment it writes.
 *
 * A same-tab move (WI-17b) changes the page inside this view, so everything
 * fixed at wiring time follows the committed page: the file watch retargets at
 * the commit, the link bridge reads the page per click, the pipeline reads it
 * per run, and the still picture is dropped. Paths leave main in project space
 * – `toProjectPath` (`previewUrl.ts`) – the tree's spelling.
 */

import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import type { IPreviewWatchCoordinator } from './PreviewWatchCoordinator'
import type { IPreviewReloadPolicy } from './PreviewReloadPolicy'
import type { IPreviewFindController } from './PreviewFindController'
import { wirePreviewLifecycle } from './previewViewLifecycle'
import { attachPreviewFrameEvents, type PreviewFrameEvents } from './previewFrameEvents'
import { createPreviewLinkBridge, type PreviewLinkBridge } from './previewLinkBridge'
import type { PreviewLiveViewParams } from './previewLiveTypes'
import {
  createPreviewLivePage,
  isNavigationKind,
  type PreviewLivePage,
  type PreviewPageLoadEnd
} from './previewLivePage'
import {
  createPreviewPageNavigator,
  nativeHistoryOf,
  type PreviewPageNavigator
} from './previewPageNavigator'
import { createPreviewEntryWatch, type PreviewEntryWatch } from './previewEntryWatch'
import { buildPreviewUrl, toProjectPath } from './previewUrl'
import { createPreviewLiveBounds, type PreviewLiveBounds } from './previewLiveBounds'
import { createPreviewLiveVisibility, type PreviewLiveVisibility } from './previewLiveVisibility'
import { createPreviewLivePipeline, type PreviewLivePipeline } from './previewLivePipeline'
import { createPreviewLiveBackdrop } from './previewLiveBackdrop'
import { forwardWithHostFocus } from './previewHostFocus'
import { unwindConstruction } from './previewLiveTeardown'
import {
  attachStillFrameFreshness,
  type PreviewStillFrameFreshness
} from './previewStillFrameFreshness'

/** What the wiring needs from the view it builds the parts for. */
export interface PreviewLiveWiringOwner {
  readonly params: PreviewLiveViewParams
  /** True once the view is torn down, closing, or its webContents is gone. */
  readonly isDefunct: () => boolean
  /** The view's teardown latch alone (see `PreviewLivePipelineDeps.isTornDown`). */
  readonly isTornDown: () => boolean
  /** Latch the view destroyed: its construction failed. */
  readonly markDestroyed: () => void
  /** `render-process-gone` / `unresponsive`, with Electron's reason. */
  readonly onCrash: (reason: string) => void
  /** A page `console-message` already classified into a failure input. */
  readonly onConsoleMessage: (input: PreviewFailureInput) => void
  /** The page on screen was unlinked (or renamed away). */
  readonly onEntryDeleted: () => void
  /**
   * A same-tab move or history step landed (issue #124); `failed` when it
   * committed at status 400 or above (S15).
   */
  readonly onMoveLanded: (failed: boolean) => void
}

/** What the wiring built, for the view to drive and, at teardown, release. */
export interface PreviewLiveParts {
  readonly bounds: PreviewLiveBounds
  readonly visibility: PreviewLiveVisibility
  /** The page on screen and the one load main has started. */
  readonly page: PreviewLivePage
  /** The panel's history and the moves main starts (issue #124, WI-17b). */
  readonly navigator: PreviewPageNavigator
  readonly pipeline: PreviewLivePipeline
  readonly watchCoordinator: IPreviewWatchCoordinator
  readonly reloadPolicy: IPreviewReloadPolicy
  readonly findController: IPreviewFindController
  readonly linkBridge: PreviewLinkBridge
  /** The watch on the page's own file, which follows a move (WI-17b). */
  readonly entryWatch: PreviewEntryWatch
  readonly lifecycle: { dispose(): Promise<void> }
  /** The frame guard, the failed-load writer and the frame console bridge (WI-14). */
  readonly frameEvents: PreviewFrameEvents
  /**
   * Marks the cached still stale on real input, and refreshes it after a
   * pause; keeps the history's gesture clock, which the navigator spends
   * (QG-7 S1, QG-8 T1).
   */
  readonly freshness: PreviewStillFrameFreshness
}

/**
 * Build one live view's parts: the state owners first, then the collaborators.
 *
 * Everything past the state owners can throw — the chokidar entry watcher opens
 * eagerly, and `window.contentView.addChildView` throws "Object has been
 * destroyed" against a window that closed during the session build (probed on
 * Electron 39). A throw used to leave the watcher and the coordinator with no
 * reference and no owner (#83, #112). The collaborators are built in order and
 * unwound on failure, after the owner is latched destroyed; the SESSION is the
 * caller's to discard, as before.
 */
export function wirePreviewLiveView(owner: PreviewLiveWiringOwner): PreviewLiveParts {
  const { params } = owner
  const { panelId, deps, pageScopes, projectPath } = params
  const { token, realRoot, view } = params.session
  const wc = view.webContents
  const urlFor = (absPath: string): string => buildPreviewUrl(token, realRoot, absPath)
  /** A confined real path in project space, the spelling the tree uses (part 3 §3.4). */
  const projectFile = (realTarget: string): string =>
    toProjectPath(projectPath, realRoot, realTarget)

  // The state owners. Building them cannot throw, and they reach the
  // collaborators built below only through callbacks run after construction.
  const core = {
    panelId,
    view,
    window: params.window,
    contents: wc,
    emit: deps.emit,
    stillFrameCache: deps.stillFrameCache,
    isDefunct: owner.isDefunct
  }
  const bounds = createPreviewLiveBounds({ ...core, getZoomFactor: deps.getZoomFactor })
  const visibility = createPreviewLiveVisibility({
    ...core,
    lastRect: () => bounds.lastRect(),
    // The CSS size a still is drawn at, read from bounds at capture (issue #124).
    lastCssSize: () => bounds.lastCssSize()
  })
  const backdrop = createPreviewLiveBackdrop(core)
  // The page on screen and the one load main has started. It only attaches
  // listeners to the page's own contents; the unwind below still detaches them.
  // Its ends feed the navigator first, then the collaborators (issue #124).
  const page = createPreviewLivePage({
    panelId,
    contents: wc,
    pageScopes,
    initialPage: params.entryFilePath,
    urlFor,
    onOutcome: (end) => onPageLoadEnded(end),
    onInPageStep: (url) => navigator.inPageStep(url)
  })
  let watchCoordinator!: IPreviewWatchCoordinator
  let reloadPolicy!: IPreviewReloadPolicy
  let entryWatch: PreviewEntryWatch | undefined
  const pipeline = createPreviewLivePipeline({
    ...core,
    now: () => deps.now(),
    readEntryHtml: deps.readEntryHtml,
    currentPage: () => page.currentPage(),
    urlFor,
    // Frame documents are read for links only inside it (WI-15, fail closed).
    realRoot,
    setWatchSet: (candidates) => watchCoordinator.setWatchSet(candidates),
    recordChange: (path) => reloadPolicy.record(path),
    // How this view reloads; the pipeline decides when, and guards it. A reload
    // is a page load like any other, so it goes through `startPageLoad` (WI-29).
    reloadPage: (ignoreCache) => {
      void page.startPageLoad(page.currentPage(), 'reload', () =>
        ignoreCache ? wc.reloadIgnoringCache() : wc.reload()
      )
    },
    isWanted: () => visibility.isWanted(),
    captureWhileVisible: () => visibility.captureWhileVisible(),
    isTornDown: owner.isTornDown
  })
  // The input watch that keeps the history's gesture clock is attached only
  // once nothing below can throw, so until then no gesture has reached the view.
  let freshness: PreviewStillFrameFreshness | null = null
  // The panel's history and the moves main starts (issue #124, WI-17b). It
  // writes the view's first history now; the service keeps it across a suspend.
  const navigator = createPreviewPageNavigator({
    panelId,
    page,
    navigation: params.navigation,
    urlFor,
    loadUrl: (url) => wc.loadURL(url),
    nativeHistory: () => nativeHistoryOf(wc),
    emitPageChanged: (change) => deps.emit.pageChanged?.(panelId, change),
    onMoveStarted: () => pipeline.pause(),
    // Spends the gesture; the window rule is the watch's (QG-7 S1, QG-8 T1).
    takeRecentGesture: () => freshness?.takeRecentGesture() ?? false,
    isDefunct: owner.isDefunct
  })

  /** What the end of a pending load means for the collaborators (part 3 §3.4). */
  function onPageLoadEnded(end: PreviewPageLoadEnd): void {
    navigator.loadEnded(end)
    const move = isNavigationKind(end.load.kind)
    const committed = end.reason === 'committed'
    if (committed && end.load.filePath !== end.previousPage) {
      // Another page is on screen: its file is watched now, and the old page's
      // picture must never be what the next hide shows (RS2-8). The watch set
      // and the frame files follow at the run after its did-finish-load (WI-15).
      entryWatch?.retarget(end.load.filePath)
      deps.stillFrameCache.invalidate(panelId)
    }
    if (move && (committed || end.reason === 'same-document')) {
      owner.onMoveLanded(committed && end.failed)
    }
    if (move || committed) {
      pipeline.resume({ replaced: committed, failed: move && end.failed })
    }
  }

  let findController!: IPreviewFindController
  let linkBridge!: PreviewLinkBridge
  let lifecycle!: { dispose(): Promise<void> }
  let frameEvents!: PreviewFrameEvents
  try {
    watchCoordinator = deps.createWatchCoordinator(realRoot, (paths) =>
      pipeline.onWatchChanged(paths)
    )
    reloadPolicy = deps.createReloadPolicy((decision) => pipeline.handleReloadDecision(decision))
    findController = deps.createFindController(wc, (count) =>
      deps.emit.findResult({
        panelId,
        requestId: 0,
        matches: count.total,
        activeMatchOrdinal: count.activeOrdinal
      })
    )

    linkBridge = createPreviewLinkBridge(
      {
        panelId,
        token,
        realRoot,
        windowId: params.window.id,
        // Read at every click: a move changes the page on screen (issue #124).
        get currentUrl(): string {
          return urlFor(page.currentPage())
        }
      },
      {
        // In project space, so a link and a tree click mint one tab for one
        // file (part 3 §3.4); the disposition rides along (part 3 §3.2).
        requestOpenFile: (sourcePanelId, realTarget, anchor, windowId, disposition) =>
          deps.emit.openFileRequested(
            sourcePanelId,
            projectFile(realTarget),
            anchor,
            windowId,
            disposition
          ),
        openExternal: (url) =>
          deps.openExternal?.(url, params.window.id) ??
          Promise.reject(new Error('No external opener')),
        // The page on screen, looked up per write: no writer keeps a scope.
        recordFailure: (input) => pageScopes.committed().recordFailure(input),
        // Row 6 of the link table, read in project space: through a symlinked
        // project the real path would count every page as outside (part 3 §3.1).
        runsAsPreview: async (realTarget) => {
          const check = deps.checkEligibility
          return check !== undefined && (await check(projectFile(realTarget), projectPath)).eligible
        },
        platform: deps.platform
      }
    )

    // The page's own file (WI-17b: it follows a move). A save goes through the
    // same coalescing reload policy the subresources use, so an entry and
    // stylesheet save collapses to ONE reload decision instead of racing an
    // immediate reload against a CSS swap.
    entryWatch = createPreviewEntryWatch({
      panelId,
      initialPath: page.currentPage(),
      createEntryWatcher: deps.createEntryWatcher,
      onChange: () => reloadPolicy.record(page.currentPage()),
      onDeleted: () => owner.onEntryDeleted()
    })

    lifecycle = wirePreviewLifecycle(
      { webContents: wc, platform: deps.platform },
      {
        onRenderProcessGone: (reason) => {
          backdrop.move('crashed')
          owner.onCrash(reason ?? 'crashed')
        },
        onUnresponsive: () => owner.onCrash('unresponsive'),
        onDidFinishLoad: () => pipeline.schedule(),
        // Backdrop transitions are SIBLINGS of the post-load pipeline, never
        // routed through it: `schedule` is rate-limited and drops events
        // during a save burst, and a dropped transition leaves the page
        // unreadable.
        onDidStartLoading: () => backdrop.move('start-loading'),
        onDidStopLoading: () => void backdrop.settle(),
        onDidFailLoad: () => void backdrop.settle('fail-load'),
        // Focus-moving keys hand native focus to the host window first, or the
        // renderer's DOM focus cannot take the keyboard back (QG-11a H1).
        onForwardedShortcut: (key) => {
          const forward = deps.onForwardedShortcut
          if (forward !== undefined) {
            forwardWithHostFocus(params.window, key, (forwarded) => forward(panelId, forwarded))
          }
        },
        onConsoleMessage: (input) => owner.onConsoleMessage(input),
        onLinkActivated: (payload) => linkBridge.handleActivation(payload),
        onNavigationAttempt: (url) => linkBridge.handleWillNavigate(url),
        // Into the page on screen's own CSP dedupe, ledger and log (WI-29).
        onCspViolation: (payload) => pageScopes.committed().handleCspViolation(payload)
      }
    )

    // Frames (issue #124, WI-14): the guard, the `srcdoc` check, the failed-load
    // writer and the frame console bridge. Each write looks the page on screen
    // up; each page's frame counters and over-limit timer live in its scope.
    frameEvents = attachPreviewFrameEvents({ panelId, contents: wc, pageScopes, ownToken: token })

    params.window.contentView.addChildView(view)
    bounds.place(params.initialBounds)
    backdrop.apply()
  } catch (error) {
    owner.markDestroyed()
    // In unwind order. Declared with `!`, but the throw may precede any of them.
    void unwindConstruction(panelId, {
      lifecycle,
      entryWatch,
      frameEvents,
      page,
      watchCoordinator,
      linkBridge,
      reloadPolicy,
      findController
    })
    throw error
  }

  // Real input makes the cached still stale, and a pause refreshes it (issue
  // #124, WI-10); a gesture is kept for the navigator to spend (QG-7 S1).
  // Attached once nothing above can throw, so it needs no unwind; the view's
  // teardown detaches it.
  freshness = attachStillFrameFreshness({
    contents: wc,
    markStale: () => deps.stillFrameCache.markStale?.(panelId),
    refresh: () => visibility.captureWhileVisible(),
    now: () => deps.now()
  })

  return {
    bounds,
    visibility,
    page,
    navigator,
    pipeline,
    watchCoordinator,
    reloadPolicy,
    findController,
    linkBridge,
    entryWatch,
    lifecycle,
    frameEvents,
    freshness
  }
}
