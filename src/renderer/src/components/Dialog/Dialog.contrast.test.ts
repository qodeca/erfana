// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WCAG 1.4.3 (AA) contrast guard for every `.dialog-btn-*` variant.
 *
 * `Dialog.css` DOCUMENTS the ratios it achieves ("8.4:1", "6.85:1") in a
 * comment, and a comment cannot fail. The primary button's foreground was
 * `--color-white` on the brand violet — 2.2:1, well under the 4.5:1 that
 * WCAG 1.4.3 requires for normal-size text — until #42 changed it to
 * `--color-brand-black`. The danger button then failed the same way in its
 * HOVER state only (white on `#e03e18` = 4.31:1, against 5.49:1 at rest), so
 * the one control on screen during an import or a transcription got harder to
 * read exactly as the pointer reached it. Nothing stopped either drifting back.
 *
 * This test recomputes the ratios from the SHIPPING stylesheets rather than
 * from hardcoded hex strings: it parses the custom properties out of
 * `design-tokens.css`, parses the `color` / `background-color` declarations
 * out of `Dialog.css`, resolves the `var()` chain between them, and applies the
 * WCAG 2.x relative-luminance formula. So the regression it guards is the real
 * one — editing a token value, or repointing a button at a different token, is
 * what breaks it.
 *
 * COVERAGE IS SELF-EXTENDING. {@link BUTTON_VARIANTS} lists the states checked,
 * and a separate test cross-checks that list against every rule in `Dialog.css`
 * that both names a `.dialog-btn-*` variant and declares a background. Adding a
 * `:focus-visible` background to any variant therefore fails this suite until
 * the state is covered, instead of slipping through unmeasured.
 *
 * SCOPE, stated honestly:
 * - It reads CSS as TEXT. It does not lay anything out, does not composite
 *   opacity, and does not know about cascade order beyond "the last rule with a
 *   given selector wins, and the last declaration of a custom property in the
 *   file wins". It therefore proves the ratio of the two token values the rules
 *   name — not what a user's screen shows after antialiasing, a
 *   `backdrop-filter`, or a stacked translucent overlay.
 * - `background-color: transparent` is resolved to `.dialog-container`'s
 *   background, i.e. the surface the button actually sits on. That is an
 *   assumption about composition, and it is the only one made here.
 * - Disabled buttons are deliberately NOT asserted: WCAG 1.4.3 exempts
 *   inactive controls, and `.dialog-btn:disabled` only changes `opacity`.
 *
 * @see WCAG 2.2 SC 1.4.3 Contrast (Minimum)
 * @see https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** WCAG 1.4.3 AA minimum for normal-size text (< 18.66px bold / < 24px regular). */
const WCAG_AA_NORMAL_TEXT = 4.5

const TOKENS_CSS = readFileSync(resolve(__dirname, '../../styles/design-tokens.css'), 'utf8')
const DIALOG_CSS = readFileSync(resolve(__dirname, 'Dialog.css'), 'utf8')

/**
 * Remove CSS block comments so they cannot be mistaken for rules.
 *
 * Necessary, not cosmetic: `Dialog.css` documents these very ratios in a block
 * comment that contains braces-adjacent prose, and the rule matcher below keys
 * off `{`/`}`.
 *
 * @param css - Raw stylesheet source
 * @returns The same source with comments blanked out
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Collect every `--custom-property: value` declaration in the given sources.
 *
 * Later declarations overwrite earlier ones, which matches the cascade for the
 * flat, single-`:root` files this reads. Both files are checked at import time
 * to still have that shape (see the `stylesheet shape` suite), so a future
 * `@media`, `@supports`, `[data-theme]` or second `:root` override cannot
 * silently make this the wrong model.
 *
 * @param sources - Stylesheet sources, in cascade order
 * @returns Map of property name (including the leading `--`) to raw value
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

/** One parsed rule: its selector text and its declarations. */
interface ParsedRule {
  /** Selector text exactly as written, whitespace-collapsed */
  selector: string
  /** Declaration block, braces excluded */
  body: string
}

