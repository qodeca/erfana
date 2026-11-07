// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { createManualClock } from '../../../../shared/clock'
import { NO_FILL, PICK_OUTLINE_COLOUR, pickOutlineParams } from '../cdp/cdpPinned'
import { PickReader } from './pickCdp'
import { PickFrames } from './pickFrames'
import { OutlineBand, type BandStrip, type BandSurface } from './pickBand'
import type { Box } from './pickGeometry'
import { OUTLINE_PAIR } from './pickOutlineColours'
import { PickHighlight, SCROLL_SETTLE_MS } from './pickHighlight'
import type { FaultPair } from './pickSupport'
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

  it('025-AC-034 the engine’s fallback outline takes the ink test colour while a hook sets the pair, and the accent otherwise', async () => {
    let colour: FaultPair | null = { ink: { r: 0, g: 200, b: 100, a: 1 }, paper: { r: 255, g: 255, b: 0, a: 1 } }
    let highlight: PickHighlight | undefined
    const page = samplePage({
      beforeFrames: (p) => {
        const reader = new PickReader(p.cdp)
        highlight = new PickHighlight(reader, new PickFrames(p.cdp, reader), { testColours: () => colour })
      }
    })
    await highlight!.show(top(4))
    colour = null
    await highlight!.show(top(5))
    expect(page.cdp.calls('Overlay.highlightQuad').map((c) => (c.params as { outlineColor: unknown }).outlineColor)).toEqual([
      { r: 0, g: 200, b: 100, a: 1 },
      PICK_OUTLINE_COLOUR
    ])
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

  describe('Erfana’s band (ADR 0007 decision 6, amended 2026-11-05)', () => {
    class Surface implements BandSurface {
      draws: Array<{ bounds: Box; strips: readonly BandStrip[]; colours: { ink: string; paper: string } }> = []
      hides = 0
      destroyed = 0
      draw(bounds: Box, strips: readonly BandStrip[], colours: { ink: string; paper: string }): void {
        this.draws.push({ bounds, strips, colours })
      }
      hide(): void {
        this.hides++
      }
      destroy(): void {
        this.destroyed++
      }
    }

    function withBand(testColours: () => FaultPair | null = () => null) {
      const surface = new Surface()
      const clock = createManualClock()
      const band = new OutlineBand({ open: () => surface, placement: () => ({ clip: { x: 0, y: 0, width: 800, height: 600 }, view: { x: 0, y: 0, width: 800, height: 600 }, zoom: 1 }) })
      let highlight: PickHighlight | undefined
      const page = samplePage({
        beforeFrames: (p) => {
          const reader = new PickReader(p.cdp)
          highlight = new PickHighlight(reader, new PickFrames(p.cdp, reader), { band, clock, testColours })
        }
      })
      return { page, highlight: highlight!, surface, clock }
    }

    it('draws ink, paper, ink around the top-level box in the product colours, and sends no engine outline', async () => {
      const { page, highlight, surface } = withBand()
      const record = await highlight.show(top(4))
      expect(record).toEqual({ node: top(4), box: { x: 20, y: 20, width: 100, height: 30 }, label: 'button#save 100 × 30' })
      expect(page.cdp.calls('Overlay.highlightQuad')).toEqual([])
      expect(page.cdp.calls('Overlay.hideHighlight')).toEqual([])
      const [drawn] = surface.draws
      expect(drawn.colours).toEqual(OUTLINE_PAIR)
      expect(drawn.strips[0]).toEqual({ tone: 'ink', rect: { x: 19, y: 19, width: 102, height: 4 } })
      expect(drawn.strips[4]).toEqual({ tone: 'paper', rect: { x: 20, y: 20, width: 100, height: 2 } })
      expect(highlight.band?.colours).toEqual(OUTLINE_PAIR)
    })

    it('draws a node in a cross-site frame at its top-level box', async () => {
      const { highlight, surface } = withBand()
      await highlight.show({ sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' })
      expect(surface.draws[0].strips[4].rect).toEqual({ x: 410, y: 110, width: 50, height: 2 })
    })

    it('025-AC-034 draws the band in the test colours while a hook sets them', async () => {
      const { highlight, surface } = withBand(() => ({ ink: { r: 255, g: 0, b: 255, a: 1 }, paper: { r: 255, g: 255, b: 0, a: 1 } }))
      await highlight.show(top(4))
      expect(surface.draws[0].colours).toEqual({ ink: '#ff00ff', paper: '#ffff00' })
    })

    it('hides the band for a node without a box, and on hide and forget – with no engine command', async () => {
      const { page, highlight, surface } = withBand()
      page.add({ id: 7, tag: 'span', parent: 3, attrs: { id: 'contents' } })
      await highlight.show(top(4))
      expect((await highlight.show(top(7)))?.box).toBeNull()
      expect(surface.hides).toBe(1)
      expect(highlight.band).toBeNull()
      await highlight.show(top(4))
      await highlight.hide()
      expect(surface.hides).toBe(2)
      await highlight.show(top(4))
      highlight.forget()
      expect(surface.hides).toBe(3)
      expect(page.cdp.calls('Overlay.hideHighlight')).toEqual([])
    })

    it('drops a request overtaken while its box was read, drawing only the newer one', async () => {
      const { highlight, surface } = withBand()
      const [older, newer] = await Promise.all([highlight.show(top(4)), highlight.show(top(5))])
      expect(older).toBeNull()
      expect(newer?.box).toEqual({ x: 30, y: 25, width: 40, height: 20 })
      expect(surface.draws).toHaveLength(1)
    })

    it('hides the engine’s outline of an earlier fallback once the band can draw again', async () => {
      const surface = new Surface()
      let available = false
      const band = new OutlineBand({ open: () => (available ? surface : null), placement: () => ({ clip: { x: 0, y: 0, width: 800, height: 600 }, view: { x: 0, y: 0, width: 800, height: 600 }, zoom: 1 }) })
      const fake = Object.assign(Object.create(band) as OutlineBand, {})
      Object.defineProperty(fake, 'available', { get: () => available })
      let highlight: PickHighlight | undefined
      const page = samplePage({
        beforeFrames: (p) => {
          const reader = new PickReader(p.cdp)
          highlight = new PickHighlight(reader, new PickFrames(p.cdp, reader), { band: fake })
        }
      })
      await highlight!.show(top(4))
      expect(page.cdp.calls('Overlay.highlightQuad')).toHaveLength(1)
      available = true
      await highlight!.show(top(5))
      expect(page.cdp.calls('Overlay.hideHighlight').map((c) => c.sessionKey)).toEqual([''])
      // The engine outline is gone: a later hide sends no command for it.
      await highlight!.hide()
      expect(page.cdp.calls('Overlay.hideHighlight')).toHaveLength(1)
    })

    it('follows a scroll: hidden at the wheel, drawn again at the new box once the wheel is still', async () => {
      const { page, highlight, surface, clock } = withBand()
      await highlight.show(top(4))
      highlight.scrolled()
      expect(surface.hides).toBe(1)
      // The page scrolled by 15 px.
      page.remove(4)
      page.add({ id: 4, tag: 'button', parent: 3, attrs: { id: 'save' }, box: [20, 5, 100, 30] })
      clock.advance(SCROLL_SETTLE_MS - 1)
      highlight.scrolled()
      clock.advance(SCROLL_SETTLE_MS - 1)
      await settled()
      expect(surface.draws).toHaveLength(1)
      clock.advance(1)
      await settled()
      expect(surface.draws).toHaveLength(2)
      expect(surface.draws[1].strips[4].rect).toEqual({ x: 20, y: 5, width: 100, height: 2 })
      expect(highlight.record?.box).toEqual({ x: 20, y: 5, width: 100, height: 30 })
    })

    it('a scroll that loses the box hides the band; a new show or a hide during the settle wins over it', async () => {
      const { page, highlight, surface, clock } = withBand()
      await highlight.show(top(4))
      highlight.scrolled()
      page.remove(4)
      page.add({ id: 4, tag: 'button', parent: 3, attrs: { id: 'save' } })
      clock.advance(SCROLL_SETTLE_MS)
      await settled()
      expect(highlight.band).toBeNull()
      expect(surface.draws).toHaveLength(1)

      await highlight.show(top(5))
      highlight.scrolled()
      await highlight.show(top(5))
      clock.advance(SCROLL_SETTLE_MS)
      await settled()
      expect(surface.draws).toHaveLength(3)
      highlight.scrolled()
      await highlight.hide()
      clock.advance(SCROLL_SETTLE_MS)
      await settled()
      expect(surface.draws).toHaveLength(3)
    })

    it('ignores a scroll with nothing outlined, or with no band', async () => {
      const { highlight, surface } = withBand()
      highlight.scrolled()
      expect(surface.hides).toBe(0)
      const { page, highlight: engine } = setup()
      await engine.show(top(4))
      engine.scrolled()
      expect(page.cdp.calls('Overlay.hideHighlight')).toEqual([])
    })

    it('dispose closes the band’s surface', async () => {
      const { highlight, surface } = withBand()
      await highlight.show(top(4))
      highlight.dispose()
      expect(surface.destroyed).toBe(1)
      expect(highlight.record).toBeNull()
    })
  })
})

async function settled(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}
