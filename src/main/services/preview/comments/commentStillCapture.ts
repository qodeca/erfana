// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fresh still under a comment popup (docs/designs/html-preview-comments.md
 * §3 "Stale still image under popups", §7.3 step 4, §19 R3-6; spike S6; test
 * E-011).
 *
 * The menu and the comment window hide the native view and show its still
 * picture in its place. That picture must show what the reader picked, with
 * the selected outline – which the preload paints before it sends the pick.
 * One animation frame is not enough for the paint to reach a capture (S6:
 * 9 of 20); two are (40 of 40). So: wait two frames in the top frame, capture
 * through the still-frame cache's fresh path, check that the outline's accent
 * pixels are there, and capture once more when they are not.
 *
 * The same two-frame wait reports where the picked frame's `<iframe>` sits in
 * the top frame, which a keyboard pick's menu point and the ring check need.
 * Departure (documented in the P5 report): only a direct child of the top
 * frame is measured; a frame deeper down is placed at its top-level ancestor's
 * origin, its ring is not checked, and its keyboard menu point is approximate.
 */
import { withTimeout } from '../../../utils/withTimeout'
import type { PreviewBounds } from '../../../../shared/ipc/preview-types'
import type { CommentBox } from '../../../../shared/ipc/preview-comment-schema'
import type {
  IPreviewStillFrameCache,
  PreviewCaptureContents,
  PreviewNativeImage
} from '../PreviewStillFrameCache'
import {
  COMMENT_SCRIPT_TIMEOUT_MS,
  COMMENT_WORLD_ID,
  parseFrameOffset,
  waitFramesScript,
  type FrameOffset
} from './commentScripts'

/** Accent pixels a capture must show on the outline before it is kept. */
export const RING_MIN_PIXELS = 3
/** How far a channel may stray from the accent and still count (anti-aliasing, colour management). */
const CHANNEL_TOLERANCE = 24
/** The outline's ring width in CSS pixels (`--border-width-thick`). */
const RING_CSS_PX = 2

/** Where the picked frame sits: the top frame (-1), or the index of its top-level ancestor. */
export interface PickFramePlace {
  readonly childIndex: number
  /** Deeper than a direct child of the top frame: offsets are approximate. */
  readonly nested: boolean
}

/** The isolated-world surface the wait uses. */
export interface PaintContents {
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: { code: string }[]): Promise<unknown>
}

/**
 * Wait two animation frames in the top frame, then read the picked frame's
 * offset in it. `null` when the wait timed out or the frame was not found –
 * a hidden view runs no animation frame.
 */
export async function waitForPaint(contents: PaintContents, place: PickFramePlace): Promise<FrameOffset | null> {
  try {
    const raw = await withTimeout(
      contents.executeJavaScriptInIsolatedWorld(COMMENT_WORLD_ID, [{ code: waitFramesScript(place.childIndex) }]),
      COMMENT_SCRIPT_TIMEOUT_MS,
      'Preview comments: paint wait'
    )
    return parseFrameOffset(raw) ?? null
  } catch {
    return null
  }
}

/** What a ring check needs to find the outline in a capture. */
export interface RingGeometry {
  /** The picked element's box in its own frame's CSS pixels. */
  readonly box: CommentBox
  /** Where that frame's content box sits in the top frame. */
  readonly offset: FrameOffset
  /** The page's own zoom factor. */
  readonly pageZoom: number
  /** The view's size in DIPs – the capture's rectangle. */
  readonly viewSize: { readonly width: number; readonly height: number }
  readonly accent: readonly [number, number, number]
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= CHANNEL_TOLERANCE
}

