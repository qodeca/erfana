// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What colour sits behind a previewed page (issue #74 follow-up).
 *
 * THE DEFECT THIS EXISTS FOR. The view's background was set once, in the
 * constructor, to Erfana's dark brand black — the colour that hides the seam
 * between the native `WebContentsView` and the DOM placeholder it paints over.
 * An HTML page that declares no background of its own is transparent, so that
 * dark colour became the page's paper while the page's default text stayed
 * black. Most plain HTML was therefore unreadable. A browser paints white there.
 *
 * So the backdrop has two jobs at two different times, and one constant cannot
 * do both:
 *
 *  - **Before the page paints** it is CHROME: it must match the DOM placeholder
 *    exactly, or a bounds update flashes a bright band at the view's edge and a
 *    hidden-with-no-still-frame panel flashes on show.
 *  - **Once the page has painted** it is the page's PAPER: it must be whatever
 *    a browser would have painted, which is the page's own resolved
 *    `color-scheme`, not a hard-coded white.
 *
 * WHY THE EVENT PAIR MATTERS. `did-start-loading` / `did-stop-loading` are
 * scoped by Chromium to *any document in the frame tree*, while
 * `did-finish-load` is scoped to the *primary main frame's* `onload`. Pairing
 * `did-start-loading` with `did-finish-load` — the obvious-looking choice —
 * means one lazily-loaded `<iframe>` flips the backdrop back to chrome and
 * nothing ever flips it forward again: the page is unreadable for good.
 * `did-stop-loading` is the symmetric counterpart and additionally fires when a
 * load fails or is cancelled, which matters because `window.stop()` is callable
 * by the untrusted page and would otherwise pin it into the chrome state.
 *
 * WHY A RELOAD DOES NOT GO BACK TO CHROME. `setBackgroundColor` is not deferred
 * to the next paint — Electron writes the compositor layer, the WebContents and
 * the web preferences immediately. During a reload the previous document stays
 * on screen until the new one commits, so repainting the backdrop dark under it
 * would flash the *current* page dark on every autosave. Only the first load has
 * nothing painted to lose.
 *
 * @see specs/designs/sd-074-html-preview.md §1.8
 */

/** ARGB, matching `--color-brand-black` and the panel's placeholder CSS. */
export const CHROME_BACKDROP = '#FF161312'

/**
 * ARGB fallback paper for a page that declares no `color-scheme` — the colour a
 * browser paints behind a transparent document.
 */
export const DEFAULT_PAGE_BACKDROP = '#FFFFFFFF'

/** Where a view is in its load, as far as the backdrop is concerned. */
export type BackdropPhase = 'chrome' | 'page'

/** The lifecycle edges that can move the backdrop. */
export type BackdropEvent =
  | 'constructed'
  | 'start-loading'
  | 'stop-loading'
  | 'fail-load'
  | 'crashed'

/** The backdrop state a view carries between events. */
export interface BackdropState {
  readonly phase: BackdropPhase
  /**
   * `true` until the first load terminates. Only a first load may repaint the
   * backdrop to chrome; every later `start-loading` is a reload with a document
   * still on screen.
   */
  readonly firstLoad: boolean
}

/** A freshly constructed view: chrome, and its first load still ahead of it. */
export const INITIAL_BACKDROP_STATE: BackdropState = { phase: 'chrome', firstLoad: true }

/**
 * The backdrop state machine.
 *
 * Pure so the whole table is testable without an Electron view, and so the
 * "which event moves what" question has one answer rather than three
 * `setBackgroundColor` calls scattered through a 650-line class.
 *
 * @param state - The view's current backdrop state.
 * @param event - The lifecycle edge that just fired.
 * @returns The next state; `===`-identical to `state` when nothing changes.
 *
 * @example
 * ```ts
 * let s = INITIAL_BACKDROP_STATE          // chrome, first load ahead
 * s = nextBackdropState(s, 'start-loading') // chrome (repaint is a no-op)
 * s = nextBackdropState(s, 'stop-loading')  // page
 * s = nextBackdropState(s, 'start-loading') // page — a reload keeps the paper
 * ```
 */
