// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The screenshot outline's colour: the `--color-accent-primary` token,
 * resolved from `design-tokens.css` at build time (spec 025, 025-FR-034).
 *
 * Main may not import the renderer's stylesheet (the layer rule), so the
 * build resolves the token (`electron.vite.design-tokens.ts`) and inlines it
 * as `__ERFANA_ACCENT_PRIMARY__`; a token change reaches the outline with the
 * next build. `accentColour.test.ts` pins the inlined value to the token read
 * from the stylesheet on its own.
 */
import type { Rgb } from './captureImage'

/** The token the outline uses (025-FR-034). */
export const OUTLINE_TOKEN = '--color-accent-primary'

/**
 * `#rrggbb` as a colour.
 *
 * @throws when `hex` is not six hex digits after `#` (the build resolves only such values)
 */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (match === null) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const n = Number.parseInt(match[1], 16)
  return Object.freeze({ r: n >> 16, g: (n >> 8) & 0xff, b: n & 0xff })
}

/** `--color-accent-primary`, as the build resolved it. */
export const OUTLINE_COLOUR: Rgb = hexToRgb(__ERFANA_ACCENT_PRIMARY__)

/** The outline colour of every capture. */
export function outlineColour(): Rgb {
  return OUTLINE_COLOUR
}
