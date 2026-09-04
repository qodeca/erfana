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
