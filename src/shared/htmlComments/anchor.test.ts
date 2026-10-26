// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Anchors and re-attachment (docs/designs/html-preview-comments.md §5.9,
 * §19 R3-10; U-080–U-088): position by SOURCE order first, then id, path and
 * quote; ambiguity orphans a block, and nothing here ever writes.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import { addTo, ch, elementOf, fixedId, makeComment } from './__fixtures__/commentTestData'
import {
  buildAnchor,
  buildDraftAnchor,
  findAnchorTarget,
  isBlockHeader,
  normalizeQuoteText,
  prepareSnapshot,
  quoteOf,
  relativePath,
  resolveBlockTarget,
  resolveRelativePath
} from './anchor'
import { encodeText } from './encoding'
import type { CommentAnchor, CommentData, RuntimeAnchor } from './format'
import { indexHtml, type HtmlIndex } from './htmlIndex'
import { parseCommentBlocks, parseCommentFile } from './parse'
import { addReply } from './thread'

function comment(n: number, anchor: CommentAnchor): CommentData {
  return makeComment({ id: fixedId('c-', n), anchor })
}

function resolve(index: HtmlIndex, anchor: CommentAnchor, after = index.text.length) {
  return resolveBlockTarget(index, { after, anchor, blockEnds: new Map() })
}

function targetOf(html: string) {
  const blocks = parseCommentBlocks(html).blocks
  return blocks.map(b => (b.kind === 'ok' ? b.target : b))
}

describe('position', () => {
  it('U-080 a block directly before its element attaches by position – also in implied and auto-closed structures', () => {
    const cases: Array<[string, string, number]> = [
      ['<main><button>b</button></main>', 'button', 0],
      ['<table>\n  <tr><td>first row</td></tr>\n</table>', 'tr', 0],
      ['<table><col><tr><td>x</td></tr></table>', 'col', 0],
      ['<p>one\n<p>two', 'p', 1],
      ['<ul>\n  <li>one\n  <li>two\n</ul>', 'li', 1],
      ['<dl><dt>term<dd>one<dd>two</dl>', 'dd', 1],
      ['<select><option>a<option>b</select>', 'option', 1],
      ['<p>para<ul><li>x</li></ul>', 'ul', 0],
      ['<table><tr><td>a<td>b</tr></table>', 'td', 1]
    ]
    for (const [html, tag, n] of cases) {
      const { text, plan } = addTo(html, tag, comment(1, { tag, path: '' }), { n, ws: 'collapse' })
      const target = targetOf(text)[0]
      expect(target, `${tag} in ${html}`).toEqual({
        state: 'attached',
        startOffset: plan.start + plan.insert.length,
        via: 'position'
      })
    }
  })

  it('U-081 whitespace between block and element still attaches; other content falls back to the backups', () => {
    const { text } = addTo(
      '<main><b id="x">bold</b></main>',
      'b',
      comment(2, { tag: 'b', id: 'x', path: '' })
    )
    const spaced = text.replace('--><b', '-->\n\n\t  <b')
    expect(targetOf(spaced)[0]).toMatchObject({ state: 'attached', via: 'position' })
    const noted = text.replace('--><b', '--><!-- a note --><b')
    expect(targetOf(noted)[0]).toMatchObject({ state: 'attached', via: 'id' })
    const worded = text.replace('--><b', '-->words <b')
    expect(targetOf(worded)[0]).toMatchObject({ state: 'attached', via: 'id' })
    const otherTag = text.replace('--><b id="x">bold</b>', '--><i>x</i><b id="x">bold</b>')
    expect(targetOf(otherTag)[0]).toMatchObject({ state: 'attached', via: 'id' })
  })

  it('skips other erfana blocks on the way to the element', () => {
    let html = '<main>\n  <h2>T</h2>\n</main>'
    html = addTo(html, 'h2', comment(3, { tag: 'h2', path: '' }), { ws: 'collapse' }).text
    html = addTo(html, 'h2', comment(4, { tag: 'h2', path: '' })).text
    expect(targetOf(html).map(t => 'via' in t && t.via)).toEqual(['position', 'position'])
  })
})

