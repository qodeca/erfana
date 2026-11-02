// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Browser zoom steps (spec 025, 025-FR-008): Ctrl/Cmd+Plus and Ctrl/Cmd+Minus
 * step through a fixed list, as in Chrome; Plus at the top and Minus at the
 * bottom do nothing; Ctrl/Cmd+0 resets to 100%.
 */

/** The zoom levels in percent, lowest first (025-FR-008). */
export const ZOOM_PERCENTS: readonly number[] = Object.freeze([
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500
])

export const ZOOM_DEFAULT_PERCENT = 100
export const ZOOM_MIN_PERCENT = ZOOM_PERCENTS[0]
export const ZOOM_MAX_PERCENT = ZOOM_PERCENTS[ZOOM_PERCENTS.length - 1]

export type ZoomStep = 'in' | 'out' | 'reset'

/**
 * The level after one step from `currentPercent`. A level between two steps
 * (set outside Erfana, for example by DevTools) moves to the nearest step in
 * that direction. At either end the level does not change.
 */
export function nextZoomPercent(currentPercent: number, step: ZoomStep): number {
  if (step === 'reset' || !Number.isFinite(currentPercent)) return ZOOM_DEFAULT_PERCENT
  if (step === 'in') return ZOOM_PERCENTS.find(p => p > currentPercent) ?? clampToEnd(currentPercent)
  const lower = ZOOM_PERCENTS.filter(p => p < currentPercent)
  return lower.length > 0 ? lower[lower.length - 1] : clampToEnd(currentPercent)
}

/** A level already at (or beyond) an end stays at that end. */
function clampToEnd(percent: number): number {
  return Math.min(Math.max(percent, ZOOM_MIN_PERCENT), ZOOM_MAX_PERCENT)
}

/** Electron's zoom factor for a level in percent (100% → 1). */
export function zoomFactorOf(percent: number): number {
  return percent / 100
}

/** The level in whole percent for an Electron zoom factor. */
export function zoomPercentOf(factor: number): number {
  return Math.round(factor * 100)
}
