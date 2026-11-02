// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A position match must be corroborated (docs/designs/comments/html-preview-comments.md
 * §5.9 step 1, §19 Rev 4; U-089). The X-001 confirmation found that removing a
 * commented element handed its open comment to the next element with the same
 * tag. Every row of the decision table in `anchorEvidence.ts` is pinned here,
 * with the X-001 page itself, and the edits that must keep a comment on its
 * element.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addTo, elementOf, fixedId, makeComment } from './__fixtures__/commentTestData'
import { buildAnchor, type TargetResolution } from '../htmlComments/anchor'
import { positionCorroborated } from './anchorEvidence'
import { AnchorLookup } from './anchorLookup'
import type { CommentAnchor, CommentData } from './format'
import { indexHtml, type HtmlIndex } from '../htmlComments/htmlIndex'
import { analyzeCommentDocument, parseCommentBlocks, type ParsedBlock } from '../htmlComments/parse'

const LANDING = join(
  __dirname,
  '..',
  '..',
  '..',
  'e2e',
  'fixtures',
  'html-preview-corpus',
  'comments',
  'agent-review',
  'landing.html'
)
/** The X-001 block on the grinder card ("Remove this whole card."). */
const GRINDER_BLOCK = 'c-jahjqxyhdceqtgdz'

/** Three sibling cards with no `id`, as on the X-001 page. */
const CARDS = [
  '<main>',
  '  <h1>Northwind Coffee</h1>',
  '  <section class="features">',
  '    <article class="card">',
  '      <h2>Roasted to order</h2>',
  '      <p>We roast only what we sell that week.</p>',
  '    </article>',
  '    <article class="card">',
  '      <h2>Grinder rental</h2>',
  '      <p>Borrow a burr grinder for 5 EUR a month.</p>',
  '    </article>',
  '    <article class="card">',
  '      <h2>Pause any time</h2>',
  '      <p>Skip a week or cancel from your account page.</p>',
  '    </article>',
  '  </section>',
  '  <footer>Questions? Write to us.</footer>',
  '</main>'
].join('\n')

/** {@link CARDS} with an `id` on each card. */
const CARDS_WITH_IDS = ['roast', 'grinder', 'pause'].reduce(
  (html, id) => html.replace('<article class="card">', `<article id="${id}" class="card">`),
  CARDS
)

/** A comment on the `n`-th `<tag>` of `html`, its anchor built as the writer builds it. */
function commentOn(html: string, tag: string, n: number): CommentData {
  const index = indexHtml(html)
  return makeComment({
    id: fixedId('c-', n + 1),
    anchor: buildAnchor(index, elementOf(index, tag, n))
  })
}

/** `html` with an open comment before every `<tag>`, each placed as the writer places it. */
function commentEvery(html: string, tag: string): string {
  const count = indexHtml(html).elements.filter(el => el.tag === tag).length
  let text = html
  for (let n = 0; n < count; n += 1) {
    text = addTo(text, tag, commentOn(text, tag, n), { n, ws: 'collapse' }).text
  }
  return text
}

/** The source range of the `n`-th `<tag>`, start tag to end tag. */
function rangeOf(index: HtmlIndex, tag: string, n: number): [number, number] {
  const el = elementOf(index, tag, n)
  return [el.start, el.node.sourceCodeLocation!.endOffset + index.bomLength]
}

/** `text` without the `n`-th `<tag>` – the outside edit that removes an element and leaves its block. */
function withoutElement(text: string, tag: string, n: number): string {
  const [start, end] = rangeOf(indexHtml(text), tag, n)
  return text.slice(0, start) + text.slice(end)
}

function targetsOf(text: string): Array<TargetResolution | ParsedBlock> {
  return parseCommentBlocks(text).blocks.map(b => (b.kind === 'ok' ? b.target : b))
}

function atPosition(index: HtmlIndex, tag: string, n: number): TargetResolution {
  return { state: 'attached', startOffset: elementOf(index, tag, n).start, via: 'position' }
}

/** `html` with one comment before the first `<tag>`, then edited by `edit`. */
function commentedThenEdited(html: string, tag: string, edit: (text: string) => string): string {
  return edit(addTo(html, tag, commentOn(html, tag, 0), { ws: 'collapse' }).text)
}

