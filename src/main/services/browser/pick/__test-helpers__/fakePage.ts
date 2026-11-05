// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A scripted page behind {@link FakePickCdp}: a small DOM per session, the
 * frame tree, and out-of-process frame targets, answering the CDP commands
 * and pinned page functions pick mode sends. Boxes are frame-local CSS px.
 *
 * ```ts
 * const page = new FakePage()
 * page.add({ id: 1, tag: 'html', box: [0, 0, 800, 600] })
 * page.add({ id: 2, tag: 'button', parent: 1, attrs: { id: 'save' }, box: [10, 10, 80, 20] })
 * ```
 */
import { OUTER_HTML_CUT } from '../../cdp/cdpPinned'
import { PICK_ANCESTOR, PICK_CHAIN, PICK_STYLES, REACT_LOOKUP } from '../../cdp/cdpPickFunctions'
import type { CdpTargetInfo } from '../../cdp/cdpSessionTypes'
import { FakePickCdp, frameTarget } from './fakePickCdp'

export interface FakeNode {
  readonly id: number
  readonly tag: string
  readonly session?: string
  readonly frameId?: string
  readonly parent?: number
  readonly attrs?: Record<string, string>
  /** `[x, y, width, height]` in the node's own frame, CSS px; absent for a node with no box. */
  readonly box?: readonly [number, number, number, number]
  /** Border plus padding on each side, CSS px: the content box lies this far inside `box` (none: 0). */
  readonly inset?: number
  /** For an `<iframe>`: the frame it holds. */
  readonly contentFrameId?: string
  readonly shadow?: 'open' | 'closed'
  /** `pointer-events: none`: skipped by a hit test unless it asks for `ignorePointerEventsNone`. */
  readonly pointerEventsNone?: boolean
}

export interface FakeFrame {
  readonly frameId: string
  readonly parentId: string | null
  readonly session: string
  readonly origin: string
  readonly url?: string
}

const objectIdOf = (id: number): string => `obj:${id}`
const idOfObject = (objectId: unknown): number => (typeof objectId === 'string' && objectId.startsWith('obj:') ? Number(objectId.slice(4)) : NaN)

export class FakePage {
  readonly cdp = new FakePickCdp()
  readonly nodes = new Map<number, FakeNode>()
  readonly frames: FakeFrame[] = [{ frameId: 'top', parentId: null, session: '', origin: 'https://app.test', url: 'https://app.test/' }]
  readonly viewports = new Map<string, { width: number; height: number }>([['', { width: 800, height: 600 }]])
  /**
   * Each session's document scroll offset (none: 0, 0). Node boxes are in the
   * viewport, as `getContentQuads` answers; `getNodeForLocation` takes
   * document coordinates, as the engine does.
   */
  readonly scrolls = new Map<string, { x: number; y: number }>()
  /** What the React lookup answers, by node id; absent nodes answer null. */
  readonly react = new Map<number, unknown>()
  /** Node ids whose page-function reads throw (a page that broke a prototype, or the node went). */
  readonly broken = new Set<number>()
  /** Nodes no longer in their document (`isConnected` false). */
  readonly disconnected = new Set<number>()
  matchedStyles: unknown = { matchedCSSRules: [] }

  constructor() {
    this.install()
  }

  add(node: FakeNode): this {
    this.nodes.set(node.id, { session: '', frameId: 'top', ...node })
    return this
  }

  remove(id: number): void {
    this.nodes.delete(id)
  }

  /** An out-of-process frame: its target, its frame, its viewport, announced on the parent session. */
  addFrameTarget(sessionKey: string, frameId: string, parentFrameId: string, parentSession = '', viewport = { width: 300, height: 150 }, origin = 'https://other.test'): CdpTargetInfo {
    const target = frameTarget(sessionKey, frameId, `${origin}/`)
    this.cdp.targets.push(target)
    this.frames.push({ frameId, parentId: parentFrameId, session: sessionKey, origin, url: `${origin}/` })
    this.viewports.set(sessionKey, viewport)
    this.cdp.emit('protocolEvent', {
      target: this.cdp.targets.find((t) => t.sessionKey === parentSession)!,
      method: 'Target.attachedToTarget',
      params: { sessionId: sessionKey, targetInfo: { targetId: frameId, type: 'iframe' } }
    })
    return target
  }

  /** A same-process child frame. */
  addFrame(frame: FakeFrame): void {
    this.frames.push(frame)
  }

  private node(id: unknown): FakeNode {
    const node = typeof id === 'number' ? this.nodes.get(id) : undefined
    if (node === undefined) throw new Error('No node with given id found')
    return node
  }

  /** The chain from `id` to its document root, element first. */
  private ancestry(id: number): FakeNode[] {
    const out: FakeNode[] = []
    for (let n: FakeNode | undefined = this.nodes.get(id); n !== undefined; n = n.parent === undefined ? undefined : this.nodes.get(n.parent)) out.push(n)
    return out
  }

  private quad(node: FakeNode): number[] | null {
    if (node.box === undefined) return null
    const [x, y, w, h] = node.box
    return [x, y, x + w, y, x + w, y + h, x, y + h]
  }

