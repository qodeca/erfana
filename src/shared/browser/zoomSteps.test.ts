// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { ZOOM_PERCENTS, nextZoomPercent, zoomFactorOf, zoomPercentOf } from './zoomSteps'

describe('zoom steps (025-FR-008)', () => {
  it('025-AC-008 steps 100% → 110% → 125% and resets to 100%', () => {
    const once = nextZoomPercent(100, 'in')
    const twice = nextZoomPercent(once, 'in')
    expect([once, twice, nextZoomPercent(twice, 'reset')]).toEqual([110, 125, 100])
  })

  it('025-AC-008 does nothing for Plus at 500% and Minus at 25%', () => {
    expect(nextZoomPercent(500, 'in')).toBe(500)
    expect(nextZoomPercent(25, 'out')).toBe(25)
    expect(nextZoomPercent(400, 'in')).toBe(500)
    expect(nextZoomPercent(33, 'out')).toBe(25)
  })

  it('walks every step in both directions', () => {
    let p = 25
    const up = [p]
    while (p < 500) up.push((p = nextZoomPercent(p, 'in')))
    expect(up).toEqual([...ZOOM_PERCENTS])
    const down = [p]
    while (p > 25) down.push((p = nextZoomPercent(p, 'out')))
    expect(down).toEqual([...ZOOM_PERCENTS].reverse())
  })

  it('moves an off-step level to the nearest step in the direction, and clamps beyond the ends', () => {
    expect(nextZoomPercent(105, 'in')).toBe(110)
    expect(nextZoomPercent(105, 'out')).toBe(100)
    expect(nextZoomPercent(900, 'in')).toBe(500)
    expect(nextZoomPercent(10, 'out')).toBe(25)
    expect(nextZoomPercent(Number.NaN, 'in')).toBe(100)
  })

  it('converts between percent and Electron zoom factors', () => {
    expect(zoomFactorOf(125)).toBe(1.25)
    expect(zoomPercentOf(1.1000000001)).toBe(110)
  })
})
