// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the bounded, tree-free element scan behind the link extractor
 * (issue #124, security audit): what it reports, the tree builder's feedback it
 * repeats (raw text, foreign content, `<image>`, inert templates), and its
 * bounds (attributes per tag, document length, one element per start tag).
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ATTRIBUTES_PER_TAG,
  MAX_SCAN_CHARS,
  scanHtmlElements,
  type ScannedElement
} from './htmlElementScan'

/** Every element the scan reports, and the bounds it reached. */
function scan(markup: string): { elements: ScannedElement[]; limits: string[] } {
  const elements: ScannedElement[] = []
  const limits = scanHtmlElements(markup, (element) => elements.push(element))
  return { elements, limits }
}

function tagNames(markup: string): string[] {
  return scan(markup).elements.map((element) => element.tagName)
}

function styleTexts(markup: string): (readonly string[])[] {
  return scan(markup)
    .elements.filter((element) => element.tagName === 'style')
    .map((element) => element.texts)
}

/** A tag with `count` distinct attributes, `a0` … */
function tagWithAttributes(count: number, extra = ''): string {
  let tag = '<img'
  for (let index = 0; index < count; index += 1) tag += ` a${index}`
  return `${tag}${extra}>`
}

describe('scanHtmlElements – what it reports', () => {
  it('reports each element once, in document order, with its attributes', () => {
    const { elements, limits } = scan('<link rel="icon" href="a.ico"><div><img src="b.png"></div>')

    expect(elements.map((element) => element.tagName)).toEqual(['link', 'div', 'img'])
    expect(elements[0].attrs).toEqual([
      { name: 'rel', value: 'icon' },
      { name: 'href', value: 'a.ico' }
    ])
    expect(limits).toEqual([])
  })

  it('keeps the first of a repeated attribute name, as the DOM does', () => {
    const [img] = scan('<img src="first.png" SRC="second.png" src="third.png">').elements
    expect(img.attrs).toEqual([{ name: 'src', value: 'first.png' }])
  })

  it('lower-cases HTML tag and attribute names and decodes entities', () => {
    const [img] = scan('<IMG SRC="a&amp;b.png">').elements
    expect(img).toMatchObject({ tagName: 'img', attrs: [{ name: 'src', value: 'a&b.png' }] })
  })

  it('reports nothing for markup in a comment', () => {
    expect(tagNames('<!-- <img src="no.png"> --><p>')).toEqual(['p'])
  })

  it('reads <image> as <img>', () => {
    expect(tagNames('<image src="a.png">')).toEqual(['img'])
  })

  it("reports a <style> element's text, markup and all", () => {
    expect(styleTexts('<style>a{background:url(x.png)} <b>not a tag</b></style>')).toEqual([
      ['a{background:url(x.png)} <b>not a tag</b>']
    ])
  })

  it('reports a <style> left open at the end of the document', () => {
    expect(styleTexts('<style>a{color:red}')).toEqual([['a{color:red}']])
  })
})

describe('scanHtmlElements – raw text, as the tree builder switches the tokenizer', () => {
  it.each([
    ['script', '<script>document.write("<img src=no.png>"); if (a<b) {}</script>'],
    ['script', '<script><!--<script>"<img src=no.png>"</script>--></script>'],
    ['style', '<style><img src=no.png></style>'],
    ['textarea', '<textarea><img src=no.png></textarea>'],
    ['title', '<title><img src=no.png></title>'],
    ['xmp', '<xmp><img src=no.png></xmp>'],
    ['iframe', '<iframe><img src=no.png></iframe>'],
    ['noembed', '<noembed><img src=no.png></noembed>'],
    ['noframes', '<noframes><img src=no.png></noframes>'],
    ['noscript', '<noscript><img src=no.png></noscript>']
  ])('hides the markup inside <%s>: %s', (tagName, markup) => {
    expect(tagNames(`${markup}<p>`)).toEqual([tagName, 'p'])
  })

  it('reads everything after <plaintext> as text', () => {
    expect(tagNames('<p><plaintext><img src="no.png"></plaintext><p>')).toEqual(['p', 'plaintext'])
  })
})

describe('scanHtmlElements – inert template content', () => {
  it('reports the <template> element but nothing inside it, however deep', () => {
    const markup =
      '<template id="t"><img src="no.png"><template><img src="no.png"></template>' +
      '<style>a{}</style></template><img src="yes.png">'
    const { elements } = scan(markup)

    expect(elements.map((element) => element.tagName)).toEqual(['template', 'img'])
    expect(elements[1].attrs).toEqual([{ name: 'src', value: 'yes.png' }])
  })

  it('still reads raw text inside a template, so a closing tag in a script is no tag', () => {
    expect(tagNames('<template><script>"</template>"</script></template><p>')).toEqual([
      'template',
      'p'
    ])
  })

  it('treats a <template> inside SVG as an ordinary element', () => {
    expect(tagNames('<svg><template><rect/></template></svg>')).toEqual(['svg', 'template', 'rect'])
  })
})

