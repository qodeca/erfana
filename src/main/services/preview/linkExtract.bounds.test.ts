// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The link extractor stays bounded on hostile pages (issue #124, security
 * audit). It runs on the main thread at every preview load. Each payload is
 * built at test time and goes through the real entry points. Measured on the
 * emulated Windows box before the fix, through `extractStaticLinks`:
 *
 *   - formatting blow-up – `<p>`, 400 distinct unclosed `<b a=N>`, then `<p>x`
 *     blocks: 5,000 blocks (23 KB, 5,402 start tags) built 2,005,405 elements
 *     in 520 ms, and the audit's 20,000 blocks (83 KB) exhausted 2 GB;
 *   - one tag of 10,000 / 20,000 / 40,000 attributes: 0.4 / 1.4 / 6.6 s;
 *   - 40,000 unmatched end tags under 20,000 open `<b>` (220 KB): 10.4 s;
 *   - 160 KB of CSS `url(`: 6.2 s; a `srcset` URL of `x`, 80,000 commas, `y,`: 2.9 s.
 *
 * Now the scan reports one element per start tag – counted, so that bound is
 * exact – and keeps at most `MAX_ATTRIBUTES_PER_TAG` per tag. The wall-clock
 * ceiling is a backstop: every payload takes milliseconds.
 */
import { describe, expect, it, vi } from 'vitest'
import { MAX_ATTRIBUTES_PER_TAG, scanHtmlElements } from './htmlElementScan'
import { extractFrameSources, extractStaticLinks } from './linkExtract'

/** Far above the fixed extractor's milliseconds, far below the seconds it took before. */
const SCAN_BUDGET_MS = 3_000

/** The audit's page: 400 distinct open formatting tags, re-created in each of 20,000 blocks. */
const FORMATTING_TAGS = 400
const FORMATTING_BLOCKS = 20_000
/** Six seconds and more before the fix. */
const ATTRIBUTE_FLOOD = 40_000
/** 20,000 open `<b>`, then 40,000 end tags that match nothing: 10.4 s before the fix. */
const OPEN_TAGS = 20_000
const UNMATCHED_END_TAGS = 40_000
/** 400 KB of `url(`, some 40 s for the former regex. */
const URL_OPENINGS = 100_000
/** A `srcset` URL with 200,000 commas inside, some 18 s for the former regex. */
const SRCSET_COMMAS = 200_000

const TAIL = '<img src="tail.png">'

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now()
  const value = run()
  return { value, ms: performance.now() - start }
}

function elementCount(markup: string): number {
  let count = 0
  scanHtmlElements(markup, () => {
    count += 1
  })
  return count
}

function formattingBlowup(): string {
  let markup = '<p>'
  for (let index = 0; index < FORMATTING_TAGS; index += 1) markup += `<b a=${index}>`
  return `${markup}${'<p>x'.repeat(FORMATTING_BLOCKS)}${TAIL}`
}

/** `<img>` with `src`, `count` junk attributes, then a `srcset` past the cap. */
function attributeFlood(count: number): string {
  let tag = '<img src="kept.png"'
  for (let index = 0; index < count; index += 1) tag += ` a${index}`
  return `<link rel="stylesheet" href="before.css">${tag} srcset="dropped.png 2x"><script src="after.js"></script>`
}

describe('extractStaticLinks – bounded on hostile pages (issue #124 audit)', () => {
  it('builds no tree from the formatting blow-up: one element per start tag', () => {
    const markup = formattingBlowup()

    expect(elementCount(markup)).toBe(1 + FORMATTING_TAGS + FORMATTING_BLOCKS + 1)
    const { value, ms } = timed(() => extractStaticLinks(markup))
    expect(value).toEqual(['tail.png'])
    expect(ms).toBeLessThan(SCAN_BUDGET_MS)
  })

  it(`keeps ${MAX_ATTRIBUTES_PER_TAG} of ${ATTRIBUTE_FLOOD} attributes on one tag, reports it, and reads on`, () => {
    const markup = attributeFlood(ATTRIBUTE_FLOOD)
    const onLimit = vi.fn()

    const { value, ms } = timed(() => extractStaticLinks(markup, onLimit))

    expect(value).toEqual(['before.css', 'kept.png', 'after.js'])
    expect(onLimit.mock.calls).toEqual([['attributes-per-tag']])
    expect(ms).toBeLessThan(SCAN_BUDGET_MS)
  })

  it('walks no stack for end tags that match nothing', () => {
    const markup = `${'<b>'.repeat(OPEN_TAGS)}${'</x>'.repeat(UNMATCHED_END_TAGS)}${TAIL}`

    expect(elementCount(markup)).toBe(OPEN_TAGS + 1)
    const { value, ms } = timed(() => extractStaticLinks(markup))
    expect(value).toEqual(['tail.png'])
    expect(ms).toBeLessThan(SCAN_BUDGET_MS)
  })

  it.each([
    ['a <style> element', `<style>${'url('.repeat(URL_OPENINGS)}</style>${TAIL}`],
    ['a style attribute', `<p style="${'url('.repeat(URL_OPENINGS)}">${TAIL}`]
  ])('reads a CSS url( flood in %s in linear time', (_label, markup) => {
    const { value, ms } = timed(() => extractStaticLinks(markup))
    expect(value).toEqual(['tail.png'])
    expect(ms).toBeLessThan(SCAN_BUDGET_MS)
  })

  it('reads a srcset URL of one long comma run in linear time', () => {
    const inner = ','.repeat(SRCSET_COMMAS)
    const markup = `<img srcset="x${inner}y,">${TAIL}`
    const { value, ms } = timed(() => extractStaticLinks(markup))
    expect(ms).toBeLessThan(SCAN_BUDGET_MS)
    expect(value).toEqual([`x${inner}y`, 'tail.png'])
  })

  it('reports no bound on an ordinary page', () => {
    const onLimit = vi.fn()
    extractStaticLinks(
      '<link rel="stylesheet" href="a.css"><style>b{background:url(b.png)}</style><img src="c.png">',
      onLimit
    )
    expect(onLimit).not.toHaveBeenCalled()
  })
})

describe('extractFrameSources – bounded on hostile pages (issue #124 audit)', () => {
  it('lists the frames around a tag of too many attributes and reports the cap', () => {
    const markup = `<iframe src="a.html"></iframe>${attributeFlood(ATTRIBUTE_FLOOD)}<iframe srcdoc="<p>b</p>"></iframe>`
    const onLimit = vi.fn()

    const { value, ms } = timed(() => extractFrameSources(markup, onLimit))

    expect(value).toEqual({ src: ['a.html'], srcdocHtml: ['<p>b</p>'] })
    expect(onLimit.mock.calls).toEqual([['attributes-per-tag']])
    expect(ms).toBeLessThan(SCAN_BUDGET_MS)
  })

  it('builds no tree from the formatting blow-up', () => {
    const markup = `${formattingBlowup()}<iframe src="tail.html"></iframe>`
    const { value, ms } = timed(() => extractFrameSources(markup))
    expect(value).toEqual({ src: ['tail.html'], srcdocHtml: [] })
    expect(ms).toBeLessThan(SCAN_BUDGET_MS)
  })
})
