// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { BAND_STRIP_COUNT, bandStrips, OutlineBand, type BandHostEvents, type BandPlacement, type BandStrip, type BandSurface } from './pickBand'
import type { Box } from './pickGeometry'

const PAIR = { ink: '#161312', paper: '#ffffff' }

/** The tone of the pixel at (x, y) once the strips are drawn in order (later over earlier), or null. */
function toneAt(strips: readonly BandStrip[], x: number, y: number): string | null {
  let tone: string | null = null
  for (const s of strips) if (x >= s.rect.x && x < s.rect.x + s.rect.width && y >= s.rect.y && y < s.rect.y + s.rect.height) tone = s.tone
  return tone
}

describe('bandStrips', () => {
  it('draws ink 1px outside the border box, paper on its 2px edge and ink 1px inside – the still image’s outline', () => {
    const strips = bandStrips({ x: 10, y: 20, width: 40, height: 30 }, { width: 200, height: 200 })
    expect(strips).toHaveLength(BAND_STRIP_COUNT)
    expect(strips.slice(0, 4).every((s) => s.tone === 'ink')).toBe(true)
    expect(strips.slice(4).every((s) => s.tone === 'paper')).toBe(true)
    // Walking right from outside the left edge, at the middle row: page, ink, paper, paper, ink, element.
    const row = 35
    expect([8, 9, 10, 11, 12, 13].map((x) => toneAt(strips, x, row))).toEqual([null, 'ink', 'paper', 'paper', 'ink', null])
    // The right edge (box ends at x = 50): ink, paper, paper inside; ink just outside.
    expect([46, 47, 48, 49, 50, 51].map((x) => toneAt(strips, x, row))).toEqual([null, 'ink', 'paper', 'paper', 'ink', null])
    // Top and bottom, at the middle column.
    expect([18, 19, 20, 21, 22, 23].map((y) => toneAt(strips, 30, y))).toEqual([null, 'ink', 'paper', 'paper', 'ink', null])
    expect([46, 47, 48, 49, 50, 51].map((y) => toneAt(strips, 30, y))).toEqual([null, 'ink', 'paper', 'paper', 'ink', null])
    // The corner keeps the rings unbroken: the paper L turns inside the outer ink, the inner ink inside it.
    expect(toneAt(strips, 9, 19)).toBe('ink')
    expect(toneAt(strips, 10, 10 + 10)).toBe('paper')
    expect(toneAt(strips, 11, 21)).toBe('paper')
    expect(toneAt(strips, 12, 22)).toBe('ink')
    expect(toneAt(strips, 13, 23)).toBeNull()
  })

  it('rounds fractional edges to whole DIP, keeping the far edge where it falls', () => {
    const strips = bandStrips({ x: 10.4, y: 20.6, width: 40.2, height: 29.8 }, { width: 200, height: 200 })
    const top = strips[0].rect
    expect(top).toEqual({ x: 9, y: 20, width: 43, height: 4 })
  })

  it('clips every strip to the surface and drops the ones wholly outside it', () => {
    // The element runs off the surface's left and top: only the right and bottom strips remain, cut at the edge.
    const strips = bandStrips({ x: -100, y: -100, width: 120, height: 130 }, { width: 50, height: 50 })
    for (const s of strips) {
      expect(s.rect.x).toBeGreaterThanOrEqual(0)
      expect(s.rect.y).toBeGreaterThanOrEqual(0)
      expect(s.rect.x + s.rect.width).toBeLessThanOrEqual(50)
      expect(s.rect.y + s.rect.height).toBeLessThanOrEqual(50)
    }
    expect(strips.map((s) => s.tone)).toEqual(['ink', 'ink', 'paper', 'paper'])
    expect(bandStrips({ x: 300, y: 300, width: 10, height: 10 }, { width: 50, height: 50 })).toEqual([])
  })

  it('fills a tiny element with the band, never a strip of negative size (0, 1 and 2 DIP)', () => {
    for (const size of [0, 1, 2]) {
      const strips = bandStrips({ x: 20, y: 20, width: size, height: size }, { width: 100, height: 100 })
      for (const s of strips) {
        expect(s.rect.width).toBeGreaterThan(0)
        expect(s.rect.height).toBeGreaterThan(0)
      }
      expect(toneAt(strips, 19, 19)).toBe('ink')
    }
    expect(bandStrips({ x: 20, y: 20, width: 0, height: 0 }, { width: 100, height: 100 }).every((s) => s.tone === 'ink')).toBe(true)
  })
})

