// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every design token this panel's stylesheet references must exist.
 *
 * THE BUG THIS EXISTS FOR. `.html-preview-chrome-strip` shipped with
 * `border-bottom: 1px solid var(--color-border)` — a custom property defined
 * nowhere. The real tokens are `--color-border-default` / `-subtle` / `-focus` /
 * `-warning`.
 *
 * That typo is SILENT and total. An undefined custom property inside a shorthand
 * makes the whole declaration invalid at computed-value time, so every longhand
 * falls back to its initial value — and `border-bottom-style`'s initial value is
 * `none`. Not a wrong colour: no border at all.
 *
 * It mattered here more than a missing line usually would. That border was the
 * seam between Erfana's own chrome and an untrusted page which picks its own
 * paper colour (`previewBackdrop.ts`) and stays on screen while Erfana asks a
 * security question. With the border gone the boundary was carried only by a
 * background colour the page can simply match.
 *
 * The strip itself is gone — `PreviewChromeBand` replaced it, and the band's
 * bottom rule is now a 1px neutral one by owner decision (`docs/security.md`
 * residual risk 8). The typo class has not gone anywhere, so the assertion
 * follows the live rule into `PreviewChromeBand.css` rather than retiring with
 * the element it was written for.
 *
 * Nothing catches this class of fault: not the type-checker, not ESLint, not a
 * rendering test in jsdom (which resolves no custom properties). Only reading
 * the shipping stylesheet against the shipping tokens does — the same approach
 * `Dialog.contrast.test.ts` takes.
 *
 * @see HtmlPreviewPanel.css
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_CSS = readFileSync(resolve(__dirname, 'HtmlPreviewPanel.css'), 'utf8')
const BAND_CSS = readFileSync(
  resolve(__dirname, 'components/PreviewChromeBand.css'),
  'utf8'
)
const TOKENS_CSS = readFileSync(
  resolve(__dirname, '../../../styles/design-tokens.css'),
  'utf8'
)

/**
 * The stylesheet with its comments removed.
 *
 * Needed because these files explain themselves at length, and the comment on
 * the strip's border quotes the very token that was missing. A token named in
 * prose is not a reference, and scanning it as one made this test fail on its
 * own explanation.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Every custom property the stylesheet READS, with its fallback stripped.
 *
 * `var(--a, var(--b))` yields both names; a literal fallback (`var(--a, 32px)`)
 * yields only `--a`, which is correct — a declared fallback is a deliberate
 * default, not a missing token.
 */
function referencedTokens(css: string): string[] {
  return [...withoutComments(css).matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])
}

/** Every custom property the token sheet DEFINES. */
function definedTokens(css: string): Set<string> {
  return new Set(
    [...withoutComments(css).matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1])
  )
}

describe('HtmlPreviewPanel.css token references', () => {
  it('references only tokens that exist', () => {
    const defined = definedTokens(TOKENS_CSS)
    // The panel defines a few of its own properties inline (e.g. the band height
    // it publishes for the find bar); those count as defined too.
    for (const own of definedTokens(PANEL_CSS)) {
      defined.add(own)
    }

    const referenced = [...new Set(referencedTokens(PANEL_CSS))]
    // Guard the guard. `missing` is empty both when every token resolves AND
    // when the scan found nothing at all — a changed `var(...)` shape, a moved
    // file, an over-eager comment stripper. Without this the check could pass
    // forever while reading nothing.
    expect(referenced.length).toBeGreaterThan(5)
    expect(defined.size).toBeGreaterThan(20)

    const missing = referenced.filter((token) => !defined.has(token)).sort()

    expect(missing).toEqual([])
  })

  it('paints a bottom border under the preview toolbar', () => {
    // A line that can PAINT is the point, and that is all this asserts: a style
    // and a colour token that resolves. It deliberately does not assert the
    // width or the colour — those went from a 2px accent to a 1px neutral by
    // decision, and a test that pinned them would have read as a regression.
    const rule = BAND_CSS.slice(
      BAND_CSS.indexOf('.erf-band {'),
      BAND_CSS.indexOf('}', BAND_CSS.indexOf('.erf-band {'))
    )
    const border = /border-bottom:\s*([^;]+);/.exec(rule)?.[1]

    expect(border).toBeDefined()
    expect(border).toMatch(/solid/)

    const colours = referencedTokens(border ?? '')
    expect(colours.length).toBeGreaterThan(0)
    for (const colour of colours) {
      expect(definedTokens(TOKENS_CSS).has(colour)).toBe(true)
    }
  })
})

