// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a browser tab's page view goes for a width preset (spec 025,
 * 025-FR-012; ADR 0011 decision 6).
 *
 * The renderer pushes two rectangles in its own CSS px (`browser-tab:bounds`):
 * `clip`, the page area of the panel, and `bounds`, the page view. Main owns
 * the width: the view is
 *
 * - at **Full width**, exactly the page area;
 * - at **Phone** or **Tablet width**, the preset's width in DIP – the page's
 *   CSS px at 100% page zoom, whatever Erfana's own zoom – centred in the page
 *   area when the area is wider, and otherwise starting at `bounds.x`, which
 *   is how the renderer tells its horizontal scroll position (`clip.x` minus
 *   the scroll offset), kept so the view always covers the whole area.
 *
 * The view's top and bottom are `bounds`' own, cut to the page area. The page
 * area itself is clamped to the window's content (the preview's
 * `clampAndZoomBounds`); a view wider than the area is clipped by the parent
 * `View` whose bounds are that area, so no page pixel is drawn outside the
 * panel.
 */
import { presetViewWidth, type WidthPresetId } from '../../../../shared/browser/widthPresets'
import { clampAndZoomBounds, type RectLike } from '../../preview/previewBoundsClamp'

/** The renderer's push: the page view and the page area, in the window's CSS px. */
export interface PagePush {
  readonly bounds: RectLike
  readonly clip: RectLike
}

/** Where the clipping parent and the page view go, in DIP. */
export interface PagePlacement {
  /** The clipping parent: the page area, relative to the window's content view. */
  readonly clip: RectLike
  /** The page view, relative to the window's content view. */
  readonly view: RectLike
  /** The page view, relative to the clipping parent. */
  readonly viewInClip: RectLike
}

/**
 * The placement of the page view for `preset`, or `null` when the page area
 * or the view's height clamps to nothing (the view is hidden then).
 *
 * @param content - the window's content size in DIP
 * @param hostZoom - Erfana's own zoom factor (the renderer's CSS px → DIP)
 */
export function placePageView(
  push: PagePush,
  preset: WidthPresetId,
  content: { width: number; height: number },
  hostZoom: number
): PagePlacement | null {
  const zoom = Number.isFinite(hostZoom) && hostZoom > 0 ? hostZoom : 1
  const area = clampAndZoomBounds(push.clip, content, zoom)
  if (area === null) return null
  const top = Math.max(Math.round(push.bounds.y * zoom), area.y)
  const bottom = Math.min(Math.round((push.bounds.y + push.bounds.height) * zoom), area.y + area.height)
  if (bottom <= top) return null
  const width = preset === 'full' ? area.width : presetViewWidth(preset, area.width)
  const left = viewLeft(width, area, Math.round(push.bounds.x * zoom))
  const view = { x: left, y: top, width, height: bottom - top }
  return { clip: area, view, viewInClip: { ...view, x: left - area.x, y: top - area.y } }
}

/** Centred in a wider area; otherwise at the scrolled left, never leaving a gap at either edge. */
function viewLeft(width: number, area: RectLike, scrolledLeft: number): number {
  if (width <= area.width) return area.x + Math.floor((area.width - width) / 2)
  const leftmost = area.x + area.width - width
  return Math.min(Math.max(scrolledLeft, leftmost), area.x)
}
