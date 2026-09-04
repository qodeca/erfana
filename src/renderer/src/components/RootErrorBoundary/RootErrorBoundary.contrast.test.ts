// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WCAG 1.4.3 (AA) contrast guard for the crash surfaces.
 *
 * Modelled on `Dialog.contrast.test.ts`: the ratios are RECOMPUTED from the
 * shipping stylesheets — custom properties parsed out of `design-tokens.css`,
 * declarations parsed out of `RootErrorBoundary.css`, the `var()` chain
 * resolved between them — rather than asserted against hardcoded numbers. So
 * the regression it guards is the real one: editing a token value, or
 * repointing a rule at a different token, is what breaks it.
 *
 * BOTH crash stylesheets are measured here, not just the root one.
 * `Panels/PanelErrorBoundary.css` is the other tier of the same containment set
 * (design §2.3) and has the same property: it is the screen a user only ever
 * sees when something has already gone wrong, so nobody would notice it
 * drifting. One guard reading both beats a second copy of this machinery.
 *
 * WHY THIS SURFACE IN PARTICULAR. The crash screen may be the only thing on the
 * display, it carries the one instruction that gets the user out of the failure,
 * and it is not reachable in normal use — so nobody would notice it drifting.
 * The temptation is `--color-text-muted` for the "small print" (version, stack).
 * All three of `--color-text-muted` / `--color-text-disabled` /
 * `--color-text-placeholder` resolve to `#6e6e6e`, which measures ~3.6:1 on the
 * app background and FAILS 1.4.3. They are banned outright below;
 * `--color-text-secondary` (`#858585`, ~5.0:1) is the floor.
 *
 * SCOPE, stated honestly: this reads CSS as TEXT. It does not lay anything out,
 * does not composite opacity, and knows about the cascade only to the extent of
 * "the last declaration wins". It proves the ratio of the two token values the
 * rules name.
 *
 * @see WCAG 2.2 SC 1.4.3 Contrast (Minimum)
 * @see docs/design/design-issue-60.md §2.3 (colour contract)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** WCAG 1.4.3 AA minimum for normal-size text. */
const WCAG_AA_NORMAL_TEXT = 4.5

const TOKENS_CSS = readFileSync(resolve(__dirname, '../../styles/design-tokens.css'), 'utf8')
const ROOT_ERROR_CSS = readFileSync(resolve(__dirname, 'RootErrorBoundary.css'), 'utf8')
const PANEL_ERROR_CSS = readFileSync(resolve(__dirname, '../Panels/PanelErrorBoundary.css'), 'utf8')

/** The crash stylesheets this guard measures, by file name. */
const STYLESHEETS: Array<[string, string]> = [
  ['RootErrorBoundary.css', ROOT_ERROR_CSS],
  ['PanelErrorBoundary.css', PANEL_ERROR_CSS]
]

/**
 * Tokens that all resolve to `#6e6e6e` (~3.6:1 on `--color-bg-primary`) and are
 * therefore forbidden on this surface.
 */
/**
 * Tokens too dim to use as text on the crash screen.
 *
 * `--color-text-placeholder` used to be here and has been REMOVED, because the
 * reason for its ban stopped being true. All three once resolved to
 * `--color-gray-600` (#6e6e6e, 3.63:1 on this background). The placeholder token
 * now resolves to `--color-gray-450` (#949494, 6.09:1) — it was repointed to fix
 * a real WCAG 1.4.3 failure inside text inputs, where 2.69:1 made typed-over
 * placeholder text unreadable.
 *
 * Leaving it listed would have made this suite assert something false, which the
 * "ban is about contrast, not naming" test below caught immediately — exactly
 * what that test is for. The remaining two still resolve to #6e6e6e and still
 * fail; if either is ever repointed, that test fails again and this list should
 * shrink again rather than the assertion being loosened.
 */
const FORBIDDEN_TOKENS = ['--color-text-muted', '--color-text-disabled'] as const

