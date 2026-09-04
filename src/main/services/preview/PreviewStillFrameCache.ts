// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview still-frame cache (Issue #74, work item 34).
 *
 * When a preview tab goes inactive its `WebContentsView` is hidden, and the
 * dockview tab would otherwise show a blank rectangle. This cache captures a
 * downscaled snapshot of the LIVE page so the inactive tab can paint the last
 * frame instead — with a **defined fallback**: if a frame cannot be produced
 * within budget, NO frame is emitted and the panel falls back to the
 * placeholder's current backdrop — brand black before the page has painted, the
 * page's own paper colour afterwards (`previewBackdrop.ts`). It never emits a
 * blank frame (design §1.4).
 *
 * `captureIfStale` must be called BEFORE the view is hidden, or with a capture
 * that passes `stayHidden: true`, so `capturePage` has live pixels to read.
 * Invalidation is driven by FILE CHANGE, not DOM observation — the caller
 * invalidates on a watched-file change (design §1.4).
 *
 * The budgets below are all about SIZE. There is deliberately no time budget,
 * and nothing on an interactive path may await this — `PreviewLiveView` starts a
 * capture and hides the view in the same tick, precisely because a slow capture
 * in front of `setVisible(false)` leaves the native view eating clicks meant for
 * the overlay that just opened. The one caller that waits is eviction, which is
 * about to destroy the page anyway.
 *
 * Budget enforcement, in order:
 *   - a capture of this panel that THIS cache started is still in flight ⇒ skip.
 *     Not Electron's `isBeingCaptured()`: that is Chromium's capturer count,
 *     which other things raise — on Windows it read true from a fresh preview's
 *     first frame, so no frame was ever taken (2026-09-03).
 *   - either edge under `MIN_STILL_FRAME_PX` ⇒ skip (the 1×1 seed rect)
 *   - the caller's `shouldKeep` says its subject left mid-capture ⇒ keep the
 *     frame this panel already had. An EMPTY slot is exempt: a picture taken as
 *     the tab went away beats the no picture at all that the veto would leave.
 *   - `capturePage` past `CAPTURE_TIMEOUT_MS` ⇒ NO frame, previous kept
 *   - `capturePage` throws      ⇒ NO frame (swallowed, never rethrown)
 *   - downscale to `MAX_FRAME_EDGE_PX` longest edge via `NativeImage.resize`
 *   - `toDataURL` over `MAX_FRAME_DATAURL_CHARS` ⇒ NO frame
 *
 * @see specs/designs/sd-074-html-preview.md §1.4
 */
import { PREVIEW } from '../../../shared/constants'
import { logger } from '../LoggingService'
import { withTimeout } from '../../utils/withTimeout'
import type { PreviewBounds, PreviewStillFrame } from '../../../shared/ipc/preview-types'

/**
 * The `NativeImage` surface this cache uses. Structural so tests inject a fake
 * without constructing a real Electron image. `resize` preserves aspect ratio
 * when only one edge is supplied.
 */
export interface PreviewNativeImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): PreviewNativeImage
  toDataURL(): string
}

/**
 * The `WebContents` surface this cache uses. Structural so tests need no real
 * `WebContentsView`.
 */
export interface PreviewCaptureContents {
  capturePage(rect?: PreviewBounds, opts?: { stayHidden?: boolean }): Promise<PreviewNativeImage>
}

export interface PreviewStillFrameCacheDeps {
  /** Clock for `capturedAt` (defaults to `Date.now`). */
  now?: () => number
  /** Longest-edge cap in px before `toDataURL` (defaults to the constant). */
  maxEdgePx?: number
  /** Data-URL char cap; over budget ⇒ no frame (defaults to the constant). */
  maxDataUrlChars?: number
}

