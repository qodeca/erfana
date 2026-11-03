// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { NO_FILL, PICK_OUTLINE_COLOUR, pickOutlineParams } from '../cdp/cdpPinned'
import { PickReader } from './pickCdp'
import { PickFrames } from './pickFrames'
import { PickHighlight } from './pickHighlight'
import { samplePage } from './__test-helpers__/samplePage'

function setup() {
  let highlight: PickHighlight | undefined
  const page = samplePage({
    beforeFrames: (p) => {
      const reader = new PickReader(p.cdp)
      highlight = new PickHighlight(reader, new PickFrames(p.cdp, reader))
    }
  })
  return { page, highlight: highlight! }
}

const top = (id: number) => ({ sessionKey: '', backendNodeId: id, frameId: 'top' })

describe('PickHighlight', () => {
  it('outlines a node with the engine overlay – outline only, no fill, no engine label (Q2) – and records its node, top-level box and exact label (S-1)', async () => {
    const { page, highlight } = setup()
    const record = await highlight.show(top(4))
    expect(record).toEqual({ node: top(4), box: { x: 20, y: 20, width: 100, height: 30 }, label: 'button#save 100 × 30' })
    expect(highlight.record).toBe(record)
    const [call] = page.cdp.calls('Overlay.highlightQuad')
    expect(call).toEqual({ method: 'Overlay.highlightQuad', params: pickOutlineParams([20, 20, 120, 20, 120, 50, 20, 50]), sessionKey: '' })
    expect(call.params).toMatchObject({ color: NO_FILL, outlineColor: PICK_OUTLINE_COLOUR })
    expect(NO_FILL.a).toBe(0)
    // No highlightNode: its fill, band and engine label are gone with Q2.
    expect(page.cdp.calls('Overlay.highlightNode')).toEqual([])
    expect(Object.keys(call.params as object).sort()).toEqual(['color', 'outlineColor', 'quad'])
  })

  it('drops an older request that finishes after a newer one', async () => {
    const { highlight } = setup()
    const [older, newer] = await Promise.all([highlight.show(top(4)), highlight.show(top(5))])
    expect(older).toBeNull()
    expect(newer?.label).toMatch(/^span#label /)
    expect(highlight.record?.node.backendNodeId).toBe(5)
  })

  it('hides the outline in the old session when the pointer moves into another frame target', async () => {
    const { page, highlight } = setup()
    await highlight.show(top(4))
    await highlight.show({ sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' })
    expect(page.cdp.calls('Overlay.hideHighlight').map((c) => c.sessionKey)).toEqual([''])
    expect(highlight.record?.box).toEqual({ x: 410, y: 110, width: 50, height: 20 })
  })

  it('answers null for a node that went before it could be read', async () => {
    const { highlight } = setup()
    expect(await highlight.show(top(999))).toBeNull()
    expect(highlight.record).toBeNull()
  })

  it('still records the node when the overlay command is refused', async () => {
    const { page, highlight } = setup()
    page.cdp.handle('Overlay.highlightQuad', () => {
      throw new Error('Overlay is not enabled')
    })
    expect((await highlight.show(top(4)))?.label).toBe('button#save 100 × 30')
  })

  it('hides before a capture, dropping a request in flight, and never rejects', async () => {
    const { page, highlight } = setup()
    await highlight.show(top(4))
    page.cdp.handle('Overlay.hideHighlight', () => {
      throw new Error('detached')
    })
    const pending = highlight.show(top(5))
    await expect(highlight.hide()).resolves.toBeUndefined()
    expect(await pending).toBeNull()
    expect(highlight.record).toBeNull()
    await highlight.hide()
    expect(page.cdp.calls('Overlay.hideHighlight')).toHaveLength(1)
  })

  it('forgets what it shows without a command', async () => {
    const { page, highlight } = setup()
    await highlight.show(top(4))
    highlight.forget()
    expect(highlight.record).toBeNull()
    await highlight.hide()
    expect(page.cdp.calls('Overlay.hideHighlight')).toHaveLength(0)
  })

  it('outlines nothing for a node without a box, hiding the previous outline, but keeps its label', async () => {
    const { page, highlight } = setup()
    page.add({ id: 7, tag: 'span', parent: 3, attrs: { id: 'contents' } })
    await highlight.show(top(4))
    page.cdp.handle('Overlay.hideHighlight', () => {
      throw new Error('detached')
    })
    const record = await highlight.show(top(7))
    expect(record?.box).toBeNull()
    expect(record?.label).toMatch(/^span#contents /)
    expect(page.cdp.calls('Overlay.highlightQuad')).toHaveLength(1)
    expect(page.cdp.calls('Overlay.hideHighlight').map((c) => c.sessionKey)).toEqual([''])
  })

  it('never rejects when hiding the old session’s outline is refused', async () => {
    const { page, highlight } = setup()
    await highlight.show(top(4))
    page.cdp.handle('Overlay.hideHighlight', () => {
      throw new Error('detached')
    })
    const record = await highlight.show({ sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' })
    expect(record?.label).toMatch(/^button#inner /)
  })
})
