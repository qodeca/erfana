// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PickReader } from './pickCdp'
import { PickFrames } from './pickFrames'
import { PickHitTest } from './pickHitTest'
import { samplePage } from './__test-helpers__/samplePage'

function setup() {
  let hitTest: PickHitTest | undefined
  const page = samplePage({
    beforeFrames: (p) => {
      const reader = new PickReader(p.cdp)
      hitTest = new PickHitTest(reader, new PickFrames(p.cdp, reader))
    }
  })
  return { page, hitTest: hitTest! }
}

describe('PickHitTest', () => {
  it('finds the deepest element at a view point in the top document', async () => {
    const { hitTest } = setup()
    expect(await hitTest.atViewPoint({ x: 35, y: 30 })).toEqual({ node: { sessionKey: '', backendNodeId: 5, frameId: 'top' }, viewPoint: { x: 35, y: 30 } })
  })

  it('a point inside an <embed> PDF picks the embed, not the document inside it (025-FR-029, S-2)', async () => {
    const { page, hitTest } = setup()
    page.addFrame({ frameId: 'PDF', parentId: 'top', session: '', origin: 'https://app.test' })
    page
      .add({ id: 7, tag: 'embed', parent: 2, attrs: { id: 'pdf' }, box: [500, 300, 100, 80], contentFrameId: 'PDF' })
      .add({ id: 8, tag: 'body', frameId: 'PDF', box: [505, 305, 90, 70] })
    expect(await hitTest.atViewPoint({ x: 550, y: 340 })).toEqual({ node: { sessionKey: '', backendNodeId: 7, frameId: 'top' }, viewPoint: { x: 550, y: 340 } })
  })

  it("descends into a cross-site frame through its owner's content quad (ADR 0007 decision 4)", async () => {
    const { hitTest } = setup()
    const hit = await hitTest.atViewPoint({ x: 415, y: 115 })
    expect(hit).toEqual({ node: { sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' }, viewPoint: { x: 415, y: 115 } })
    // The frame-local point was 15, 10 (rounded).
    expect(hitTest && (await hitTest.atViewPoint({ x: 600, y: 200 }))?.node.backendNodeId).toBe(101)
  })

  it('adds each session\'s scroll offset: getNodeForLocation takes document coordinates, the point is in the viewport', async () => {
    const { page, hitTest } = setup()
    page.scrolls.set('', { x: 0, y: 1919 })
    expect((await hitTest.atViewPoint({ x: 35, y: 30 }))?.node.backendNodeId).toBe(5)
    expect(page.cdp.calls('DOM.getNodeForLocation').at(-1)?.params).toMatchObject({ x: 35, y: 1949 })
    // A scrolled cross-site frame: its own offset, added in its own session.
    page.scrolls.set('S1', { x: 3, y: 200 })
    expect((await hitTest.atViewPoint({ x: 415, y: 115 }))?.node.backendNodeId).toBe(102)
    expect(page.cdp.calls('DOM.getNodeForLocation').at(-1)).toMatchObject({ sessionKey: 'S1', params: { x: 18, y: 215 } })
  })

  it('uses no offset when the layout metrics cannot be read', async () => {
    const { page, hitTest } = setup()
    page.cdp.handle('Page.getLayoutMetrics', () => {
      throw new Error('gone')
    })
    expect((await hitTest.atViewPoint({ x: 35, y: 30 }))?.node.backendNodeId).toBe(5)
  })

  it('stops at the owner element when its frame is not laid out yet', async () => {
    const { page, hitTest } = setup()
    page.viewports.delete('S1')
    expect((await hitTest.atViewPoint({ x: 415, y: 115 }))?.node).toEqual({ sessionKey: '', backendNodeId: 6, frameId: 'top' })
  })

  it('treats an iframe whose frame is in-process as the element under the pointer', async () => {
    const { page, hitTest } = setup()
    page.add({ id: 7, tag: 'iframe', parent: 2, box: [0, 400, 100, 100], contentFrameId: 'same-process' })
    expect((await hitTest.atViewPoint({ x: 10, y: 410 }))?.node.backendNodeId).toBe(7)
  })

  it('answers null for a point that hits nothing', async () => {
    const { hitTest } = setup()
    expect(await hitTest.atViewPoint({ x: 900, y: 900 })).toBeNull()
  })

  it('keeps a hit whose node cannot be described (it goes on to the highlight, which drops it)', async () => {
    const { page, hitTest } = setup()
    page.cdp.handle('DOM.describeNode', () => {
      throw new Error('gone')
    })
    expect((await hitTest.atViewPoint({ x: 35, y: 30 }))?.node.backendNodeId).toBe(5)
  })

  it('answers null for a located node without an id', async () => {
    const { page, hitTest } = setup()
    page.cdp.handle('DOM.getNodeForLocation', () => ({}))
    expect(await hitTest.atViewPoint({ x: 35, y: 30 })).toBeNull()
  })

  describe('atPointer', () => {
    it('reads x and y as the view point for main-side input (globals 0, 0), dividing by the zoom', async () => {
      const { hitTest } = setup()
      expect((await hitTest.atPointer({ x: 70, y: 60, globalX: 0, globalY: 0 }, { x: 100, y: 100 }, 2))?.node.backendNodeId).toBe(5)
    })

    it("maps a frame-local report through the frame whose box starts at the derived origin (a transformed frame's widget)", async () => {
      const { hitTest } = setup()
      // Local 15, 10 in F1; globals = view origin + frame origin (400, 100) + local.
      const hit = await hitTest.atPointer({ x: 15, y: 10, globalX: 1000 + 400 + 15, globalY: 500 + 100 + 10 }, { x: 1000, y: 500 }, 1)
      expect(hit).toEqual({ node: { sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' }, viewPoint: { x: 415, y: 110 } })
    })

    it('falls back to the globals as the view point when no frame starts at the derived origin', async () => {
      const { hitTest } = setup()
      const hit = await hitTest.atPointer({ x: 5, y: 5, globalX: 1000 + 35, globalY: 500 + 30 }, { x: 1000, y: 500 }, 1)
      expect(hit?.node.backendNodeId).toBe(5)
    })

    it('skips a frame target that goes away while frames are matched', async () => {
      const { page, hitTest } = setup()
      page.cdp.handle('Page.getLayoutMetrics', (_p, key) => {
        if (key === 'S1') throw new Error('gone')
        return { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }
      })
      const hit = await hitTest.atPointer({ x: 5, y: 5, globalX: 1000 + 35, globalY: 500 + 30 }, { x: 1000, y: 500 }, 1)
      expect(hit?.node.backendNodeId).toBe(5)
    })

    it('prefers the deepest frame when nested frames share a box origin', async () => {
      const { page, hitTest } = setup()
      page.add({ id: 103, tag: 'iframe', session: 'S1', frameId: 'F1', parent: 101, box: [0, 0, 100, 50], contentFrameId: 'F2' })
      page.addFrameTarget('S2', 'F2', 'F1', 'S1', { width: 100, height: 50 }, 'https://third.test')
      page.add({ id: 201, tag: 'p', session: 'S2', frameId: 'F2', box: [0, 0, 100, 50] })
      const hit = await hitTest.atPointer({ x: 5, y: 5, globalX: 400 + 5 + 7, globalY: 100 + 5 + 7 }, { x: 7, y: 7 }, 1)
      expect(hit?.node).toEqual({ sessionKey: 'S2', backendNodeId: 201, frameId: 'F2' })
    })
  })
})
