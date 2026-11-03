// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PickReader } from './pickCdp'
import { chainFrames, PickFrames } from './pickFrames'
import { applyAffine } from './pickGeometry'
import { samplePage } from './__test-helpers__/samplePage'

function setup() {
  let frames: PickFrames | undefined
  const page = samplePage({ beforeFrames: (p) => (frames = new PickFrames(p.cdp, new PickReader(p.cdp))) })
  return { page, frames: frames! }
}

describe('PickFrames', () => {
  it('learns which session announced each frame target', () => {
    const { frames } = setup()
    expect(frames.parentSession('S1')).toBe('')
    expect(frames.parentSession('')).toBeNull()
    expect(frames.frameTarget('F1')?.sessionKey).toBe('S1')
    expect(frames.frameTarget('nope')).toBeNull()
    expect(frames.frameTargets().map((t) => t.sessionKey)).toEqual(['', 'S1'])
  })

  it('ignores protocol events other than a target attach, and stops listening on dispose', () => {
    const { page, frames } = setup()
    page.cdp.emit('protocolEvent', { target: page.cdp.targets[0], method: 'Page.frameNavigated', params: { sessionId: 'X' } })
    page.cdp.emit('protocolEvent', { target: page.cdp.targets[0], method: 'Target.attachedToTarget', params: 'junk' })
    page.cdp.emit('protocolEvent', { target: page.cdp.targets[0], method: 'Target.attachedToTarget', params: { sessionId: '' } })
    expect(frames.parentSession('X')).toBeNull()
    frames.dispose()
    expect(frames.parentSession('S1')).toBeNull()
    expect(page.cdp.listenerCount('protocolEvent')).toBe(0)
  })

  it('lists the frames of every frame target with their origins, and joins the chain across sessions (025-FR-029)', async () => {
    const { page, frames } = setup()
    page.addFrame({ frameId: 'sandboxed', parentId: 'top', session: '', origin: '://' })
    const all = await frames.allFrames()
    expect(all.map((f) => [f.frameId, f.sessionKey, f.origin])).toEqual([
      ['top', '', 'https://app.test'],
      ['sandboxed', '', 'null'],
      ['F1', 'S1', 'https://other.test']
    ])
    expect((await frames.frameChain('F1')).map((f) => f.frameId)).toEqual(['top', 'F1'])
  })

  it("gives a srcdoc frame its parent's origin, but keeps null when its own iframe is sandboxed without allow-same-origin (025-FR-029)", async () => {
    const { page, frames } = setup()
    // The engine reports `://` for every srcdoc frame, sandboxed or not.
    const srcdoc = (frameId: string, id: number, attrs: Record<string, string>) => {
      page.add({ id, tag: 'iframe', parent: 2, attrs, box: [0, 300 + id, 100, 50], contentFrameId: frameId })
      page.addFrame({ frameId, parentId: 'top', session: '', origin: '://', url: 'about:srcdoc' })
    }
    srcdoc('plain', 40, { id: 'plain' })
    srcdoc('locked', 41, { id: 'locked', sandbox: '' })
    srcdoc('opened', 42, { id: 'opened', sandbox: 'allow-scripts allow-same-origin' })
    srcdoc('child-of-locked', 43, { id: 'child' })
    page.frames[page.frames.length - 1] = { frameId: 'child-of-locked', parentId: 'locked', session: '', origin: '://', url: 'about:srcdoc' }
    // A srcdoc frame whose owner the engine cannot find keeps null.
    page.addFrame({ frameId: 'ownerless', parentId: 'top', session: '', origin: '://', url: 'about:srcdoc' })
    const origins = Object.fromEntries((await frames.allFrames()).map((f) => [f.frameId, f.origin]))
    expect(origins).toMatchObject({
      top: 'https://app.test',
      F1: 'https://other.test',
      plain: 'https://app.test',
      locked: 'null',
      opened: 'https://app.test',
      'child-of-locked': 'null',
      ownerless: 'null'
    })
  })

  it('records null for an out-of-process sandboxed frame the engine reports with its URL origin, and for its child (025-FR-029)', async () => {
    const { page, frames } = setup()
    page.add({ id: 50, tag: 'iframe', parent: 2, attrs: { id: 'sandboxed', sandbox: 'allow-scripts' }, box: [0, 300, 100, 50], contentFrameId: 'SB' })
    page.addFrameTarget('S9', 'SB', 'top', '', { width: 100, height: 50 }, 'https://app.test')
    // A plain child frame of the sandboxed one, in its session: the flags inherit.
    page.addFrame({ frameId: 'SB-child', parentId: 'SB', session: 'S9', origin: 'https://app.test', url: 'https://app.test/child' })
    const origins = Object.fromEntries((await frames.allFrames()).map((f) => [f.frameId, f.origin]))
    expect(origins).toMatchObject({ top: 'https://app.test', F1: 'https://other.test', SB: 'null', 'SB-child': 'null' })
  })

  it('leaves out the frames of a target that cannot answer', async () => {
    const { page, frames } = setup()
    page.cdp.handle('Page.getFrameTree', (_p, key) => {
      if (key === 'S1') throw new Error('gone')
      return { frameTree: { frame: { id: 'top', url: 'https://app.test/', securityOrigin: 'https://app.test' } } }
    })
    expect((await frames.allFrames()).map((f) => f.frameId)).toEqual(['top'])
  })

  it('finds a frame\'s owner element in its parent frame\'s session; none for the top frame', async () => {
    const { frames } = setup()
    const all = await frames.allFrames()
    expect(await frames.ownerOf(all.find((f) => f.frameId === 'F1')!, all)).toEqual({ sessionKey: '', backendNodeId: 6, frameId: 'top' })
    expect(await frames.ownerOf(all[0], all)).toBeNull()
    expect(await frames.ownerOf({ frameId: 'x', parentId: 'missing', sessionKey: '', url: '', origin: '' }, all)).toBeNull()
  })

  it('answers null for an owner the engine does not name', async () => {
    const { page, frames } = setup()
    page.cdp.handle('DOM.getFrameOwner', () => ({}))
    const all = await frames.allFrames()
    expect(await frames.ownerOf(all.find((f) => f.frameId === 'F1')!, all)).toBeNull()
  })

  it("maps a frame target's coordinates into the top viewport through its owner's content quad", async () => {
    const { frames } = setup()
    expect(applyAffine(await frames.toView(''), { x: 5, y: 6 })).toEqual({ x: 5, y: 6 })
    expect(applyAffine(await frames.toView('S1'), { x: 10, y: 10 })).toEqual({ x: 410, y: 110 })
    expect(await frames.viewBox('S1')).toMatchObject({ box: { x: 400, y: 100, width: 300, height: 150 } })
  })

  it('composes the map through a nested out-of-process frame', async () => {
    const { page, frames } = setup()
    page.add({ id: 103, tag: 'iframe', session: 'S1', frameId: 'F1', parent: 101, box: [100, 50, 100, 50], contentFrameId: 'F2' })
    page.addFrameTarget('S2', 'F2', 'F1', 'S1', { width: 100, height: 50 }, 'https://third.test')
    expect(applyAffine(await frames.toView('S2'), { x: 1, y: 2 })).toEqual({ x: 501, y: 152 })
    expect((await frames.frameChain('F2')).map((f) => f.frameId)).toEqual(['top', 'F1', 'F2'])
  })

  it('fails the map for a target not attached, an owner not found or an owner with no box', async () => {
    const { page, frames } = setup()
    await expect(frames.toView('ghost')).rejects.toThrow('frame target is not attached')
    page.cdp.handle('DOM.getFrameOwner', () => ({}))
    await expect(frames.toView('S1')).rejects.toThrow('frame owner not found')
    const other = setup()
    other.page.cdp.handle('DOM.getContentQuads', () => ({ quads: [] }))
    await expect(other.frames.toView('S1')).rejects.toThrow('frame owner has no content box')
  })

  it('reads a viewport of 0 × 0 when the metrics are missing', async () => {
    const { page, frames } = setup()
    page.viewports.delete('S1')
    expect(await frames.viewportSize('S1')).toEqual({ width: 0, height: 0 })
    await expect(frames.childToParent('S1', '', 6)).rejects.toThrow('frame owner has no content box')
  })
})

describe('chainFrames', () => {
  it('walks from a frame to the top; just the frame when its parent is unknown; empty for an unknown frame', () => {
    const all = [
      { frameId: 'a', parentId: null, sessionKey: '', url: '', origin: 'o' },
      { frameId: 'b', parentId: 'a', sessionKey: '', url: '', origin: 'o' },
      { frameId: 'c', parentId: 'zz', sessionKey: '', url: '', origin: 'o' }
    ]
    expect(chainFrames(all, 'b').map((f) => f.frameId)).toEqual(['a', 'b'])
    expect(chainFrames(all, 'c').map((f) => f.frameId)).toEqual(['c'])
    expect(chainFrames(all, 'none')).toEqual([])
  })
})