/* ---------- the disabled dim must never reach the focus ring ---------- */

/** One CSS rule: its selector list and its declarations. */
interface CssRule {
  /** The whole selector list, whitespace collapsed. */
  readonly selector: string
  /** The declarations between the braces. */
  readonly body: string
}

/**
 * Every rule in a stylesheet, comments stripped.
 *
 * The pattern matches INNERMOST brace pairs, so a rule nested in `@media` or
 * `@container` is returned as itself and the at-rule never appears as a
 * selector — no nesting parser needed for what these files contain.
 */
function cssRules(css: string): CssRule[] {
  return [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }))
    .filter((rule) => !rule.selector.startsWith('@'))
}

/** The `opacity` this rule sets, if it sets one. */
function opacityOf(rule: CssRule): string | undefined {
  return /(?:^|;)\s*opacity:\s*([^;]+)/.exec(rule.body)?.[1].trim()
}

/**
 * True when `[aria-disabled]` sits on the LAST compound of a selector — i.e. the
 * rule styles the control itself, the element that draws the focus outline.
 * `…[aria-disabled='true'] > *` fails this, which is the point: that one styles
 * the content instead.
 */
function targetsTheControlItself(selectorPart: string): boolean {
  return /\[aria-disabled[^\]]*\](?:\s*:[a-z-]+(?:\([^)]*\))?)*$/.test(selectorPart)
}

/** Selector parts, one per comma. */
function parts(selector: string): string[] {
  return selector.split(',').map((part) => part.trim())
}

/** A selector part with its trailing pseudo-classes removed. */
function withoutPseudos(selectorPart: string): string {
  return selectorPart.replace(/(?:\s*:[a-z-]+(?:\([^)]*\))?)*$/, '')
}

describe('a dimmed control keeps a full-strength focus ring', () => {
  /**
   * THE BUG THIS EXISTS FOR (issue #124, UX audit U2).
   *
   * `opacity` on an `aria-disabled` button dims the button's own `:focus-visible`
   * outline with it: the property makes a group, and the outline is inside it.
   * `--color-border-focus` is 8.4:1 on the band's surface and about 2.35:1 once
   * composited at `--opacity-disabled` — under the 3:1 SC 1.4.11 asks of a focus
   * indicator, and under "visible" (SC 2.4.7). No ring colour repairs it, because
   * the dim is applied after the colour.
   *
   * It is not an edge case: the panel deliberately moves focus to Back after a
   * banner-started move and after a move closes a focused find bar
   * (`hooks/usePreviewNavigation.ts`), which is exactly when Back has nowhere to
   * go and is `aria-disabled`. The same rule dimmed the ring on BUSY controls —
   * Open in default browser, the band's Confirm, the banner's return button —
   * which are not inactive components and get no disabled-state exception at all.
   *
   * So the dim must sit somewhere the ring is not: on the content (the tools dim
   * their icon), or off entirely while the control is focused (the two buttons
   * whose whole content is a bare text node, which has no box to dim).
   *
   * Nothing else catches this. jsdom resolves no custom properties and composites
   * no opacity, so a rendering test sees a ring either way; only reading the
   * shipping rules does.
   */
  const SHEETS: ReadonlyArray<readonly [string, string]> = [
    ['PreviewChromeBand.css', BAND_CSS],
    ['HtmlPreviewPanel.css', PANEL_CSS]
  ]

  it.each(SHEETS)('%s dims no control that draws its own ring', (_name, css) => {
    const rules = cssRules(css)

    // Guard the guard: an empty scan passes every assertion below. These two
    // sheets carry the app's `aria-disabled` controls, and if they stop doing so
    // this test has to be revisited rather than quietly succeed.
    expect(rules.filter((rule) => rule.selector.includes('aria-disabled')).length).toBeGreaterThan(
      1
    )

    const offenders: string[] = []
    for (const rule of rules) {
      const opacity = opacityOf(rule)
      if (opacity === undefined || opacity === '1') continue
      for (const part of parts(rule.selector)) {
        if (!part.includes('aria-disabled')) continue
        if (!targetsTheControlItself(part)) continue

        // One escape, and only one: the same control, undimmed while focused.
        const restored = rules.some(
          (other) =>
            opacityOf(other) === '1' &&
            parts(other.selector).some(
              (candidate) =>
                candidate.includes(':focus-visible') &&
                withoutPseudos(candidate) === withoutPseudos(part)
            )
        )
        if (!restored) offenders.push(`${part} { opacity: ${opacity} }`)
      }
    }

    expect(
      offenders,
      'These rules dim the element that draws the focus ring, which takes the ring ' +
        'under 3:1 (WCAG 1.4.11). Dim the content instead, or restore opacity: 1 on ' +
        ':focus-visible. See design/system/components/permission-band/index.html.'
    ).toEqual([])
  })

  it.each([
    ['a band tool, on its icon', BAND_CSS, ".erf-band__tool[aria-disabled='true'] > *"],
    ['the busy Confirm, on its label', BAND_CSS, ".erf-band__allow[aria-disabled='true'] > *"],
    ['a busy banner button, on its label', PANEL_CSS, ".html-preview-banner-button[aria-disabled='true'] > *"]
  ] as const)('still dims %s', (_what, css, selector) => {
    // The other way to pass the check above is to delete the dim, which would
    // leave the state carried by a tooltip or a label alone. Each of these rules
    // needs an ELEMENT child: the icon, or the span the component wraps the
    // label in (pinned by PreviewBanner.test.tsx / PreviewBandConfirm.test.tsx).
    const rule = cssRules(css).find((candidate) => parts(candidate.selector).includes(selector))

    expect(rule, `${selector} must still dim the content`).toBeDefined()
    expect(opacityOf(rule as CssRule)).toBe('var(--opacity-disabled)')
  })

  it('keeps the ring itself on the focus token', () => {
    // If the ring stopped being --color-border-focus the measured claim on the
    // permission-band card (contrast-focus-ring-on-band) would describe nothing.
    const focusRules = [...cssRules(BAND_CSS), ...cssRules(PANEL_CSS)].filter(
      (rule) => rule.selector.includes(':focus-visible') && /outline:/.test(rule.body)
    )

    expect(focusRules.length).toBeGreaterThan(2)
    for (const rule of focusRules) {
      expect(rule.body, `${rule.selector} must draw the ring with the focus token`).toMatch(
        /outline:[^;]*var\(--color-border-focus\)/
      )
    }
  })
})