class FakeSurface implements BandSurface {
  readonly draws: Array<{ bounds: Box; strips: readonly BandStrip[]; colours: typeof PAIR }> = []
  hides = 0
  destroyed = 0
  failDraw = false
  draw(bounds: Box, strips: readonly BandStrip[], colours: typeof PAIR): void {
    if (this.failDraw) throw new Error('window gone')
    this.draws.push({ bounds, strips, colours })
  }
  hide(): void {
    this.hides++
  }
  destroy(): void {
    this.destroyed++
  }
}

function setup(options: { placement?: BandPlacement | null; open?: 'ok' | 'null' | 'throws' } = {}) {
  const surface = new FakeSurface()
  let events: BandHostEvents | undefined
  let placement: BandPlacement | null =
    options.placement === undefined ? { clip: { x: 100, y: 200, width: 400, height: 300 }, view: { x: 100, y: 150, width: 400, height: 350 }, zoom: 2 } : options.placement
  const watchers = new Set<() => void>()
  const onError = vi.fn()
  const open = vi.fn((e: BandHostEvents) => {
    events = e
    if (options.open === 'throws') throw new Error('no window')
    return options.open === 'null' ? null : surface
  })
  const band = new OutlineBand({
    open,
    placement: () => placement,
    watchPlacement: (listener) => {
      watchers.add(listener)
      return () => watchers.delete(listener)
    },
    onError
  })
  return {
    band,
    surface,
    open,
    onError,
    watchers,
    events: () => events!,
    place: (next: BandPlacement | null) => {
      placement = next
      for (const w of watchers) w()
    }
  }
}

