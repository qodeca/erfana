// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fresh still under a comment popup and where the menu opens
 * (docs/designs/html-preview-comments.md §7.3 step 4, §19 R3-5, R3-6;
 * M-067).
 */
import { describe, expect, it, vi } from 'vitest'
import type { PreviewNativeImage } from '../PreviewStillFrameCache'
import { menuPoint, type MenuPointInput } from './commentMenuPoint'
import { COMMENT_WORLD_ID } from './commentScripts'
import { captureFreshStill, ringPainted, waitForPaint, RING_MIN_PIXELS, type FreshStillDeps } from './commentStillCapture'

const ACCENT = [0xa0, 0xa8, 0xff] as const

/** A width×height image; `paint(x, y)` says which pixels are the accent (BGRA). */
function picture(width: number, height: number, paint: (x: number, y: number) => boolean, order: 'bgra' | 'rgba' = 'bgra'): PreviewNativeImage {
  const at = (rect: { x: number; y: number; width: number; height: number }): PreviewNativeImage => ({
    isEmpty: () => false,
    getSize: () => ({ width: rect.width, height: rect.height }),
    resize: () => at(rect),
    toDataURL: () => 'data:',
    crop: inner => at({ x: rect.x + inner.x, y: rect.y + inner.y, width: inner.width, height: inner.height }),
    toBitmap: () => {
      const out = Buffer.alloc(rect.width * rect.height * 4)
      for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
          if (!paint(rect.x + x, rect.y + y)) continue
          const i = (y * rect.width + x) * 4
          const [r, g, b] = ACCENT
          out.set(order === 'bgra' ? [b, g, r, 255] : [r, g, b, 255], i)
        }
      }
      return out
    }
  })
  return at({ x: 0, y: 0, width, height })
}

const ring = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
  x >= x0 && x < x1 && y >= y0 && y < y1 && (x < x0 + 2 || x >= x1 - 2 || y < y0 + 2 || y >= y1 - 2)

const GEOMETRY = {
  box: { x: 10, y: 10, w: 40, h: 20 },
  offset: { x: 0, y: 0 },
  pageZoom: 1,
  viewSize: { width: 100, height: 100 },
  accent: ACCENT
}

describe('ringPainted', () => {
  it('finds the outline ring at the picked box, in BGRA or RGBA', () => {
    expect(ringPainted(picture(100, 100, ring(10, 10, 50, 30)), GEOMETRY)).toBe(true)
    expect(ringPainted(picture(100, 100, ring(10, 10, 50, 30), 'rgba'), GEOMETRY)).toBe(true)
    expect(ringPainted(picture(100, 100, () => false), GEOMETRY)).toBe(false)
  })

  it('scales the box by the capture\'s pixel ratio and the page zoom, and adds the frame offset', () => {
    // A 2× capture of a 100×100 view, page zoom 1.5, the frame 4 px in.
    const geometry = { ...GEOMETRY, offset: { x: 4, y: 4 }, pageZoom: 1.5 }
    const scale = 2 * 1.5
    const painted = ring(14 * scale, 14 * scale, 54 * scale, 34 * scale)
    expect(ringPainted(picture(200, 200, painted), geometry)).toBe(true)
    expect(ringPainted(picture(200, 200, ring(10, 10, 50, 30)), geometry)).toBe(false)
  })

  it('passes what it cannot check: a box off the capture, no pixel access, an empty view', () => {
    expect(ringPainted(picture(100, 100, () => false), { ...GEOMETRY, box: { x: 500, y: 500, w: 10, h: 10 } })).toBe(true)
    const opaque: PreviewNativeImage = { isEmpty: () => false, getSize: () => ({ width: 100, height: 100 }), resize: vi.fn(), toDataURL: () => '' }
    expect(ringPainted(opaque, GEOMETRY)).toBe(true)
    expect(ringPainted(picture(100, 100, () => false), { ...GEOMETRY, viewSize: { width: 0, height: 0 } })).toBe(true)
    expect(RING_MIN_PIXELS).toBeGreaterThan(0)
  })
})

describe('waitForPaint', () => {
  it('runs the two-frame wait in world 996 and parses the frame offset', async () => {
    const execute = vi.fn(async (..._args: unknown[]) => ({ x: 5, y: 6 }))
    expect(await waitForPaint({ executeJavaScriptInIsolatedWorld: execute }, { childIndex: 0, nested: false })).toEqual({ x: 5, y: 6 })
    expect(execute.mock.calls[0][0]).toBe(COMMENT_WORLD_ID)
    expect(await waitForPaint({ executeJavaScriptInIsolatedWorld: async () => null }, { childIndex: 0, nested: false })).toBeNull()
    expect(await waitForPaint({ executeJavaScriptInIsolatedWorld: async () => Promise.reject(new Error('x')) }, { childIndex: -1, nested: false })).toBeNull()
  })
})