export interface IPreviewStillFrameCache {
  /**
   * Capture `wc` into `panelId`'s slot if no in-flight capture is running.
   * Never throws and never stores a blank frame: an over-budget, skipped or
   * throwing capture leaves the previous frame (if any) untouched.
   *
   * TAKES A SIZE, NOT A RECT, AND THAT IS THE WHOLE POINT. `capturePage`'s rect
   * is **page-relative** — `(0,0)` is the page's own top-left — while the only
   * rect a caller has to hand is `PreviewLiveView.lastBounds`, which is
   * **window-relative** DIPs for `View.setBounds`. Passing that through asked
   * for a box starting hundreds of pixels INTO the page; Chromium clipped it at
   * the page edge and returned a narrow off-centre sliver, which
   * `.html-preview-still-frame`'s `object-fit: cover` then blew up to fill the
   * height and letterboxed in black. Accepting a size makes the mistake
   * unspellable: the rect is built here, at the origin, every time.
   *
   * `shouldKeep` VETOES A REPLACEMENT, NOT A FIRST WRITE. It is the caller's
   * answer to "was my subject on screen the whole time", and a `false` from it
   * protects a frame this panel already holds from being overwritten by one
   * captured as the page went away. On an EMPTY slot it is not consulted: there
   * is nothing to protect, and honouring it there parks the tab on a bare
   * backdrop for good.
   */
  captureIfStale(
    wc: PreviewCaptureContents,
    panelId: string,
    size: { width: number; height: number },
    opts?: { shouldKeep?: () => boolean }
  ): Promise<void>
  /** The cached frame for `panelId`, or `undefined` (⇒ placeholder colour). */
  get(panelId: string): PreviewStillFrame | undefined
  /** Drop `panelId`'s frame (called on file change / panel close). */
  invalidate(panelId: string): void
}

export class PreviewStillFrameCache implements IPreviewStillFrameCache {
  private readonly frames = new Map<string, PreviewStillFrame>()
  /** Panels whose capture THIS cache started and has not yet settled. */
  private readonly inFlight = new Set<string>()
  private readonly now: () => number
  private readonly maxEdgePx: number
  private readonly maxDataUrlChars: number

  constructor(deps: PreviewStillFrameCacheDeps = {}) {
    this.now = deps.now ?? Date.now
    this.maxEdgePx = deps.maxEdgePx ?? PREVIEW.MAX_FRAME_EDGE_PX
    this.maxDataUrlChars = deps.maxDataUrlChars ?? PREVIEW.MAX_FRAME_DATAURL_CHARS
  }