describe('U-089 removing a commented element (X-001)', () => {
  it.each([
    ['no ids – the next card slid into the place and the path of the removed one (row 4)', CARDS],
    ['ids – the next card carries another id (row 1)', CARDS_WITH_IDS]
  ])(
    'the first of three sibling cards: its comment is orphaned, the other two stay on their cards (%s)',
    (_name, page) => {
      const commented = commentEvery(page, 'article')
      expect(targetsOf(commented).map(t => 'via' in t && t.via)).toEqual([
        'position',
        'position',
        'position'
      ])
      const edited = withoutElement(commented, 'article', 0)
      const index = indexHtml(edited)
      expect(targetsOf(edited)).toEqual([
        { state: 'orphaned' },
        atPosition(index, 'article', 0),
        atPosition(index, 'article', 1)
      ])
    }
  )

  it('the X-001 page itself: removing the grinder card orphans its open comment and moves no other block', () => {
    const text = readFileSync(LANDING, 'utf8')
    const before = analyzeCommentDocument(text)
    const cards = before.index.elements.filter(el => el.tag === 'article')
    const n = cards.findIndex((_, i) => {
      const [from, to] = rangeOf(before.index, 'article', i)
      return text.slice(from, to).includes('<h2>Grinder rental</h2>')
    })
    const [start, end] = rangeOf(before.index, 'article', n)
    const after = analyzeCommentDocument(text.slice(0, start) + text.slice(end))
    const moved = (offset: number): number => (offset >= end ? offset - (end - start) : offset)
    expect(after.state.blocks).toHaveLength(before.state.blocks.length)
    for (const [i, was] of before.state.blocks.entries()) {
      const now = after.state.blocks[i]
      if (was.kind !== 'ok' || now.kind !== 'ok') {
        expect(now.kind).toBe(was.kind)
        continue
      }
      // On the page as Erfana wrote it, every block is corroborated where it stands.
      expect(was.target, was.data.id).toMatchObject({ state: 'attached', via: 'position' })
      if (was.data.id === GRINDER_BLOCK) {
        expect(was.target).toEqual({ state: 'attached', startOffset: start, via: 'position' })
        expect(now.target, 'the grinder comment').toEqual({ state: 'orphaned' })
        continue
      }
      const expected =
        was.target.state === 'attached'
          ? { ...was.target, startOffset: moved(was.target.startOffset) }
          : was.target
      expect(now.target, was.data.id).toEqual(expected)
    }
  })

  it('an element replaced by another of the same tag with a different id: orphaned (row 1, and no backup takes it)', () => {
    const page =
      '<main>\n  <section id="plans">Plans start at 10 EUR.</section>\n  <p>After.</p>\n</main>'
    const edited = commentedThenEdited(page, 'section', text =>
      text.replace(
        '<section id="plans">Plans start at 10 EUR.</section>',
        '<section id="faq">Questions and answers.</section>'
      )
    )
    expect(targetsOf(edited)).toEqual([{ state: 'orphaned' }])
  })

  it('a target moved away: the element that slid in is refused, and the quote finds the target at its new place', () => {
    const page = '<ul>\n  <li>Alpha one</li>\n  <li>Beta two</li>\n</ul>'
    const edited = commentedThenEdited(page, 'li', text =>
      text
        .replace('<li>Alpha one</li>\n  ', '')
        .replace('<li>Beta two</li>', '<li>Beta two</li>\n  <li>Alpha one</li>')
    )
    const index = indexHtml(edited)
    expect(targetsOf(edited)).toEqual([
      { state: 'attached', startOffset: elementOf(index, 'li', 1).start, via: 'quote' }
    ])
  })
})

describe('U-089 edits that keep a comment on its element', () => {
  const page = [
    '<main>',
    '  <p>Fresh beans, roasted every Monday for you.</p>',
    '  <h2 id="lead">Start your subscription</h2>',
    '  <p>Delivered by Thursday.</p>',
    '</main>'
  ].join('\n')
  const noId = page.replace(' id="lead"', '')
  // Element text only: the block's own `@data` holds the same words, and its target line the start tag.
  const editTarget = (text: string): string =>
    text.replace('>Start your subscription<', '>Get your first bag free<')
  const editNext = (text: string): string =>
    text.replace('>Delivered by Thursday.<', '>Delivered by Wednesday.<')
  const addHeadingFirst = (text: string): string =>
    text.replace('<main>', '<main>\n  <h2>Our story</h2>')

  it('edited text, same id: stays (row 2) – even with the text around it edited too', () => {
    const edited = commentedThenEdited(page, 'h2', text => editNext(editTarget(text)))
    expect(targetsOf(edited)).toEqual([atPosition(indexHtml(edited), 'h2', 0)])
  })

  it('edited text, no id, same path: stays (row 5) – even with the text after it edited too', () => {
    const edited = commentedThenEdited(noId, 'h2', text => editNext(editTarget(text)))
    expect(targetsOf(edited)).toEqual([atPosition(indexHtml(edited), 'h2', 0)])
  })

  it('edited text, no id, another path: stays while the text on both sides is unchanged (row 3, context)', () => {
    const stored = commentOn(noId, 'h2', 0).anchor.path
    const edited = commentedThenEdited(noId, 'h2', text => addHeadingFirst(editTarget(text)))
    const index = indexHtml(edited)
    expect(index.pathOf(elementOf(index, 'h2', 1).node)).not.toBe(stored)
    expect(targetsOf(edited)).toEqual([atPosition(index, 'h2', 1)])
  })

  it('attribute changes – class, style, the id removed – at another path, text unchanged: stays (row 3, exact text)', () => {
    const edited = commentedThenEdited(page, 'h2', text =>
      addHeadingFirst(
        text.replace('<h2 id="lead">Start', '<h2 class="hero" style="font-size: 2rem">Start')
      )
    )
    expect(targetsOf(edited)).toEqual([atPosition(indexHtml(edited), 'h2', 1)])
  })

  it('an anchor that stores no id, no path and no quote: position alone (row 6)', () => {
    const { text } = addTo(
      '<main><img alt=""></main>',
      'img',
      makeComment({ anchor: { tag: 'img', path: '' } })
    )
    expect(targetsOf(text)).toEqual([atPosition(indexHtml(text), 'img', 0)])
  })
})