/* ---------- an inset ring must not match the fill it is drawn on ---------- */

/** The literal a custom property resolves to, following `var()` chains. */
function resolveToken(name: string, css: string, seen = new Set<string>()): string | undefined {
  if (seen.has(name)) return undefined
  seen.add(name)
  const value = new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm').exec(withoutComments(css))?.[1]
  const next = value === undefined ? undefined : /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim())
  return next ? resolveToken(next[1], css, seen) : value?.trim().toLowerCase()
}

/** True for an `outline-offset` that pulls the ring inside the border box. */
function isInsetOffset(value: string): boolean {
  return /^-|\*\s*-\s*1\b/.test(value.trim())
}

describe('a focus ring is never drawn in the colour of the fill under it', () => {
  /**
   * THE BUG THIS EXISTS FOR (issue #124, follow-up to UX audit U2).
   *
   * The band draws its rings INSIDE a control (negative `outline-offset`), so an
   * inset ring paints on top of that control's own background. The confirm
   * step's Confirm is filled with `--color-accent-primary`, and
   * `--color-border-focus` resolves to the very same brand violet: its ring was
   * violet on violet, 1:1 — invisible on the most irreversible control in the
   * app. Nothing flagged it, because each token is correct on its own.
   *
   * So: for every rule that paints a background token, find the focus ring that
   * applies to the same element — the LAST `:focus-visible` rule whose base
   * selector that rule's selector starts with, which is how equal-specificity
   * rules resolve in these flat stylesheets — and if that ring is inset, its
   * colour must not resolve to the fill's. An outward ring lands on the parent's
   * surface instead and is out of scope here.
   */
  it.each([
    ['PreviewChromeBand.css', BAND_CSS],
    ['HtmlPreviewPanel.css', PANEL_CSS]
  ] as const)('%s draws no inset ring on a same-colour fill', (_name, css) => {
    const rules = cssRules(css)
    const rings = rules.flatMap((rule) =>
      parts(rule.selector)
        .filter((part) => part.endsWith(':focus-visible'))
        .map((part) => ({ base: withoutPseudos(part), rule }))
    )
    // Guard the guard: with no ring rules found, every check below passes on
    // nothing. The band also has to find fills that a ring applies to (below).
    expect(rings.length).toBeGreaterThan(0)

    const offenders: string[] = []
    let filled = 0
    for (const rule of rules) {
      const fill = /(?:^|;)\s*background(?:-color)?:\s*var\((--[\w-]+)\)/.exec(rule.body)?.[1]
      if (fill === undefined) continue
      for (const part of parts(rule.selector)) {
        const ring = rings.filter((candidate) => part.startsWith(candidate.base)).at(-1)
        if (ring === undefined) continue
        filled += 1
        // The offset may come from an earlier, broader ring rule; the last rule
        // that STATES one wins.
        const offset = rings
          .filter((candidate) => part.startsWith(candidate.base))
          .map((candidate) => /outline-offset:\s*([^;]+)/.exec(candidate.rule.body)?.[1])
          .filter((value): value is string => value !== undefined)
          .at(-1)
        const colour = rings
          .filter((candidate) => part.startsWith(candidate.base))
          .map((candidate) => /outline:[^;]*var\((--[\w-]+)\)/.exec(candidate.rule.body)?.[1])
          .filter((value): value is string => value !== undefined)
          .at(-1)
        if (offset === undefined || colour === undefined || !isInsetOffset(offset)) continue
        const ringHex = resolveToken(colour, TOKENS_CSS)
        const fillHex = resolveToken(fill, TOKENS_CSS)
        if (ringHex !== undefined && ringHex === fillHex) {
          offenders.push(`${part}: inset ${colour} on ${fill} (both ${ringHex})`)
        }
      }
    }

    if (css === BAND_CSS) expect(filled).toBeGreaterThan(2)
    expect(
      offenders,
      'An inset focus ring is drawn on top of the fill and is invisible in the same ' +
        'colour. Move that variant\'s ring outward (see .erf-band__allow--primary).'
    ).toEqual([])
  })

  it('resolves the two tokens that collided, so the check above can see a collision', () => {
    // If these ever stop being equal the check still works — but this is the
    // evidence it was written against, and it keeps the resolver honest.
    expect(resolveToken('--color-border-focus', TOKENS_CSS)).toBe(
      resolveToken('--color-accent-primary', TOKENS_CSS)
    )
    expect(resolveToken('--color-border-focus', TOKENS_CSS)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('draws the page placeholder ring outside the box the native view covers', () => {
    // The native page view is laid over exactly the placeholder's box and paints
    // above all DOM in it, so a ring drawn on or inside that box is invisible
    // while the page runs (issue #124, QG-8 U1). Outward at offset >= 0 is the
    // only shape with a visible edge: the top one, over the band's bottom rule.
    const rule = cssRules(PANEL_CSS).find(
      (candidate) => candidate.selector === '.html-preview-placeholder:focus-visible'
    )
    const offset = rule === undefined ? undefined : /outline-offset:\s*([^;]+)/.exec(rule.body)?.[1]

    expect(rule, 'the placeholder needs its own :focus-visible ring').toBeDefined()
    expect(rule?.body).toMatch(/outline:[^;]*var\(--color-border-focus\)/)
    expect(offset, 'state the offset: the UA default is not guaranteed outward').toBeDefined()
    expect(isInsetOffset(offset ?? '-')).toBe(false)
    // A stacking context or clip on the ancestors would hide the last visible edge.
    for (const ancestor of ['.html-preview-page-area', '.html-preview-surface']) {
      const body = cssRules(PANEL_CSS).find((candidate) => candidate.selector === ancestor)?.body
      expect(body, `${ancestor} must exist`).toBeDefined()
      expect(body, `${ancestor} must not clip the placeholder ring`).not.toMatch(
        /overflow|z-index|contain:|isolation|transform|opacity|filter/
      )
    }
  })

  it('draws the filled Confirm ring outward', () => {
    const rule = cssRules(BAND_CSS).find(
      (candidate) => candidate.selector === '.erf-band__allow--primary:focus-visible'
    )
    const offset = rule === undefined ? undefined : /outline-offset:\s*([^;]+)/.exec(rule.body)?.[1]

    expect(offset, 'the primary variant needs its own, outward, outline-offset').toBeDefined()
    expect(isInsetOffset(offset ?? '-')).toBe(false)
  })
})
