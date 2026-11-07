// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `window.open` features and the popup's content size (025-FR-011 rule 2,
 * ADR 0011 decision 9, S-22).
 */
import { describe, expect, it } from 'vitest'
import {
  parseWindowFeatures,
  popupContentSize,
  POPUP_DEFAULT_CONTENT,
  POPUP_MIN_CONTENT_HEIGHT,
  POPUP_MIN_CONTENT_WIDTH,
  reclampContentSize
} from './windowFeatures'

const LIMITS = { workArea: { width: 1440, height: 900 }, stripHeight: 0, originMinWidth: 0 }

describe('parseWindowFeatures', () => {
  it('reads width and height, their inner aliases, case and separators as Chromium does', () => {
    expect(parseWindowFeatures('width=500,height=600')).toEqual({ width: 500, height: 600, noopener: false })
    expect(parseWindowFeatures(' innerWidth = 400  innerHeight=300 ')).toEqual({ width: 400, height: 300, noopener: false })
    expect(parseWindowFeatures('WIDTH=320px,height=abc')).toEqual({ width: 320, height: null, noopener: false })
    expect(parseWindowFeatures('')).toEqual({ width: null, height: null, noopener: false })
  })

  it('caps an absurd size and ignores left, top and unknown keys (S-22)', () => {
    expect(parseWindowFeatures('width=99999999999,left=0,top=0,screenX=5,popup')).toEqual({ width: 100_000, height: null, noopener: false })
  })

  it('reads noopener and noreferrer as on unless they say no, 0 or false (rule 1)', () => {
    expect(parseWindowFeatures('noopener').noopener).toBe(true)
    expect(parseWindowFeatures('noreferrer=yes').noopener).toBe(true)
    expect(parseWindowFeatures('noopener=1').noopener).toBe(true)
    expect(parseWindowFeatures('noopener=no').noopener).toBe(false)
    expect(parseWindowFeatures('noopener=0').noopener).toBe(false)
    expect(parseWindowFeatures('noopener=false').noopener).toBe(false)
  })
})

describe('popupContentSize', () => {
  it('025-AC-011 gives the requested content size, and 800 × 600 when none is named', () => {
    expect(popupContentSize({ width: 500, height: 600 }, LIMITS)).toEqual({ width: 500, height: 600 })
    expect(popupContentSize({ width: null, height: null }, LIMITS)).toEqual(POPUP_DEFAULT_CONTENT)
    expect(popupContentSize({ width: 700, height: null }, LIMITS)).toEqual({ width: 700, height: 600 })
  })

  it('025-AC-011 fits a huge request inside the work area, less the strip', () => {
    expect(popupContentSize({ width: 99_999, height: 99_999 }, { ...LIMITS, stripHeight: 40 })).toEqual({ width: 1440, height: 860 })
  })

  it('025-AC-011 raises a narrow request to 320 px, or to what the origin strip needs', () => {
    expect(popupContentSize({ width: 200, height: 400 }, LIMITS)).toEqual({ width: POPUP_MIN_CONTENT_WIDTH, height: 400 })
    expect(popupContentSize({ width: 200, height: 400 }, { ...LIMITS, originMinWidth: 410.2 })).toEqual({ width: 411, height: 400 })
    expect(popupContentSize({ width: 500, height: 10 }, LIMITS)).toEqual({ width: 500, height: POPUP_MIN_CONTENT_HEIGHT })
  })

  it('keeps the minimums on a work area smaller than them', () => {
    const tiny = { workArea: { width: 200, height: 50 }, stripHeight: 30, originMinWidth: 0 }
    expect(popupContentSize({ width: 999, height: 999 }, tiny)).toEqual({ width: POPUP_MIN_CONTENT_WIDTH, height: POPUP_MIN_CONTENT_HEIGHT })
  })

  it('re-clamps a page resize by the same rules, rounding fractions', () => {
    expect(reclampContentSize({ width: 100.4, height: 5000 }, LIMITS)).toEqual({ width: POPUP_MIN_CONTENT_WIDTH, height: 900 })
    expect(reclampContentSize({ width: 640.6, height: 480.2 }, LIMITS)).toEqual({ width: 641, height: 480 })
  })
})
