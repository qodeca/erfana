// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Backup-tier tables (docs/designs/html-preview-comments.md §5.9 steps 2–4).
 * The tables replaced a scan of every element per block; they must answer
 * exactly what that scan answered, which is kept here as the reference, and a
 * quote budget that runs out must leave blocks orphaned – never attached by a
 * half-built table.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PROPERTY_TIMEOUT_MS, documentArb, fcParams } from './__fixtures__/arbitraries'
import { elementOf } from './__fixtures__/commentTestData'
import { buildAnchor, findAnchorTarget, type TargetResolution, type TargetVia } from './anchor'
import { AnchorLookup, QUOTE_READ_BUDGET, anchorLookupOf } from './anchorLookup'
import type { CommentAnchor, TextQuote } from './format'
import { indexHtml, type HtmlIndex, type IndexedElement } from './htmlIndex'
import { exactOf, prefixOf, suffixOf } from './quoteText'

// --- the reference: the per-block scan the tables replaced ---

function only<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined
}

function attachedAt(el: IndexedElement, via: TargetVia): TargetResolution {
  return { state: 'attached', startOffset: el.start, via }
}

function scanQuote(index: HtmlIndex, tag: string, quote: TextQuote): IndexedElement | undefined {
  const sameTag = index.elements.filter(el => el.tag === tag)
  const exact = sameTag.filter(el => exactOf(index, el) === quote.exact)
  if (exact.length === 1) return exact[0]
  if (!quote.prefix && !quote.suffix) return undefined
  const pool = exact.length > 1 ? exact : sameTag
  return only(
    pool.filter(el => prefixOf(index, el) === quote.prefix && suffixOf(index, el) === quote.suffix)
  )
}

function scanTarget(index: HtmlIndex, anchor: CommentAnchor): TargetResolution {
  if (anchor.id) {
    const el = only(index.elements.filter(c => c.id === anchor.id && c.tag === anchor.tag))
    if (el) return attachedAt(el, 'id')
  }
  if (anchor.path) {
    const paths = new Map(index.elements.map(el => [index.pathOf(el.node), el]))
    const el = paths.get(anchor.path)
    if (el && el.tag === anchor.tag) return attachedAt(el, 'path')
  }
  const el = anchor.quote && scanQuote(index, anchor.tag, anchor.quote)
  return el ? attachedAt(el, 'quote') : { state: 'orphaned' }
}

// --- anchors that hit, miss and collide, built from the document's own elements ---

/** One anchor: each part taken from a picked element, or bent so it misses or collides. */
const anchorRecipe = fc.record({
  of: fc.nat(),
  other: fc.nat(),
  tag: fc.constantFrom('own', 'other'),
  id: fc.constantFrom('own', 'other', 'missing', 'none'),
  path: fc.constantFrom('own', 'other', 'shifted', 'none'),
  quote: fc.constantFrom('own', 'other', 'changed', 'exact-only', 'context-only', 'none')
})

type Recipe = typeof anchorRecipe extends fc.Arbitrary<infer T> ? T : never

function quoteFor(recipe: Recipe, own?: TextQuote, other?: TextQuote): TextQuote | undefined {
  switch (recipe.quote) {
    case 'own':
      return own
    case 'other':
      return other
    case 'changed':
      return own && { ...own, exact: `${own.exact} (edited)` }
    case 'exact-only':
      return own && { ...own, prefix: '', suffix: '' }
    case 'context-only':
      return own && { ...own, exact: 'text that is gone' }
    default:
      return undefined
  }
}

function anchorFrom(index: HtmlIndex, recipe: Recipe): CommentAnchor {
  const own = buildAnchor(index, index.elements[recipe.of % index.elements.length])
  const other = buildAnchor(index, index.elements[recipe.other % index.elements.length])
  const id = { own: own.id, other: other.id, missing: 'no-such-id', none: undefined }[recipe.id]
  const shifted = own.path.replace(/\((\d+)\)$/, (_, n: string) => `(${Number(n) + 1})`)
  const path = { own: own.path, other: other.path, shifted, none: '' }[recipe.path]
  const quote = quoteFor(recipe, own.quote, other.quote)
  return {
    tag: recipe.tag === 'own' ? own.tag : other.tag,
    path,
    ...(id ? { id } : {}),
    ...(quote ? { quote } : {})
  }
}