describe('scanHtmlElements – foreign content (SVG and MathML)', () => {
  it('reads an SVG <style> as an element, not raw text, CDATA as its text', () => {
    expect(styleTexts('<svg><style><![CDATA[ .a{fill:url(a.png)} ]]></style></svg>')).toEqual([
      [' .a{fill:url(a.png)} ']
    ])
  })

  it('reads an SVG <style> up to its first child tag, which is reported after it', () => {
    const { elements } = scan('<svg><style>.a{}<rect/>.b{}</style></svg>')
    expect(elements.map((element) => [element.tagName, element.texts])).toEqual([
      ['svg', []],
      ['style', ['.a{}']],
      ['rect', []]
    ])
  })

  it('splits an SVG <style> text at a comment, as the tree builder does', () => {
    expect(styleTexts('<svg><style>.a{}<!-- x -->.b{}</style></svg>')).toEqual([['.a{}', '.b{}']])
  })

  it('turns a NUL in foreign content into U+FFFD', () => {
    expect(styleTexts('<svg><style>a\u0000b</style></svg>')).toEqual([['a\uFFFDb']])
  })

  it('adjusts SVG tag names and XML attribute names as in the DOM', () => {
    const { elements } = scan('<svg><foreignobject/><link xlink:href="x.css"/></svg>')
    expect(elements.map((element) => element.tagName)).toEqual(['svg', 'foreignObject', 'link'])
    expect(elements[2].attrs).toEqual([
      { name: 'href', value: 'x.css', prefix: 'xlink', namespace: 'http://www.w3.org/1999/xlink' }
    ])
  })

  it('breaks out to HTML at an HTML-only tag, so a later <style> is raw text again', () => {
    expect(tagNames('<svg><g><p>x</p><style><b>no</b></style>')).toEqual([
      'svg',
      'g',
      'p',
      'style'
    ])
  })

  it('reads HTML inside <foreignObject> and SVG again after it', () => {
    const markup =
      '<svg><foreignObject><style><b>no</b></style></foreignObject><style><rect/></style></svg>'
    expect(tagNames(markup)).toEqual(['svg', 'foreignObject', 'style', 'style', 'rect'])
  })

  it('reads HTML inside a MathML text integration point', () => {
    expect(tagNames('<math><mi><style><b>no</b></style></mi></math>')).toEqual([
      'math',
      'mi',
      'style'
    ])
  })

  it('opens no foreign content for a self-closed <svg/>', () => {
    expect(tagNames('<svg/><style><b>no</b></style><p>')).toEqual(['svg', 'style', 'p'])
  })
})

describe('scanHtmlElements – bounds', () => {
  it(`keeps ${MAX_ATTRIBUTES_PER_TAG} attributes on one tag and reports the cap once`, () => {
    const { elements, limits } = scan(
      tagWithAttributes(MAX_ATTRIBUTES_PER_TAG + 100) + tagWithAttributes(MAX_ATTRIBUTES_PER_TAG + 1)
    )

    expect(elements.map((element) => element.attrs.length)).toEqual([
      MAX_ATTRIBUTES_PER_TAG,
      MAX_ATTRIBUTES_PER_TAG
    ])
    expect(elements[0].attrs.at(-1)?.name).toBe(`a${MAX_ATTRIBUTES_PER_TAG - 1}`)
    expect(limits).toEqual(['attributes-per-tag'])
  })

  it('reports no cap for a tag exactly at it, nor for repeats of one name', () => {
    const repeated = `<img${' src="a.png"'.repeat(MAX_ATTRIBUTES_PER_TAG * 4)}>`
    const { elements, limits } = scan(tagWithAttributes(MAX_ATTRIBUTES_PER_TAG) + repeated)

    expect(elements.map((element) => element.attrs.length)).toEqual([MAX_ATTRIBUTES_PER_TAG, 1])
    expect(limits).toEqual([])
  })

  it('counts attributes per tag, not per document', () => {
    const { elements, limits } = scan(tagWithAttributes(10).repeat(MAX_ATTRIBUTES_PER_TAG))
    expect(elements).toHaveLength(MAX_ATTRIBUTES_PER_TAG)
    expect(limits).toEqual([])
  })

  it(`scans the first ${MAX_SCAN_CHARS} characters of a longer document and says so`, () => {
    const before = '<img src="kept.png">'
    const markup = `${before}${' '.repeat(MAX_SCAN_CHARS - before.length)}<img src="cut.png">`
    const { elements, limits } = scan(markup)

    expect(elements.map((element) => element.attrs[0].value)).toEqual(['kept.png'])
    expect(limits).toEqual(['document-length'])
  })

  it('reports exactly one element per start tag, however the tags would nest', () => {
    // The audit's page: 400 distinct open formatting tags re-created in each of
    // 20,000 blocks. parse5's tree builder made millions of elements of it.
    let markup = '<p>'
    for (let index = 0; index < 400; index += 1) markup += `<b a=${index}>`
    markup += '<p>x'.repeat(20_000)

    expect(scan(markup).elements).toHaveLength(1 + 400 + 20_000)
  })
})
