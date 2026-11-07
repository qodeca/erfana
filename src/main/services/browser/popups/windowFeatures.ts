// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a page's `window.open` features ask for, and the popup size Erfana
 * gives it (spec 025, 025-FR-011 rule 2; ADR 0011 decision 9; spec change
 * S-22).
 *
 * - **Size.** The requested `width` / `height` (or `innerWidth` /
 *   `innerHeight`) are the size of the popup's **content** – the page view –
 *   never of the whole window. A missing one is the default
 *   ({@link POPUP_DEFAULT_CONTENT}, 800 × 600). The content is at least
 *   {@link POPUP_MIN_CONTENT_WIDTH} wide – and never narrower than the origin
 *   strip needs, which the caller passes in – and at least
 *   {@link POPUP_MIN_CONTENT_HEIGHT} high; it never exceeds the screen's
 *   work area, less the strip above it.
 * - **Position.** Every page-requested `left` / `top` (`screenX` / `screenY`)
 *   is ignored: the popup opens where the operating system puts it (S-22),
 *   so a page can never place it over the opener window's navigation, pick or
 *   strip rows.
 * - **`noopener` / `noreferrer`** (025-FR-011 rule 1): the open becomes a tab.
 *
 * Pure: no Electron, no clock.
 */

/** A popup's content size when the page names none (025-FR-011). */
export const POPUP_DEFAULT_CONTENT = Object.freeze({ width: 800, height: 600 })
/** The narrowest popup content (025-FR-011). */
export const POPUP_MIN_CONTENT_WIDTH = 320
/** The lowest popup content, as Chromium's own floor for popups. */
export const POPUP_MIN_CONTENT_HEIGHT = 100

/** Largest number a size feature may carry before it is treated as "as large as possible". */
const MAX_FEATURE_PX = 100_000

/** What the features string asks for. */
export interface WindowFeatures {
  readonly width: number | null
  readonly height: number | null
  /** `noopener` or `noreferrer`: the page keeps no reference to the new window. */
  readonly noopener: boolean
}

export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * Parse a `window.open` features string as Chromium does: `key=value` or a
 * bare `key`, separated by commas or white space (white space around `=`
 * allowed), keys case-insensitive, a
 * size read from its leading digits. Unknown keys are ignored.
 */
export function parseWindowFeatures(features: string): WindowFeatures {
  let width: number | null = null
  let height: number | null = null
  let noopener = false
  // White space around `=` belongs to the pair, not between tokens.
  for (const token of features.replace(/\s*=\s*/g, '=').split(/[\s,]+/)) {
    if (token === '') continue
    const eq = token.indexOf('=')
    const key = (eq === -1 ? token : token.slice(0, eq)).trim().toLowerCase()
    const value = eq === -1 ? '' : token.slice(eq + 1).trim()
    if (key === 'noopener' || key === 'noreferrer') noopener = isTruthyFlag(value)
    else if (key === 'width' || key === 'innerwidth') width = sizeOf(value) ?? width
    else if (key === 'height' || key === 'innerheight') height = sizeOf(value) ?? height
  }
  return { width, height, noopener }
}

/** A bare flag, `yes`, `1` or `true` is on; `no`, `0` and `false` are off (Chromium's rule). */
function isTruthyFlag(value: string): boolean {
  const lower = value.toLowerCase()
  return lower !== 'no' && lower !== '0' && lower !== 'false'
}

function sizeOf(value: string): number | null {
  const digits = /^\d+/.exec(value)
  if (digits === null) return null
  const n = Number(digits[0])
  return Number.isFinite(n) ? Math.min(n, MAX_FEATURE_PX) : null
}

export interface PopupSizeLimits {
  /** The screen's work area the popup opens on. */
  readonly workArea: Size
  /** The height of the strip above the page (origin strip and rows), added to the window. */
  readonly stripHeight: number
  /** The width the origin strip needs for the badge word, the registrable domain and the port. */
  readonly originMinWidth: number
}

/** The popup's content size for `features` within `limits` (025-FR-011 rule 2). */
export function popupContentSize(features: Pick<WindowFeatures, 'width' | 'height'>, limits: PopupSizeLimits): Size {
  const minWidth = Math.max(POPUP_MIN_CONTENT_WIDTH, Math.ceil(limits.originMinWidth))
  const maxWidth = Math.max(minWidth, Math.floor(limits.workArea.width))
  const maxHeight = Math.max(POPUP_MIN_CONTENT_HEIGHT, Math.floor(limits.workArea.height - limits.stripHeight))
  const width = clamp(features.width ?? POPUP_DEFAULT_CONTENT.width, minWidth, maxWidth)
  const height = clamp(features.height ?? POPUP_DEFAULT_CONTENT.height, POPUP_MIN_CONTENT_HEIGHT, maxHeight)
  return { width, height }
}

/**
 * The content size after the page asked to resize itself (`resizeTo`,
 * `resizeBy`), re-clamped by the same rules; the position it asked for is
 * ignored (ADR 0011 decision 9).
 */
export function reclampContentSize(requested: Size, limits: PopupSizeLimits): Size {
  return popupContentSize({ width: Math.round(requested.width), height: Math.round(requested.height) }, limits)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
