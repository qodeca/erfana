// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The origin fitted to the width of the element that draws it (spec 025,
 * 025-FR-004, 025-FR-011; design Security UI rule 2 and § States › Tiers,
 * fold steps 2 and 8): the address bar at rest, the popup strip and the
 * editor-tab label.
 *
 * A surface that only clips its overflow shows the start of a long host and
 * hides its end – `accounts.google.com.secure-login.verify.ev…` – which is the
 * part that says whose page it is. Fitted here, whole subdomain labels go
 * from the front first (`….verify.evil.test`), and only then is the
 * registrable domain cut from its start, so its end, the TLD and the port
 * always stay in view.
 *
 * The width is followed with a `ResizeObserver`; the text is measured in the
 * element's own font on a canvas, so wide (CJK) characters count for what
 * they draw. Before layout (width 0, also under jsdom) the whole origin is
 * given.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  fitOriginParts,
  fitOriginToWidth,
  type FittedOrigin,
  type WebOriginParts
} from '../../../../../shared/browser/originFormat'

/** Kept free at the end of the box, so sub-pixel rounding never clips the last character. */
const SAFETY_PX = 1

/** The width of the box's content (no padding), in CSS px. */
function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element)
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  return element.clientWidth - padding
}

/** Measures text in `element`'s font; without a canvas, one font size per character (wider than any glyph). */
function measurerFor(element: HTMLElement): (text: string) => number {
  const style = getComputedStyle(element)
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx === null) {
    const size = parseFloat(style.fontSize) || 16
    return text => [...text].length * size
  }
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return text => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

/**
 * The fitted origin for `parts` in `element`.
 *
 * @param element - The box that draws the origin (its content width is the room), or null before it mounts
 * @param parts - The origin to fit, or null when the surface shows no web origin
 * @returns The fitted parts, or null when `parts` is null
 *
 * @example
 * ```tsx
 * const [box, setBox] = useState<HTMLElement | null>(null)
 * const fitted = useOriginFit(box, parts)
 * // <span ref={setBox}>{fitted && fittedText(fitted)}</span>
 * ```
 */
export function useOriginFit(element: HTMLElement | null, parts: WebOriginParts | null): FittedOrigin | null {
  const [width, setWidth] = useState(0)
  /** Bumped once the document's fonts are ready: a glyph measured in a fallback font has another width. */
  const [fontsReady, setFontsReady] = useState(0)

  useEffect(() => {
    let live = true
    void document.fonts?.ready.then(() => {
      if (live) setFontsReady(n => n + 1)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    const measure = (): void => setWidth(contentWidth(element))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return useMemo(() => {
    if (parts === null) return null
    if (element === null || width <= SAFETY_PX) return fitOriginParts(parts, Number.POSITIVE_INFINITY)
    return fitOriginToWidth(parts, width - SAFETY_PX, measurerFor(element))
    // fontsReady re-measures the same text once the real font is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, parts, width, fontsReady])
}
