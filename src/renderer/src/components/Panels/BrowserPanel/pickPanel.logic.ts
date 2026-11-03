// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the prompt-actions panel and the instruction dialog go (spec 025,
 * 025-FR-030; design § Prompt-actions panel and § Layout rules "The sheet";
 * commit 19). Pure geometry, in the page area's CSS px:
 *
 * - the picked element's box on the still image ({@link anchorOnStill});
 * - the panel at the outline's nearest edge with room – below, above, right,
 *   left – never covering the outline, kept inside the page area
 *   ({@link placePanel});
 * - under {@link SHEET_BELOW_PX} of room, a sheet pinned to the bottom of the
 *   page area, over the still image (M-36).
 */
import type { BrowserRect } from '../../../../../shared/ipc/browser-tab-schema'

/** Narrower page areas show the panel and dialog as a bottom sheet (M-36). */
export const SHEET_BELOW_PX = 400
/** Space between the outline and the panel. */
export const PANEL_GAP_PX = 8

export interface Size {
  readonly width: number
  readonly height: number
}

/** Where the panel goes: a point, or the sheet. */
export type PanelPlacement =
  | { readonly kind: 'sheet' }
  | { readonly kind: 'at'; readonly left: number; readonly top: number; readonly side: 'below' | 'above' | 'right' | 'left' | 'inside' }

/**
 * The picked element's box in the page area, from its page CSS px box.
 *
 * @param box - The element's border box in the page (CSS px)
 * @param zoomPercent - The tab's zoom
 * @param pageWidth - The page's width in the area's CSS px, before the area clamps it
 * @param area - The page area's size
 * @returns The box in the area's CSS px (the still image is centred and scaled down to fit)
 */
export function anchorOnStill(box: BrowserRect, zoomPercent: number, pageWidth: number, area: Size): BrowserRect {
  const shown = Math.min(pageWidth, area.width)
  const fit = pageWidth > 0 ? shown / pageWidth : 1
  const k = (zoomPercent / 100) * fit
  const offset = (area.width - shown) / 2
  return { x: offset + box.x * k, y: box.y * k, width: box.width * k, height: box.height * k }
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)))

/**
 * Place the panel next to the outline.
 *
 * @param anchor - The outline in the area (see {@link anchorOnStill})
 * @param panel - The panel's measured size
 * @param area - The page area's size
 * @returns The placement
 *
 * @example
 * ```ts
 * placePanel({ x: 10, y: 10, width: 100, height: 20 }, { width: 300, height: 200 }, { width: 800, height: 600 })
 * // { kind: 'at', left: 10, top: 38, side: 'below' }
 * ```
 */
export function placePanel(anchor: BrowserRect, panel: Size, area: Size): PanelPlacement {
  if (area.width < SHEET_BELOW_PX) return { kind: 'sheet' }
  const bottom = anchor.y + anchor.height
  const right = anchor.x + anchor.width
  const left = clamp(anchor.x, 0, area.width - panel.width)
  const top = clamp(anchor.y, 0, area.height - panel.height)
  if (bottom + PANEL_GAP_PX + panel.height <= area.height) return { kind: 'at', left, top: bottom + PANEL_GAP_PX, side: 'below' }
  if (anchor.y - PANEL_GAP_PX - panel.height >= 0) return { kind: 'at', left, top: anchor.y - PANEL_GAP_PX - panel.height, side: 'above' }
  if (right + PANEL_GAP_PX + panel.width <= area.width) return { kind: 'at', left: right + PANEL_GAP_PX, top, side: 'right' }
  if (anchor.x - PANEL_GAP_PX - panel.width >= 0) return { kind: 'at', left: anchor.x - PANEL_GAP_PX - panel.width, top, side: 'left' }
  // No edge has room (a huge element): over it, at the area's bottom-left, inside the area.
  return { kind: 'at', left: clamp(0, 0, area.width - panel.width), top: clamp(area.height - panel.height, 0, area.height), side: 'inside' }
}

/**
 * The ancestor path cut from its start so the picked element stays whole
 * (025-FR-027): at most `keep` crumbs, behind a leading "…".
 *
 * @param ancestors - Names from the root to the picked element's parent
 * @param keep - Crumbs that fit
 * @returns The crumbs shown with their index in `ancestors`, and whether the start was cut
 */
export function cutPath(ancestors: readonly string[], keep: number): { crumbs: Array<{ name: string; index: number }>; cut: boolean } {
  const from = Math.max(0, ancestors.length - Math.max(0, keep))
  return { crumbs: ancestors.slice(from).map((name, i) => ({ name, index: from + i })), cut: from > 0 }
}
