// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frames of one tab as pick mode sees them (spec 025, 025-FR-027,
 * 025-FR-029, 025-FR-033; ADR 0007 decision 4).
 *
 * - **Which session holds a frame.** Same-process frames live in their
 *   parent's session; an out-of-process frame (a cross-site frame, ADR 0007
 *   frame kinds) is its own flattened target. The parent session of every
 *   child target is learned from the `Target.attachedToTarget` event that
 *   announced it, so nothing else in `cdp/` has to expose it.
 * - **Frame chain** (025-FR-029): `Page.getFrameTree` of each frame target,
 *   joined across sessions through each out-of-process root's `parentId`;
 *   each frame's origin: `null` for a sandboxed frame without
 *   `allow-same-origin` (read from its owner's `sandbox` attribute – the
 *   engine reports the URL's origin for an out-of-process one), a `srcdoc`
 *   frame's parent's origin (the engine reports `://`), otherwise the
 *   engine's `securityOrigin`.
 * - **The owner `<iframe>`** of a frame (Up crosses from a frame's root to
 *   it, 025-FR-027): `DOM.getFrameOwner` in the session that holds the
 *   parent frame.
 * - **To the view** (025-FR-033 boxes, the pick point): a session's
 *   coordinates map to the top-level viewport through the owner's content
 *   quad (`DOM.getContentQuads`, transformed frames included) and the frame's
 *   own viewport size (`Page.getLayoutMetrics`), composed up the chain.
 */
import { isRecord } from '../cdp/cdpTypes'
import type { CdpTargetInfo } from '../cdp/cdpSessionTypes'
import { composeAffine, frameToParent, IDENTITY, mapBox, quadFrom, type Affine, type Box } from './pickGeometry'
import { TOP_SESSION, type PickCdp, type PickReader } from './pickCdp'

/** One frame of the tab. */
export interface PickFrame {
  readonly frameId: string
  readonly parentId: string | null
  readonly sessionKey: string
  readonly url: string
  readonly origin: string
}

/** Longest frame chain followed (a pathological nesting depth). */
const MAX_FRAME_DEPTH = 64

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The engine's origin for a frame: `securityOrigin`, `null` for an opaque one. */
function frameOrigin(frame: Record<string, unknown>): string {
  const origin = str(frame.securityOrigin)
  if (origin === '' || origin === '://') return 'null'
  return origin
}

function flattenTree(node: unknown, sessionKey: string, out: PickFrame[]): void {
  if (!isRecord(node) || !isRecord(node.frame)) return
  const frame = node.frame
  const frameId = str(frame.id)
  if (frameId !== '') {
    out.push({ frameId, parentId: str(frame.parentId) || null, sessionKey, url: str(frame.url), origin: frameOrigin(frame) })
  }
  if (Array.isArray(node.childFrames)) for (const child of node.childFrames) flattenTree(child, sessionKey, out)
}

/** The frames from the top down to `frameId`, from a list of every frame; top first. */
export function chainFrames(all: readonly PickFrame[], frameId: string): PickFrame[] {
  const byId = new Map(all.map((f) => [f.frameId, f]))
  const out: PickFrame[] = []
  for (let f = byId.get(frameId); f !== undefined && out.length < MAX_FRAME_DEPTH; f = f.parentId === null ? undefined : byId.get(f.parentId)) {
    out.unshift(f)
  }
  return out
}

export class PickFrames {
  /** Child session key → the session that announced it. */
  private readonly parents = new Map<string, string>()
  private readonly unsubscribe: () => void

  constructor(
    private readonly cdp: PickCdp,
    private readonly reader: PickReader
  ) {
    this.unsubscribe = cdp.on('protocolEvent', (event) => {
      if (event.method !== 'Target.attachedToTarget' || !isRecord(event.params)) return
      const child = str(event.params.sessionId)
      if (child !== '') this.parents.set(child, event.target.sessionKey)
    })
  }

  dispose(): void {
    this.unsubscribe()
    this.parents.clear()
  }

  /** The session that announced `sessionKey`, or null for the top (or an unknown) one. */
  parentSession(sessionKey: string): string | null {
    return this.parents.get(sessionKey) ?? null
  }

  /** The attached out-of-process frame target whose frame is `frameId`, or null. */
  frameTarget(frameId: string): CdpTargetInfo | null {
    return this.cdp.attachedTargets().find((t) => t.type === 'iframe' && t.targetId === frameId) ?? null
  }

  /** Every attached frame target (the top one and out-of-process frames). */
  frameTargets(): CdpTargetInfo[] {
    return this.cdp.attachedTargets().filter((t) => t.sessionKey === TOP_SESSION || t.type === 'iframe')
  }

  /** Every frame of every frame target. Frames of a target that cannot answer are left out. */
  async allFrames(): Promise<PickFrame[]> {
    const lists = await Promise.all(
      this.frameTargets().map(async (t) => {
        const out: PickFrame[] = []
        try {
          const raw = await this.reader.call('Page.getFrameTree', undefined, t.sessionKey)
          flattenTree(isRecord(raw) ? raw.frameTree : undefined, t.sessionKey, out)
        } catch {
          // The target went, or cannot answer: its frames are unknown.
        }
        return out
      })
    )
    return this.settleOrigins(lists.flat())
  }

  /**
   * Correct two engine reports, top frame first (HTML origin rules):
   * - a frame whose own `<iframe>` is sandboxed without `allow-same-origin`,
   *   or whose parent is such a frame (sandbox flags inherit), is `null` –
   *   the engine reports the URL's origin for an out-of-process one;
   * - an `about:srcdoc` frame, which the engine reports as `://`, has its
   *   parent's origin.
   * A frame whose owner cannot be read keeps the engine's report.
   */
  private async settleOrigins(frames: PickFrame[]): Promise<PickFrame[]> {
    const byId = new Map(frames.map((f) => [f.frameId, f]))
    const opaque = new Map<string, Promise<boolean>>()
    const ownRead = new Map<string, Promise<boolean | null>>()
    const ownSandbox = (frame: PickFrame): Promise<boolean | null> => {
      let known = ownRead.get(frame.frameId)
      if (known === undefined) {
        known = this.ownSandboxIsOpaque(frame, frames)
        ownRead.set(frame.frameId, known)
      }
      return known
    }
    // `depth` stops a parent loop in a malformed tree, as chainFrames does.
    const isOpaque = (frame: PickFrame, depth: number): Promise<boolean> => {
      let known = opaque.get(frame.frameId)
      if (known === undefined) {
        const parent = frame.parentId === null || depth >= MAX_FRAME_DEPTH ? undefined : byId.get(frame.parentId)
        known =
          parent === undefined ? Promise.resolve(false) : Promise.all([isOpaque(parent, depth + 1), ownSandbox(frame)]).then(([a, b]) => a || b === true)
        opaque.set(frame.frameId, known)
      }
      return known
    }
    const settle = async (frame: PickFrame, depth: number): Promise<PickFrame> => {
      if (await isOpaque(frame, depth)) return frame.origin === 'null' ? frame : { ...frame, origin: 'null' }
      const parent = frame.parentId === null || depth >= MAX_FRAME_DEPTH ? undefined : byId.get(frame.parentId)
      if (frame.url !== 'about:srcdoc' || frame.origin !== 'null' || parent === undefined) return frame
      // Only an owner read as not sandboxed lets it take the parent's origin.
      if ((await ownSandbox(frame)) !== false) return frame
      return { ...frame, origin: (await settle(parent, depth + 1)).origin }
    }
    return Promise.all(frames.map((f) => settle(f, 0)))
  }

  /** Whether the frame's own owner element carries `sandbox` without `allow-same-origin`; null when it cannot be read. */
  private async ownSandboxIsOpaque(frame: PickFrame, frames: readonly PickFrame[]): Promise<boolean | null> {
    try {
      const owner = await this.ownerOf(frame, frames)
      if (owner === null) return null
      const raw = await this.reader.call('DOM.describeNode', { backendNodeId: owner.backendNodeId }, owner.sessionKey)
      const attrs = isRecord(raw) && isRecord(raw.node) && Array.isArray(raw.node.attributes) ? raw.node.attributes : []
      for (let i = 0; i + 1 < attrs.length; i += 2) {
        if (attrs[i] === 'sandbox') return !str(attrs[i + 1]).split(/\s+/).includes('allow-same-origin')
      }
      return false
    } catch {
      return null
    }
  }

  /**
   * Whether `frameId` is still a frame of `sessionKey` – false once its
   * target detached or the frame left the session's tree (025-FR-029: a
   * removed frame ends the highlight). An empty `frameId` (unknown) and a
   * tree that cannot be read count as alive, so nothing is ended on a guess.
   */
  async frameAlive(sessionKey: string, frameId: string): Promise<boolean> {
    if (!this.frameTargets().some((t) => t.sessionKey === sessionKey)) return false
    if (frameId === '') return true
    let raw: unknown
    try {
      raw = await this.reader.call('Page.getFrameTree', undefined, sessionKey)
    } catch {
      return true
    }
    const frames: PickFrame[] = []
    flattenTree(isRecord(raw) ? raw.frameTree : undefined, sessionKey, frames)
    return frames.length === 0 || frames.some((f) => f.frameId === frameId)
  }

  /** The frames from the top page down to `frameId`, top first; just the frame when the chain breaks. */
  async frameChain(frameId: string): Promise<PickFrame[]> {
    return chainFrames(await this.allFrames(), frameId)
  }

  /** The owner element of `frame` (an `<iframe>` or `<frame>`) in its parent frame's session, or null for the top frame. */
  async ownerOf(frame: PickFrame, frames: readonly PickFrame[]): Promise<{ sessionKey: string; backendNodeId: number; frameId: string } | null> {
    if (frame.parentId === null) return null
    const parent = frames.find((f) => f.frameId === frame.parentId)
    if (parent === undefined) return null
    const raw = await this.reader.call('DOM.getFrameOwner', { frameId: frame.frameId }, parent.sessionKey)
    const backendNodeId = isRecord(raw) ? raw.backendNodeId : undefined
    if (typeof backendNodeId !== 'number') return null
    return { sessionKey: parent.sessionKey, backendNodeId, frameId: parent.frameId }
  }

  /**
   * The map from `sessionKey`'s coordinates to the top-level viewport's,
   * through each out-of-process owner's content quad. Throws when a link of
   * the chain cannot be read (a frame going away mid-read).
   */
  async toView(sessionKey: string): Promise<Affine> {
    let map = IDENTITY
    let key = sessionKey
    for (let depth = 0; key !== TOP_SESSION && depth < MAX_FRAME_DEPTH; depth++) {
      const parentKey = this.parentSession(key)
      const target = this.cdp.attachedTargets().find((t) => t.sessionKey === key)
      if (parentKey === null || target === undefined) throw new Error('frame target is not attached')
      const owner = await this.reader.call('DOM.getFrameOwner', { frameId: target.targetId }, parentKey)
      const backendNodeId = isRecord(owner) ? owner.backendNodeId : undefined
      if (typeof backendNodeId !== 'number') throw new Error('frame owner not found')
      const step = await this.childToParent(key, parentKey, backendNodeId)
      map = composeAffine(step, map)
      key = parentKey
    }
    return map
  }

  /** {@link toView} and the frame viewport's bounding box in the top-level viewport. */
  async viewBox(sessionKey: string): Promise<{ toView: Affine; box: Box }> {
    const [toView, size] = await Promise.all([this.toView(sessionKey), this.viewportSize(sessionKey)])
    return { toView, box: mapBox(toView, { x: 0, y: 0, width: size.width, height: size.height }) }
  }

  /** A session's layout viewport size in CSS px (0 × 0 when unknown). */
  async viewportSize(sessionKey: string): Promise<{ width: number; height: number }> {
    const metrics = await this.reader.call('Page.getLayoutMetrics', undefined, sessionKey)
    const viewport = isRecord(metrics) && isRecord(metrics.cssLayoutViewport) ? metrics.cssLayoutViewport : {}
    return {
      width: typeof viewport.clientWidth === 'number' ? viewport.clientWidth : 0,
      height: typeof viewport.clientHeight === 'number' ? viewport.clientHeight : 0
    }
  }

  /** The map from the child session's viewport into its parent's, through the owner's content quad. */
  async childToParent(childKey: string, parentKey: string, ownerBackendNodeId: number): Promise<Affine> {
    const [quads, size] = await Promise.all([
      this.reader.call('DOM.getContentQuads', { backendNodeId: ownerBackendNodeId }, parentKey),
      this.viewportSize(childKey)
    ])
    const list = isRecord(quads) && Array.isArray(quads.quads) ? quads.quads : []
    const quad = quadFrom(list[0])
    const map = quad === null ? null : frameToParent(quad, size.width, size.height)
    if (map === null) throw new Error('frame owner has no content box')
    return map
  }
}
