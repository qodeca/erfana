// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fixed values the CDP allow-list pins (spec 025 solution design § 5,
 * panel finding S23, ADR 0007 decisions 3, 6 and 10, ADR 0008 decision 3).
 *
 * Everything here is frozen. A new page function or a new pinned value is a
 * reviewed edit to this file; no caller can build one at run time.
 */

import { PICK_PAGE_FUNCTIONS } from './cdpPickFunctions'

/** A function Erfana may run in a page through `Runtime.callFunctionOn`. */
export interface CdpPageFunction {
  /** Stable name for logs and tests. */
  readonly name: string
  /** The exact `functionDeclaration` sent. */
  readonly source: string
  /** The `throwOnSideEffect` value pinned for this function. */
  readonly throwOnSideEffect: boolean
}

/** Longest outer HTML read from the page, in UTF-16 units: one past the context file's 20,000 cap, so the cut is detectable (ADR 0007 decision 3). */
export const OUTER_HTML_READ_MAX_CODE_UNITS = 20_001

/**
 * Outer HTML cut in the page before it crosses the protocol (ADR 0007
 * decision 3). Run in the isolated world with `this` bound to the element.
 * `throwOnSideEffect: true` per ADR 0008 decision 3; the commit-8 probe must
 * confirm the `outerHTML` getter passes V8's side-effect check (inferred).
 */
export const OUTER_HTML_CUT: CdpPageFunction = Object.freeze({
  name: 'outerHtmlCut',
  source: `function () { const html = this.outerHTML; return typeof html === 'string' ? html.slice(0, ${OUTER_HTML_READ_MAX_CODE_UNITS}) : '' }`,
  throwOnSideEffect: true
})

/**
 * Every function `Runtime.callFunctionOn` may carry, compared by exact source:
 * the outer-HTML cut and the pick reads, including the React lookup (ADR 0007
 * decision 10), of `cdpPickFunctions.ts` (solution design § 13, commit 14).
 */
export const CDP_PAGE_FUNCTIONS: readonly CdpPageFunction[] = Object.freeze([OUTER_HTML_CUT, ...PICK_PAGE_FUNCTIONS])

/** The isolated world Erfana's reads run in (`Page.createIsolatedWorld`). */
export const ISOLATED_WORLD_NAME = 'erfana-pick'

/** Object groups Erfana may name: the page's console objects, and Erfana's own pick reads. */
export const CONSOLE_OBJECT_GROUP = 'console'
export const PICK_OBJECT_GROUP = 'erfana-pick'
export const CDP_OBJECT_GROUPS: readonly string[] = Object.freeze([CONSOLE_OBJECT_GROUP, PICK_OBJECT_GROUP])

/** The only `Target.setAutoAttach` parameters (ADR 0007 decision 1). */
export const AUTO_ATTACH_PARAMS = Object.freeze({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })

/** The only `Runtime.evaluate` parameters: the hang probe (025-FR-056). */
export const HANG_PROBE_EVALUATE_PARAMS = Object.freeze({ expression: '0', returnByValue: true, silent: true })

/** `Network.enable` with every body buffer at zero (ADR 0007 decision 2). */
export const NETWORK_ENABLE_PARAMS = Object.freeze({ maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 })

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * The live pick outline's colour (ADR 0007 decision 6, owner decision Q2):
 * `--color-accent-primary` (`--color-brand-violet`, #A0A8FF), opaque – the
 * Element picker card's accent ring, as close as the engine's one-colour
 * outline allows. The card's two-tone outline is drawn on the still image.
 */
export const PICK_OUTLINE_COLOUR: Rgba = Object.freeze({ r: 160, g: 168, b: 255, a: 1 })

/** No fill: the live highlight is an outline only (Q2); `Overlay.highlightQuad`'s `color` is pinned to it. */
export const NO_FILL: Rgba = Object.freeze({ r: 0, g: 0, b: 0, a: 0 })

/** Numbers in one CDP quad: four corners, x then y. */
export const QUAD_LENGTH = 8

/**
 * The `Overlay.highlightQuad` parameters of the live pick outline: the
 * element's border-box quad in its own target's viewport, no fill, and the
 * outline colour. `outlineColor` is a parameter for a forced-colours system
 * colour; nothing passes one yet.
 */
export function pickOutlineParams(
  quad: readonly number[],
  outlineColor: Rgba = PICK_OUTLINE_COLOUR
): Readonly<{ quad: number[]; color: Rgba; outlineColor: Rgba }> {
  return Object.freeze({ quad: [...quad], color: NO_FILL, outlineColor })
}
