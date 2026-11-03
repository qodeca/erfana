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

/** The fixed flags of the pick `HighlightConfig` (ADR 0007 decision 6); colours vary (forced colours). */
export const HIGHLIGHT_FLAGS = Object.freeze({
  showInfo: true,
  showStyles: false,
  showAccessibilityInfo: false,
  showExtensionLines: false
})

/** The colour keys a pick `HighlightConfig` carries, each an RGBA object. */
export const HIGHLIGHT_COLOUR_KEYS = Object.freeze(['contentColor', 'paddingColor', 'marginColor', 'borderColor'] as const)

export type HighlightColourKey = (typeof HIGHLIGHT_COLOUR_KEYS)[number]

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export type HighlightPalette = Readonly<Record<HighlightColourKey, Rgba>>

/**
 * The default palette: a low-alpha brand-violet fill (`--color-brand-violet`,
 * #A0A8FF) with an opaque contrasting band. Proposed until owner question Q2
 * is answered; the pick commit may add the forced-colours palette.
 */
export const DEFAULT_HIGHLIGHT_PALETTE: HighlightPalette = Object.freeze({
  contentColor: Object.freeze({ r: 160, g: 168, b: 255, a: 0.25 }),
  paddingColor: Object.freeze({ r: 20, g: 20, b: 20, a: 1 }),
  marginColor: Object.freeze({ r: 20, g: 20, b: 20, a: 1 }),
  borderColor: Object.freeze({ r: 160, g: 168, b: 255, a: 1 })
})

/** A pick `HighlightConfig`: the fixed flags plus `palette`. */
export function pickHighlightConfig(palette: HighlightPalette = DEFAULT_HIGHLIGHT_PALETTE): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...HIGHLIGHT_FLAGS, ...palette })
}
