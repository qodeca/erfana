// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Bounds on one parse (security review S-M; design §19 Rev 4 "Element cap").
 * Every hostile page is generated here, at test time, and each refusal must
 * come in bounded time – unbounded, these pages take parse5 from seconds to
 * minutes.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import { encodeText } from '../comments/encoding'
import { indexHtml } from './htmlIndex'
import { parseCommentFile } from './parse'
import {
  HtmlParseLimitError,
  PARSE_ELEMENT_SLACK,
  hasAttributeFlood,
  parseLimitsFor
} from './parseBounds'

/** Wall-clock budget for one refusal; the pages below take 6 s to minutes unbounded. */
const REFUSED_WITHIN_MS = 3_000

/** `<p>` then `distinct` open formatting elements, then `paragraphs` paragraphs that each re-open them all. */
function reconstructionBomb(distinct: number, paragraphs: number): string {
  let html = '<!doctype html><body><p>'
  for (let i = 0; i < distinct; i += 1) html += `<b a=${i}>`
  return html + '<p>x'.repeat(paragraphs)
}

/** One start tag with `count` attributes. */
function attributeFlood(count: number): string {
  let tag = '<a'
  for (let i = 0; i < count; i += 1) tag += ` a${i}`
  return `${tag}>`
}

/** `elapsed` ms and the error a call threw, if any. */
function timed(run: () => unknown): { elapsed: number; error: unknown } {
  const started = performance.now()
  try {
    run()
    return { elapsed: performance.now() - started, error: undefined }
  } catch (error) {
    return { elapsed: performance.now() - started, error }
  }
}

describe('the parse bounds (S-M)', () => {
  it('counts the elements the parser creates – 2 million from a 17 KB page of re-opened formatting – and stops at the cap', () => {
    const html = reconstructionBomb(1_000, 2_000)
    expect(html.length).toBeLessThan(20_000)
    // The work budget stops it first; without one, the element cap does.
    const bounded = timed(() => indexHtml(html))
    expect(bounded.error).toBeInstanceOf(HtmlParseLimitError)
    expect(bounded.elapsed).toBeLessThan(REFUSED_WITHIN_MS)
    const byElements = timed(() => indexHtml(html, { ...parseLimitsFor(html.length), maxWork: Infinity }))
    expect((byElements.error as HtmlParseLimitError).limit).toBe('elements')
    expect(byElements.elapsed).toBeLessThan(REFUSED_WITHIN_MS)
  })

  it('counts elements no start tag names: every stray </p> in a body builds a <p>', () => {
    const limits = parseLimitsFor(0, 1_000)
    expect(() => indexHtml(`<body>${'</p>'.repeat(1_001)}`, { ...limits, maxWork: Infinity })).toThrow(HtmlParseLimitError)
    // Only the explicit <body> is indexed: the built <p>s have no start tag.
    expect(indexHtml(`<body>${'</p>'.repeat(900)}`, { ...limits, maxWork: Infinity }).elements).toHaveLength(1)
  })

  it('stops a parse whose work outgrows the page: 100,000 unclosed <div> (minutes unbounded)', () => {
    const { elapsed, error } = timed(() => indexHtml(`<body>${'<div>'.repeat(100_000)}`))
    expect((error as HtmlParseLimitError).limit).toBe('work')
    expect(elapsed).toBeLessThan(REFUSED_WITHIN_MS)
  })

  it('stops it for 20,000 unclosed distinct formatting elements (11 s unbounded)', () => {
    let html = '<body>'
    for (let i = 0; i < 20_000; i += 1) html += `<b a=${i}>`
    const { elapsed, error } = timed(() => indexHtml(html))
    expect((error as HtmlParseLimitError).limit).toBe('work')
    expect(elapsed).toBeLessThan(REFUSED_WITHIN_MS)
  })

  it('lets a page nested as deep as a browser nests (512) parse, and any real page well inside the budget', () => {
    let block = ''
    for (let depth = 0; depth < 512; depth += 1) block += `<div class="c${depth}">`
    block += '<span>leaf</span><p>para <b>x</b></p>'
    block += '</div>'.repeat(512)
    expect(indexHtml(`<body>${block.repeat(20)}`).elements.length).toBeGreaterThan(512 * 20)
  })

  it('leaves room past the token cap for elements a page builds without a start tag', () => {
    expect(parseLimitsFor(10).maxElements).toBe(PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT + PARSE_ELEMENT_SLACK)
  })
})

describe('hasAttributeFlood (S-M)', () => {
  const bytes = (text: string): Uint8Array => encodeText(text)

  it('refuses a start tag with more attributes than the cap, before any parse', () => {
    const cap = PREVIEW_LIMITS.COMMENT_MAX_ATTRIBUTES_PER_TAG
    expect(hasAttributeFlood(bytes(attributeFlood(cap)))).toBe(false)
    expect(hasAttributeFlood(bytes(attributeFlood(cap + 1)))).toBe(true)
    // 40,000 attributes take the tokenizer 6.5 s; the scan answers at once.
    const { elapsed, error } = timed(() => expect(hasAttributeFlood(bytes(attributeFlood(40_000)))).toBe(true))
    expect(error).toBeUndefined()
    expect(elapsed).toBeLessThan(REFUSED_WITHIN_MS)
  })

  it('refuses many tags each under the cap whose comparisons add up past the page budget', () => {
    // 2,000 tags of 1,000 attributes: about a billion comparisons in 11 MB.
    const page = `${attributeFlood(1_000)}</a>`.repeat(2_000)
    const { elapsed } = timed(() => expect(hasAttributeFlood(bytes(page))).toBe(true))
    expect(elapsed).toBeLessThan(REFUSED_WITHIN_MS)
  })

  it('reads tags as the tokenizer does: values, quotes, `>` inside quotes, self-closing slashes', () => {
    expect(hasAttributeFlood(bytes('<a href="x>y" title=\'a b\' data-x=1 hidden/>'), 4)).toBe(false)
    expect(hasAttributeFlood(bytes('<a href="x>y" title=\'a b\' data-x=1 hidden/>'), 3)).toBe(true)
    // Not a tag: `< a`, `<1`, a lone `<` at the end.
    expect(hasAttributeFlood(bytes(`< a${' b'.repeat(10)}> <1${' c'.repeat(10)}> <`), 2)).toBe(false)
    // An unclosed quote runs to the end of the file, as it does for the tokenizer.
    expect(hasAttributeFlood(bytes(`<a b="${' c'.repeat(10)}`), 2)).toBe(false)
  })

  it('a real page is not a flood, and parses', () => {
    const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head>' +
      '<body><svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="red" stroke-width="2"><path d="M0 0L10 10"/></svg>' +
      '<button id="b" class="cta" type="button" aria-label="Buy" data-x="1" data-y="2" disabled>Buy</button></body></html>'
    expect(hasAttributeFlood(bytes(page))).toBe(false)
    expect(parseCommentFile(bytes(page))).toMatchObject({ ok: true })
  })
})

describe('a page past a bound is "page too large", read-only', () => {
  it('parseCommentFile refuses the generated pages as too-large, each in bounded time', () => {
    for (const page of [reconstructionBomb(1_000, 2_000), `<body>${'<div>'.repeat(100_000)}`, attributeFlood(40_000)]) {
      const { elapsed } = timed(() =>
        expect(parseCommentFile(encodeText(page))).toMatchObject({ ok: false, reason: 'too-large', state: { writable: false, readOnlyReason: 'too-large' } })
      )
      expect(elapsed).toBeLessThan(REFUSED_WITHIN_MS)
    }
  })
})