describe('the decision table, row by row', () => {
  const index = indexHtml(
    '<main><p>Lead words.</p><b id="one">first text</b><b>second text</b><b id="three">third text</b><p>Tail words.</p></main>'
  )
  const [one, second, three] = [0, 1, 2].map(n => elementOf(index, 'b', n))
  const anchorOf = buildAnchor(index, one)
  const check = (
    el: typeof one,
    anchor: CommentAnchor,
    lookup = new AnchorLookup(index)
  ): boolean => positionCorroborated(index, lookup, el, anchor)

  it('row 1: another id rejects, whatever the text and path say', () => {
    expect(
      check(three, {
        ...anchorOf,
        path: index.pathOf(three.node),
        quote: buildAnchor(index, three).quote
      })
    ).toBe(false)
  })

  it('row 2: the same id counts, whatever the text and path say', () => {
    expect(
      check(one, {
        ...anchorOf,
        path: 'html > body > nav:nth-of-type(9)',
        quote: { exact: 'gone', prefix: 'x', suffix: 'y' }
      })
    ).toBe(true)
  })

  it('an element without an id gives no id evidence: the text decides', () => {
    expect(check(second, { ...buildAnchor(index, second), id: 'removed-id' })).toBe(true)
  })

  it('rows 3–4: matching text counts; text that begins the stored suffix is the next element and is rejected', () => {
    const noId: CommentAnchor = { ...anchorOf, id: undefined, path: '' }
    expect(check(one, noId)).toBe(true)
    expect(check(one, { ...noId, quote: { ...noId.quote!, exact: 'edited text' } })).toBe(true)
    expect(check(second, noId)).toBe(false)
    // The shorter of the two may be the start of the other: a short next element, or a long one.
    expect(check(second, { ...noId, quote: { ...noId.quote!, suffix: 'second' } })).toBe(false)
    expect(check(second, { ...noId, path: index.pathOf(second.node) })).toBe(false)
  })

  it('rows 5 and 7: other text decides nothing, and the path does', () => {
    const otherText: CommentAnchor = {
      tag: 'b',
      path: index.pathOf(second.node),
      quote: { exact: 'gone', prefix: 'x', suffix: 'y' }
    }
    expect(check(second, otherText)).toBe(true)
    expect(check(second, { ...otherText, path: 'html > body > nav:nth-of-type(9)' })).toBe(false)
    expect(check(second, { ...otherText, path: '' })).toBe(false)
    expect(check(second, { tag: 'b', id: 'gone', path: '' })).toBe(false)
  })

  it('row 6: an anchor with nothing to compare counts', () => {
    expect(check(second, { tag: 'b', path: '' })).toBe(true)
  })

  it('a spent quote budget leaves rows 3–4 without an answer: the path decides', () => {
    const spent = (): AnchorLookup => new AnchorLookup(index, 1)
    const noId: CommentAnchor = { ...anchorOf, id: undefined }
    expect(check(one, noId, spent())).toBe(true)
    expect(check(one, { ...noId, path: '' }, spent())).toBe(false)
    // `second` slid into the place of `one` (row 4) – known only with the budget to read its context.
    const slid: CommentAnchor = { ...noId, path: index.pathOf(second.node) }
    expect(check(second, slid)).toBe(false)
    const exactOnly = new AnchorLookup(index, 'second text'.length + 1)
    expect(check(second, slid, exactOnly)).toBe(true)
    expect(exactOnly.budgetSpent).toBe(true)
  })
})
