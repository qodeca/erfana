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
   */
  captureIfStale(wc: PreviewCaptureContents, panelId: string, bounds: PreviewBounds): Promise<void>
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
    bounds: PreviewBounds
  ): Promise<void> {
    // A capture is already in flight — skip rather than stack captures.
    if (wc.isBeingCaptured()) {
      return
    }

    let image: PreviewNativeImage
    try {
      // `stayHidden: true` lets the capture succeed even as the view is hidden.
      image = await wc.capturePage(bounds, { stayHidden: true })
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
