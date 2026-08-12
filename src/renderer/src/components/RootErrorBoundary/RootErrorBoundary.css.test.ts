// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ALLOWLIST guard for `RootErrorBoundary.css` (design §2.4).
 *
 * The renderer has one `index.html` entry shared with the screenshot-overlay
 * window, and `main.import-isolation.test.ts` exists because a global
 * `html, body, #root` rule in a statically imported stylesheet once leaked a
 * crosshair cursor into every window. `main.tsx` statically imports the root
 * boundary, so this stylesheet is in the shared entry bundle by construction —
 * the only control left is that it can never match anything outside its own
 * component.
 *
 * An ALLOWLIST, not a denylist: a denylist of `html` / `body` / `#root` would
 * still wave through a bare `button {}` or a `:root { --x: … }` token override.
 * Every top-level selector must start with `.root-error`, full stop.
 *
 * At-rules are rejected outright. The parser below is flat, so an `@media`
 * wrapper would hide its inner selectors from the check rather than fail it —
 * and there is no legitimate need for one on a dark-mode-only crash screen.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// The fallback's buttons carry `.dialog-btn*` classes that this stylesheet
// deliberately never declares (see the allowlist test below), so the styling
// comes from another component's file. Imported as raw text to pin that
// cross-component dependency — see the "shared Dialog.css contract" block.
import DIALOG_CSS from '../Dialog/Dialog.css?raw'

const CSS_PATH = resolve(__dirname, 'RootErrorBoundary.css')
const RAW_CSS = readFileSync(CSS_PATH, 'utf8')

/** The allowed prefix for every top-level selector in this stylesheet. */
const REQUIRED_PREFIX = '.root-error'

/**
 * Remove CSS block comments so prose cannot be mistaken for a rule.
 *
 * Not cosmetic: the file's header comment names `#root`, `html` and `body`
 * while explaining why they are forbidden.
 *
 * @param css - Raw stylesheet source
 * @returns The same source with comments removed
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Every individual selector in the stylesheet, comma-lists expanded.
 *
 * @param css - Comment-stripped stylesheet source
 * @returns Selector strings in source order
 */
function topLevelSelectors(css: string): string[] {
  const rulePattern = /([^{}]+)\{[^{}]*\}/g
  const selectors: string[] = []
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(css)) !== null) {
    for (const part of match[1].split(',')) {
      const selector = part.trim().replace(/\s+/g, ' ')
      if (selector.length > 0) selectors.push(selector)
    }
  }
  return selectors
}

/**
 * Declaration block of every rule whose selector is EXACTLY `selector`.
 *
 * Exact match on purpose: `.root-error-details` must not be satisfied by
 * `.root-error-details[hidden]` or `.root-error-details::-webkit-scrollbar`.
 *
 * @param css - Comment-stripped stylesheet source
 * @param selector - Full selector text to match
 * @returns The matching declaration blocks, joined by `;`
 */
function declarationsFor(css: string, selector: string): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  const bodies: string[] = []
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(css)) !== null) {
    const parts = match[1].split(',').map((part) => part.trim().replace(/\s+/g, ' '))
    if (parts.includes(selector)) bodies.push(match[2])
  }
  return bodies.join(';')
}

/**
 * Value of `property` in a declaration block, last declaration winning.
 *
 * @param body - Declaration block, braces excluded
 * @param property - CSS property name
 * @returns The declared value, or `null` when the property is absent
 */
function declaredValue(body: string, property: string): string | null {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi')
  let value: string | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    value = match[1].trim()
  }
  return value
}

const CLEAN_CSS = stripComments(RAW_CSS)
const SELECTORS = topLevelSelectors(CLEAN_CSS)

