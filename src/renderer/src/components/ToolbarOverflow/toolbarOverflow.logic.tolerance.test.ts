// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overflow computation at fractional widths (#451).
 *
 * At a non-integer display scale (Windows at 125 % / 150 %, a zoomed macOS
 * window) `getBoundingClientRect()` returns widths like 24.8 px, so a row that
 * fits on screen can sum a fraction of a pixel past its content box. The
 * computation allows `FIT_TOLERANCE_PX` (0.5 px) of slack: a miss of up to half
 * a pixel is not a clip, anything more is. The boundary cases use dyadic
 * fractions (0.375, 0.5, 0.625) so floating-point sums are exact.
 */
import { describe, it, expect } from 'vitest'
import { computeOverflow, type OverflowInput } from './toolbarOverflow.logic'

/** Four buttons, … the same width, no gaps, no icon or title: the arithmetic alone. */
function bare(available: number, width = 24): OverflowInput {
  return {
    available,
    rowGap: 0,
    itemGap: 0,
    iconWidth: 0,
    titleReserve: 0,
    hasIcon: false,
    hasTitle: false,
    moreWidth: width,
    items: ['a', 'b', 'c', 'd'].map((id) => ({ id, width }))
  }
}

const FULL = 4 * 24

describe('computeOverflow – sub-pixel tolerance', () => {
  it('keeps every button when the row is 0.375 px short', () => {
    expect(computeOverflow(bare(FULL - 0.375)).moved).toEqual([])
  })

  it('keeps every button at exactly the 0.5 px tolerance', () => {
    expect(computeOverflow(bare(FULL - 0.5)).moved).toEqual([])
  })

  it('moves buttons once the row is 0.625 px short', () => {
    // Past the slack: the row would really clip. The smallest worthwhile move is two buttons.
    expect(computeOverflow(bare(FULL - 0.625)).moved).toEqual(['c', 'd'])
  })

  it('applies the same slack to the menu layout, not only to the all-fit check', () => {
    // Room for two buttons + … (72 px), 0.375 px short: stays at two + …, does not drop to one.
    expect(computeOverflow(bare(3 * 24 - 0.375)).moved).toEqual(['c', 'd'])
    // 0.625 px short: one button + … is all that fits.
    expect(computeOverflow(bare(3 * 24 - 0.625)).moved).toEqual(['b', 'c', 'd'])
  })

  it('applies the slack to the title/icon floor as well', () => {
    const input: OverflowInput = { ...bare(0), hasIcon: true, iconWidth: 16, hasTitle: true, titleReserve: 32, rowGap: 8 }
    // … alone (24) + icon (16) + gap (8) = 48: 0.375 short still keeps the icon.
    expect(computeOverflow({ ...input, available: 48 - 0.375 })).toMatchObject({ showIcon: true, showTitle: false })
    expect(computeOverflow({ ...input, available: 48 - 0.625 })).toMatchObject({ showIcon: false, showTitle: false })
  })

  it('keeps a 125 % DPI terminal row whole when its measured widths sum 0.3 px past the room', () => {
    // 31 device px / 1.25 = 24.8 css px per button; eight buttons, 8 px gaps, icon 16, title reserve 32.
    const width = 24.8
    const lead = 16 + 8 + 32 + 8
    const group = 8 * width + 7 * 8
    const input: OverflowInput = {
      available: lead + group - 0.3,
      rowGap: 8,
      itemGap: 8,
      iconWidth: 16,
      titleReserve: 32,
      hasIcon: true,
      hasTitle: true,
      moreWidth: width,
      items: ['screen', 'window', 'area', 'photo', 'bottom', 'restart', 'lock', 'maximize'].map((id) => ({
        id,
        width,
        moveLast: id === 'maximize'
      }))
    }
    expect(computeOverflow(input)).toEqual({ moved: [], showTitle: true, showIcon: true })
    // 0.7 px short is a real clip at that scale: buttons move, Maximize (raised) stays.
    const short = computeOverflow({ ...input, available: lead + group - 0.7 })
    expect(short.moved.length).toBeGreaterThan(0)
    expect(short.moved).not.toContain('maximize')
  })
})