describe('OutlineBand', () => {
  it('opens its surface once, over the visible page area, and outlines the box at the page’s zoom and offset', () => {
    const { band, surface, open } = setup()
    expect(band.available).toBe(true)
    band.show({ x: 10, y: 50, width: 20, height: 10 }, PAIR)
    band.show({ x: 10, y: 50, width: 20, height: 10 }, PAIR)
    expect(open).toHaveBeenCalledTimes(1)
    const [first] = surface.draws
    expect(first.bounds).toEqual({ x: 100, y: 200, width: 400, height: 300 })
    // view y 150 − clip y 200 + 50 × 2 = 50; x 0 + 10 × 2 = 20; size 40 × 20.
    expect(first.strips[0].rect).toEqual({ x: 19, y: 49, width: 42, height: 4 })
    expect(first.colours).toEqual(PAIR)
    expect(band.state).toEqual({ bounds: first.bounds, strips: first.strips, colours: PAIR })
  })

  it('draws again when the page is placed again, and hides – keeping the box – while it is out of the window', () => {
    const { band, surface, place } = setup()
    band.show({ x: 10, y: 50, width: 20, height: 10 }, PAIR)
    place({ clip: { x: 0, y: 0, width: 400, height: 300 }, view: { x: 0, y: 0, width: 400, height: 300 }, zoom: 1 })
    expect(surface.draws.at(-1)?.strips[0].rect).toEqual({ x: 9, y: 49, width: 22, height: 4 })
    place(null)
    expect(surface.hides).toBe(1)
    expect(band.state).toBeNull()
    place({ clip: { x: 0, y: 0, width: 400, height: 300 }, view: { x: 0, y: 0, width: 400, height: 300 }, zoom: 1 })
    expect(surface.draws).toHaveLength(3)
  })

  it('follows its window: drawn again when it moves or comes back, hidden while it is hidden', () => {
    const { band, surface, events } = setup()
    band.show({ x: 0, y: 25, width: 10, height: 10 }, PAIR)
    events().hidden()
    expect(surface.hides).toBe(1)
    events().hidden()
    expect(surface.hides).toBe(1)
    events().moved()
    expect(surface.draws).toHaveLength(2)
  })

  it('hides an element scrolled out of the page area, and draws nothing before a show', () => {
    const { band, surface, place } = setup()
    place({ clip: { x: 0, y: 0, width: 100, height: 100 }, view: { x: 0, y: 0, width: 100, height: 100 }, zoom: 1 })
    expect(surface.draws).toEqual([])
    band.show({ x: 10, y: 10, width: 10, height: 10 }, PAIR)
    band.show({ x: 500, y: 500, width: 10, height: 10 }, PAIR)
    expect(surface.hides).toBe(1)
    expect(band.state).toBeNull()
  })

  it('hide forgets the box, suspend keeps it', () => {
    const { band, surface, events } = setup()
    band.show({ x: 0, y: 25, width: 10, height: 10 }, PAIR)
    band.suspend()
    events().moved()
    expect(surface.draws).toHaveLength(2)
    band.hide()
    events().moved()
    expect(surface.draws).toHaveLength(2)
    expect(surface.hides).toBe(2)
  })

  it('does not open its window for a placement change while nothing is outlined', () => {
    const { band, open } = setup()
    band.redraw()
    expect(open).not.toHaveBeenCalled()
    expect(band.state).toBeNull()
  })

  it('is unavailable where no surface can be placed, or when opening it throws (reported once)', () => {
    expect(setup({ open: 'null' }).band.available).toBe(false)
    const failing = setup({ open: 'throws' })
    expect(failing.band.available).toBe(false)
    expect(failing.band.available).toBe(false)
    expect(failing.open).toHaveBeenCalledTimes(1)
    expect(failing.onError).toHaveBeenCalledTimes(1)
    failing.band.show({ x: 0, y: 0, width: 1, height: 1 }, PAIR)
    expect(failing.band.state).toBeNull()
  })

  it('a draw that throws reports the error and closes the band for good, so the engine takes over', () => {
    const { band, surface, onError } = setup()
    surface.failDraw = true
    band.show({ x: 0, y: 25, width: 10, height: 10 }, PAIR)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(surface.destroyed).toBe(1)
    expect(band.available).toBe(false)
    expect(band.state).toBeNull()
  })

  it('a hide that throws is reported and closes the band', () => {
    const { band, surface, onError } = setup()
    band.show({ x: 0, y: 25, width: 10, height: 10 }, PAIR)
    surface.hide = () => {
      throw new Error('gone')
    }
    band.hide()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(band.available).toBe(false)
  })

  it('stops when its window closes, and dispose closes the surface and stops watching the page', () => {
    const closed = setup()
    closed.band.show({ x: 0, y: 25, width: 10, height: 10 }, PAIR)
    closed.events().closed()
    expect(closed.band.state).toBeNull()
    expect(closed.band.available).toBe(false)

    const { band, surface, watchers } = setup()
    band.show({ x: 0, y: 25, width: 10, height: 10 }, PAIR)
    band.dispose()
    expect(surface.destroyed).toBe(1)
    expect(watchers.size).toBe(0)
    surface.destroy = () => {
      throw new Error('already destroyed')
    }
    expect(() => band.dispose()).not.toThrow()
  })

  it('tells onDrawn after every draw that placed the strips – the box asked for and what is drawn – and never on a hide or a failed draw', () => {
    const surface = new FakeSurface()
    // Called once the surface has the strips.
    const drawsAtCall: number[] = []
    const onDrawn = vi.fn((_box: Box, _state: unknown) => void drawsAtCall.push(surface.draws.length))
    let placement: BandPlacement | null = { clip: { x: 0, y: 0, width: 100, height: 100 }, view: { x: 0, y: 0, width: 100, height: 100 }, zoom: 1 }
    const band = new OutlineBand({ open: () => surface, placement: () => placement, onDrawn, onError: () => undefined })
    const box = { x: 10, y: 10, width: 10, height: 10 }
    band.show(box, PAIR)
    expect(onDrawn).toHaveBeenCalledTimes(1)
    expect(onDrawn).toHaveBeenLastCalledWith(box, band.state)
    band.redraw()
    expect(onDrawn).toHaveBeenCalledTimes(2)
    expect(drawsAtCall).toEqual([1, 2])
    // Nothing placed: no element on the surface, or no page.
    band.show({ x: 500, y: 500, width: 10, height: 10 }, PAIR)
    placement = null
    band.show(box, PAIR)
    band.hide()
    expect(onDrawn).toHaveBeenCalledTimes(2)
    placement = { clip: { x: 0, y: 0, width: 100, height: 100 }, view: { x: 0, y: 0, width: 100, height: 100 }, zoom: 1 }
    surface.failDraw = true
    band.show(box, PAIR)
    expect(onDrawn).toHaveBeenCalledTimes(2)
  })

  it('treats a zero or missing zoom as 100 %', () => {
    const { band, surface } = setup({ placement: { clip: { x: 0, y: 0, width: 100, height: 100 }, view: { x: 0, y: 0, width: 100, height: 100 }, zoom: 0 } })
    band.show({ x: 10, y: 10, width: 10, height: 10 }, PAIR)
    expect(surface.draws[0].strips[0].rect).toEqual({ x: 9, y: 9, width: 12, height: 4 })
  })

  it('works without a placement watcher', () => {
    const surface = new FakeSurface()
    const band = new OutlineBand({ open: () => surface, placement: () => ({ clip: { x: 0, y: 0, width: 50, height: 50 }, view: { x: 0, y: 0, width: 50, height: 50 }, zoom: 1 }) })
    band.show({ x: 5, y: 5, width: 5, height: 5 }, PAIR)
    band.dispose()
    expect(surface.destroyed).toBe(1)
  })
})
