// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which comment bar a page's ground takes (K-20; C-12; Text highlights card,
 * "Contrast"): the deep violet on a light ground, the brand violet on a dark
 * one. Pure: the page's overlay reads the colour and hands it in.
 */

/** A colour's 0–255 channels. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** A ground colour, with its alpha. */
export interface GroundColour extends Rgb {
  readonly alpha: number
}

/**
 * The relative luminance where the two bars have the same contrast: above it
 * the deep violet (#3F3FBA) stands out more, below it the brand violet (#A0A8FF).
 * `markGround.test.ts` pins it to the two colours.
 */
export const LIGHT_GROUND_LUMINANCE = 0.2

/** One sRGB channel, 0–255, as linear light. */
function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a colour. */
export function luminanceOf({ r, g, b }: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * @param ground - The ground a mark sits on.
 * @returns It takes the deep bar.
 */
export function isLightGround(ground: GroundColour): boolean {
  return luminanceOf(ground) >= LIGHT_GROUND_LUMINANCE
}