/**
 * Remove CSS block comments so prose cannot be parsed as a rule.
 *
 * @param css - Raw stylesheet source
 * @returns The same source with comments removed
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** One parsed rule: selector text and declaration block. */
interface ParsedRule {
  /** Selector text, whitespace-collapsed */
  selector: string
  /** Declaration block, braces excluded */
  body: string
}

/**
 * Parse every flat rule out of a stylesheet.
 *
 * `RootErrorBoundary.css.test.ts` independently asserts the file contains no
 * at-rules, so a flat parse sees everything.
 *
 * @param css - Stylesheet source
 * @returns Rules in source order
 */
function parseRules(css: string): ParsedRule[] {
  const rules: ParsedRule[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  const clean = stripComments(css)
  while ((match = pattern.exec(clean)) !== null) {
    rules.push({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] })
  }
  return rules
}

/**
 * Collect every `--custom-property: value` declaration.
 *
 * @param sources - Stylesheet sources, in cascade order
 * @returns Map of property name to raw value
 */
function collectCustomProperties(...sources: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const source of sources) {
    const declarations = /(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g
    let match: RegExpExecArray | null
    const clean = stripComments(source)
    while ((match = declarations.exec(clean)) !== null) {
      map.set(match[1], match[2].trim())
    }
  }
  return map
}

const RULES = STYLESHEETS.flatMap(([, css]) => parseRules(css))
const tokens = collectCustomProperties(TOKENS_CSS, ...STYLESHEETS.map(([, css]) => css))

/**
 * The declaration block of the (single) rule with exactly this selector.
 *
 * @param selector - Selector text, verbatim
 * @returns The rule body
 * @throws {Error} When no such rule exists
 */
function ruleBody(selector: string): string {
  const matches = RULES.filter((rule) => rule.selector === selector)
  if (matches.length === 0) {
    throw new Error(
      `No rule with selector "${selector}" in the crash stylesheets. If it was ` +
        `renamed, repoint this contrast guard — do not delete the assertion.`
    )
  }
  return matches[matches.length - 1].body
}

/**
 * Read one property out of a rule body (last declaration wins).
 *
 * @param body - Rule body
 * @param property - Property name
 * @returns The declared value, or `null`
 */
function optionalValue(body: string, property: string): string | null {
  const declaration = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi')
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = declaration.exec(body)) !== null) {
    last = match[1].trim()
  }
  return last
}

/**
 * Read one property out of a rule body, requiring it.
 *
 * @param body - Rule body
 * @param property - Property name
 * @returns The declared value
 * @throws {Error} When the property is not declared
 */
function declaredValue(body: string, property: string): string {
  const value = optionalValue(body, property)
  if (value === null) {
    throw new Error(`Rule does not declare "${property}". Body was: ${body.trim()}`)
  }
  return value
}

/**
 * Resolve a possibly-nested `var()` reference to a literal.
 *
 * @param value - Declared value
 * @param seen - Internal cycle guard
 * @returns The literal at the end of the chain
 * @throws {Error} On an undefined property or a cycle
 */
function resolveVar(value: string, seen = new Set<string>()): string {
  const reference = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim())
  if (reference === null) return value.trim()

  const name = reference[1]
  if (seen.has(name)) throw new Error(`Cyclic custom-property reference through ${name}`)
  seen.add(name)

  const next = tokens.get(name)
  if (next === undefined) {
    throw new Error(`Custom property ${name} is referenced but never defined`)
  }
  return resolveVar(next, seen)
}

/**
 * Parse a `#rgb` / `#rrggbb` colour into 8-bit channels.
 *
 * Deliberately narrow — anything else throws rather than being approximated.
 *
 * @param color - CSS colour literal
 * @returns `[r, g, b]`, each 0–255
 * @throws {Error} On an unsupported literal
 */
function parseHexColor(color: string): [number, number, number] {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color)
  if (short !== null) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16)
    ]
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (long !== null) {
    return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)]
  }
  throw new Error(
    `Unsupported colour literal "${color}". Extend parseHexColor() rather than ` +
      `weakening the assertion.`
  )
}

/**
 * WCAG 2.x relative luminance.
 *
 * @param color - CSS hex colour literal
 * @returns Relative luminance, 0–1
 */
