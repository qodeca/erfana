// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared parse (docs/designs/comments/html-preview-comments.md §4.2, §5.5, §5.6):
 * which elements may take a block, where they start, and their text.
 */
import { defaultTreeAdapter, html as htmlSpec } from 'parse5'
import { describe, expect, it } from 'vitest'
import { BOM, LINE_SEP, elementOf } from '../comments/__fixtures__/commentTestData'
import { attributeOf, hasMoreStartTagsThan, indexHtml } from './htmlIndex'
import { UNBOUNDED_PARSE } from './parseBounds'

/** About 1.6 s alone; room for a loaded CI runner and coverage instrumentation. */
const DEEP_PAGE_TIMEOUT_MS = 30_000

describe('eligible elements', () => {
  it('excludes html, head, head content and template content; implied tags have no start tag', () => {
    const text =
      '<!doctype html><html><head><title>t</title><meta charset="utf-8"></head>' +
      '<body class="b"><template><p>later</p></template><p>now</p></body></html>'
    const index = indexHtml(text)
    expect(index.elements.map(el => el.tag)).toEqual(['body', 'template', 'p'])
    for (const el of index.elements) expect(text.startsWith(`<${el.tag}`, el.start)).toBe(true)
    expect(indexHtml('<p>only</p>').elements.map(el => el.tag)).toEqual(['p'])
    expect(index.tagSequence).toEqual([
      'html',
      'head',
      'title',
      'meta',
      'body',
      'template',
      'p',
      'p'
    ])
  })

  it('gives a reconstructed formatting element no start tag of its own', () => {
    const index = indexHtml('<p><b>bold<p>still bold</b></p>')
    expect(index.elements.map(el => el.tag)).toEqual(['p', 'b', 'p'])
    expect(index.tagSequence.filter(tag => tag === 'b')).toHaveLength(2)
  })

  it('records where the tag name ends, id, classes and pre-like ancestors', () => {
    const text =
      '<div\n id="x" class=" a  b\tc "><pre><span>s</span></pre><svg viewBox="0 0 1 1"><foreignObject/></svg><br/></div>'
    const index = indexHtml(text)
    const div = elementOf(index, 'div')
    expect(text.slice(div.start, div.nameEnd)).toBe('<div')
    expect(div).toMatchObject({ id: 'x', classes: ['a', 'b', 'c'], preformatted: false })
    expect(elementOf(index, 'span').preformatted).toBe(true)
    expect(elementOf(index, 'pre').preformatted).toBe(false)
    expect(
      text.slice(elementOf(index, 'foreignObject').start, elementOf(index, 'foreignObject').nameEnd)
    ).toBe('<foreignObject')
    expect(text.slice(elementOf(index, 'br').start, elementOf(index, 'br').nameEnd)).toBe('<br')
    expect(attributeOf(div.node, 'class')).toBe(' a  b\tc ')
    expect(attributeOf(div.node, 'title')).toBeUndefined()
    expect(index.elementOf(div.node)).toBe(div)
    expect(index.elementAt(div.start + 1)).toBeUndefined()
  })

  it('shifts every offset past a BOM and keeps the BOM in the text', () => {
    const plain = indexHtml('<!doctype html><p>x</p><!-- c -->')
    const bom = indexHtml(`${BOM}<!doctype html><p>x</p><!-- c -->`)
    expect(bom.bomLength).toBe(1)
    expect(bom.text.startsWith(BOM)).toBe(true)
    expect(bom.elements.map(el => el.start)).toEqual(plain.elements.map(el => el.start + 1))
    expect(bom.comments.map(c => [c.start, c.end])).toEqual(
      plain.comments.map(c => [c.start + 1, c.end + 1])
    )
    // Without the BOM hidden, parse5 would read U+FEFF as body text.
    expect(bom.visibleText).toBe('x')
  })
})

describe('comments', () => {
  it('lists every comment in source order, template content included, with its parent', () => {
    const text =
      '<!-- a --><main><!-- b --><template><!-- c --></template><table><!-- d --><tr><td>x</td></tr></table></main><!-- e'
    const index = indexHtml(text)
    expect(index.comments.map(c => c.data.trim())).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(index.comments.map(c => c.inTemplate)).toEqual([false, false, true, false, false])
    expect(index.comments[0].parent).toBeNull()
    expect(index.comments[1].parent?.tagName).toBe('main')
    expect(index.comments[2].parent).toBeNull()
    expect(text.slice(index.comments[1].start, index.comments[1].end)).toBe('<!-- b -->')
    expect(index.comments[4].end).toBe(text.length)
  })
})