/**
 * Parse every flat (non-nested) rule out of a stylesheet.
 *
 * Nested at-rules such as `@keyframes` yield only their INNER blocks, and the
 * at-rule prelude is DISCARDED: `@keyframes dialogFadeIn { from {…} to {…} }`
 * parses as two rules with the selectors `from` and `to`, and the wrapper's
 * closing brace is skipped. Harmless here — nothing this guard looks for lives
 * inside an at-rule, and no keyframe step can collide with a class selector —
 * and cheaper than a real CSS parser for a check that must not add a
 * dependency. Note the corollary for anyone extending this: a declaration
 * cannot be traced back to the `@media` query that scopes it.
 *
 * @param css - Stylesheet source
 * @returns Every rule, in source order
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

const DIALOG_RULES = parseRules(DIALOG_CSS)

/**
 * Every rule whose selector text is exactly `selector`.
 *
 * Exact-match, so `.dialog-btn-primary` cannot pick up
 * `.dialog-btn-primary:hover:not(:disabled)`.
 *
 * @param rules - Parsed stylesheet
 * @param selector - Selector text, verbatim as written in the file
 * @returns The matching rules, in source order (usually exactly one)
 */
function rulesFor(rules: ParsedRule[], selector: string): ParsedRule[] {
  return rules.filter((rule) => rule.selector === selector)
}

/**
 * The declaration block of the rule with exactly the given selector.
 *
 * Returns the LAST such rule, because that is the one the browser applies. The
 * `no duplicate rules` test below independently fails if there is more than
 * one — a duplicate is a real hazard here, since a later re-declaration of
 * `color` would win on screen while a first-match reader kept measuring the
 * earlier value and stayed green.
 *
 * @param selector - Selector text, verbatim as written in the file
 * @returns The rule body (declarations only, no braces)
 * @throws {Error} If no rule with that exact selector exists
 */
function ruleBody(selector: string): string {
  const matches = rulesFor(DIALOG_RULES, selector)
  if (matches.length === 0) {
    throw new Error(
      `No rule with selector "${selector}" found. If it was renamed, this ` +
        `contrast guard must be repointed, not deleted.`
    )
  }
  return matches[matches.length - 1].body
}

/**
 * Read one property's value out of a rule body.
 *
 * Returns the LAST declaration, matching the cascade within a block.
 *
 * @param body - Rule body from {@link ruleBody}
 * @param property - Property name, e.g. `color`
 * @returns The raw declared value, trimmed, or `null` when not declared
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
 * Read one property's value out of a rule body, requiring it to be present.
 *
 * @param body - Rule body from {@link ruleBody}
 * @param property - Property name, e.g. `color`
 * @returns The raw declared value, trimmed
 * @throws {Error} If the rule does not declare that property
 */
function declaredValue(body: string, property: string): string {
  const value = optionalValue(body, property)
  if (value === null) {
    throw new Error(`Rule does not declare "${property}". Body was: ${body.trim()}`)
  }
  return value
}

const tokens = collectCustomProperties(TOKENS_CSS, DIALOG_CSS)

/**
 * Resolve a possibly-nested `var(--x)` reference down to a literal value.
 *
 * @param value - Declared value, literal or a single `var()` reference
 * @param seen - Internal cycle guard
 * @returns The literal value at the end of the `var()` chain
 * @throws {Error} If a referenced property is undefined or the chain is cyclic
 */
function resolveVar(value: string, seen = new Set<string>()): string {
  const reference = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim())
  if (reference === null) return value.trim()

  const name = reference[1]
  if (seen.has(name)) {
    throw new Error(`Cyclic custom-property reference through ${name}`)
  }
  seen.add(name)

  const next = tokens.get(name)
  if (next === undefined) {
    throw new Error(`Custom property ${name} is referenced but never defined`)
  }
  return resolveVar(next, seen)
}

/**
 * The surface a dialog button sits on.
 *
 * `.dialog-btn-secondary` declares `background-color: transparent`, which is a
 * declared background with nothing to measure against. What shows through is
 * `.dialog-container`, so that is what the ratio is computed on. Read from the
 * stylesheet, not hardcoded, so restyling the container re-measures the button.
 */
const DIALOG_SURFACE = resolveVar(declaredValue(ruleBody('.dialog-container'), 'background-color'))

/**
 * Resolve a declared background to something measurable.
 *
 * @param declared - Raw `background-color` value from the stylesheet
 * @returns A colour literal
 */
function resolveBackground(declared: string): string {
  const resolved = resolveVar(declared)
  return resolved === 'transparent' ? DIALOG_SURFACE : resolved
}