  private install(): void {
    const c = this.cdp
    c.handle('DOM.getNodeForLocation', (p, session) => {
      const scroll = this.scrolls.get(session) ?? { x: 0, y: 0 }
      const x = (p.x as number) - scroll.x
      const y = (p.y as number) - scroll.y
      let best: FakeNode | null = null
      for (const n of this.nodes.values()) {
        if (n.session !== session || n.box === undefined) continue
        if (n.pointerEventsNone === true && p.ignorePointerEventsNone !== true) continue
        const [bx, by, bw, bh] = n.box
        if (x < bx || y < by || x >= bx + bw || y >= by + bh) continue
        if (best === null || bw * bh <= best.box![2] * best.box![3]) best = n
      }
      if (best === null) throw new Error('No node found at given location')
      return { backendNodeId: best.id, frameId: best.frameId }
    })
    c.handle('DOM.describeNode', (p) => {
      const n = this.node(p.backendNodeId ?? idOfObject(p.objectId))
      const attributes = Object.entries(n.attrs ?? {}).flat()
      return { node: { backendNodeId: n.id, nodeName: n.tag.toUpperCase(), localName: n.tag, attributes, ...(n.contentFrameId ? { frameId: n.contentFrameId } : {}) } }
    })
    c.handle('DOM.getBoxModel', (p) => {
      const n = this.node(p.backendNodeId)
      const border = this.quad(n)
      if (border === null) throw new Error('Could not compute box model.')
      const inset = n.inset ?? 0
      const [x, y, w, h] = n.box!
      const content = [x + inset, y + inset, x + w - inset, y + inset, x + w - inset, y + h - inset, x + inset, y + h - inset]
      return { model: { border, content, width: w, height: h } }
    })
    c.handle('DOM.resolveNode', (p) => ({ object: { objectId: objectIdOf(this.node(p.backendNodeId).id) } }))
    c.handle('Page.createIsolatedWorld', () => ({ executionContextId: 1 }))
    c.handle('Page.getFrameTree', (_p, session) => {
      const own = this.frames.filter((f) => f.session === session)
      const root = own.find((f) => f.parentId === null || !own.some((o) => o.frameId === f.parentId))
      const tree = (f: FakeFrame): unknown => ({
        frame: { id: f.frameId, ...(f.parentId ? { parentId: f.parentId } : {}), url: f.url ?? '', securityOrigin: f.origin },
        childFrames: own.filter((o) => o.parentId === f.frameId).map(tree)
      })
      return { frameTree: root === undefined ? undefined : tree(root) }
    })
    c.handle('Page.getLayoutMetrics', (_p, session) => {
      const v = this.viewports.get(session)
      const scroll = this.scrolls.get(session) ?? { x: 0, y: 0 }
      return v === undefined ? {} : { cssLayoutViewport: { clientWidth: v.width, clientHeight: v.height, pageX: scroll.x, pageY: scroll.y } }
    })
    c.handle('DOM.getFrameOwner', (p) => {
      const owner = [...this.nodes.values()].find((n) => n.contentFrameId === p.frameId)
      if (owner === undefined) throw new Error('Frame owner not found')
      return { backendNodeId: owner.id }
    })
    c.handle('DOM.getContentQuads', (p) => {
      const q = this.quad(this.node(p.backendNodeId))
      return { quads: q === null ? [] : [q] }
    })
    c.handle('DOM.getDocument', (_p, session) => ({ root: { nodeId: session === '' ? 1000 : 2000 } }))
    c.handle('DOM.querySelectorAll', () => ({ nodeIds: [55] }))
    c.handle('CSS.getMatchedStylesForNode', () => this.matchedStyles)
    c.handle('Runtime.callFunctionOn', (p) => this.callFunction(p))
  }

  private callFunction(p: Record<string, unknown>): unknown {
    const id = idOfObject(p.objectId)
    const node = this.node(id)
    if (this.broken.has(id)) return { result: { type: 'object' }, exceptionDetails: { text: 'EvalError: Possible side-effect in debug-evaluate' } }
    const args = Array.isArray(p.arguments) ? p.arguments.map((a: { value: unknown }) => a.value) : []
    switch (p.functionDeclaration) {
      case PICK_CHAIN.source:
        return { result: { value: this.chainValue(node) } }
      case PICK_ANCESTOR.source: {
        const up = this.ancestry(node.id)[args[0] as number]
        return { result: up === undefined ? { type: 'object', subtype: 'null', value: null } : { type: 'object', objectId: objectIdOf(up.id) } }
      }
      case PICK_STYLES.source:
        return { result: { value: { styles: [['display', 'block'], ['color', 'rgb(0, 0, 0)']], layout: [{ tag: 'div', display: 'flex', position: 'static', overflow: 'visible', width: '10px', height: '10px' }] } } }
      case OUTER_HTML_CUT.source:
        return { result: { value: `<${node.tag}></${node.tag}>` } }
      case REACT_LOOKUP.source:
        return { result: { value: this.react.get(node.id) ?? null } }
      default:
        throw new Error('function not pinned')
    }
  }

  private chainValue(node: FakeNode): unknown {
    const chain = this.ancestry(node.id).map((n) => ({
      tag: n.tag,
      id: n.attrs?.id ?? '',
      cls: n.attrs?.class ?? '',
      x: n.box?.[0] ?? 0,
      y: n.box?.[1] ?? 0,
      w: n.box?.[2] ?? 0,
      h: n.box?.[3] ?? 0,
      shadow: n.shadow ?? null,
      attrs: Object.entries(n.attrs ?? {}).filter(([k]) => k.startsWith('data-'))
    }))
    const sel = node.attrs?.id ? `${node.tag}#${node.attrs.id}` : node.tag
    return { chain, selectors: [sel], closed: chain.some((e) => e.shadow === 'closed'), connected: !this.disconnected.has(node.id) }
  }
}