/** Accent pixels in one region of `image`. BGRA on every platform Electron ships; RGBA accepted too. */
function accentPixels(
  image: PreviewNativeImage,
  rect: { x: number; y: number; width: number; height: number },
  [r, g, b]: readonly [number, number, number]
): number {
  if (rect.width <= 0 || rect.height <= 0 || image.crop === undefined) return 0
  const bitmap = image.crop(rect).toBitmap?.()
  if (bitmap === undefined) return 0
  let count = 0
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const bgra = near(bitmap[i], b) && near(bitmap[i + 1], g) && near(bitmap[i + 2], r)
    const rgba = near(bitmap[i], r) && near(bitmap[i + 1], g) && near(bitmap[i + 2], b)
    if (bgra || rgba) count += 1
  }
  return count
}

/**
 * Whether `image` shows the outline ring around the picked element: accent
 * pixels in a band just inside each edge of its box, clipped to the capture.
 * A box that is not on the capture at all, or an image that cannot be read,
 * passes – there is nothing to check, and the capture is kept.
 */
export function ringPainted(image: PreviewNativeImage, geometry: RingGeometry): boolean {
  if (image.crop === undefined || image.toBitmap === undefined) return true
  const size = image.getSize()
  if (geometry.viewSize.width <= 0 || size.width <= 0) return true
  const scale = (size.width / geometry.viewSize.width) * geometry.pageZoom
  const left = Math.max(0, Math.floor((geometry.box.x + geometry.offset.x) * scale))
  const top = Math.max(0, Math.floor((geometry.box.y + geometry.offset.y) * scale))
  const right = Math.min(size.width, Math.ceil((geometry.box.x + geometry.offset.x + geometry.box.w) * scale))
  const bottom = Math.min(size.height, Math.ceil((geometry.box.y + geometry.offset.y + geometry.box.h) * scale))
  if (right - left < 2 || bottom - top < 2) return true
  const band = Math.max(1, Math.round(RING_CSS_PX * scale))
  const width = right - left
  const height = bottom - top
  const edges = [
    { x: left, y: top, width, height: Math.min(band, height) },
    { x: left, y: Math.max(top, bottom - band), width, height: Math.min(band, height) },
    { x: left, y: top, width: Math.min(band, width), height },
    { x: Math.max(left, right - band), y: top, width: Math.min(band, width), height }
  ]
  const found = edges.reduce((sum, rect) => sum + accentPixels(image, rect, geometry.accent), 0)
  return found >= RING_MIN_PIXELS
}

/** What the fresh capture needs from its view. */
export interface FreshStillDeps {
  readonly panelId: string
  readonly contents: PreviewCaptureContents & PaintContents
  readonly stillFrameCache: Pick<IPreviewStillFrameCache, 'captureFresh'>
  readonly lastRect: () => PreviewBounds | null
  readonly lastCssSize: () => { width: number; height: number } | null
  /** Only a drawn view is captured (the still-frame rule, `previewLiveVisibility`). */
  readonly isDrawn: () => boolean
}

/** One fresh capture: the ring to look for, when the pick said where it is. */
export interface FreshStillRequest {
  readonly place: PickFramePlace
  readonly ring?: Omit<RingGeometry, 'viewSize'>
}

/**
 * Capture the still the popup will sit over. Never throws; resolves whether a
 * frame was stored. The paint has already been waited for by the caller.
 */
export async function captureFreshStill(deps: FreshStillDeps, request: FreshStillRequest): Promise<boolean> {
  const capture = deps.stillFrameCache.captureFresh
  const rect = deps.lastRect()
  if (capture === undefined || rect === null || !deps.isDrawn()) return false
  const viewSize = { width: rect.width, height: rect.height }
  const ring = request.place.nested ? undefined : request.ring
  try {
    return await capture.call(deps.stillFrameCache, deps.contents, deps.panelId, viewSize, {
      cssSize: deps.lastCssSize() ?? undefined,
      ...(ring === undefined ? {} : { accept: image => ringPainted(image, { ...ring, viewSize }) }),
      beforeRetry: async () => {
        await waitForPaint(deps.contents, { childIndex: -1, nested: false })
      }
    })
  } catch {
    return false
  }
}