export function nextBackdropState(state: BackdropState, event: BackdropEvent): BackdropState {
  switch (event) {
    case 'constructed':
      return INITIAL_BACKDROP_STATE

    case 'start-loading':
      // A reload keeps the old document painted, so it keeps the old paper.
      return state.firstLoad ? state : { phase: 'page', firstLoad: false }

    // Every way a load can END puts the page's own paper behind it — success,
    // failure, and `window.stop()`. A failed load shows Chromium's error
    // document, which is dark text on transparent and needs paper just as much
    // as a successful one does.
    case 'stop-loading':
    case 'fail-load':
      return { phase: 'page', firstLoad: false }

    case 'crashed':
      // Nothing is painting. Back to chrome so the view is indistinguishable
      // from the panel behind it while the DOM shows its own failure banner.
      return { phase: 'chrome', firstLoad: false }

    default: {
      // Exhaustiveness: a new event must be given a rule here, not defaulted.
      const unreachable: never = event
      return unreachable
    }
  }
}

/**
 * The ARGB colour for a state.
 *
 * @param state - The backdrop state.
 * @param pageBackdrop - The page's own resolved paper, when it has been read.
 * @returns An ARGB string for `view.setBackgroundColor`.
 */
export function backdropColor(state: BackdropState, pageBackdrop: string | null): string {
  if (state.phase === 'chrome') {
    return CHROME_BACKDROP
  }
  return pageBackdrop ?? DEFAULT_PAGE_BACKDROP
}

/**
 * Script evaluated in the preview's isolated world to read the page's own paper.
 *
 * Returns an `rgb()`/`rgba()` string, or `null` when the page leaves the canvas
 * to the user agent and the caller should fall back to
 * {@link DEFAULT_PAGE_BACKDROP}.
 *
 * Reads the `<body>` background first and the root element second, matching the
 * CSS background-propagation rule: a `<body>` background propagates to the
 * canvas when the root has none. `color-scheme` is consulted last, so a page
 * that only opts into dark mode — the common `<meta name="color-scheme">` case,
 * which has no background at all — still gets dark paper rather than white.
 *
 * Runs in an isolated world, so the page cannot shadow `getComputedStyle`.
 */
export const READ_PAGE_BACKDROP_SCRIPT = `(() => {
  try {
    const transparent = (v) =>
      !v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)'
    const root = document.documentElement
    const body = document.body
    const rootBg = root ? getComputedStyle(root).backgroundColor : ''
    if (!transparent(rootBg)) return rootBg
    const bodyBg = body ? getComputedStyle(body).backgroundColor : ''
    if (!transparent(bodyBg)) return bodyBg
    const scheme = root ? getComputedStyle(root).colorScheme : ''
    if (typeof scheme === 'string' && /\\bdark\\b/.test(scheme) && !/\\blight\\b/.test(scheme)) {
      return 'rgb(18, 18, 18)'
    }
    if (typeof scheme === 'string' && /\\bdark\\b/.test(scheme) &&
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'rgb(18, 18, 18)'
    }
    return null
  } catch {
    return null
  }
})()`

/** Matches `rgb(r, g, b)` / `rgba(r, g, b, a)` with integer channels. */
const RGB_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/

/**
 * Convert a CSS `rgb()`/`rgba()` string from the page into the opaque ARGB form
 * `setBackgroundColor` takes.
 *
 * The value crosses a trust boundary — it is computed from an untrusted page —
 * so it is parsed strictly and anything unrecognised becomes `null` rather than
 * being interpolated into a colour string. Alpha is dropped: the backdrop is the
 * bottom layer and must be opaque, or the chrome colour shows through and the
 * unreadable-page defect comes back at partial strength.
 *
 * @param value - The script's return value; anything at all.
 * @returns An `#AARRGGBB` string, or `null` when it is not a usable colour.
 */
export function toArgb(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = RGB_PATTERN.exec(value.trim())
  if (match === null) {
    return null
  }
  const channels = [match[1], match[2], match[3]].map((part) => Number.parseInt(part, 10))
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    return null
  }
  // A fully transparent background is the page declining to paint; treat it as
  // "no opinion" so the caller falls back rather than painting black.
  if (match[4] !== undefined && Number.parseFloat(match[4]) === 0) {
    return null
  }
  const hex = channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')
  return `#FF${hex.toUpperCase()}`
}

/**
 * The CSS colour the renderer should paint behind the view, derived from the
 * same ARGB value the native side uses.
 *
 * The DOM placeholder and the native backdrop must always carry the same value —
 * that is the invariant replacing sd-074 §1.8's "both are brand black", which
 * this change retires. Keeping them equal is what makes a bounds update, a
 * hide-without-a-still-frame, and a show all seamless.
 *
 * @param argb - An `#AARRGGBB` string.
 * @returns A `#RRGGBB` CSS colour, or `null` when the input is malformed.
 */
export function argbToCss(argb: string): string | null {
  if (!/^#[0-9a-f]{8}$/i.test(argb)) {
    return null
  }
  return `#${argb.slice(3)}`
}
