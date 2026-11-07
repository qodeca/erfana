// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Width preset layout (025-FR-012, ADR 0011 decision 6): Full width fills the
 * page area; a preset keeps its width in DIP, centred in a wider area, and
 * scrolled – never leaving a gap – in a narrower one; the clipping parent is
 * the page area.
 */
import { describe, expect, it } from 'vitest'
import { placePageView } from './widthPresetLayout'

const CONTENT = { width: 1200, height: 800 }
const AREA = { x: 320, y: 80, width: 860, height: 620 }

describe('placePageView', () => {
  it('at Full width places the view exactly on the page area', () => {
    const placed = placePageView({ bounds: AREA, clip: AREA }, 'full', CONTENT, 1)
    expect(placed).toEqual({ clip: AREA, view: AREA, viewInClip: { x: 0, y: 0, width: 860, height: 620 } })
  })

  it('025-AC-012 gives Phone width 390 DIP and Tablet width 768 DIP, centred in a wider area', () => {
    const phone = placePageView({ bounds: AREA, clip: AREA }, 'phone', CONTENT, 1)
    expect(phone?.view).toEqual({ x: 320 + 235, y: 80, width: 390, height: 620 })
    expect(phone?.viewInClip.x).toBe(235)
    const tablet = placePageView({ bounds: AREA, clip: AREA }, 'tablet', CONTENT, 1)
    expect(tablet?.view.width).toBe(768)
    expect(tablet?.view.x).toBe(320 + 46)
  })

  it('keeps the preset width in DIP whatever Erfana zoom is, while the page area scales', () => {
    const placed = placePageView({ bounds: AREA, clip: AREA }, 'phone', { width: 3000, height: 3000 }, 1.5)
    expect(placed?.clip).toEqual({ x: 480, y: 120, width: 1290, height: 930 })
    expect(placed?.view.width).toBe(390)
  })

  it('025-AC-012 in a panel narrower than the preset, keeps the width and follows the scroll position', () => {
    const narrow = { x: 100, y: 50, width: 300, height: 400 }
    const atStart = placePageView({ bounds: { ...narrow, width: 390 }, clip: narrow }, 'phone', CONTENT, 1)
    expect(atStart?.view).toEqual({ x: 100, y: 50, width: 390, height: 400 })
    expect(atStart?.clip).toEqual(narrow)
    const scrolled = placePageView({ bounds: { ...narrow, x: 60, width: 390 }, clip: narrow }, 'phone', CONTENT, 1)
    expect(scrolled?.viewInClip.x).toBe(-40)
  })

  it('never scrolls the view past either edge of the area', () => {
    const narrow = { x: 100, y: 50, width: 300, height: 400 }
    const tooFarLeft = placePageView({ bounds: { ...narrow, x: -500 }, clip: narrow }, 'phone', CONTENT, 1)
    expect(tooFarLeft?.view.x).toBe(100 + 300 - 390)
    const tooFarRight = placePageView({ bounds: { ...narrow, x: 400 }, clip: narrow }, 'phone', CONTENT, 1)
    expect(tooFarRight?.view.x).toBe(100)
  })

  it('cuts the view to the area vertically and hides it when nothing is left', () => {
    const tall = placePageView({ bounds: { ...AREA, y: 0, height: 2000 }, clip: AREA }, 'full', CONTENT, 1)
    expect(tall?.view).toEqual(AREA)
    expect(placePageView({ bounds: { ...AREA, y: 900 }, clip: AREA }, 'full', CONTENT, 1)).toBeNull()
  })

  it('hides the view when the page area clamps to nothing, and treats a bad zoom as 100%', () => {
    expect(placePageView({ bounds: AREA, clip: { x: 2000, y: 0, width: 10, height: 10 } }, 'full', CONTENT, 1)).toBeNull()
    expect(placePageView({ bounds: AREA, clip: AREA }, 'full', CONTENT, Number.NaN)?.clip).toEqual(AREA)
  })
})