  async captureIfStale(
    wc: PreviewCaptureContents,
    panelId: string,
    size: { width: number; height: number },
    opts: { shouldKeep?: () => boolean } = {}
  ): Promise<void> {
    // A capture of this panel is already in flight — skip rather than stack.
    // Our own ledger, not `wc.isBeingCaptured()`: see the header.
    if (this.inFlight.has(panelId)) {
      return
    }

    // No rectangle, no picture — and no picture worth having below the
    // minimum either. A view that has never been laid out reports the 1×1 seed
    // rect `preview:open` was called with, and a one-pixel frame stretched over
    // the panel is the flat colour block a suspended tab used to show.
    if (size.width < PREVIEW.MIN_STILL_FRAME_PX || size.height < PREVIEW.MIN_STILL_FRAME_PX) {
      return
    }

    let image: PreviewNativeImage
    this.inFlight.add(panelId)
    try {
      image = await this.captureOnce(wc, size)
      // An EMPTY image is Chromium saying the surface has not produced a frame
      // yet — measured on Windows: the capture at `'ready'` came back empty for
      // a page that had just finished loading, and a parked tab then showed a
      // flat colour block. One retry after a short pause is enough; a second
      // empty answer means the page is genuinely not painting.
      if (image.isEmpty()) {
        await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW.CAPTURE_RETRY_DELAY_MS))
        // `shouldKeep` protects a frame this panel ALREADY has; with an empty
        // slot it has nothing to protect and abandoning the retry costs the tab
        // its only picture. That is not hypothetical: the first capture at
        // `'ready'` comes back empty on macOS every time, so a tab switched away
        // inside `CAPTURE_RETRY_DELAY_MS` — opening four `.html` files in a
        // burst does it — reached this line with `wantedVisible` already false
        // and parked as a flat colour block for the rest of the session.
        // `captureOnce` passes `stayHidden: true`, which reads a hidden-but-live
        // page (verified on macOS 2026-09-04), so the retry is worth running.
        if (this.frames.has(panelId) && !this.keep(opts)) {
          return
        }
        image = await this.captureOnce(wc, size)
      }
    } catch (error) {
      // Capture failed or timed out ⇒ NO frame. The panel keeps what it had.
      // Said out loud: a tab that wakes without a picture is otherwise silent.
      logger.warn('Preview still frame: capture failed', {
        panelId,
        error: error instanceof Error ? error.message : String(error)
      })
      return
    } finally {
      this.inFlight.delete(panelId)
    }

    if (image.isEmpty()) {
      logger.debug('Preview still frame: empty capture, no frame stored', { panelId })
      return
    }

    const downscaled = this.downscale(image)
    const dataUrl = downscaled.toDataURL()

    // Over the data-URL budget ⇒ NO frame (never a partial/blank one).
    if (dataUrl.length > this.maxDataUrlChars) {
      return
    }

    /*
     * LAST CHANCE TO THROW THE RESULT AWAY, and it is the only defence against
     * poisoning a good frame with a bad one.
     *
     * `isEmpty()` above catches a ZERO-DIMENSION image and nothing else — an
     * all-black picture at the right size sails through and overwrites whatever
     * was cached. So a capture that started while the page was on screen and
     * finished after it had gone could replace a perfectly good frame with a
     * black rectangle, and nothing invalidates it afterwards: the only callers
     * of `invalidate` are a file change, a completed load, and teardown.
     *
     * The caller knows whether its subject was still there the whole time. This
     * asks, at the last possible moment, rather than guessing from the pixels.
     *
     * IT GUARDS A REPLACEMENT, NOT A FIRST WRITE. Every word above is about
     * overwriting a frame that is already good, and with an empty slot there is
     * no such frame — refusing the write there does not avoid a black rectangle,
     * it guarantees no rectangle at all. The tab then parks on its backdrop
     * colour, which is the documented fallback for a capture that could not be
     * produced, not for one that was produced and thrown away.
     */
    if (this.frames.has(panelId) && !this.keep(opts)) {
      logger.debug('Preview still frame: kept the existing frame, view went away mid-capture', {
        panelId
      })
      return
    }

    const { width, height } = downscaled.getSize()
    this.frames.set(panelId, { dataUrl, width, height, capturedAt: this.now() })
  }

  get(panelId: string): PreviewStillFrame | undefined {
    return this.frames.get(panelId)
  }

  /** The caller's verdict, defaulting to "keep" when it did not supply one. */
  private keep(opts: { shouldKeep?: () => boolean }): boolean {
    return opts.shouldKeep === undefined || opts.shouldKeep()
  }

  invalidate(panelId: string): void {
    this.frames.delete(panelId)
  }

  /**
   * One `capturePage`, page-relative at the origin, `stayHidden` so it also
   * works for a view that is hiding, and bounded — a capture that never comes
   * back must not hold this panel's slot (or eviction's settle wait) hostage.
   */
  private captureOnce(
    wc: PreviewCaptureContents,
    size: { width: number; height: number }
  ): Promise<PreviewNativeImage> {
    return withTimeout(
      wc.capturePage({ x: 0, y: 0, width: size.width, height: size.height }, { stayHidden: true }),
      PREVIEW.CAPTURE_TIMEOUT_MS,
      'Preview still-frame capture'
    )
  }

  /**
   * Downscale so the longest edge is at most `maxEdgePx`, preserving aspect
   * ratio. Images already within budget are returned untouched.
   */
  private downscale(image: PreviewNativeImage): PreviewNativeImage {
    const { width, height } = image.getSize()
    const longestEdge = Math.max(width, height)
    if (longestEdge <= this.maxEdgePx || longestEdge === 0) {
      return image
    }

    const scale = this.maxEdgePx / longestEdge
    return image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good'
    })
  }
}

/** Factory mirroring the codebase interface + class + factory convention. */
export function createPreviewStillFrameCache(
  deps: PreviewStillFrameCacheDeps = {}
): IPreviewStillFrameCache {
  return new PreviewStillFrameCache(deps)
}