describe('backup tiers', () => {
  const html =
    '<main>\n  <p>Intro text before.</p>\n  <section id="pricing" class="a b">\n    <h2>Plans</h2>\n    <p>Basic plan costs 10 EUR.</p>\n  </section>\n  <p>Footer words after.</p>\n</main>'
  const index = indexHtml(html)
  const section = elementOf(index, 'section')
  const basic = elementOf(index, 'p', 1)
  const anchor = buildAnchor(index, section)

  it('U-082 each tier alone', () => {
    expect(resolve(index, anchor)).toEqual({
      state: 'attached',
      startOffset: section.start,
      via: 'id'
    })
    const noId = { ...anchor, id: undefined }
    expect(resolve(index, noId)).toEqual({
      state: 'attached',
      startOffset: section.start,
      via: 'path'
    })
    const basicAnchor = buildAnchor(index, basic)
    const quoteOnly = {
      tag: 'p',
      path: 'html > body > nowhere:nth-of-type(9)',
      quote: basicAnchor.quote
    }
    expect(resolve(index, quoteOnly)).toEqual({
      state: 'attached',
      startOffset: basic.start,
      via: 'quote'
    })
    const contextOnly = {
      ...quoteOnly,
      quote: { ...basicAnchor.quote!, exact: 'text that changed' }
    }
    expect(resolve(index, contextOnly)).toEqual({
      state: 'attached',
      startOffset: basic.start,
      via: 'quote'
    })
  })

  it('U-082 tiers apply in priority order: id before path before quote', () => {
    const intro = elementOf(index, 'p', 0)
    const mixed: CommentAnchor = {
      tag: 'p',
      id: undefined,
      path: index.pathOf(intro.node),
      quote: buildAnchor(index, basic).quote
    }
    expect(resolve(index, mixed)).toMatchObject({ startOffset: intro.start, via: 'path' })
    const withId: CommentAnchor = { ...anchor, path: index.pathOf(elementOf(index, 'main').node) }
    expect(resolve(index, withId)).toMatchObject({ startOffset: section.start, via: 'id' })
    expect(resolve(index, { ...anchor, tag: 'div' })).toEqual({ state: 'orphaned' })
  })

  it('U-083 two equal candidates → orphaned, never a guess', () => {
    const twins = indexHtml('<div><p class="t">Same text</p><p class="t">Same text</p></div>')
    const first = elementOf(twins, 'p', 0)
    const quote = quoteOf(twins, first)!
    expect(
      resolve(twins, { tag: 'p', path: '', quote: { ...quote, prefix: '', suffix: '' } })
    ).toEqual({ state: 'orphaned' })
    const dupIds = indexHtml('<i id="d">one</i><i id="d">two</i>')
    expect(findAnchorTarget(dupIds, { tag: 'i', id: 'd', path: '' })).toEqual({ state: 'orphaned' })
    // Filler longer than the context on both sides makes the two contexts equal too.
    const pad = `<p>${'same words '.repeat(5)}</p>`
    const sameContext = indexHtml(`${pad}<b>A</b>${pad}<b>A</b>${pad}`)
    const q = quoteOf(sameContext, elementOf(sameContext, 'b', 0))!
    expect(q).toEqual(quoteOf(sameContext, elementOf(sameContext, 'b', 1)))
    expect(findAnchorTarget(sameContext, { tag: 'b', path: '', quote: q })).toEqual({
      state: 'orphaned'
    })
    expect(
      findAnchorTarget(sameContext, { tag: 'b', path: '', quote: { ...q, exact: 'gone' } })
    ).toEqual({ state: 'orphaned' })
  })

  it('U-084 no match → orphaned, and loading never writes', () => {
    const { text } = addTo(
      '<main><b id="x">bold</b></main>',
      'b',
      comment(5, { tag: 'b', id: 'x', path: '', quote: { exact: 'bold', prefix: '', suffix: '' } })
    )
    const gone = text.replace('<b id="x">bold</b>', '<i>other</i>')
    const bytes = encodeText(gone)
    const copy = Uint8Array.from(bytes)
    const result = parseCommentFile(bytes)
    expect(result.ok && result.doc.state.blocks[0]).toMatchObject({
      kind: 'ok',
      target: { state: 'orphaned' }
    })
    expect(bytes).toEqual(copy)
  })
})