function relativeLuminance(color: string): number {
  const [r, g, b] = parseHexColor(color)
  const linear = [r, g, b].map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/**
 * WCAG 2.x contrast ratio, order-independent.
 *
 * @param foreground - CSS hex colour literal
 * @param background - CSS hex colour literal
 * @returns Ratio, 1–21
 */
function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** One text rule and the surface rule whose background it sits on. */
interface TextSurface {
  /** Selector of the rule declaring `color` */
  selector: string
  /** Selector of the rule declaring the background it is painted over */
  surface: string
}

/**
 * Every text rule on the crash surfaces.
 *
 * Not the source of truth for what EXISTS — the two cross-checks below run this
 * list against the stylesheets in both directions, so neither a new coloured
 * element nor a new background can be added without being measured here.
 */
const TEXT_SURFACES: TextSurface[] = [
  { selector: '.root-error-heading', surface: '.root-error' },
  { selector: '.root-error-message', surface: '.root-error' },
  { selector: '.root-error-status', surface: '.root-error' },
  { selector: '.root-error-log-path', surface: '.root-error' },
  { selector: '.root-error-meta', surface: '.root-error-details' },
  { selector: '.root-error-stack', surface: '.root-error-details' },
  { selector: '.panel-error-message', surface: '.panel-error' }
]

/**
 * Backgrounds that legitimately pair with no text rule, and why.
 *
 * The reverse cross-check would otherwise have no way to express "this rule
 * paints a background that carries nothing measurable". Each entry is verified
 * to still exist, so an exemption cannot outlive the rule it excuses.
 */
const BACKGROUNDS_WITHOUT_TEXT = new Map<string, string>([
  [
    ".root-error-actions button[aria-disabled='true']:hover",
    'Pending Restart. The declaration re-states the RESTING background so the ' +
      'shared :hover rule cannot re-colour a control that ignores the click — it ' +
      'introduces no colour of its own, and the label it sits under is styled by ' +
      'Dialog.css, which this stylesheet is forbidden to re-declare. WCAG 1.4.3 ' +
      'exempts inactive controls in any case.'
  ]
])

describe('WCAG contrast: root crash screen', () => {
  describe('formula sanity', () => {
    // Without these, a broken luminance implementation could return a large
    // number for everything and the suite below would pass while proving nothing.
    it('computes the WCAG reference extremes', () => {
      expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
      expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    })

    it('reproduces the muted-token failure this suite exists to prevent', () => {
      // Historical literals on purpose: #6e6e6e is what all three forbidden
      // tokens resolve to, #161312 is the app background.
      expect(contrastRatio('#6e6e6e', '#161312')).toBeLessThan(WCAG_AA_NORMAL_TEXT)
    })
  })

  describe('stylesheet shape', () => {
    const SOURCES: Array<[string, string]> = [['design-tokens.css', TOKENS_CSS], ...STYLESHEETS]

    it.each(SOURCES)('keeps %s free of @media overrides', (_name, css) => {
      expect(stripComments(css)).not.toMatch(/@media/)
    })

    it.each(SOURCES)('keeps %s free of [data-theme] overrides', (_name, css) => {
      expect(stripComments(css)).not.toMatch(/\[data-theme/)
    })

    it('scopes every PanelErrorBoundary.css selector to .panel-error', () => {
      // `RootErrorBoundary.css.test.ts` guards the root sheet's `.root-error`
      // prefix; the panel sheet had no equivalent. Both reach the entry bundle
      // the screenshot-overlay window also loads, so an unscoped rule here
      // leaks into every window.
      const unscoped = parseRules(PANEL_ERROR_CSS)
        .map((rule) => rule.selector)
        .filter((selector) => !selector.startsWith('.panel-error'))

      expect(unscoped).toEqual([])
    })

    it.each(TEXT_SURFACES)('declares $selector exactly once', ({ selector }) => {
      // A duplicate rule is invisible to a first-match reader but wins in the
      // browser, so a later re-declaration of `color` could break the pairing.
      expect(RULES.filter((rule) => rule.selector === selector)).toHaveLength(1)
    })

    it('covers every rule that declares a color', () => {
      const declaresColor = RULES.filter(
        (rule) => optionalValue(rule.body, 'color') !== null
      ).map((rule) => rule.selector)

      expect(
        [...new Set(declaresColor)].sort(),
        'A rule declares `color` that no contrast assertion covers. Add it to ' +
          'TEXT_SURFACES rather than leaving it unmeasured.'
      ).toEqual([...new Set(TEXT_SURFACES.map((entry) => entry.selector))].sort())
    })

    it('covers every rule that declares a background-color', () => {
      // The symmetric half of the check above. Without it a new panel or card
      // could introduce a background that no text pairing measures, and every
      // ratio below would still pass while the new surface went unchecked.
      const declaresBackground = RULES.filter(
        (rule) => optionalValue(rule.body, 'background-color') !== null
      ).map((rule) => rule.selector)

      const surfaces = new Set(TEXT_SURFACES.map((entry) => entry.surface))
      const unmeasured = [...new Set(declaresBackground)]
        .filter((selector) => !surfaces.has(selector))
        .filter((selector) => !BACKGROUNDS_WITHOUT_TEXT.has(selector))
        .sort()

      expect(
        unmeasured,
        'A rule paints a background that no contrast assertion sits on. Pair it ' +
          'with the text drawn over it in TEXT_SURFACES, or record why it carries ' +
          'no measurable text in BACKGROUNDS_WITHOUT_TEXT.'
      ).toEqual([])
    })

    it('keeps every background exemption attached to a rule that still exists', () => {
      // An exemption whose rule was renamed or deleted is a hole in the check
      // above that nothing else would report.
      for (const selector of BACKGROUNDS_WITHOUT_TEXT.keys()) {
        // `matches`, not `body`: these are whole rules, and the name `body` is
        // the DECLARATION BLOCK everywhere else in this file.
        const matches = RULES.filter((rule) => rule.selector === selector)
        expect(
          matches.length,
          `BACKGROUNDS_WITHOUT_TEXT excuses "${selector}", which no longer exists. ` +
            `Drop the exemption.`
        ).toBeGreaterThan(0)
        expect(optionalValue(matches[matches.length - 1].body, 'background-color')).not.toBeNull()
      }
    })
  })

  describe('forbidden tokens', () => {
    const TOKEN_USES: Array<[string, string, string]> = STYLESHEETS.flatMap(([name, css]) =>
      FORBIDDEN_TOKENS.map((token): [string, string, string] => [name, token, css])
    )

    it.each(TOKEN_USES)('%s never references %s', (_name, token, css) => {
      expect(
        stripComments(css),
        `${token} resolves to #6e6e6e (~3.6:1 on the app background) and fails ` +
          `WCAG 1.4.3. Use --color-text-secondary as the floor on this surface.`
      ).not.toContain(`var(${token})`)
    })

    it('confirms the ban is about contrast, not naming', () => {
      const background = resolveVar(declaredValue(ruleBody('.root-error'), 'background-color'))
      for (const token of FORBIDDEN_TOKENS) {
        const value = tokens.get(token)
        expect(value, `${token} is not defined in design-tokens.css`).toBeDefined()
        expect(contrastRatio(resolveVar(value as string), background)).toBeLessThan(
          WCAG_AA_NORMAL_TEXT
        )
      }
    })
  })

  describe('WCAG 1.4.3 AA (4.5:1, normal text)', () => {
    it.each(TEXT_SURFACES)('$selector passes on $surface', ({ selector, surface }) => {
      const foreground = resolveVar(declaredValue(ruleBody(selector), 'color'))
      const background = resolveVar(declaredValue(ruleBody(surface), 'background-color'))
      const ratio = contrastRatio(foreground, background)

      expect(
        ratio,
        `${selector} on ${surface}: foreground ${foreground} on background ` +
          `${background} = ${ratio.toFixed(2)}:1, but WCAG 1.4.3 AA requires ` +
          `>= ${WCAG_AA_NORMAL_TEXT}:1. Fix the token values or the declarations — ` +
          `do not lower this threshold.`
      ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
    })
  })
})