describe('the tables answer what the scan answered', () => {
  it(
    'findAnchorTarget equals the per-block scan for anchors that hit, miss and collide',
    () => {
      fc.assert(
        fc.property(
          documentArb,
          fc.array(anchorRecipe, { minLength: 1, maxLength: 12 }),
          ({ text }, recipes) => {
            const index = indexHtml(text)
            if (index.elements.length === 0) return
            // One index for every anchor, so later lookups also read the tables earlier ones built.
            for (const recipe of recipes) {
              const anchor = anchorFrom(index, recipe)
              expect(findAnchorTarget(index, anchor)).toEqual(scanTarget(index, anchor))
            }
          }
        ),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )
})

describe('step 2 – id within a tag', () => {
  const index = indexHtml(
    '<i id="a">1</i><b id="a">2</b><b id="a">3</b><u id="c">4</u><u>5</u><s id="">6</s>'
  )
  const lookup = new AnchorLookup(index)

  it('finds the one element with the tag and id, ignoring the same id on other tags', () => {
    expect(lookup.byId('i', 'a')).toBe(elementOf(index, 'i'))
    expect(lookup.byId('u', 'c')).toBe(elementOf(index, 'u'))
  })

  it('answers nothing for two candidates, a missing id or a tag with no such element', () => {
    expect(lookup.byId('b', 'a')).toBeUndefined()
    expect(lookup.byId('u', 'a')).toBeUndefined()
    expect(lookup.byId('nav', 'a')).toBeUndefined()
  })

  it('keeps an empty id apart from no id', () => {
    expect(lookup.byId('s', '')).toBe(elementOf(index, 's'))
  })
})

describe('step 4 – quote within a tag', () => {
  // Filler longer than the context on both sides gives the last two twins the same context.
  const pad = '<p>same words to fill the context on both sides</p>'
  const index = indexHtml(
    `<p>Intro</p><b>Alpha</b><p>Middle</p><b>Twin</b>${pad}<b>Twin</b>${pad}<b>Twin</b>${pad}`
  )
  const [alpha, firstTwin, secondTwin, thirdTwin] = [0, 1, 2, 3].map(n => elementOf(index, 'b', n))
  const contextOf = (el: IndexedElement) => ({
    prefix: prefixOf(index, el),
    suffix: suffixOf(index, el)
  })

  it('finds a unique exact quote without the context', () => {
    const lookup = new AnchorLookup(index)
    expect(lookup.byQuote('b', { exact: 'Alpha', prefix: '', suffix: '' })).toBe(alpha)
    expect(lookup.byQuote('i', { exact: 'Alpha', prefix: '', suffix: '' })).toBeUndefined()
  })

  it('tells several exact matches apart by their context – among those matches only – or not at all', () => {
    const lookup = new AnchorLookup(index)
    expect(lookup.byQuote('b', { exact: 'Twin', ...contextOf(firstTwin) })).toBe(firstTwin)
    expect(lookup.byQuote('b', { exact: 'Twin', prefix: '', suffix: '' })).toBeUndefined()
    expect(contextOf(secondTwin)).toEqual(contextOf(thirdTwin))
    expect(lookup.byQuote('b', { exact: 'Twin', ...contextOf(secondTwin) })).toBeUndefined()
    // The context of an element whose exact quote differs is no match among the twins.
    expect(lookup.byQuote('b', { exact: 'Twin', ...contextOf(alpha) })).toBeUndefined()
  })

  it('falls back to the context among every element of the tag when no exact quote matches', () => {
    const lookup = new AnchorLookup(index)
    expect(lookup.byQuote('b', { exact: 'Changed', ...contextOf(firstTwin) })).toBe(firstTwin)
    expect(lookup.byQuote('b', { exact: 'Changed', ...contextOf(alpha) })).toBe(alpha)
    expect(lookup.byQuote('b', { exact: 'Changed', ...contextOf(thirdTwin) })).toBeUndefined()
    expect(lookup.byQuote('b', { exact: 'Changed', prefix: 'no', suffix: 'match' })).toBeUndefined()
  })
})

describe('the quote budget', () => {
  const html =
    '<p id="x">first paragraph</p><b>bold words</b><i>italic words</i><i>italic words</i>'
  const index = indexHtml(html)
  const charsFor = (tag: string) =>
    index.elements
      .filter(el => el.tag === tag)
      .reduce((sum, el) => sum + (el.textEnd - el.textStart), 0)

  it('answers nothing once a table cannot be finished, and never throws', () => {
    const lookup = new AnchorLookup(index, 3)
    expect(lookup.byQuote('p', { exact: 'first paragraph', prefix: '', suffix: '' })).toBeUndefined()
    expect(lookup.budgetSpent).toBe(true)
    // Nothing new is read after it ran out, however short the text.
    expect(lookup.byQuote('b', { exact: 'bold words', prefix: '', suffix: '' })).toBeUndefined()
    // The id tier reads no quotes and still answers.
    expect(lookup.byId('p', 'x')).toBe(elementOf(index, 'p'))
  })

  it('keeps answering from a table finished before it ran out', () => {
    // Enough for every <b> exact quote, not for the <i> ones after it.
    const lookup = new AnchorLookup(index, charsFor('b') + 1)
    expect(lookup.byQuote('b', { exact: 'bold words', prefix: '', suffix: '' })).toBe(
      elementOf(index, 'b')
    )
    expect(lookup.byQuote('i', { exact: 'italic words', prefix: 'x', suffix: '' })).toBeUndefined()
    expect(lookup.budgetSpent).toBe(true)
    expect(lookup.byQuote('b', { exact: 'bold words', prefix: '', suffix: '' })).toBe(
      elementOf(index, 'b')
    )
  })

  it('never uses a context table it could not finish', () => {
    // Enough for the <i> exact quotes, not for their context.
    const lookup = new AnchorLookup(index, charsFor('i') + 1)
    const second = elementOf(index, 'i', 1)
    const quote = { exact: 'italic words', prefix: prefixOf(index, second), suffix: '' }
    expect(lookup.byQuote('i', quote)).toBeUndefined()
    expect(lookup.budgetSpent).toBe(true)
    expect(new AnchorLookup(index).byQuote('i', quote)).toBe(second)
  })

  it('starts every parse with the full budget', () => {
    expect(QUOTE_READ_BUDGET).toBeGreaterThan(0)
    expect(new AnchorLookup(index).budgetSpent).toBe(false)
  })
})

describe('one lookup per parse', () => {
  it('shares the tables of an index and never across indexes', () => {
    const first = indexHtml('<p>x</p>')
    const second = indexHtml('<p>x</p>')
    expect(anchorLookupOf(first)).toBe(anchorLookupOf(first))
    expect(anchorLookupOf(first)).not.toBe(anchorLookupOf(second))
    expect(anchorLookupOf(first).budgetSpent).toBe(false)
  })
})