/**
 * Parse a `#rgb` / `#rrggbb` colour into 8-bit channels.
 *
 * Deliberately narrow: every colour on this path is a brand hex. Anything else
 * throws rather than being silently approximated, so an unnoticed change of
 * colour format surfaces as a failure instead of a wrong ratio.
 *
 * @param color - CSS colour literal
 * @returns `[r, g, b]`, each 0–255
 * @throws {Error} If the colour is not a 3- or 6-digit hex literal
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
    `Unsupported colour literal "${color}". This guard understands #rgb and ` +
      `#rrggbb only; extend parseHexColor() rather than weakening the assertion.`
  )
}

/**
 * WCAG 2.x relative luminance of an sRGB colour.
 *
 * @param color - CSS hex colour literal
 * @returns Relative luminance, 0 (black) to 1 (white)
 *
 * @see https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
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
 * WCAG 2.x contrast ratio between two colours.
 *
 * Order-independent: the lighter colour is always the numerator.
 *
 * @param foreground - CSS hex colour literal
 * @param background - CSS hex colour literal
 * @returns Contrast ratio, 1 (identical) to 21 (black on white)
 *
 * @see https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/** One interactive state of a button variant. */
interface VariantState {
  /** Human-readable state name used in failure messages */
  state: string
  /** Selector text of the rule declaring this state's background */
  selector: string
}

/** A `.dialog-btn-*` variant and every state of it that declares a background. */
interface ButtonVariant {
  /** Base class selector, which is where `color` is declared */
  base: string
  /** Resting state first; every later state inherits the base foreground */
  states: VariantState[]
}

/**
 * The variants and states under test.
 *
 * Not the source of truth for what EXISTS — `covers every rule that declares a
 * background` cross-checks this list against the stylesheet, so a new state
 * cannot be added to `Dialog.css` without either being covered here or failing
 * the suite.
 */
const BUTTON_VARIANTS: ButtonVariant[] = [
  {
    base: '.dialog-btn-primary',
    states: [
      { state: 'resting', selector: '.dialog-btn-primary' },
      { state: 'hover', selector: '.dialog-btn-primary:hover:not(:disabled)' }
    ]
  },
  {
    base: '.dialog-btn-danger',
    states: [
      { state: 'resting', selector: '.dialog-btn-danger' },
      { state: 'hover', selector: '.dialog-btn-danger:hover:not(:disabled)' }
    ]
  },
  {
    base: '.dialog-btn-secondary',
    states: [
      { state: 'resting (transparent over the dialog surface)', selector: '.dialog-btn-secondary' },
      { state: 'hover', selector: '.dialog-btn-secondary:hover' }
    ]
  }
]

/** Every selector this guard reads a declaration from. */
const READ_SELECTORS = [
  '.dialog-container',
  ...BUTTON_VARIANTS.flatMap((variant) => [
    variant.base,
    ...variant.states.map((state) => state.selector)
  ])
]

/**
 * Build a failure message that names the tokens AND the resolved values, so a
 * red run says which token to look at rather than just printing a number.
 *
 * @param variant - Base selector of the variant
 * @param state - Human-readable state name, e.g. `hover`
 * @param foreground - Resolved foreground literal
 * @param background - Resolved background literal
 * @param ratio - Computed contrast ratio
 * @returns Assertion message
 */
function contrastMessage(
  variant: string,
  state: string,
  foreground: string,
  background: string,
  ratio: number
): string {
  return (
    `${variant} (${state}): foreground ${foreground} on background ` +
    `${background} = ${ratio.toFixed(2)}:1, but WCAG 1.4.3 AA requires ` +
    `>= ${WCAG_AA_NORMAL_TEXT}:1 for normal-size text. Fix the token values in ` +
    `design-tokens.css or the declarations in Dialog.css — do not lower this threshold.`
  )
}