describe('text and paths', () => {
  it('keeps the readable text only, with each element’s range in it', () => {
    const index = indexHtml(
      '<p>Hello <b>world</b></p><script>no()</script><style>x{}</style><noscript>ns</noscript><template>t</template><p>end</p>'
    )
    expect(index.visibleText).toBe('Hello worldend')
    const b = elementOf(index, 'b')
    expect(index.visibleText.slice(b.textStart, b.textEnd)).toBe('world')
    const script = elementOf(index, 'script')
    expect(script.textStart).toBe(script.textEnd)
  })

  it('builds absolute CSS paths and finds elements by them', () => {
    const index = indexHtml('<main><ul><li>a</li><li>b</li></ul><ul><li>c</li></ul></main>')
    const c = elementOf(index, 'li', 2)
    expect(index.pathOf(c.node)).toBe(
      'html > body > main:nth-of-type(1) > ul:nth-of-type(2) > li:nth-of-type(1)'
    )
    expect(index.elementAtPath(index.pathOf(c.node))).toBe(c)
    expect(index.elementAtPath('html > body > nav:nth-of-type(1)')).toBeUndefined()
    expect(index.nthOf(elementOf(index, 'li', 1).node)).toBe(2)
    expect(index.segmentOf(elementOf(index, 'main').node)).toBe('main:nth-of-type(1)')
  })

  it('walks a path down to every element of a page, and only a path pathOf writes', () => {
    const index = indexHtml(
      '<body><main><p>a</p><section><p>b</p><p>c</p></section><table><tr><td>x</td></tr></table></main></body>'
    )
    for (const el of index.elements) expect(index.elementAtPath(index.pathOf(el.node))).toBe(el)
    const td = elementOf(index, 'td')
    expect(index.pathOf(td.node)).toBe(
      'html > body > main:nth-of-type(1) > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(1) > td:nth-of-type(1)'
    )
    const second = 'html > body > main:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(2)'
    expect(index.elementAtPath(second)).toBe(elementOf(index, 'p', 2))
    for (const path of [
      '',
      'html',
      'body',
      'html > body > main',
      'html > body:nth-of-type(1)',
      'html > body > main:nth-of-type(01)',
      'html > body > main:nth-of-type(0)',
      'html > body > main:nth-of-type(+1)',
      'html > body > main:nth-of-type(1',
      'html > body > main:nth-of-type()',
      'html > body > :nth-of-type(1)',
      'html > body > main:nth-of-type(2)',
      'html > body > main:nth-of-type(1) > ',
      'html > body > main:nth-of-type(1) > table:nth-of-type(1) > tbody:nth-of-type(1)'
    ]) {
      expect(index.elementAtPath(path), path).toBeUndefined()
    }
  })

  it('finds tags whose names hold the path syntax or a line separator', () => {
    const index = indexHtml(
      `<main><x:nth-of-type(2) id="odd"></x:nth-of-type(2)><a${LINE_SEP}b id="ls"></a${LINE_SEP}b></main>`
    )
    for (const id of ['odd', 'ls']) {
      const el = index.elementsWithId(id)[0]
      expect(index.elementAtPath(index.pathOf(el.node))).toBe(el)
    }
    expect(index.pathOf(index.elementsWithId('odd')[0].node)).toBe(
      'html > body > main:nth-of-type(1) > x:nth-of-type(2):nth-of-type(1)'
    )
  })

  it('answers the last element in tree order when two share a path (repeated SVG <html>)', () => {
    const index = indexHtml(
      '<svg><html><g id="one"></g></html><html><g id="two"></g></html></svg>'
    )
    const [one, two] = ['one', 'two'].map(id => index.elementsWithId(id)[0])
    expect(index.pathOf(one.node)).toBe(index.pathOf(two.node))
    expect(index.elementAtPath(index.pathOf(one.node))).toBe(two)
  })

  it('treats an element it never saw as the first of its type', () => {
    const index = indexHtml('<p>x</p>')
    const stranger = defaultTreeAdapter.createElement('p', htmlSpec.NS.HTML, [])
    expect(index.nthOf(stranger)).toBe(1)
    expect(index.elementOf(stranger)).toBeUndefined()
    expect(index.pathOf(stranger)).toBe('p:nth-of-type(1)')
  })

  it('finds elements by id, duplicates included', () => {
    const index = indexHtml('<i id="a">1</i><b id="a">2</b><u id="c">3</u><s>4</s>')
    expect(index.elementsWithId('a').map(el => el.tag)).toEqual(['i', 'b'])
    expect(index.elementsWithId('c').map(el => el.tag)).toEqual(['u'])
    expect(index.elementsWithId('missing')).toEqual([])
  })

  it(
    'walks a very deep page without overflowing the stack',
    () => {
      // Deeper than plain recursion reaches on Node 24 (about 10,400 frames).
      // Kept near that: parse5's scope checks make deep nesting quadratic –
      // which is why the default bounds refuse this page (S-M, parseBounds.test.ts),
      // and why this test of the walk lifts them.
      const depth = 12_000
      const index = indexHtml(`${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}`, UNBOUNDED_PARSE)
      expect(index.elements).toHaveLength(depth)
      expect(index.visibleText).toBe('deep')
    },
    DEEP_PAGE_TIMEOUT_MS
  )
})

describe('hasMoreStartTagsThan (§19 Rev 4)', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

  it('counts a `<` followed by an ASCII letter of either case, up to the limit', () => {
    const page = bytes('<p>a</p><DIV>b</DIV><x-y></x-y>')
    expect(hasMoreStartTagsThan(page, 3)).toBe(false)
    expect(hasMoreStartTagsThan(page, 2)).toBe(true)
  })

  it('ignores end tags, comments, doctypes, a `<` before a digit or a blank, and a `<` at the very end', () => {
    expect(hasMoreStartTagsThan(bytes('<!doctype html><!-- c --></p><1 < 2 <'), 0)).toBe(false)
    expect(hasMoreStartTagsThan(bytes('['), 0)).toBe(false)
    expect(hasMoreStartTagsThan(new Uint8Array(0), 0)).toBe(false)
  })

  it('never counts fewer than the elements the index finds: every eligible element owns a start tag', () => {
    const text = '<main><p id="a">x<b>y</b></p><table><tr><td>1</td></tr></table><template><i>t</i></template></main>'
    const elements = indexHtml(text).elements.length
    expect(hasMoreStartTagsThan(bytes(text), elements - 1)).toBe(true)
  })
})
