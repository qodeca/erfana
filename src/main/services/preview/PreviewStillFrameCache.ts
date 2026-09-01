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
 *   - `isBeingCaptured()` true  ⇒ skip (a capture is already in flight)
 *   - `capturePage` throws      ⇒ NO frame (swallowed, never rethrown)
 *   - downscale to `MAX_FRAME_EDGE_PX` longest edge via `NativeImage.resize`
 *   - `toDataURL` over `MAX_FRAME_DATAURL_CHARS` ⇒ NO frame
 *
 * @see specs/designs/sd-074-html-preview.md §1.4
 */
import { PREVIEW } from '../../../shared/constants'
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
  isBeingCaptured(): boolean
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
   * `.html-preview-still-frame`'s `object-fit: contain` then blew up to fill the
   * height and letterboxed in black. Accepting a size makes the mistake
   * unspellable: the rect is built here, at the origin, every time.
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
    // A capture is already in flight — skip rather than stack captures.
    if (wc.isBeingCaptured()) {
      return
    }

    // No rectangle, no picture. A view that has never been laid out reports a
    // zero size, and asking Chromium to capture nothing is at best a wasted
    // round trip — at worst an unbounded one, since nothing here imposes a time
    // budget. Answering it locally is free and certain.
    if (size.width <= 0 || size.height <= 0) {
      return
    }

    let image: PreviewNativeImage
    try {
      // `stayHidden: true` lets the capture succeed even as the view is hidden.
      image = await wc.capturePage(
        { x: 0, y: 0, width: size.width, height: size.height },
        { stayHidden: true }
      )
    } catch {
      // Capture failed ⇒ NO frame. Panel falls back to the placeholder colour.
      return
    }

    if (image.isEmpty()) {
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
     */
    if (opts.shouldKeep !== undefined && !opts.shouldKeep()) {
      return
    }

    const { width, height } = downscaled.getSize()
    this.frames.set(panelId, { dataUrl, width, height, capturedAt: this.now() })
  }

  get(panelId: string): PreviewStillFrame | undefined {
    return this.frames.get(panelId)
  }

  invalidate(panelId: string): void {
    this.frames.delete(panelId)
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
