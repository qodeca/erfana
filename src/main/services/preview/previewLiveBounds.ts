// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where one live preview view sits, and the proof the page moved there (Issue
 * #124, WI-1; design §3). Moved out of `PreviewLiveView.ts` unchanged.
 *
 * Owns the last rect applied, its CSS size (the still picture is drawn at it,
 * issue #124) and the last bounds sequence number, and is the only caller of
 * `view.setBounds`. The repaint confirmation lives here because
 * it only means something against the sequence number held here. The page's
 * isolated-world call and the `boundsApplied` emitter are injected.
 *
 * Its drop points (M5–M8, M10; issue #124, WI-5, part 1 §1.2) report through
 * a reporter each view builds here from `previewBoundsDropLog.ts` – never one
 * handed in through the wiring.
 */

import { logger } from '../LoggingService'
import type { BoundsDrop } from '../../../shared/dropReporter'
import type { PreviewBounds, PreviewEmitters } from '../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import type { PreviewViewHandle, PreviewWebContentsHandle } from './PreviewSessionFactory'
import type { PreviewLiveViewDeps, PreviewWindowLike } from './previewLiveTypes'
import { clampAndZoomBounds } from './previewBoundsClamp'
import { LIVE_BOUNDS_DROP_REASON, createMainDropReporter } from './previewBoundsDropLog'

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

/** What the bounds module needs from the view that owns it. */
export interface PreviewLiveBoundsDeps {
  readonly panelId: string
  readonly view: Pick<PreviewViewHandle, 'setBounds'>
  /** The host window: its content rect for the clamp, its own zoom to size the view with. */
  readonly window: Pick<PreviewWindowLike, 'getContentBounds' | 'webContents'>
  /** The page, asked in an isolated world whether it has repainted. */
  readonly contents: Pick<PreviewWebContentsHandle, 'executeJavaScriptInIsolatedWorld'>
  readonly emit: Pick<PreviewEmitters, 'boundsApplied'>
  /** Reads the zoom of the window it is handed – `window` above – for every rect (C3). */
  readonly getZoomFactor: PreviewLiveViewDeps['getZoomFactor']
  /** True once the view is torn down, closing, or its webContents is gone. */
  readonly isDefunct: () => boolean
  /** Milliseconds for the drop log's rate cap; defaults to a monotonic clock. */
  readonly now?: () => number
}

/** The bounds of one live view. */
export interface PreviewLiveBounds {
  /** The construction-time placement: no sequence number, no confirmation. */
  place(cssRect: PreviewBounds): void
  /**
   * A renderer push. A defunct, stale or collapsed push is dropped and logged.
   * @returns whether it reached the view – only such bounds end a resize hold.
   */
  apply(cssRect: PreviewBounds, seq: number, ack: boolean): boolean
  /** The last DIP rect handed to `view.setBounds`, or `null` before the first. */
  lastRect(): PreviewBounds | null
  /**
   * The view's size in CSS px at that rect – its DIP size over the zoom it was
   * sized with – or `null` before the first (issue #124).
   */
  lastCssSize(): { width: number; height: number } | null
}

/** A clamped DIP rect and the zoom it was sized with. */
interface SizedRect {
  readonly dip: PreviewBounds
  readonly zoom: number
}

/** `lastSeq` for a drop line: absent until a push has been accepted. */
function knownSeq(seq: number): number | undefined {
  return seq < 0 ? undefined : seq
}

/** Create the bounds owner for one live view. */
export function createPreviewLiveBounds(deps: PreviewLiveBoundsDeps): PreviewLiveBounds {
  let lastSeq = -1
  let last: PreviewBounds | null = null
  let lastCss: { width: number; height: number } | null = null
  // One reporter per view: a live view is one scope (part 1 §1.2). Every line
  // carries the rect as the renderer sent it, in CSS px, so it lines up with
  // the renderer's own lines.
  const drops = createMainDropReporter({ now: deps.now })
  const report = (drop: Omit<BoundsDrop, 'panelId'>): void =>
    drops.report({ ...drop, panelId: deps.panelId })

  /** Zoom-convert + clamp a CSS-px rect to the window content rect (§4.3), with the zoom used. */
  function computeBounds(cssRect: PreviewBounds, seq?: number): SizedRect | null {
    const content = deps.window.getContentBounds()
    const zoom = deps.getZoomFactor(deps.window)
    checkHostZoom(zoom, cssRect, seq)
    const dip = clampAndZoomBounds(cssRect, { width: content.width, height: content.height }, zoom)
    return dip === null ? null : { dip, zoom }
  }

  /** Hand a computed rect to the view, and remember it with its CSS size. */
  function setViewBounds({ dip, zoom }: SizedRect): void {
    // The clamp's own fallback: a zoom that is not a positive number sized it at 1.
    const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    last = dip
    lastCss = { width: dip.width / factor, height: dip.height / factor }
    deps.view.setBounds(dip)
  }

  /**
   * M10, a tripwire after C3: the view is sized with `getZoomFactor(window)`,
   * so this fires only if a zoom dep that does not read its host is wired in.
   * Reported, never corrected.
   */
  function checkHostZoom(used: number, cssRect: PreviewBounds, seq: number | undefined): void {
    const host = hostZoomFactor()
    // Both factors come from Chromium's own zoom-level maths, so one zoom gives
    // the same double; any difference is a different zoom.
    if (host !== undefined && host !== used) {
      report({ reason: LIVE_BOUNDS_DROP_REASON.zoomMismatch, level: 'warn', seq, rect: cssRect })
    }
  }

  /** The host window's zoom, or `undefined` when its page is gone mid-call. */
  function hostZoomFactor(): number | undefined {
    try {
      return deps.window.webContents.getZoomFactor()
    } catch {
      // A host page gone mid-call has nothing to compare; M10 never blocks a rect.
      return undefined
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
  async function confirmRepaint(seq: number): Promise<void> {
    try {
      const height = await deps.contents.executeJavaScriptInIsolatedWorld(BOUNDS_ACK_WORLD_ID, [
        { code: REPAINTED_SCRIPT }
      ])
      if (deps.isDefunct()) {
        report({ reason: LIVE_BOUNDS_DROP_REASON.viewDefunct, level: 'info', seq, lastSeq })
        return
      }
      if (seq !== lastSeq) {
        // A newer push overtook this one; that push owns the confirmation.
        report({ reason: LIVE_BOUNDS_DROP_REASON.ackSuperseded, level: 'info', seq, lastSeq })
        return
      }
      deps.emit.boundsApplied(deps.panelId, seq)
      logger.debug('Preview bounds applied', {
        panelId: stablePathDigest(deps.panelId),
        seq,
        height
      })
    } catch {
      // A page that tore down mid-frame, or a world that could not run. Silence
      // is the safe answer, and the caller already has to handle it.
    }
  }

  function place(cssRect: PreviewBounds): void {
    const sized = computeBounds(cssRect)
    if (sized === null) {
      report({ reason: LIVE_BOUNDS_DROP_REASON.clampedEmpty, level: 'warn', rect: cssRect })
      return
    }
    setViewBounds(sized)
  }

  function apply(cssRect: PreviewBounds, seq: number, ack: boolean): boolean {
    if (deps.isDefunct()) {
      report({
        reason: LIVE_BOUNDS_DROP_REASON.viewDefunct,
        level: 'info',
        seq,
        lastSeq: knownSeq(lastSeq),
        rect: cssRect
      })
      return false
    }
    if (seq <= lastSeq) {
      report({ reason: LIVE_BOUNDS_DROP_REASON.staleSeq, level: 'warn', seq, lastSeq, rect: cssRect })
      return false
    }
    // The seq is spent even when the rect clamps to nothing, so an older push
    // arriving after it is still stale.
    const previous = lastSeq
    lastSeq = seq
    const sized = computeBounds(cssRect, seq)
    if (sized === null) {
      report({
        reason: LIVE_BOUNDS_DROP_REASON.clampedEmpty,
        level: 'warn',
        seq,
        lastSeq: knownSeq(previous),
        rect: cssRect
      })
      return false
    }
    setViewBounds(sized)

    // Every path that returns EARLY above deliberately emits nothing. A caller
    // waiting on this confirmation must fall back safely on silence, and a
    // dropped push is exactly a case where it must: the view is not where the
    // renderer believes it is.
    if (ack) {
      void confirmRepaint(seq)
    }
    return true
  }

  return { place, apply, lastRect: () => last, lastCssSize: () => lastCss }
}
