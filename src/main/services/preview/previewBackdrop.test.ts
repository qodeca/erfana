// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The backdrop state machine (issue #74 follow-up).
 *
 * THE ASSERTION THAT MATTERS is the contrast one. Checking that
 * `setBackgroundColor` was called with a particular string pins the
 * implementation, not the outcome, and would keep passing if the constant were
 * changed to any other value — the same vacuity that let a preview ship
 * invisible at 0×0 while every test watched its web contents run scripts
 * happily. So the painted state is asserted as a PROPERTY: whatever colour it
 * resolves to must be readable under a browser's default black text.
 * `#161312`, the colour that caused the bug, scores ≈1.2:1 and fails it.
 */
import { describe, expect, it } from 'vitest'

import {
  CHROME_BACKDROP,
  DEFAULT_PAGE_BACKDROP,
  INITIAL_BACKDROP_STATE,
  argbToCss,
  backdropColor,
  nextBackdropState,
  toArgb,
  type BackdropState
} from './previewBackdrop'

/** WCAG 2.2 relative luminance of an `#AARRGGBB` colour. */
function luminance(argb: string): number {
  const channels = [argb.slice(3, 5), argb.slice(5, 7), argb.slice(7, 9)].map((pair) => {
    const value = Number.parseInt(pair, 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** WCAG 2.2 contrast ratio against pure black — the UA's default text colour. */
function contrastAgainstBlack(argb: string): number {
  return (luminance(argb) + 0.05) / 0.05
}

/** Walk the machine through a sequence of events from a starting state. */
function run(events: Parameters<typeof nextBackdropState>[1][], from = INITIAL_BACKDROP_STATE): BackdropState {
  return events.reduce(nextBackdropState, from)
}

describe('nextBackdropState', () => {
  it('starts on chrome so the seam with the placeholder is invisible', () => {
    expect(INITIAL_BACKDROP_STATE).toEqual({ phase: 'chrome', firstLoad: true })
  })

  it('stays on chrome while the first load is in flight', () => {
    expect(run(['start-loading']).phase).toBe('chrome')
  })

  it('hands the page its own paper once the first load stops', () => {
    expect(run(['start-loading', 'stop-loading']).phase).toBe('page')
  })

  it('keeps the paper across a reload, so a save never flashes chrome', () => {
    // `setBackgroundColor` is not deferred to the next paint: the old document
    // is still on screen during a reload, so repainting chrome under it would
    // flash the CURRENT page dark on every autosave.
    const afterFirstLoad = run(['start-loading', 'stop-loading'])
    expect(nextBackdropState(afterFirstLoad, 'start-loading').phase).toBe('page')
  })

  it('gives a FAILED load paper too', () => {
    // Chromium's error document is dark text on a transparent canvas. Leaving it
    // on chrome reproduces the exact bug this module exists to fix, on the
    // failure path — and `window.stop()` is callable by the untrusted page, so
    // it could pin itself there.
    expect(run(['start-loading', 'fail-load']).phase).toBe('page')
  })

  it('treats a cancelled load like any other termination', () => {
    // `window.stop()` surfaces as did-stop-loading with no did-finish-load.
    expect(run(['start-loading', 'stop-loading']).phase).toBe('page')
  })

  it('survives a subframe load that re-enters the loading state', () => {
    // did-start-loading is frame-tree scoped, so a lazily-loaded <iframe> fires
    // it again after the page is up. Pairing it with the main-frame-only
    // did-finish-load would strand the page on chrome for good.
    const state = run(['start-loading', 'stop-loading', 'start-loading'])
    expect(state.phase).toBe('page')
  })

  it('settles on paper through a burst of reloads', () => {
    const state = run([
      'start-loading',
      'stop-loading',
      'start-loading',
      'stop-loading',
      'start-loading',
      'stop-loading'
    ])
    expect(state.phase).toBe('page')
  })

  it('returns to chrome when the render process is gone', () => {
    // Nothing is painting, and the DOM shows its own failure banner behind.
    const state = run(['start-loading', 'stop-loading', 'crashed'])
    expect(state.phase).toBe('chrome')
  })

  it('re-arms the first-load rule when a view is reconstructed', () => {
    const state = nextBackdropState(run(['start-loading', 'stop-loading']), 'constructed')
    expect(state).toEqual(INITIAL_BACKDROP_STATE)
  })
})

describe('backdropColor', () => {
  it('is readable under the browser default text colour once painted', () => {
    // THE point of the change. A UA renders unstyled text in black, so whatever
    // paper the painted state resolves to has to clear WCAG AA against it.
    const painted = run(['start-loading', 'stop-loading'])
    expect(contrastAgainstBlack(backdropColor(painted, null))).toBeGreaterThanOrEqual(4.5)
  })

  it('proves the old constant would fail that bar', () => {
    // Guards the guard: if someone re-points the painted state at brand black,
    // the assertion above must be the thing that catches it.
    expect(contrastAgainstBlack(CHROME_BACKDROP)).toBeLessThan(1.5)
  })

  it('uses the page own paper when it has one', () => {
    const painted = run(['start-loading', 'stop-loading'])
    expect(backdropColor(painted, '#FF102030')).toBe('#FF102030')
  })

  it('falls back to the browser default when the page declares nothing', () => {
    const painted = run(['start-loading', 'stop-loading'])
    expect(backdropColor(painted, null)).toBe(DEFAULT_PAGE_BACKDROP)
  })

  it('ignores the page paper while still on chrome', () => {
    expect(backdropColor(INITIAL_BACKDROP_STATE, '#FFFFFFFF')).toBe(CHROME_BACKDROP)
  })
})

describe('toArgb', () => {
  it.each([
    ['rgb(255, 255, 255)', '#FFFFFFFF'],
    ['rgb(0, 0, 0)', '#FF000000'],
    ['rgba(18, 18, 18, 1)', '#FF121212'],
    ['  rgb(16, 32, 48)  ', '#FF102030']
  ])('parses %s', (input, expected) => {
    expect(toArgb(input)).toBe(expected)
  })

  it('drops alpha, because the backdrop is the bottom layer', () => {
    // A translucent backdrop lets the chrome colour through and brings the
    // unreadable-page defect back at partial strength.
    expect(toArgb('rgba(255, 255, 255, 0.5)')).toBe('#FFFFFFFF')
  })

  it('treats a fully transparent background as no opinion', () => {
    expect(toArgb('rgba(0, 0, 0, 0)')).toBeNull()
  })

  it.each([
    ['not a colour'],
    ['rgb(300, 0, 0)'],
    ['rgb(1,2)'],
    ['#ffffff'],
    ['color-mix(in srgb, red, blue)'],
    ['rgb(1, 2, 3); background: url(evil)']
  ])('refuses %s rather than interpolating it', (input) => {
    // The value is computed from an untrusted page, so anything unrecognised
    // becomes null instead of reaching setBackgroundColor.
    expect(toArgb(input)).toBeNull()
  })

  it.each([[null], [undefined], [42], [{}], [['rgb(0,0,0)']]])(
    'refuses the non-string %s',
    (input) => {
      expect(toArgb(input)).toBeNull()
    }
  )
})

describe('argbToCss', () => {
  it('drops the alpha byte so the DOM can carry the same value', () => {
    expect(argbToCss('#FF161312')).toBe('#161312')
  })

  it('matches the token the placeholder CSS uses today', () => {
    // The invariant replacing "both are brand black": both sides carry the SAME
    // value, whatever it is. This pins the chrome case of that equality.
    expect(argbToCss(CHROME_BACKDROP)?.toLowerCase()).toBe('#161312')
  })

  it('refuses a malformed value rather than emitting a broken colour', () => {
    expect(argbToCss('#161312')).toBeNull()
    expect(argbToCss('rgb(0,0,0)')).toBeNull()
  })
})
