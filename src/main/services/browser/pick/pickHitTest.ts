// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick hit test, in main (spec 025, 025-FR-025, 025-FR-029, 025-FR-053;
 * ADR 0007 decision 4 and its commit-8 probe results).
 *
 * `DOM.getNodeForLocation` on a session finds the element a click there would
 * hit, through same-process frames and shadow roots. When it lands on the
 * owner of an out-of-process frame, the point is mapped into that frame
 * through the owner's content quad and the test goes on in the frame's own
 * session – so transformed and nested cross-site frames work.
 *
 * Where the point comes from (`pointerCandidates` in `pickGeometry.ts`):
 * - the top document's widget, or `sendInputEvent`: a view point;
 * - an out-of-process frame's widget: the event carries the frame-local
 *   point, and `globalX`/`globalY` only tell where the frame's box starts
 *   (the probe: in a transformed frame they are ~18 px off the pointer). The
 *   frame is found by matching that origin against every frame target's box
 *   in the view; the test then starts in that frame at the exact local point,
 *   and the view point is that local point mapped through the frame's quad.
 *   With no match, the globals are used as the view point (inferred: a frame
 *   moving between the event and the test).
 */
import { isRecord } from '../cdp/cdpTypes'
import {
  applyAffine,
  distance,
  FRAME_ORIGIN_TOLERANCE_PX,
  invertAffine,
  pointerCandidates,
  type Affine,
  type Point,
  type PointerReport
} from './pickGeometry'
import { stringField, TOP_SESSION, type PickNode, type PickReader } from './pickCdp'
import type { PickFrames } from './pickFrames'

/** What a hit test found: the node, and the pick point in the top-level viewport (CSS px). */
export interface PickHit {
  readonly node: PickNode
  readonly viewPoint: Point
}

/** Out-of-process frames followed at most in one test. */
const MAX_DESCENT = 16

const FRAME_OWNER_TAGS = new Set(['IFRAME', 'FRAME'])

export class PickHitTest {
  constructor(
    private readonly reader: PickReader,
    private readonly frames: PickFrames
  ) {}

  /**
   * The element under `viewPoint` (top-level viewport, CSS px), or null when
   * the point hits nothing (outside the page, or the target went).
   */
  async atViewPoint(viewPoint: Point): Promise<PickHit | null> {
    return this.descend(TOP_SESSION, viewPoint, viewPoint)
  }

  /**
   * The element under a pointer report from `before-mouse-event`, in view
   * DIP; `origin` is the view's top-left on the screen and `zoom` the page's
   * zoom factor (DIP per CSS px).
   */
  async atPointer(report: PointerReport, origin: Point, zoom: number): Promise<PickHit | null> {
    const candidates = pointerCandidates(report, origin)
    const toCss = (p: Point): Point => ({ x: p.x / zoom, y: p.y / zoom })
    if (candidates.kind === 'view') return this.atViewPoint(toCss(candidates.point))
    const local = toCss(candidates.local)
    const frame = await this.frameAt(toCss(candidates.frameOrigin))
    if (frame === null) return this.atViewPoint(toCss(candidates.fallback))
    return this.descend(frame.sessionKey, local, applyAffine(frame.toView, local))
  }

  /** The deepest out-of-process frame whose bounding box in the view starts at `origin`, with its map. */
  private async frameAt(origin: Point): Promise<{ sessionKey: string; toView: Affine } | null> {
    let best: { sessionKey: string; toView: Affine; depth: number } | null = null
    for (const target of this.frames.frameTargets()) {
      if (target.sessionKey === TOP_SESSION) continue
      try {
        const { toView, box } = await this.frames.viewBox(target.sessionKey)
        if (distance({ x: box.x, y: box.y }, origin) > FRAME_ORIGIN_TOLERANCE_PX) continue
        const depth = this.depth(target.sessionKey)
        if (best === null || depth > best.depth) best = { sessionKey: target.sessionKey, toView, depth }
      } catch {
        // A frame going away mid-test cannot be the one under the pointer.
      }
    }
    return best
  }

  private depth(sessionKey: string): number {
    let depth = 0
    for (let key: string | null = sessionKey; key !== null && key !== TOP_SESSION && depth < MAX_DESCENT; key = this.frames.parentSession(key)) depth++
    return depth
  }

  private async descend(sessionKey: string, point: Point, viewPoint: Point): Promise<PickHit | null> {
    let key = sessionKey
    let at = point
    for (let step = 0; step < MAX_DESCENT; step++) {
      const found = await this.locate(key, at)
      if (found === null) return null
      const child = found.contentFrameId === null ? null : this.frames.frameTarget(found.contentFrameId)
      if (child === null) return { node: found.node, viewPoint }
      let inverse: ReturnType<typeof invertAffine>
      try {
        inverse = invertAffine(await this.frames.childToParent(child.sessionKey, key, found.node.backendNodeId))
      } catch {
        inverse = null
      }
      // A frame not laid out yet: the owner element itself is what is under the pointer.
      if (inverse === null) return { node: found.node, viewPoint }
      at = applyAffine(inverse, at)
      key = child.sessionKey
    }
    return null
  }

  /** One `getNodeForLocation` and, for a frame owner, the frame it holds. */
  private async locate(sessionKey: string, point: Point): Promise<{ node: PickNode; contentFrameId: string | null } | null> {
    let located: unknown
    try {
      located = await this.reader.call(
        'DOM.getNodeForLocation',
        { x: Math.round(point.x), y: Math.round(point.y), ignorePointerEventsNone: false, includeUserAgentShadowDOM: false },
        sessionKey
      )
    } catch {
      return null
    }
    const backendNodeId = isRecord(located) ? located.backendNodeId : undefined
    if (typeof backendNodeId !== 'number') return null
    const node: PickNode = { sessionKey, backendNodeId, frameId: stringField(located, 'frameId') }
    let described: unknown
    try {
      described = await this.reader.call('DOM.describeNode', { backendNodeId }, sessionKey)
    } catch {
      return { node, contentFrameId: null }
    }
    const desc = isRecord(described) ? described.node : undefined
    const isOwner = FRAME_OWNER_TAGS.has(stringField(desc, 'nodeName').toUpperCase())
    const contentFrameId = isOwner ? stringField(desc, 'frameId') || null : null
    return { node, contentFrameId }
  }
}
