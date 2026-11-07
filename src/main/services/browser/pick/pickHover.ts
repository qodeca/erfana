// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick mode's hover and the Up and Down walk before a confirm (spec 025,
 * 025-FR-026, 025-FR-027, 025-FR-029; solution design § 4), moved out of
 * `BrowserTabPick.ts`.
 *
 * - **Hover**: each move is hit-tested (`pickHitTest.ts`), one in flight and
 *   the latest kept; the engine outlines the element and its label goes out.
 * - **The chain Up walks** (`pickElement.readChain`) costs about four
 *   commands per ancestor on the page's own thread and leaves two handles per
 *   ancestor until pick mode ends, so it is read lazily: on the first Up or
 *   Down, or once the pointer has rested on one element for
 *   {@link CHAIN_REST_MS} – never for an element the pointer only crossed.
 *   A move to another element starts over from it.
 */
import type { Clock, TimerHandle } from '../../../../shared/clock'
import type { PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { RoutingEvent } from '../../../../shared/browser/routingState'
import type { PickNode, PickReader } from './pickCdp'
import { readChain, type ElementChain } from './pickElement'
import type { PickFrames } from './pickFrames'
import { sameNode } from './pickFlash'
import type { Point, PointerReport } from './pickGeometry'
import type { PickHighlight } from './pickHighlight'
import type { PickHitTest } from './pickHitTest'
import { liveStep } from './pickMenu'
import type { PickBench } from './pickSupport'

/** How long the pointer rests on one element before its chain is read ahead of an Up or Down. */
export const CHAIN_REST_MS = 150

type Note = Extract<PickEvent, { kind: 'note' }>['note']
type Emit = (event: { kind: 'highlight'; label: string | null } | { kind: 'note'; note: Note }) => void

export interface PickHoverDeps {
  readonly reader: PickReader
  readonly frames: PickFrames
  readonly highlight: PickHighlight
  readonly hitTest: PickHitTest
  readonly clock: Clock
  readonly bench?: PickBench
  /** The page view's top-left on the screen (DIP), or null while hidden. */
  readonly viewOrigin: () => Point | null
  /** The page's zoom factor (1 for a closed page). */
  readonly zoom: () => number
  /** Whether a hover may outline now: pick mode on and no capture held. */
  readonly canHover: () => boolean
  readonly routing: (event: RoutingEvent) => void
  readonly emit: Emit
}

/** The hovered element, where the highlight is on its chain, and the chain once read. */
interface Hovered {
  readonly node: PickNode
  index: number | null
  chain: Promise<ElementChain> | null
  rest: TimerHandle | undefined
}

export class PickHover {
  private busy = false
  private queued: PointerReport | null = null
  private hovered: Hovered | null = null
  /**
   * Where the pointer last hit the element the highlight shows, in page view
   * px. Written only once that element's outline is the highlight record, so a
   * confirm by key never pairs one element with the point of the next one,
   * whose outline is still being drawn.
   */
  private viewPoint: Point | null = null

  constructor(private readonly deps: PickHoverDeps) {}

  /** Where the pointer last hit the highlighted element (page view px), for a confirm by key. */
  get lastViewPoint(): Point | null {
    return this.viewPoint
  }

  /** Hit-test `report` and outline what is under it; one at a time, the latest wins. */
  move(report: PointerReport): void {
    if (this.busy) {
      this.queued = report
      return
    }
    this.busy = true
    const startedAt = this.deps.clock.now()
    void this.once(report, startedAt).finally(() => {
      this.busy = false
      const next = this.queued
      this.queued = null
      if (next !== null && this.deps.canHover()) this.move(next)
    })
  }

  /** The element under `report`, or null. Never rejects. */
  async hit(report: PointerReport): Promise<{ node: PickNode; viewPoint: Point } | null> {
    return this.deps.hitTest.atPointer(report, this.deps.viewOrigin() ?? { x: 0, y: 0 }, this.deps.zoom() || 1).catch(() => null)
  }

  /** The element at `point` (page view px, zoom removed), or null. Never rejects. */
  async atViewPoint(point: Point): Promise<{ node: PickNode; viewPoint: Point } | null> {
    return this.deps.hitTest.atViewPoint(point).catch(() => null)
  }

  /** The highlight ends: nothing under the pointer, or its frame went (025-FR-029, `pickFrameGone.ts`). */
  async end(): Promise<void> {
    if (this.deps.highlight.record !== null) await this.deps.highlight.hide()
    this.forget()
    this.deps.routing({ type: 'hover', element: false })
    this.deps.emit({ kind: 'highlight', label: null })
  }

  /** Up or Down on the live page: walk the hovered element's chain, read now if not yet. */
  async refine(move: 'parent' | 'child'): Promise<void> {
    const hovered = this.hovered
    if (hovered === null) return this.deps.emit({ kind: 'note', note: 'moveTheMouse' })
    const chain = await this.chainOf(hovered).catch(() => null)
    // The first read can take a while: a move to another element meanwhile wins, and this press is dropped.
    if (!this.stillOn(hovered)) return
    const step = liveStep(chain, hovered.index, move)
    if ('note' in step) return this.deps.emit({ kind: 'note', note: step.note })
    hovered.index = step.index
    const record = await this.deps.highlight.show(step.node)
    if (!this.stillOn(hovered)) return this.reoutline()
    if (record !== null) this.deps.emit({ kind: 'highlight', label: record.label })
  }

  /** Whether `hovered` is still the hovered element and a hover may outline. */
  private stillOn(hovered: Hovered): boolean {
    return this.hovered === hovered && this.deps.canHover()
  }

  /** Outline the element now hovered again, after a refinement drew over it. */
  private async reoutline(): Promise<void> {
    const current = this.hovered
    if (current === null || current.index !== null || !this.deps.canHover()) return
    const record = await this.deps.highlight.show(current.node)
    if (record !== null && this.hovered === current) this.deps.emit({ kind: 'highlight', label: record.label })
  }

  /** Forget the hovered element and its chain (pick mode off, a navigation). */
  forget(): void {
    this.setHovered(null)
  }

  /** Forget where the pointer last hit, too (pick mode off). */
  reset(): void {
    this.forget()
    this.viewPoint = null
  }

  private async once(report: PointerReport, startedAt: number): Promise<void> {
    const hit = await this.hit(report)
    if (!this.deps.canHover()) return
    if (hit === null) return this.end()
    // Skipped only while it shows: after a capture hid it, the same element is outlined again.
    const hovered = this.hovered
    if (this.deps.highlight.record !== null && hovered !== null && hovered.index === null && sameNode(hovered.node, hit.node)) {
      this.viewPoint = hit.viewPoint
      return
    }
    this.forget()
    const record = await this.deps.highlight.show(hit.node)
    if (record === null) return
    this.viewPoint = hit.viewPoint
    if (!this.deps.canHover()) return
    this.setHovered(this.restingOn(hit.node))
    this.deps.routing({ type: 'hover', element: true })
    this.deps.emit({ kind: 'highlight', label: record.label })
    this.deps.bench?.record('highlight', this.deps.clock.now() - startedAt)
  }

  /** A new hovered element whose chain is read once the pointer rests on it. */
  private restingOn(node: PickNode): Hovered {
    const hovered: Hovered = { node, index: null, chain: null, rest: undefined }
    hovered.rest = this.deps.clock.setTimeout(() => {
      hovered.rest = undefined
      if (this.hovered === hovered) void this.chainOf(hovered).catch(() => undefined)
    }, CHAIN_REST_MS)
    return hovered
  }

  private chainOf(hovered: Hovered): Promise<ElementChain> {
    if (hovered.chain === null) {
      this.deps.clock.clearTimeout(hovered.rest)
      hovered.rest = undefined
      hovered.chain = readChain(this.deps.reader, this.deps.frames, hovered.node)
      hovered.chain.catch(() => undefined)
    }
    return hovered.chain
  }

  private setHovered(next: Hovered | null): void {
    if (this.hovered !== null) this.deps.clock.clearTimeout(this.hovered.rest)
    this.hovered = next
  }
}
