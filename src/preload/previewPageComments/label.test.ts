// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay label and the geometry it sits on
 * (docs/designs/comments/html-preview-comments.md §10.2; J-001).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { clipToViewport, contains, outlineBox, overlaps, snap, viewportOf } from './geometry'
import { frameFileOf, labelOf, labelText } from './label'

const BOX = { left: 10, top: 20, width: 120.4, height: 39.6 }

function element(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild as Element
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('labelOf (J-001)', () => {
  it('names the tag, id and two classes, then the rounded size', () => {
    const parts = labelOf(element('<button id="buy" class="cta primary">Buy</button>'), BOX, { kind: 'none' }, 0)
    expect(parts).toEqual({ tag: 'button', rest: '#buy.cta.primary', size: '120×40' })
    expect(labelText(parts)).toBe('button#buy.cta.primary')
  })

  it('cuts classes after two with …', () => {
    const parts = labelOf(element('<div class="a b c d"></div>'), BOX, { kind: 'none' }, 0)
    expect(parts.rest).toBe('.a.b…')
  })

  it('stays within 40 characters, keeping the suffix', () => {
    const el = element(`<section id="${'x'.repeat(60)}"></section>`)
    const parts = labelOf(el, BOX, { kind: 'script' }, 2)
    const text = labelText(parts)
    expect([...text].length).toBeLessThanOrEqual(40)
    expect(text.endsWith(' · script · 2 comments')).toBe(true)
    expect(text).toContain('…')
  })

  it.each([
    [{ kind: 'script' } as const, 0, 'span · script'],
    [{ kind: 'frame', file: 'other.html' } as const, 0, 'span · frame other.html'],
    [{ kind: 'refused-frame' } as const, 0, 'span · refused frame'],
    [{ kind: 'inline-frame' } as const, 0, 'span · inline frame'],
    [{ kind: 'none' } as const, 1, 'span · 1 comment'],
    [{ kind: 'none' } as const, 3, 'span · 3 comments']
  ])('adds the suffix %j with %i comments', (suffix, comments, expected) => {
    expect(labelText(labelOf(element('<span></span>'), BOX, suffix, comments))).toBe(expected)
  })

  it('cuts a tag name longer than the label itself', () => {
    const el = document.createElement(`x-${'y'.repeat(50)}`)
    const parts = labelOf(el, BOX, { kind: 'script' }, 0)
    expect([...parts.tag]).toHaveLength(40)
    expect(parts.rest).toBe('')
  })

  it('reads a frame file name from its src, and nothing from a broken one', () => {
    expect(frameFileOf('erfana-preview://abc/docs/other%20page.html')).toBe('other page.html')
    expect(frameFileOf('not a url')).toBe('')
    expect(frameFileOf('erfana-preview://abc/%E0%A4%A.html')).toBe('')
  })
})

describe('geometry', () => {
  const viewport = { width: 800, height: 600 }

  it('clips a box to the viewport, or answers null when it is off screen', () => {
    expect(clipToViewport({ left: -10, top: 500, width: 100, height: 200 }, viewport)).toEqual({
      left: 0,
      top: 500,
      width: 90,
      height: 100
    })
    expect(clipToViewport({ left: 900, top: 0, width: 10, height: 10 }, viewport)).toBeNull()
  })

  it('pushes a tiny element’s ring out by 2 px and snaps to device pixels', () => {
    expect(outlineBox({ left: 10.3, top: 10, width: 4, height: 4 }, viewport, 2)).toEqual({
      left: 8.5,
      top: 8,
      width: 8,
      height: 8
    })
    expect(outlineBox({ left: 10, top: 10, width: 50, height: 50 }, viewport, 1)).toEqual({
      left: 10,
      top: 10,
      width: 50,
      height: 50
    })
    expect(outlineBox({ left: 0, top: 900, width: 50, height: 50 }, viewport, 1)).toBeNull()
  })

  it('snaps with a broken device pixel ratio as 1', () => {
    expect(snap(10.4, 0)).toBe(10)
    expect(snap(10.4, Number.NaN)).toBe(10)
  })

  it('tests points and overlaps', () => {
    const box = { left: 0, top: 0, width: 10, height: 10 }
    expect(contains(box, { x: 5, y: 5 })).toBe(true)
    expect(contains(box, { x: 10, y: 5 })).toBe(false)
    expect(overlaps(box, { left: 9, top: 9, width: 5, height: 5 })).toBe(true)
    expect(overlaps(box, { left: 10, top: 0, width: 5, height: 5 })).toBe(false)
  })
})

describe('viewportOf – the visible viewport, scrollbars excluded (§19 Rev 4 "pins at the right edge")', () => {
  type Size = { clientWidth: number; clientHeight: number } | null
  /** A window as `viewportOf` reads it: inner size, compat mode, root and body sizes. */
  function windowWith(options: { compatMode?: string; root?: Size; body?: Size }): Window {
    return {
      innerWidth: 1024,
      innerHeight: 768,
      document: {
        compatMode: options.compatMode ?? 'CSS1Compat',
        documentElement: options.root ?? null,
        body: options.body ?? null
      }
    } as unknown as Window
  }

  it('leaves out classic scrollbars: the root element’s client size in standards mode', () => {
    // 15 px vertical and horizontal scrollbars.
    const win = windowWith({ root: { clientWidth: 1009, clientHeight: 753 }, body: { clientWidth: 993, clientHeight: 4000 } })
    expect(viewportOf(win)).toEqual({ width: 1009, height: 753 })
  })

  it('reads the body in quirks mode, where the root is as tall as the document', () => {
    const win = windowWith({
      compatMode: 'BackCompat',
      root: { clientWidth: 1009, clientHeight: 4000 },
      body: { clientWidth: 1009, clientHeight: 768 }
    })
    expect(viewportOf(win)).toEqual({ width: 1009, height: 768 })
  })

  it('agrees with the inner size under overlay scrollbars, and never passes it', () => {
    expect(viewportOf(windowWith({ root: { clientWidth: 1024, clientHeight: 768 } }))).toEqual({ width: 1024, height: 768 })
    expect(viewportOf(windowWith({ root: { clientWidth: 1100, clientHeight: 800 } }))).toEqual({ width: 1024, height: 768 })
  })

  it('falls back to the inner size when the root reports nothing', () => {
    // No root (the page removed <html>), no body in quirks mode, or no layout box (0).
    expect(viewportOf(windowWith({}))).toEqual({ width: 1024, height: 768 })
    expect(viewportOf(windowWith({ compatMode: 'BackCompat' }))).toEqual({ width: 1024, height: 768 })
    expect(viewportOf(windowWith({ root: { clientWidth: 0, clientHeight: 0 } }))).toEqual({ width: 1024, height: 768 })
  })

  it('measures the window it is given – a frame’s preload, its own frame', () => {
    const frame = { ...windowWith({ root: { clientWidth: 305, clientHeight: 200 } }), innerWidth: 320, innerHeight: 200 }
    expect(viewportOf(frame as unknown as Window)).toEqual({ width: 305, height: 200 })
  })
})
