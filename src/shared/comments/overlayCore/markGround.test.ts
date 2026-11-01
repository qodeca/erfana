// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { isLightGround, LIGHT_GROUND_LUMINANCE, luminanceOf } from './markGround'

const DEEP = { r: 0x3f, g: 0x3f, b: 0xba }
const VIOLET = { r: 0xa0, g: 0xa8, b: 0xff }
const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const grey = (v: number) => ({ r: v, g: v, b: v, alpha: 1 })

describe('K-20 which bar a ground takes', () => {
  it.each([
    ['white', 255, 3],
    ['the card\'s grey', 232, 3],
    ['black', 0, 3]
  ])('K-20 %s: the chosen bar is at least 3:1', (_name, value, floor) => {
    const ground = luminanceOf(grey(value))
    const bar = luminanceOf(isLightGround(grey(value)) ? DEEP : VIOLET)
    expect(contrast(bar, ground)).toBeGreaterThanOrEqual(floor)
  })

  it('K-20 the switch sits where the two bars tie, so every ground takes the better one', () => {
    const atSwitch = LIGHT_GROUND_LUMINANCE
    expect(Math.abs(contrast(luminanceOf(DEEP), atSwitch) - contrast(luminanceOf(VIOLET), atSwitch))).toBeLessThan(0.05)
  })
})
