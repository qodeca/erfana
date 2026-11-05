// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The live pick outline drawn by Erfana, outside the page (spec 025,
 * 025-FR-026; ADR 0007 decision 6, amended 2026-11-05).
 *
 * The band is the still image's outline (`PickRow.css`,
 * `.erf-brw-still__outline`) in window DIP: a 1px ink line just outside the
 * element's border box, a 2px paper line inside the edge and a 1px ink line
 * inside that. It is drawn as {@link BAND_STRIP_COUNT} opaque strips on a
 * surface Erfana owns (`pickBandWindow.ts`): four ink strips 4px thick, then
 * four paper strips 2px thick drawn over them, which leaves the two ink
 * lines. The surface covers the visible page area, so each strip is clipped
 * to it, and is placed again whenever the page view or its window moves.
 *
 * The page cannot see the band: it is not in the page's document, the
 * page's process never draws it, and `capturePage` of the page view – which
 * copies only what the page's process drew – never contains it.
 *
 * Electron-free: the surface comes from {@link BandSurfaceFactory}, so the
 * unit tests drive a fake one.
 */
import { intersect, type Box } from './pickGeometry'
import type { OutlinePair } from './pickOutlineColours'

/** The ink line just outside the border box. */
export const BAND_OUTER_INK_PX = 1
/** The paper line, inside the border box's edge. */
export const BAND_PAPER_PX = 2
/** The ink line inside the paper. */
export const BAND_INNER_INK_PX = 1
/** Four ink strips, then four paper strips. */
export const BAND_STRIP_COUNT = 8

export type BandTone = 'ink' | 'paper'

/** One opaque strip of the band, in the surface's own coordinates (DIP). */
export interface BandStrip {
  readonly tone: BandTone
  readonly rect: Box
}

/** Where the page is now, in screen DIP, and its zoom. */
export interface BandPlacement {
  /** The visible page area (the page view's clipping parent); the surface covers it. */
  readonly clip: Box
  /** The page view; the element box is relative to its top-left. */
  readonly view: Box
  /** The page's zoom factor: CSS px × zoom = DIP. */
  readonly zoom: number
}

/** The native surface the band is drawn on. */
export interface BandSurface {
  /**
   * Cover `bounds` (screen DIP), draw `strips` in their tones – every
   * strip slot not named is hidden – and show the surface without focus.
   */
  draw(bounds: Box, strips: readonly BandStrip[], colours: OutlinePair): void
  hide(): void
  destroy(): void
}

/** What the page's window does that moves or hides the band. */
export interface BandHostEvents {
  /** The window moved, or came back from hidden or minimised: draw again where the page is now. */
  readonly moved: () => void
  /** The window was hidden or minimised: hide the band, keep what it outlines. */
  readonly hidden: () => void
  /** The window closed: the surface is gone. */
  readonly closed: () => void
}

/** Opens the band's surface on the page's window; null when none can be placed (Wayland). */
export type BandSurfaceFactory = (events: BandHostEvents) => BandSurface | null

/** What the band shows now, for the test hook. */
export interface BandState {
  /** The surface's bounds, screen DIP. */
  readonly bounds: Box
  readonly strips: readonly BandStrip[]
  readonly colours: OutlinePair
}

const ring = (outer: Box, thickness: number, tone: BandTone): BandStrip[] => {
  const side = Math.max(0, outer.height - 2 * thickness)
  return [
    { tone, rect: { x: outer.x, y: outer.y, width: outer.width, height: Math.min(thickness, outer.height) } },
    { tone, rect: { x: outer.x, y: outer.y + outer.height - Math.min(thickness, outer.height), width: outer.width, height: Math.min(thickness, outer.height) } },
    { tone, rect: { x: outer.x, y: outer.y + thickness, width: Math.min(thickness, outer.width), height: side } },
    { tone, rect: { x: outer.x + outer.width - Math.min(thickness, outer.width), y: outer.y + thickness, width: Math.min(thickness, outer.width), height: side } }
  ]
}

/**
 * The band's strips around `box` (surface DIP), clipped to a surface of
 * `size`: ink strips first, paper after, so the paper draws over the ink.
 * Edges are rounded to whole DIP, as native views take them; a strip with no
 * area left is dropped.
 */
export function bandStrips(box: Box, size: { readonly width: number; readonly height: number }): BandStrip[] {
  const left = Math.round(box.x)
  const top = Math.round(box.y)
  const element = { x: left, y: top, width: Math.max(0, Math.round(box.x + box.width) - left), height: Math.max(0, Math.round(box.y + box.height) - top) }
  const inkThickness = BAND_OUTER_INK_PX + BAND_PAPER_PX + BAND_INNER_INK_PX
  const outer = {
    x: element.x - BAND_OUTER_INK_PX,
    y: element.y - BAND_OUTER_INK_PX,
    width: element.width + 2 * BAND_OUTER_INK_PX,
    height: element.height + 2 * BAND_OUTER_INK_PX
  }
  const surface = { x: 0, y: 0, width: size.width, height: size.height }
  const strips: BandStrip[] = []
  for (const strip of [...ring(outer, inkThickness, 'ink'), ...ring(element, BAND_PAPER_PX, 'paper')]) {
    if (strip.rect.width <= 0 || strip.rect.height <= 0) continue
    const rect = intersect(strip.rect, surface)
    if (rect !== null) strips.push({ tone: strip.tone, rect })
  }
  return strips
}

