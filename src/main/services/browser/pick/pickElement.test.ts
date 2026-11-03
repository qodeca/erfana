// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PickReader } from './pickCdp'
import { boxInView, describeForLabel, parseChain, readChain } from './pickElement'
import { PickFrames } from './pickFrames'
import { samplePage } from './__test-helpers__/samplePage'

function setup() {
  let frames: PickFrames | undefined
  let reader: PickReader | undefined
  const page = samplePage({
    beforeFrames: (p) => {
      reader = new PickReader(p.cdp)
      frames = new PickFrames(p.cdp, reader)
    }
  })
  return { page, reader: reader!, frames: frames! }
}

const top = (id: number) => ({ sessionKey: '', backendNodeId: id, frameId: 'top' })
const inner = (id: number) => ({ sessionKey: 'S1', backendNodeId: id, frameId: 'F1' })

describe('pickElement', () => {
  it('describes a node for the label from CDP alone', async () => {
    const { reader } = setup()
    expect(await describeForLabel(reader, top(4))).toEqual({ name: { tagName: 'button', id: 'save', classAttr: null }, width: 100, height: 30 })
  })

  it('labels a node with no box at 0 × 0, and a gone node as null', async () => {
    const { page, reader } = setup()
    page.add({ id: 9, tag: 'div', parent: 2, attrs: { class: 'contents' } })
    expect(await describeForLabel(reader, top(9))).toEqual({ name: { tagName: 'div', id: null, classAttr: 'contents' }, width: 0, height: 0 })
    expect(await describeForLabel(reader, top(999))).toBeNull()
  })

  it('maps a frame element\'s box into the top viewport; null for no box or a gone frame', async () => {
    const { page, reader, frames } = setup()
    expect(await boxInView(reader, frames, inner(102))).toEqual({ x: 410, y: 110, width: 50, height: 20 })
    page.add({ id: 9, tag: 'div', parent: 2 })
    expect(await boxInView(reader, frames, top(9))).toBeNull()
    expect(await boxInView(reader, frames, { sessionKey: 'ghost', backendNodeId: 1, frameId: 'x' })).toBeNull()
  })

  describe('parseChain', () => {
    it('accepts only the expected shape, whatever the page made of its prototypes', () => {
      expect(parseChain(null)).toBeNull()
      expect(parseChain({ chain: 'x', selectors: [] })).toBeNull()
      expect(parseChain({ chain: [5], selectors: [] })).toBeNull()
      expect(
        parseChain({
          chain: [{ tag: 'a', id: 7, cls: '', x: 'no', y: Number.NaN, w: 3, h: 4, shadow: 'weird', attrs: [['data-source', 'x'], ['bad'], 5] }],
          selectors: ['a', 9],
          closed: 'yes',
          connected: true
        })
      ).toEqual({
        chain: [{ name: { tagName: 'a', id: null, classAttr: null }, attrs: [['data-source', 'x']], shadow: null, box: { x: 0, y: 0, width: 3, height: 4 } }],
        selectors: ['a'],
        closed: false,
        connected: true
      })
    })
  })

  it('reads the chain root first, with every entry\'s node and top-level box (025-FR-027)', async () => {
    const { reader, frames } = setup()
    const chain = await readChain(reader, frames, top(5))
    expect(chain.entries.map((e) => [e.name.tagName, e.node?.backendNodeId, e.boxInView?.x])).toEqual([
      ['html', 1, 0],
      ['body', 2, 0],
      ['div', 3, 10],
      ['button', 4, 20],
      ['span', 5, 30]
    ])
    expect(chain.entries[3].attrs).toEqual([['data-source', 'src/Save.tsx:4']])
    expect(chain.selectors).toEqual(['span#label'])
    expect(chain.frameOrigins).toEqual(['https://app.test'])
    expect(chain.connected).toBe(true)
    expect(chain.closedShadow).toBe(false)
  })

  it('crosses from a frame to its owner iframe and the parent document (Up crosses frames, 025-FR-027, 025-FR-029)', async () => {
    const { reader, frames } = setup()
    const chain = await readChain(reader, frames, inner(102))
    expect(chain.entries.map((e) => `${e.node?.sessionKey ?? '?'}:${e.name.tagName}`)).toEqual([':html', ':body', ':iframe', 'S1:html', 'S1:button'])
    expect(chain.entries[2].boxInView).toEqual({ x: 400, y: 100, width: 300, height: 150 })
    expect(chain.selectors).toEqual(['iframe#cross', 'button#inner'])
    expect(chain.frameOrigins).toEqual(['https://app.test', 'https://other.test'])
  })

  it("stops at the frame boundary when the owner's chain cannot be read", async () => {
    const { page, reader, frames } = setup()
    page.broken.add(6)
    const chain = await readChain(reader, frames, inner(102))
    expect(chain.entries.map((e) => e.name.tagName)).toEqual(['html', 'button'])
    page.cdp.handle('DOM.getFrameOwner', () => {
      throw new Error('gone')
    })
    expect((await readChain(reader, frames, inner(102))).entries).toHaveLength(2)
  })

  it('keeps an entry whose ancestor handle cannot be resolved, with no node and no box', async () => {
    const { page, reader, frames } = setup()
    page.cdp.handle('DOM.describeNode', (p) => {
      if (p.objectId === 'obj:3') return { node: {} }
      return { node: { backendNodeId: Number(String(p.objectId).slice(4)) } }
    })
    const chain = await readChain(reader, frames, top(5))
    expect(chain.entries[2]).toMatchObject({ node: null, boxInView: null })
    expect(chain.entries[1].node?.backendNodeId).toBe(2)
  })

  it('fails when the element\'s own chain cannot be read (the element or its frame went)', async () => {
    const { page, reader, frames } = setup()
    page.broken.add(5)
    await expect(readChain(reader, frames, top(5))).rejects.toThrow('Pick read failed: pickChain')
    page.broken.clear()
    page.cdp.handle('Runtime.callFunctionOn', () => ({ result: { value: { chain: [], selectors: [] } } }))
    await expect(readChain(reader, frames, top(5))).rejects.toThrow('pick chain read failed')
  })

  it('says when the element is no longer in its document', async () => {
    const { page, reader, frames } = setup()
    page.disconnected.add(5)
    expect((await readChain(reader, frames, top(5))).connected).toBe(false)
  })
})
