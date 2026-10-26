// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared parse (docs/designs/html-preview-comments.md §4.2, §5.5, §5.6):
 * which elements may take a block, where they start, and their text.
 */
import { defaultTreeAdapter, html as htmlSpec } from 'parse5'
import { describe, expect, it } from 'vitest'
import { BOM, elementOf } from './__fixtures__/commentTestData'
import { attributeOf, indexHtml } from './htmlIndex'

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
      // Kept near that: parse5's scope checks make deep nesting quadratic.
      const depth = 12_000
      const index = indexHtml(`${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}`)
      expect(index.elements).toHaveLength(depth)
      expect(index.visibleText).toBe('deep')
    },
    DEEP_PAGE_TIMEOUT_MS
  )
})