describe('captureFreshStill', () => {
  function deps(overrides: Partial<FreshStillDeps> = {}) {
    const captureFresh = vi.fn(async () => true)
    const value: FreshStillDeps = {
      panelId: 'panel',
      contents: { capturePage: vi.fn(), executeJavaScriptInIsolatedWorld: vi.fn(async () => ({ x: 0, y: 0 })) },
      stillFrameCache: { captureFresh },
      lastRect: () => ({ x: 0, y: 40, width: 100, height: 100 }),
      lastCssSize: () => ({ width: 100, height: 100 }),
      isDrawn: () => true,
      ...overrides
    }
    return { value, captureFresh }
  }

  it('captures a drawn view with the ring check, and waits for another paint before the retry', async () => {
    const d = deps()
    const ringRequest = { box: GEOMETRY.box, offset: { x: 0, y: 0 }, pageZoom: 1, accent: ACCENT }
    expect(await captureFreshStill(d.value, { place: { childIndex: -1, nested: false }, ring: ringRequest })).toBe(true)
    const [, panelId, size, options] = d.captureFresh.mock.calls[0] as unknown as [unknown, string, unknown, { accept?: unknown; beforeRetry: () => Promise<void>; cssSize: unknown }]
    expect(panelId).toBe('panel')
    expect(size).toEqual({ width: 100, height: 100 })
    expect(options.cssSize).toEqual({ width: 100, height: 100 })
    expect(typeof options.accept).toBe('function')
    // The cache asks `accept` about each capture: the ring check, at the view's size.
    const accept = options.accept as (image: PreviewNativeImage) => boolean
    const blank = picture(100, 100, () => false)
    expect(accept(blank)).toBe(ringPainted(blank, { ...ringRequest, viewSize: { width: 100, height: 100 } }))
    await options.beforeRetry()
    expect(d.value.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1)
  })

  it('skips the ring check for a nested frame, and captures nothing for a hidden view or no rect', async () => {
    const nested = deps()
    await captureFreshStill(nested.value, { place: { childIndex: 0, nested: true }, ring: { box: GEOMETRY.box, offset: { x: 0, y: 0 }, pageZoom: 1, accent: ACCENT } })
    expect((nested.captureFresh.mock.calls[0] as unknown[])[3]).not.toHaveProperty('accept')

    const hidden = deps({ isDrawn: () => false })
    expect(await captureFreshStill(hidden.value, { place: { childIndex: -1, nested: false } })).toBe(false)
    const noRect = deps({ lastRect: () => null })
    expect(await captureFreshStill(noRect.value, { place: { childIndex: -1, nested: false } })).toBe(false)
    const noFresh = deps({ stillFrameCache: {} })
    expect(await captureFreshStill(noFresh.value, { place: { childIndex: -1, nested: false } })).toBe(false)
    const throwing = deps({ stillFrameCache: { captureFresh: vi.fn(async () => Promise.reject(new Error('x'))) } })
    expect(await captureFreshStill(throwing.value, { place: { childIndex: -1, nested: false } })).toBe(false)
  })
})

describe('M-067 menuPoint', () => {
  const base: MenuPointInput = {
    pick: { via: 'pointer', screen: { x: 300, y: 250 } },
    frameOffset: null,
    viewRect: { x: 100, y: 50, width: 600, height: 400 },
    contentBounds: { x: 10, y: 20 },
    hostZoom: 1,
    pageZoom: 1,
    cursor: () => ({ x: 0, y: 0 })
  }

  it('a pointer pick: the trusted screen point less the content origin, over host zoom 1.0 and 1.25', () => {
    expect(menuPoint(base)).toEqual({ x: 290, y: 230 })
    expect(menuPoint({ ...base, hostZoom: 1.25, viewRect: { x: 125, y: 62.5, width: 750, height: 500 } })).toEqual({ x: 232, y: 184 })
  })

  it('a pointer pick without a screen point falls back to the cursor', () => {
    expect(menuPoint({ ...base, pick: { via: 'pointer', screen: { x: 0, y: 0 } }, cursor: () => ({ x: 410, y: 320 }) })).toEqual({ x: 400, y: 300 })
    expect(menuPoint({ ...base, pick: { via: 'pointer' }, cursor: () => ({ x: 410, y: 320 }) })).toEqual({ x: 400, y: 300 })
  })

  it('a keyboard pick inside a frame: the view origin, plus the frame offset and point at page zoom, over host zoom', () => {
    const keyboard = { ...base, pick: { via: 'keyboard' as const, point: { x: 14, y: 24 } }, frameOffset: { x: 20, y: 30 }, pageZoom: 1.5 }
    expect(menuPoint(keyboard)).toEqual({ x: 151, y: 131 })
    expect(menuPoint({ ...keyboard, hostZoom: 1.25, viewRect: { x: 125, y: 62.5, width: 750, height: 500 } })).toEqual({ x: 141, y: 115 })
  })

  it('is clamped to the panel: a forged or stale value only misplaces the menu inside its preview', () => {
    expect(menuPoint({ ...base, pick: { via: 'pointer', screen: { x: -5_000, y: 9_000 } } })).toEqual({ x: 100, y: 449 })
    expect(menuPoint({ ...base, hostZoom: Number.NaN, pageZoom: -1, pick: { via: 'keyboard' } })).toEqual({ x: 100, y: 50 })
    expect(menuPoint({ ...base, viewRect: null, pick: { via: 'keyboard', point: { x: 3, y: 4 } } })).toEqual({ x: 3, y: 4 })
  })
})