export interface OutlineBandDeps {
  /** Opens the surface, once, at the first draw. */
  readonly open: BandSurfaceFactory
  /** The page now; null while its view is out of the window. */
  readonly placement: () => BandPlacement | null
  /** Subscribe to the page view being placed again (moved, resized, shown, hidden); returns the unsubscribe. */
  readonly watchPlacement?: (listener: () => void) => () => void
  /** Called when drawing failed; the band then reports itself unavailable. */
  readonly onError?: (error: unknown) => void
  /**
   * Called right after each draw placed the strips, with the box outlined
   * (top-level viewport, CSS px) and what is drawn. The seam the test hook
   * times the 025-AC-049 bench's end mark on; must not throw.
   */
  readonly onDrawn?: (box: Box, state: BandState) => void
}

/**
 * The band of one tab. {@link OutlineBand.show} outlines a box (top-level
 * viewport, CSS px); the band is drawn again at every placement change and
 * window move, hidden while the page is not placed or its window is hidden,
 * and keeps what it outlines until {@link OutlineBand.hide}.
 */
export class OutlineBand {
  /** `undefined` until the first draw opens it; `null` when it could not be opened or is gone. */
  private surface: BandSurface | null | undefined
  private wanted: { readonly box: Box; readonly colours: OutlinePair } | null = null
  private drawn: BandState | null = null
  private readonly unwatch: (() => void) | null

  constructor(private readonly deps: OutlineBandDeps) {
    this.unwatch = deps.watchPlacement?.(() => this.redraw()) ?? null
  }

  /** Whether the band can draw: its surface opens (or is open). False on a platform that cannot place it. */
  get available(): boolean {
    return this.open() !== null
  }

  /** What is drawn now, or null when nothing shows. */
  get state(): BandState | null {
    return this.drawn
  }

  /** Outline `box` (top-level viewport, CSS px) in `colours`. */
  show(box: Box, colours: OutlinePair): void {
    this.wanted = { box, colours }
    this.redraw()
  }

  /** Draw what is outlined again, where the page is now (placement change, window move). Never throws. */
  redraw(): void {
    // Nothing outlined: a placement change must not open the native window (round-3 architecture review).
    const wanted = this.wanted
    if (wanted === null) return
    const surface = this.open()
    if (surface === null) return
    const placement = this.deps.placement()
    const strips = placement === null ? [] : bandStrips(inSurface(wanted.box, placement), placement.clip)
    if (placement === null || strips.length === 0) return this.suspend()
    const drawn: BandState = { bounds: roundBox(placement.clip), strips, colours: wanted.colours }
    try {
      surface.draw(drawn.bounds, strips, wanted.colours)
      this.drawn = drawn
    } catch (error) {
      return this.fail(error)
    }
    this.deps.onDrawn?.(wanted.box, drawn)
  }

  /** Hide the band but keep what it outlines (the page scrolls, the window is hidden). */
  suspend(): void {
    if (this.drawn === null) return
    this.drawn = null
    try {
      this.surface?.hide()
    } catch (error) {
      this.fail(error)
    }
  }

  /** Hide the band and forget what it outlined. */
  hide(): void {
    this.wanted = null
    this.suspend()
  }

  /** Close the surface for good (the tab is closing). */
  dispose(): void {
    this.unwatch?.()
    this.wanted = null
    this.drawn = null
    const surface = this.surface
    this.surface = null
    try {
      surface?.destroy()
    } catch {
      // The window is already gone.
    }
  }

  private open(): BandSurface | null {
    if (this.surface === undefined) {
      try {
        this.surface = this.deps.open({ moved: () => this.redraw(), hidden: () => this.suspend(), closed: () => this.gone() })
      } catch (error) {
        this.surface = null
        this.deps.onError?.(error)
      }
    }
    return this.surface
  }

  private gone(): void {
    this.surface = null
    this.drawn = null
  }

  private fail(error: unknown): void {
    this.deps.onError?.(error)
    this.dispose()
  }
}

/** `box` (top-level viewport, CSS px) in the surface's coordinates (DIP). */
function inSurface(box: Box, placement: BandPlacement): Box {
  const zoom = placement.zoom > 0 ? placement.zoom : 1
  return {
    x: placement.view.x - placement.clip.x + box.x * zoom,
    y: placement.view.y - placement.clip.y + box.y * zoom,
    width: box.width * zoom,
    height: box.height * zoom
  }
}

function roundBox(box: Box): Box {
  const x = Math.round(box.x)
  const y = Math.round(box.y)
  return { x, y, width: Math.round(box.x + box.width) - x, height: Math.round(box.y + box.height) - y }
}
