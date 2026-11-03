// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PANEL_GAP_PX, SHEET_BELOW_PX, anchorOnStill, cutPath, placePanel } from './pickPanel.logic'

const AREA = { width: 800, height: 600 }
const PANEL = { width: 300, height: 200 }

describe('anchorOnStill', () => {
  it('scales by the zoom and centres a page narrower than the area', () => {
    expect(anchorOnStill({ x: 10, y: 20, width: 100, height: 50 }, 100, 800, AREA)).toEqual({ x: 10, y: 20, width: 100, height: 50 })
    expect(anchorOnStill({ x: 10, y: 20, width: 100, height: 50 }, 200, 400, AREA)).toEqual({ x: 220, y: 40, width: 200, height: 100 })
  })

  it('shrinks a page wider than the area to fit, and survives a zero width', () => {
    expect(anchorOnStill({ x: 100, y: 100, width: 100, height: 100 }, 100, 1600, AREA)).toEqual({ x: 50, y: 50, width: 50, height: 50 })
    expect(anchorOnStill({ x: 1, y: 1, width: 1, height: 1 }, 100, 0, AREA)).toEqual({ x: 401, y: 1, width: 1, height: 1 })
  })
})

describe('placePanel (025-FR-030)', () => {
  it('becomes a sheet under the narrow width', () => {
    expect(placePanel({ x: 0, y: 0, width: 10, height: 10 }, PANEL, { width: SHEET_BELOW_PX - 1, height: 600 })).toEqual({ kind: 'sheet' })
    expect(placePanel({ x: 0, y: 0, width: 10, height: 10 }, PANEL, { width: SHEET_BELOW_PX, height: 600 }).kind).toBe('at')
  })

  it('prefers below, then above, then right, then left, never over the outline', () => {
    expect(placePanel({ x: 10, y: 10, width: 100, height: 20 }, PANEL, AREA)).toEqual({ kind: 'at', left: 10, top: 30 + PANEL_GAP_PX, side: 'below' })
    expect(placePanel({ x: 10, y: 500, width: 100, height: 50 }, PANEL, AREA)).toEqual({ kind: 'at', left: 10, top: 500 - PANEL_GAP_PX - 200, side: 'above' })
    expect(placePanel({ x: 10, y: 150, width: 100, height: 300 }, PANEL, AREA)).toEqual({ kind: 'at', left: 110 + PANEL_GAP_PX, top: 150, side: 'right' })
    expect(placePanel({ x: 450, y: 150, width: 340, height: 300 }, PANEL, AREA)).toEqual({ kind: 'at', left: 450 - PANEL_GAP_PX - 300, top: 150, side: 'left' })
  })

  it('keeps the panel inside the area and falls back over a huge element', () => {
    expect(placePanel({ x: 700, y: 10, width: 90, height: 20 }, PANEL, AREA)).toMatchObject({ left: 500, side: 'below' })
    expect(placePanel({ x: 0, y: 0, width: 800, height: 600 }, PANEL, AREA)).toEqual({ kind: 'at', left: 0, top: 400, side: 'inside' })
    expect(placePanel({ x: 0, y: 0, width: 800, height: 600 }, { width: 900, height: 700 }, AREA)).toEqual({ kind: 'at', left: 0, top: 0, side: 'inside' })
  })

  it('keeps the panel inside the area when the outline lies wholly outside it (an off-screen pick, 025-FR-035)', () => {
    // Wholly above: "below" has room on paper, at a negative top.
    expect(placePanel({ x: 10, y: -1919, width: 100, height: 60 }, PANEL, AREA)).toEqual({ kind: 'at', left: 10, top: 0, side: 'below' })
    // Wholly below: "above", pulled up to the area's bottom.
    expect(placePanel({ x: 10, y: 2000, width: 100, height: 60 }, PANEL, AREA)).toEqual({ kind: 'at', left: 10, top: 400, side: 'above' })
    // Wholly left of the area.
    expect(placePanel({ x: -900, y: 100, width: 100, height: 500 }, PANEL, AREA)).toMatchObject({ left: 0 })
  })
})

describe('cutPath (025-FR-027)', () => {
  it('keeps the end of the path and marks a cut start', () => {
    expect(cutPath([], 3)).toEqual({ crumbs: [], cut: false })
    expect(cutPath(['html'], 3)).toEqual({ crumbs: [{ name: 'html', index: 0 }], cut: false })
    expect(cutPath(['html', 'body', 'main', 'div'], 2)).toEqual({
      crumbs: [
        { name: 'main', index: 2 },
        { name: 'div', index: 3 }
      ],
      cut: true
    })
    expect(cutPath(['html', 'body'], -1)).toEqual({ crumbs: [], cut: true })
  })
})
