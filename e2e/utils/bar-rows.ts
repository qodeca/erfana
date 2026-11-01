// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment bars, read from real pixels (K-21, K-20): a CSS rule can be there and
 * still paint nothing, and an HTML mark sits in a closed shadow root.
 */
import sharp from 'sharp'

/** `--color-accent-primary`: the bar on a dark ground. */
export const ACCENT_RGB = [0xa0, 0xa8, 0xff] as const
/** `--color-brand-indigo`: the bar on a light ground. */
export const INDIGO_RGB = [0x3f, 0x3f, 0xba] as const

/** The bar rows of a still: rows painted in the bar's colour across the words. */
export interface BarRows {
  /** Rows the bar runs across unbroken. */
  readonly solid: number
  /** Separate bands of bar rows: 2 for a double bar. */
  readonly bands: number
  /** Runs of colour in the fullest row: many for a dashed bar. */
  readonly dashes: number
}

/**
 * @param still - A PNG of the words.
 * @param rgb - The bar's colour.
 * @returns What the bar's rows look like.
 */
export async function barRowsIn(still: Buffer, rgb: readonly [number, number, number]): Promise<BarRows> {
  const { data, info } = await sharp(still).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const isBar = (x: number, y: number): boolean => {
    const at = (y * info.width + x) * info.channels
    return rgb.every((value, i) => Math.abs(data[at + i] - value) <= 40)
  }
  const rows = Array.from({ length: info.height }, (_, y) => {
    const xs = Array.from({ length: info.width }, (_unused, x) => x).filter(x => isBar(x, y))
    const runs = xs.filter((x, i) => i === 0 || xs[i - 1] !== x - 1).length
    return { y, runs, painted: xs.length }
  })
  // Pixels in the colour, never first-to-last: subpixel-smoothed text (Linux) leaves
  // a few stray pixels of nearly any colour, wide apart across a row of words.
  const fullest = Math.max(...rows.map(row => row.painted))
  const bars = rows.filter(row => fullest >= 30 && row.painted >= fullest * 0.8)
  return {
    solid: bars.filter(row => row.runs === 1).length,
    bands: bars.filter((row, i) => i === 0 || bars[i - 1].y !== row.y - 1).length,
    dashes: Math.max(0, ...bars.map(row => row.runs))
  }
}
