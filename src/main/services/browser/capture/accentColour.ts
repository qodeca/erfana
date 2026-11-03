// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The screenshot outline's colour: the `--color-accent-primary` token,
 * resolved (spec 025, 025-FR-034).
 *
 * Main may not import the renderer's stylesheet (the layer rule), so the
 * value travels resolved, as `preview/comments/commentOverlayTheme.ts` does;
 * `accentColour.test.ts` pins it to `design-tokens.css`, so a token change
 * fails a test instead of drifting.
 */
import type { Rgb } from './captureImage'

/** The token the outline uses (025-FR-034). */
export const OUTLINE_TOKEN = '--color-accent-primary'

/** `--color-accent-primary` (#A0A8FF, through `--color-brand-violet`). */
export const OUTLINE_COLOUR: Rgb = Object.freeze({ r: 0xa0, g: 0xa8, b: 0xff })

/** The outline colour of every capture. */
export function outlineColour(): Rgb {
  return OUTLINE_COLOUR
}
