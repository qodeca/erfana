// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick-mode geometry, pure (spec 025, 025-FR-029, 025-FR-033, 025-FR-035;
 * ADR 0007 decision 4 and its commit-8 probe results).
 *
 * Coordinates are CSS pixels. A frame's coordinates map into its parent's
 * through the owner `<iframe>`'s content quad, as `DOM.getBoxModel`'s
 * `content` reports it (the border box, `DOM.getContentQuads`, is wider by
 * the border and padding): the quad's corners are the frame viewport's (0,0), (w,0), (w,h)
 * and (0,h), so a transformed (rotated, scaled) frame maps exactly. The map is
 * the affine map through three of the corners; a perspective transform, whose
 * quad is no parallelogram, is approximated by it (inferred: rare in pages).
 *
 * **The pointer in a transformed frame.** The commit-8 probe showed that in a
 * transformed cross-site frame `before-mouse-event`'s `globalX`/`globalY` are
 * the frame's bounding-box origin plus the *untransformed* frame-local point
 * – 17.8 px off at 12° and 0.8 scale – while `x`/`y` are the exact
 * frame-local point. {@link pointerCandidates} therefore never trusts the
 * globals as the view point when `x`/`y` disagree with them: it derives the
 * frame's bounding-box origin from them, the caller matches that origin to a
 * frame, and the frame-local `x`/`y` is mapped through that frame's quad.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Four corners, clockwise from the top left, as CDP's quads (8 numbers) give them. */
export type Quad = readonly [Point, Point, Point, Point]

/** An affine map: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. */
export interface Affine {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

export const IDENTITY: Affine = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })

/** The tolerance when matching a frame's box origin to the pointer's (CSS px). */
export const FRAME_ORIGIN_TOLERANCE_PX = 2

/** A refined element's live box differs from its snapshot by more than this (S-34). */
export const BOX_CHANGE_TOLERANCE_PX = 1

/** A CDP quad (8 numbers) as corners, or null for anything else. */
export function quadFrom(raw: unknown): Quad | null {
  if (!Array.isArray(raw) || raw.length !== 8 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const n = raw as number[]
  return [
    { x: n[0], y: n[1] },
    { x: n[2], y: n[3] },
    { x: n[4], y: n[5] },
    { x: n[6], y: n[7] }
  ]
}

/** The axis-aligned bounds of a quad (transformed elements use these, 025-FR-033). */
export function quadBounds(q: Quad): Box {
  const xs = q.map((p) => p.x)
  const ys = q.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

/** `outer ∘ inner`: apply `inner`, then `outer`. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f
  }
}

/** The inverse map, or null for a degenerate (zero-area) map. */
export function invertAffine(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det
  }
}

/**
 * The map from a frame's viewport (`width` × `height` CSS px) into its
 * parent through the owner's content quad; null for an empty frame.
 */
export function frameToParent(content: Quad, width: number, height: number): Affine | null {
  if (!(width > 0) || !(height > 0)) return null
  const [p0, p1, , p3] = content
  return {
    a: (p1.x - p0.x) / width,
    b: (p1.y - p0.y) / width,
    c: (p3.x - p0.x) / height,
    d: (p3.y - p0.y) / height,
    e: p0.x,
    f: p0.y
  }
}

/** The bounds of `box` after `m` (axis-aligned). */
export function mapBox(m: Affine, box: Box): Box {
  const corners: Quad = [
    applyAffine(m, { x: box.x, y: box.y }),
    applyAffine(m, { x: box.x + box.width, y: box.y }),
    applyAffine(m, { x: box.x + box.width, y: box.y + box.height }),
    applyAffine(m, { x: box.x, y: box.y + box.height })
  ]
  return quadBounds(corners)
}

/** The pointer as `before-mouse-event` reports it: view-relative or frame-local `x`/`y`, screen globals. */
export interface PointerReport {
  readonly x: number
  readonly y: number
  readonly globalX?: number
  readonly globalY?: number
}

export type PointerCandidates =
  /** The view point is known (the top document's widget). */
  | { readonly kind: 'view'; readonly point: Point }
  /** The event came from a frame's widget: frame-local point, and the frame's bounding-box origin in the view. */
  | { readonly kind: 'frame'; readonly local: Point; readonly frameOrigin: Point; readonly fallback: Point }

/**
 * What a pointer report says about the view point, in view DIP. `origin` is
 * the view's top-left on the screen. Globals of 0, 0 (main-side
 * `sendInputEvent`, commit-8 probe) mean no screen point: `x`/`y` are the view
 * point. Otherwise globals minus the origin give the view point, unless `x`/`y`
 * disagree with it – then the event came from a frame widget.
 */
export function pointerCandidates(report: PointerReport, origin: Point): PointerCandidates {
  const { globalX = 0, globalY = 0 } = report
  const local = { x: report.x, y: report.y }
  if (globalX === 0 && globalY === 0) return { kind: 'view', point: local }
  const fromGlobals = { x: globalX - origin.x, y: globalY - origin.y }
  if (distance(fromGlobals, local) <= FRAME_ORIGIN_TOLERANCE_PX) return { kind: 'view', point: fromGlobals }
  return { kind: 'frame', local, frameOrigin: { x: fromGlobals.x - local.x, y: fromGlobals.y - local.y }, fallback: fromGlobals }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Whether two boxes differ by more than {@link BOX_CHANGE_TOLERANCE_PX} on any edge (S-34). */
export function boxChanged(a: Box, b: Box): boolean {
  const t = BOX_CHANGE_TOLERANCE_PX
  return (
    Math.abs(a.x - b.x) > t ||
    Math.abs(a.y - b.y) > t ||
    Math.abs(a.x + a.width - (b.x + b.width)) > t ||
    Math.abs(a.y + a.height - (b.y + b.height)) > t
  )
}

/** `box` clipped to `clip`, or null when they do not overlap. */
export function intersect(box: Box, clip: Box): Box | null {
  const x = Math.max(box.x, clip.x)
  const y = Math.max(box.y, clip.y)
  const right = Math.min(box.x + box.width, clip.x + clip.width)
  const bottom = Math.min(box.y + box.height, clip.y + clip.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

export type VisibilityNote = 'zeroSize' | 'offScreen' | 'partlyOffScreen'

/**
 * The visibility note of 025-FR-035 for an element whose top-level box is
 * `box` and whose visible area (the viewport, narrowed by the clipping
 * ancestors the caller knows of) is `visible`; null when wholly visible.
 */
export function visibilityNote(box: Box, visible: Box): VisibilityNote | null {
  if (!(box.width > 0) || !(box.height > 0)) return 'zeroSize'
  const shown = intersect(box, visible)
  if (shown === null) return 'offScreen'
  const whole = shown.width >= box.width - 0.5 && shown.height >= box.height - 0.5
  return whole ? null : 'partlyOffScreen'
}

/** `box` scaled by `factor` (CSS px → device px). */
export function scaleBox(box: Box, factor: number): Box {
  return { x: box.x * factor, y: box.y * factor, width: box.width * factor, height: box.height * factor }
}

/** The element crop of 025-FR-034: the box plus `margin` on each side, clipped to the viewport. */
export function cropBox(box: Box, margin: number, viewport: { width: number; height: number }): Box | null {
  const grown = { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }
  return intersect(grown, { x: 0, y: 0, width: viewport.width, height: viewport.height })
}