describe('WCAG contrast: dialog buttons', () => {
  describe('formula sanity', () => {
    // Without these, a broken luminance implementation could return a large
    // number for everything and the suite below would pass while proving
    // nothing. The two endpoints are fixed by the spec.
    it('computes the WCAG reference extremes', () => {
      expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
      expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    })

    it('is order-independent', () => {
      expect(contrastRatio('#161312', '#a0a8ff')).toBeCloseTo(
        contrastRatio('#a0a8ff', '#161312'),
        10
      )
    })

    it('reproduces the known white-on-brand-violet failure the fix removed', () => {
      // The pre-#42 pairing, kept as a literal on purpose: it is the historical
      // defect, not a value read from the current stylesheet.
      expect(contrastRatio('#ffffff', '#A0A8FF')).toBeLessThan(WCAG_AA_NORMAL_TEXT)
    })

    it('reproduces the danger-button hover failure the fix removed', () => {
      // Likewise historical: white on the old lighter hover red.
      expect(contrastRatio('#ffffff', '#e03e18')).toBeLessThan(WCAG_AA_NORMAL_TEXT)
    })
  })

  describe('stylesheet shape', () => {
    // The parser above models a flat, single-:root cascade with no conditional
    // overrides. If that stops being true, "last declaration wins" is no longer
    // the right model and the ratios computed here could be read off values the
    // browser never applies.
    const SOURCES: Array<[string, string]> = [
      ['design-tokens.css', TOKENS_CSS],
      ['Dialog.css', DIALOG_CSS]
    ]

    it.each(SOURCES)('keeps %s free of @media overrides', (_name, css) => {
      expect(stripComments(css)).not.toMatch(/@media/)
    })

    it.each(SOURCES)('keeps %s free of @supports overrides', (_name, css) => {
      expect(stripComments(css)).not.toMatch(/@supports/)
    })

    it.each(SOURCES)('keeps %s free of [data-theme] overrides', (_name, css) => {
      expect(stripComments(css)).not.toMatch(/\[data-theme/)
    })

    it.each(SOURCES)('declares exactly one :root block in %s', (_name, css) => {
      // A second :root would re-declare tokens under a different condition,
      // and "last one wins" would stop describing what any given user sees.
      expect(stripComments(css).match(/:root\s*\{/g) ?? []).toHaveLength(1)
    })

    it.each(READ_SELECTORS)('declares the rule for %s exactly once', (selector) => {
      // A duplicate rule is invisible to a first-match reader but wins in the
      // browser, so a later re-declaration of `color` could silently break the
      // pairing this suite measures.
      expect(
        rulesFor(DIALOG_RULES, selector),
        `"${selector}" is declared more than once in Dialog.css. The later rule ` +
          `wins in the browser; collapse them into one so the measured pairing ` +
          `is the one that ships.`
      ).toHaveLength(1)
    })

    it('covers every rule that declares a background for a dialog-btn variant', () => {
      const variantRule = /\.dialog-btn-(?:primary|danger|secondary)\b/
      const declaresBackground = DIALOG_RULES.filter(
        (rule) =>
          variantRule.test(rule.selector) && optionalValue(rule.body, 'background-color') !== null
      ).map((rule) => rule.selector)

      const covered = BUTTON_VARIANTS.flatMap((variant) =>
        variant.states.map((state) => state.selector)
      )

      expect(
        [...new Set(declaresBackground)].sort(),
        'A .dialog-btn-* rule declares a background that no contrast assertion ' +
          'covers. Add it to BUTTON_VARIANTS rather than leaving it unmeasured.'
      ).toEqual([...new Set(covered)].sort())
    })

    it.each(
      BUTTON_VARIANTS.flatMap((variant) =>
        variant.states.map((state) => ({ base: variant.base, ...state }))
      )
    )('resolves $base ($state) to a hex background', ({ selector }) => {
      expect(resolveBackground(declaredValue(ruleBody(selector), 'background-color'))).toMatch(
        /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i
      )
    })

    it.each(BUTTON_VARIANTS)('resolves $base foreground to a hex literal', ({ base }) => {
      expect(resolveVar(declaredValue(ruleBody(base), 'color'))).toMatch(
        /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i
      )
    })
  })

  describe('WCAG 1.4.3 AA (4.5:1, normal text)', () => {
    for (const variant of BUTTON_VARIANTS) {
      describe(variant.base, () => {
        const foreground = resolveVar(declaredValue(ruleBody(variant.base), 'color'))

        for (const { state, selector } of variant.states) {
          it(`passes in the ${state} state`, () => {
            const background = resolveBackground(
              declaredValue(ruleBody(selector), 'background-color')
            )
            const ratio = contrastRatio(foreground, background)
            expect(
              ratio,
              contrastMessage(variant.base, state, foreground, background, ratio)
            ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
          })
        }

        it('declares `color` only on the base rule', () => {
          // Every non-resting assertion above pairs the BASE foreground with a
          // state background, which is only valid while no state rule restates
          // `color`. `:active` is covered the same way: it changes only
          // transform/box-shadow, so it keeps whichever background is current.
          const restating = variant.states
            .slice(1)
            .filter(({ selector }) => optionalValue(ruleBody(selector), 'color') !== null)

          expect(
            restating.map(({ selector }) => selector),
            'A state rule restates `color`, so pairing the base foreground with ' +
              'that state background no longer describes what ships. Measure the ' +
              'restated foreground instead.'
          ).toEqual([])
        })
      })
    }
  })
})
