// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Plugin and PDF content is picked as its host element (spec 025,
 * 025-FR-029, spec change S-2; ADR 0007).
 *
 * An `<embed>` or `<object>` that shows a PDF holds a child document in the
 * same session, and `DOM.getNodeForLocation` goes into it. When the hit node
 * lies in a frame below the session's own root frame, the frames from it up
 * to that root are walked (`DOM.getFrameOwner` on each), and the outermost
 * `<embed>` or `<object>` owner on the way is the element picked. `<iframe>`
 * owners are passed over: their content is pickable (025-FR-029).
 *
 * The session's root frame is the target id for an out-of-process frame and,
 * for the top, learned once from `Page.getFrameTree` – so a hit in a
 * session's own document costs no command at all.
 */
import { isRecord } from '../cdp/cdpTypes'
import { stringField, TOP_SESSION, type PickNode, type PickReader } from './pickCdp'
import type { PickFrames } from './pickFrames'

/** Owner tags whose content is not picked inside (S-2). */
const HOST_TAGS = new Set(['EMBED', 'OBJECT'])

/** Frames walked up at most from one hit. */
const MAX_WALK = 16

export class PickEmbedHost {
  /** Session key → its root frame id (only the top's is learned; a child's is its target id). */
  private readonly roots = new Map<string, string>()

  constructor(
    private readonly reader: PickReader,
    private readonly frames: PickFrames
  ) {}

  /**
   * The outermost `<embed>` or `<object>` that holds `node`'s frame within
   * its session, or null when there is none (or it cannot be read).
   */
  async hostOf(node: PickNode): Promise<PickNode | null> {
    if (node.frameId === '') return null
    const root = await this.rootFrame(node.sessionKey)
    if (root === null || root === node.frameId) return null
    const { treeRoot, parents } = await this.treeOf(node.sessionKey)
    if (node.sessionKey === TOP_SESSION && treeRoot !== null) this.roots.set(node.sessionKey, treeRoot)
    let host: PickNode | null = null
    let frame = node.frameId
    for (let step = 0; step < MAX_WALK && frame !== treeRoot; step++) {
      const parent = parents.get(frame)
      if (parent === undefined) break
      const owner = await this.ownerTag(node.sessionKey, frame)
      if (owner === null) break
      if (HOST_TAGS.has(owner.tag)) host = { sessionKey: node.sessionKey, backendNodeId: owner.backendNodeId, frameId: parent }
      frame = parent
    }
    return host
  }

  private async rootFrame(sessionKey: string): Promise<string | null> {
    if (sessionKey !== TOP_SESSION) return this.frames.frameTargets().find((t) => t.sessionKey === sessionKey)?.targetId ?? null
    const known = this.roots.get(sessionKey)
    if (known !== undefined) return known
    try {
      const raw = await this.reader.call('Page.getFrameTree', undefined, sessionKey)
      const tree = isRecord(raw) && isRecord(raw.frameTree) ? raw.frameTree : undefined
      const id = stringField(isRecord(tree) ? tree.frame : undefined, 'id')
      if (id === '') return null
      this.roots.set(sessionKey, id)
      return id
    } catch {
      return null
    }
  }

  /**
   * The session's frame tree: its root frame id and each frame's parent. The
   * top's cached root is refreshed from it, so a stale one costs one walk.
   */
  private async treeOf(sessionKey: string): Promise<{ treeRoot: string | null; parents: Map<string, string> }> {
    const parents = new Map<string, string>()
    try {
      const raw = await this.reader.call('Page.getFrameTree', undefined, sessionKey)
      const tree = isRecord(raw) ? raw.frameTree : undefined
      collectParents(tree, null, parents)
      const id = stringField(isRecord(tree) ? tree.frame : undefined, 'id')
      return { treeRoot: id === '' ? null : id, parents }
    } catch {
      // The session cannot answer: no walk.
      return { treeRoot: null, parents }
    }
  }

  private async ownerTag(sessionKey: string, frameId: string): Promise<{ tag: string; backendNodeId: number } | null> {
    try {
      const owner = await this.reader.call('DOM.getFrameOwner', { frameId }, sessionKey)
      const backendNodeId = isRecord(owner) ? owner.backendNodeId : undefined
      if (typeof backendNodeId !== 'number') return null
      const described = await this.reader.call('DOM.describeNode', { backendNodeId }, sessionKey)
      const tag = stringField(isRecord(described) ? described.node : undefined, 'nodeName').toUpperCase()
      return { tag, backendNodeId }
    } catch {
      return null
    }
  }
}

function collectParents(node: unknown, parent: string | null, out: Map<string, string>): void {
  if (!isRecord(node) || !isRecord(node.frame)) return
  const id = stringField(node.frame, 'id')
  if (id !== '' && parent !== null) out.set(id, parent)
  if (Array.isArray(node.childFrames)) for (const child of node.childFrames) collectParents(child, id || null, out)
}