describe('script-built and climbed targets', () => {
  const html =
    '<div id="deck"><section><h2>Static slide</h2></section></div><table><tr><td>1</td></tr></table>'
  const index = indexHtml(html)
  const deck = elementOf(index, 'div')

  it('U-085 a JS-built element anchors to its in-file ancestor with a snapshot; an in-file element gets none', () => {
    const built: RuntimeAnchor = {
      path: 'section:nth-of-type(2) > h2:nth-of-type(1)',
      tag: 'h2',
      snapshot: '<h2>Built</h2>',
      snapshotSource: 'page'
    }
    const anchor = buildDraftAnchor(index, deck, built)
    expect(anchor).toMatchObject({ tag: 'div', id: 'deck', runtime: built })
    const inFile = buildDraftAnchor(index, deck, {
      ...built,
      path: 'section:nth-of-type(1) > h2:nth-of-type(1)',
      truncated: true
    })
    expect(inFile.runtime).toEqual({
      path: 'section:nth-of-type(1) > h2:nth-of-type(1)',
      tag: 'h2',
      snapshotSource: 'page'
    })
    const tbody = buildDraftAnchor(index, elementOf(index, 'table'), {
      path: 'tbody:nth-of-type(1)',
      tag: 'tbody',
      snapshot: 'x',
      snapshotSource: 'page'
    })
    expect(tbody.runtime).toEqual({
      path: 'tbody:nth-of-type(1)',
      tag: 'tbody',
      snapshotSource: 'page'
    })
    expect(buildDraftAnchor(index, deck)).toEqual(buildAnchor(index, deck))
  })

  it('U-086 a snapshot loses nested blocks and data-erfana-el, and stays frozen through later edits', () => {
    const outer =
      '<li data-erfana-el="abcdefghijkl" class="x"><!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa\nold\n--><span\n  data-erfana-el=\'x\'>t</span><!-- keep me --><tr data-erfana-el="mnopqrstuvwx"><td>c</td></tr></li>'
    const { snapshot, truncated } = prepareSnapshot(outer)
    expect(truncated).toBe(false)
    expect(snapshot).toBe('<li class="x"><span>t</span><!-- keep me --><tr><td>c</td></tr></li>')
    const template = prepareSnapshot('<template><b data-erfana-el="t">x</b></template>')
    expect(template.snapshot).toBe('<template><b>x</b></template>')
    const data = makeComment({
      anchor: {
        tag: 'div',
        path: '',
        runtime: { path: 'li:nth-of-type(1)', tag: 'li', snapshot, snapshotSource: 'page' }
      }
    })
    const replied = addReply(data, 'later', {
      author: data.msgs[0].by,
      now: new Date(),
      random: () => new Uint8Array(16)
    })
    expect(replied.anchor.runtime?.snapshot).toBe(snapshot)
    expect(replied.anchor).toBe(data.anchor)
  })

  it('U-087 a target that is hidden or zero-size still attaches (visibility is the page’s concern)', () => {
    for (const el of [
      '<section hidden>s</section>',
      '<div style="display:none">d</div>',
      '<span style="width:0;height:0"></span>'
    ]) {
      const tag = el.slice(1, el.search(/[ >]/))
      const { text } = addTo(`<main>${el}</main>`, tag, comment(6, { tag, path: '' }))
      expect(targetOf(text)[0]).toMatchObject({ state: 'attached', via: 'position' })
    }
  })

  it('paths below an ancestor resolve both ways', () => {
    const h2 = elementOf(index, 'h2')
    expect(relativePath(index, deck.node, h2.node)).toBe(
      'section:nth-of-type(1) > h2:nth-of-type(1)'
    )
    expect(relativePath(index, deck.node, deck.node)).toBe('')
    expect(relativePath(index, h2.node, deck.node)).toBeUndefined()
    expect(resolveRelativePath(deck.node, 'section:nth-of-type(1) > h2:nth-of-type(1)')).toBe(
      h2.node
    )
    expect(resolveRelativePath(deck.node, '')).toBe(deck.node)
    expect(resolveRelativePath(deck.node, 'section:nth-of-type(2)')).toBeUndefined()
    expect(
      resolveRelativePath(deck.node, 'section:nth-of-type(2) > h2:nth-of-type(1)')
    ).toBeUndefined()
    expect(resolveRelativePath(deck.node, 'section')).toBeUndefined()
  })
})

