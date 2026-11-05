// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The live pick outline's two tones (spec 025, 025-FR-026; ADR 0007
 * decision 6, amended 2026-11-05): ink and paper, so one of them stands out
 * by at least 3:1 on any page colour (ink on paper is 18.5:1, and two tones
 * at least 9:1 apart always leave one of them 3:1 from any background).
 *
 * Main may not import the renderer's stylesheet, so the build resolves the
 * tokens (`electron.vite.design-tokens.ts`) and inlines them as
 * `__ERFANA_OUTLINE_INK__` and `__ERFANA_OUTLINE_PAPER__`; this module is the
 * one place main reads them. The still image's outline (`PickRow.css`,
 * `.erf-brw-still__outline`) uses the same two tokens by name.
 */

/** The token of the outline's two outer and inner lines. */
export const OUTLINE_INK_TOKEN = '--color-brand-black'
/** The token of the outline's middle line. */
export const OUTLINE_PAPER_TOKEN = '--color-white'

/** The outline's tones, each `#rrggbb`. */
export interface OutlinePair {
  readonly ink: string
  readonly paper: string
}

/** `--color-brand-black` and `--color-white`, as the build resolved them. */
export const OUTLINE_PAIR: OutlinePair = Object.freeze({ ink: __ERFANA_OUTLINE_INK__, paper: __ERFANA_OUTLINE_PAPER__ })

/** A 0–255 colour channel triple (alpha, if any, is ignored: the band is opaque). */
export interface RgbChannels {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** `colour` as `#rrggbb`, each channel rounded and clamped to 0–255. */
export function hexOf(colour: RgbChannels): string {
  const channel = (v: number): string => Math.min(255, Math.max(0, Math.round(Number.isFinite(v) ? v : 0))).toString(16).padStart(2, '0')
  return `#${channel(colour.r)}${channel(colour.g)}${channel(colour.b)}`
}
