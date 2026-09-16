// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether one live preview view is drawn, and the still frames taken while it
 * is (Issue #124, WI-1; design §3). Moved out of `PreviewLiveView.ts` unchanged.
 *
 * Owns the wanted visibility and the capture chain, nothing else. The size a
 * capture uses arrives through the injected `lastRect()` and `lastCssSize()`,
 * so this module never holds or reads the bounds state.
 *
 * A window-edge resize hold (issue #124, WI-10) hides the view through
 * `hold()` and ends through `release()`, both called only by the state
 * machine in `previewResizeHold.ts` (RA3-2). While held, `set()` records what
 * is wanted without applying it, and nothing is captured: the view is not
 * drawn.
 */

import type { PreviewBounds, PreviewEmitters } from '../../../shared/ipc/preview-types'
import type { IPreviewStillFrameCache, PreviewCaptureContents } from './PreviewStillFrameCache'
import type { PreviewViewHandle } from './PreviewSessionFactory'
import type { PreviewWindowLike } from './previewLiveTypes'

/** What the visibility module needs from the view that owns it. */
export interface PreviewLiveVisibilityDeps {
  readonly panelId: string
  readonly view: PreviewViewHandle
  readonly window: Pick<PreviewWindowLike, 'isDestroyed' | 'contentView'>
  /** The page the still frame is captured from. */
  readonly contents: PreviewCaptureContents
  readonly emit: Pick<PreviewEmitters, 'visibilityApplied' | 'stillFrameChanged'>
  readonly stillFrameCache: Pick<IPreviewStillFrameCache, 'get' | 'captureIfStale'>
  /** The last DIP rect the bounds module applied, or `null` before the first. */
  readonly lastRect: () => PreviewBounds | null
  /** The view's CSS size at that rect, or `null` before the first; a still is drawn at it. */
  readonly lastCssSize: () => { width: number; height: number } | null
  /** True once the view is torn down, closing, or its webContents is gone. */
  readonly isDefunct: () => boolean
}

/** The visibility of one live view. */
export interface PreviewLiveVisibility {
  /** Show or hide the native view. The hide is synchronous. */
  set(visible: boolean): void
  /** Whether the view is meant to be drawn. True from birth. */
  isWanted(): boolean
  /**
   * Whether the view is on screen now: wanted, not under a window-edge resize
   * hold, and not defunct. The one owner of the "drawn" term.
   */
  isDrawn(): boolean
  /** Refresh the still frame, only while the view is drawn. */
  captureWhileVisible(): void
  /** Resolve once every still-frame capture this view started has settled. */
  whenCaptureSettled(): Promise<void>
  /** Hide for a window-edge resize hold, telling the renderer nothing. `previewResizeHold.ts` only. */
  hold(): void
  /**
   * End a resize hold at the latest wanted state, reporting `visibilityApplied`
   * either way. `previewResizeHold.ts` only.
   */
  release(): void
}

/** Create the visibility owner for one live view. */
export function createPreviewLiveVisibility(
  deps: PreviewLiveVisibilityDeps
): PreviewLiveVisibility {
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
  let wantedVisible = true
  /** A window-edge resize hold hid the view: `set()` only records until `release()`. */
  let held = false

  /** Wanted, not held, not defunct: the view is on screen now. */
  function isDrawn(): boolean {
    return wantedVisible && !held && !deps.isDefunct()
  }

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
  let pendingCapture: Promise<void> = Promise.resolve()

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
  function set(visible: boolean): void {
    if (deps.isDefunct()) {
      return
    }
    /*
     * `isDefunct` asks about the CONTENTS; this asks about the WINDOW, and the
     * show path below reaches through the window to `contentView.addChildView`.
     * Against a destroyed `BrowserWindow` that throws — and because the caller
     * `void`s an async method, it would surface as an unhandled rejection rather
     * than anything anyone sees.
     *
     * Deliberately NOT folded into `isDefunct`, which every live-view module
     * shares, and two of whose readers would change meaning: `set` would stop
     * emitting `visibilityApplied` (what the overlay guard reconciles against)
     * and `captureWhileVisible`'s `shouldKeep` would start discarding good
     * frames. The window is destroyed only in the gap between `BrowserWindow`
     * teardown and `drainWindow`, so every panel here is on its way out
     * regardless; not emitting is the honest answer, and it is scoped to the
     * one method that can actually throw.
     */
    if (deps.window.isDestroyed()) {
      return
    }
    wantedVisible = visible
    // During a window-edge hold the wish is recorded, not applied: `release()`
    // applies the latest one, so an overlay raised mid-hold stays covered.
    if (held) {
      return
    }

    if (visible) {
      show()
      return
    }

    publishCachedFrame()
    deps.view.setVisible(false)
    deps.emit.visibilityApplied(deps.panelId, false)
  }

  /** Draw the view, topmost, and tell the renderer. */
  function show(): void {
    // Re-adding an already-present child reorders it topmost (design §5(d)).
    deps.window.contentView.addChildView(deps.view)
    deps.view.setVisible(true)
    deps.emit.visibilityApplied(deps.panelId, true)
  }

  /**
   * The frame captured while the page was on screen, published before the view
   * goes, so the hide is not a flash of empty backdrop. It carries its `stale`
   * flag, from which the renderer picks picture or backdrop during a drag.
   */
  function publishCachedFrame(): void {
    const frame = deps.stillFrameCache.get(deps.panelId)
    if (frame !== undefined) {
      deps.emit.stillFrameChanged(deps.panelId, frame)
    }
  }

  /**
   * Hide the view for a window-edge resize hold (issue #124, part 1 §1.5).
   *
   * Unlike `set(false)` it tells the renderer nothing, so the overlay guard
   * keeps "visible" and never re-syncs against the hold – the one sanctioned
   * bypass of the single-hider rule. The cached still is published as on any
   * hide. Synchronous, like every hide here.
   */
  function hold(): void {
    if (held || deps.isDefunct() || deps.window.isDestroyed()) {
      return
    }
    held = true
    publishCachedFrame()
    deps.view.setVisible(false)
  }

  /**
   * End a resize hold at the LATEST wanted state: show the view, or keep it
   * hidden when something covered its panel meanwhile (a dialog, a menu), and
   * report `visibilityApplied` either way – the renderer ends its hold on that
   * event alone. The one release for the settled push, the second timeout and
   * the idle maximum (RX2-4).
   */
  function release(): void {
    if (!held) {
      return
    }
    held = false
    if (deps.isDefunct() || deps.window.isDestroyed()) {
      return
    }
    if (wantedVisible) {
      show()
    } else {
      deps.emit.visibilityApplied(deps.panelId, false)
    }
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
  function captureWhileVisible(): void {
    // A held view is not drawn, whatever is wanted.
    if (!isDrawn()) return

    // Only the SIZE of the last rect travels: its `x`/`y` are window-relative
    // DIPs for `setBounds` and mean nothing to `capturePage`, whose rect is
    // page-relative.
    const rect = deps.lastRect()
    const capture = deps.stillFrameCache.captureIfStale(
      deps.contents,
      deps.panelId,
      { width: rect?.width ?? 0, height: rect?.height ?? 0 },
      {
        // A hide or a hold DURING the capture means the result describes a page
        // on its way out. Keeping it would overwrite a good frame with a partial one.
        shouldKeep: isDrawn,
        // The size the renderer draws the still at (issue #124).
        cssSize: deps.lastCssSize() ?? undefined
      }
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
    const previous = pendingCapture
    pendingCapture = Promise.allSettled([previous, capture]).then(() => undefined)
  }

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
  function whenCaptureSettled(): Promise<void> {
    return pendingCapture
  }

  return {
    set,
    isWanted: () => wantedVisible,
    isDrawn,
    captureWhileVisible,
    whenCaptureSettled,
    hold,
    release
  }
}