describe('RootErrorBoundary.css selector allowlist', () => {
  it('parses at least one rule (guards against a vacuous pass)', () => {
    // Without this, renaming or emptying the file would make every assertion
    // below trivially true.
    expect(SELECTORS.length).toBeGreaterThan(5)
  })

  it('contains no at-rules, so the flat parse above sees every selector', () => {
    expect(
      CLEAN_CSS,
      'An at-rule (@media/@supports/@keyframes) would nest selectors out of ' +
        'reach of this allowlist. Restructure instead of adding one.'
    ).not.toMatch(/@[A-Za-z-]+/)
  })

  it.each(SELECTORS)('"%s" starts with .root-error', (selector) => {
    expect(
      selector.startsWith(REQUIRED_PREFIX),
      `Selector "${selector}" in RootErrorBoundary.css does not start with ` +
        `"${REQUIRED_PREFIX}". This stylesheet ships in the entry bundle that the ` +
        `screenshot-overlay window also loads, so anything broader leaks into ` +
        `every window. Scope it to a .root-error class.`
    ).toBe(true)
  })

  it('never declares or overrides the shared .dialog-btn rules it references', () => {
    // The fallback REFERENCES .dialog-btn* from markup; those rules belong to
    // Dialog.css. Re-declaring them here would fork the button styling.
    expect(CLEAN_CSS).not.toMatch(/\.dialog-btn/)
  })

  it('keeps the flat-design rule (border-radius token or 0 only)', () => {
    // Terminated by `;` OR `}`: a semicolon is optional on the last declaration
    // of a block, and requiring one let that exact case slip past the guard.
    const radii = [...CLEAN_CSS.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())
    for (const radius of radii) {
      expect(['var(--border-radius)', '0']).toContain(radius)
    }
  })
})

/**
 * Source-level layout guard — the honest jsdom substitute for the F31
 * "200% zoom / short viewport" acceptance row.
 *
 * jsdom has NO layout engine: every element measures 0×0, `getComputedStyle`
 * resolves no cascade for these rules, and nothing ever overflows. A test that
 * claimed to prove the Restart button stays reachable at 200% zoom would be
 * proving nothing. So this asserts only what is actually checkable here — that
 * the three declarations the reachability depends on are still DECLARED:
 * a scroll container on the details region, a non-shrinking action row, and a
 * viewport-bounded root. VISUAL CONFIRMATION AT 200% ZOOM IS A UAT STEP, not
 * something this file can do.
 *
 * @see docs/design/design-issue-60.md §2.3 (layout paragraph), §5 row F31
 */
describe('RootErrorBoundary.css layout contract (F31 substitute)', () => {
  it('bounds the root container to the viewport so it can never grow past it', () => {
    const body = declarationsFor(CLEAN_CSS, '.root-error')

    expect(body, 'the `.root-error` rule disappeared or was renamed').not.toBe('')
    expect(declaredValue(body, 'max-height')).toBe('100vh')
  })

  it('makes the details region its own scroll container', () => {
    // A long stack must consume its own scrollbar instead of pushing the
    // action row below the fold.
    const body = declarationsFor(CLEAN_CSS, '.root-error-details')

    expect(declaredValue(body, 'max-height')).not.toBeNull()
    expect(declaredValue(body, 'overflow-y')).toBe('auto')
  })

  it('never shrinks the action row', () => {
    // `flex-shrink: 0` is what keeps Restart / Copy / Open logs at full height
    // when the panel is squeezed.
    const body = declarationsFor(CLEAN_CSS, '.root-error-actions')

    expect(declaredValue(body, 'flex-shrink')).toBe('0')
  })
})

/**
 * Cross-component CSS dependency, pinned.
 *
 * `RootErrorFallback` styles every button with `.dialog-btn` +
 * `.dialog-btn-primary` / `.dialog-btn-secondary`, and the allowlist above
 * FORBIDS this stylesheet from declaring them — so the crash screen's buttons
 * are styled entirely by `Dialog/Dialog.css`. That is an invisible coupling: a
 * rename or removal there leaves the last-resort recovery screen with unstyled
 * buttons, and no test in the Dialog folder would notice, because nothing there
 * knows the crash screen exists. This assertion is the tripwire.
 */
describe('shared Dialog.css contract', () => {
  it('Dialog.css still declares the .dialog-btn classes the fallback relies on', () => {
    const dialogCss = stripComments(DIALOG_CSS)

    expect(
      dialogCss,
      'RootErrorFallback renders `className="dialog-btn dialog-btn-primary"` and ' +
        'RootErrorBoundary.css is forbidden from declaring those rules. If they ' +
        'moved out of Dialog.css, the crash screen now has unstyled buttons.'
    ).toMatch(/\.dialog-btn\b/)
    expect(dialogCss).toMatch(/\.dialog-btn-primary\b/)
    expect(dialogCss).toMatch(/\.dialog-btn-secondary\b/)
  })
})
