// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTokenHex } from '../../../../../electron.vite.design-tokens'
import { hexOf, OUTLINE_INK_TOKEN, OUTLINE_PAIR, OUTLINE_PAPER_TOKEN } from './pickOutlineColours'

const TOKENS_CSS = readFileSync(join(__dirname, '../../../../renderer/src/styles/design-tokens.css'), 'utf8')

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 0xff) + 0.0722 * lin(n & 0xff)
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('pickOutlineColours', () => {
  it('is --color-brand-black and --color-white of the real design tokens, as the build inlines them', () => {
    expect(OUTLINE_INK_TOKEN).toBe('--color-brand-black')
    expect(OUTLINE_PAPER_TOKEN).toBe('--color-white')
    expect(OUTLINE_PAIR).toEqual({ ink: resolveTokenHex(TOKENS_CSS, OUTLINE_INK_TOKEN), paper: resolveTokenHex(TOKENS_CSS, OUTLINE_PAPER_TOKEN) })
    expect(Object.isFrozen(OUTLINE_PAIR)).toBe(true)
  })

  it('the pair is at least 9:1 apart, so one tone clears 3:1 on any page colour (ink on paper is 18.5:1)', () => {
    expect(contrast(OUTLINE_PAIR.ink, OUTLINE_PAIR.paper)).toBeGreaterThanOrEqual(9)
    expect(Number(contrast(OUTLINE_PAIR.ink, OUTLINE_PAIR.paper).toFixed(1))).toBe(18.5)
    for (const page of ['#000000', '#ffffff', '#808080', '#a0a8ff', '#161312', '#f8faf8', '#ff3381', '#3f3fba', '#777777']) {
      expect(Math.max(contrast(OUTLINE_PAIR.ink, page), contrast(OUTLINE_PAIR.paper, page)), page).toBeGreaterThanOrEqual(3)
    }
  })

  it('writes a test colour as #rrggbb, rounding and clamping each channel', () => {
    expect(hexOf({ r: 255, g: 0, b: 255 })).toBe('#ff00ff')
    expect(hexOf({ r: 1.4, g: 254.6, b: 16 })).toBe('#01ff10')
    expect(hexOf({ r: -5, g: 300, b: Number.NaN })).toBe('#00ff00')
  })
})