describe('quotes', () => {
  it('U-088 whitespace is collapsed and text is NFC, so reformatting and NFD text still match', () => {
    const nfc = `Caf${ch(0xe9)} au lait`
    const nfd = `Cafe${ch(0x301)}   au\n\t lait`
    const stored = indexHtml(`<p>${nfc}</p>`)
    const anchor = buildAnchor(stored, elementOf(stored, 'p'))
    expect(anchor.quote?.exact).toBe(nfc)
    const reformatted = indexHtml(`<div><p>\n  ${nfd}\n</p></div>`)
    expect(findAnchorTarget(reformatted, { ...anchor, path: '' })).toMatchObject({ via: 'quote' })
    expect(normalizeQuoteText(`  a \n\t b ${nfd} `)).toBe(`a b ${nfc}`)
  })

  it('takes the element text without script and style, with context on both sides', () => {
    const index = indexHtml(
      '<p>Before the target.</p><div>Main <script>no()</script><style>.x{}</style>text</div><p>After it.</p>'
    )
    expect(quoteOf(index, elementOf(index, 'div'))).toEqual({
      exact: 'Main text',
      prefix: 'Before the target.',
      suffix: 'After it.'
    })
    expect(quoteOf(index, elementOf(index, 'script'))).toBeUndefined()
  })

  it('cuts quotes and context on a code-point boundary', () => {
    const max = PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS
    const emoji = ch(0x1f600)
    const index = indexHtml(
      `<p>${'x'.repeat(40)}${emoji}</p><b>${'a'.repeat(max - 1)}${emoji}tail</b><i>${emoji}${'s'.repeat(40)}</i>`
    )
    const quote = quoteOf(index, elementOf(index, 'b'))!
    expect(quote.exact).toBe('a'.repeat(max - 1))
    expect(quote.prefix).toBe(`${'x'.repeat(30)}${emoji}`)
    expect(quote.suffix).toBe(`${emoji}${'s'.repeat(30)}`)
    const tail = indexHtml(`<p>${emoji}${'y'.repeat(31)}</p><b>t</b>`)
    expect(quoteOf(tail, elementOf(tail, 'b'))!.prefix).toBe('y'.repeat(31))
  })

  it('keeps an anchor within its limits', () => {
    const longId = 'i'.repeat(300)
    const classes = ['ok', 'c'.repeat(101), 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']
    let deep = '<p>leaf</p>'
    for (let i = 0; i < 400; i += 1) deep = `<div>${deep}</div>`
    const index = indexHtml(
      `<span id="${longId}" class="${classes.join(' ')}"></span><span id="">e</span>${deep}`
    )
    const anchor = buildAnchor(index, elementOf(index, 'span'))
    expect(anchor).toEqual({
      tag: 'span',
      cls: ['ok', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'],
      path: 'html > body > span:nth-of-type(1)'
    })
    expect(buildAnchor(index, elementOf(index, 'span', 1)).id).toBeUndefined()
    expect(buildAnchor(index, elementOf(index, 'p')).path).toBe('')
  })

  it('recognises the block header of any version, anchored at the start', () => {
    expect(isBlockHeader(' erfana:comment v1 id=x')).toBe(true)
    expect(isBlockHeader('\n\terfana:comment   v12')).toBe(true)
    expect(isBlockHeader('note: erfana:comment v1')).toBe(false)
    expect(isBlockHeader(' erfana:comment v')).toBe(false)
    expect(isBlockHeader(`${' '.repeat(80)}erfana:comment v1`)).toBe(false)
  })
})
