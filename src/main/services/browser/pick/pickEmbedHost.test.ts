// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it } from 'vitest'
import { PickReader } from './pickCdp'
import { PickEmbedHost } from './pickEmbedHost'
import { PickFrames } from './pickFrames'
import { FakePickCdp, frameTarget } from './__test-helpers__/fakePickCdp'

/** top › iframe#f1 (frame F1) › embed (frame PDF); and top › object (frame OBJ) › embed (frame INNER). */
const TREE = {
  frameTree: {
    frame: { id: 'top' },
    childFrames: [
      { frame: { id: 'F1', parentId: 'top' }, childFrames: [{ frame: { id: 'PDF', parentId: 'F1' } }] },
      { frame: { id: 'OBJ', parentId: 'top' }, childFrames: [{ frame: { id: 'INNER', parentId: 'OBJ' } }] }
    ]
  }
}

/** Frame id → its owner element (backend id, tag). */
const OWNERS: Record<string, { id: number; tag: string }> = {
  F1: { id: 10, tag: 'IFRAME' },
  PDF: { id: 11, tag: 'EMBED' },
  OBJ: { id: 20, tag: 'OBJECT' },
  INNER: { id: 21, tag: 'EMBED' }
}

describe('PickEmbedHost (025-FR-029, S-2)', () => {
  let cdp: FakePickCdp
  let host: PickEmbedHost

  beforeEach(() => {
    cdp = new FakePickCdp()
    cdp.handle('Page.getFrameTree', () => TREE)
    cdp.handle('DOM.getFrameOwner', (p) => {
      const owner = OWNERS[String(p.frameId)]
      if (owner === undefined) throw new Error('no owner')
      return { backendNodeId: owner.id }
    })
    cdp.handle('DOM.describeNode', (p) => ({ node: { nodeName: Object.values(OWNERS).find((o) => o.id === p.backendNodeId)?.tag ?? 'DIV' } }))
    const reader = new PickReader(cdp)
    host = new PickEmbedHost(reader, new PickFrames(cdp, reader))
  })

  it("a hit in the session's own document is its own pick; the top's root is learned once", async () => {
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 5, frameId: 'top' })).toBeNull()
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 6, frameId: 'top' })).toBeNull()
    expect(cdp.calls('Page.getFrameTree')).toHaveLength(1)
    expect(cdp.calls('DOM.getFrameOwner')).toHaveLength(0)
  })

  it('a hit inside an <embed> picks the embed, in the frame that holds it', async () => {
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 99, frameId: 'PDF' })).toEqual({ sessionKey: '', backendNodeId: 11, frameId: 'F1' })
  })

  it('an <iframe> owner alone is passed over: its content stays pickable', async () => {
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 99, frameId: 'F1' })).toBeNull()
  })

  it('nested hosts: the outermost <object> wins', async () => {
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 99, frameId: 'INNER' })).toEqual({ sessionKey: '', backendNodeId: 20, frameId: 'top' })
  })

  it("an out-of-process frame's root is its target id: no tree read for a hit in its own document", async () => {
    cdp.targets.push(frameTarget('S1', 'X1'))
    expect(await host.hostOf({ sessionKey: 'S1', backendNodeId: 3, frameId: 'X1' })).toBeNull()
    expect(cdp.calls('Page.getFrameTree')).toHaveLength(0)
  })

  it('an unknown frame id, an unknown session, or a tree that cannot be read: no host', async () => {
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 1, frameId: '' })).toBeNull()
    expect(await host.hostOf({ sessionKey: 'gone', backendNodeId: 1, frameId: 'Z' })).toBeNull()
    cdp.handle('Page.getFrameTree', () => {
      throw new Error('gone')
    })
    const reader = new PickReader(cdp)
    const fresh = new PickEmbedHost(reader, new PickFrames(cdp, reader))
    expect(await fresh.hostOf({ sessionKey: '', backendNodeId: 1, frameId: 'PDF' })).toBeNull()
  })

  it('an owner that cannot be read ends the walk with what was found so far', async () => {
    cdp.handle('DOM.getFrameOwner', () => {
      throw new Error('gone')
    })
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 99, frameId: 'PDF' })).toBeNull()
  })

  it("a stale top root (a new main frame) is refreshed from the tree it read", async () => {
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 5, frameId: 'top' })).toBeNull()
    cdp.handle('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'top2' } } }))
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 5, frameId: 'top2' })).toBeNull()
    const reads = cdp.calls('Page.getFrameTree').length
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 5, frameId: 'top2' })).toBeNull()
    expect(cdp.calls('Page.getFrameTree')).toHaveLength(reads)
  })

  it('malformed answers walk nothing: a tree without a root id, an owner without a backend id, a node without a name', async () => {
    cdp.handle('Page.getFrameTree', () => ({ frameTree: { frame: {} } }))
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 1, frameId: 'PDF' })).toBeNull()
    cdp.handle('Page.getFrameTree', () => 'junk')
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 1, frameId: 'PDF' })).toBeNull()
    cdp.handle('Page.getFrameTree', () => TREE)
    cdp.handle('DOM.getFrameOwner', () => ({}))
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 1, frameId: 'PDF' })).toBeNull()
    cdp.handle('DOM.getFrameOwner', () => ({ backendNodeId: 11 }))
    cdp.handle('DOM.describeNode', () => 'junk')
    expect(await host.hostOf({ sessionKey: '', backendNodeId: 1, frameId: 'PDF' })).toBeNull()
  })
})

