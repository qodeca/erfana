// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the pure static-link extractor (Issue #74, work item 8).
 *
 * Covers each collected element type, `url()` in `<style>` bodies and `style=""`
 * attributes, srcset expansion, deduplication, remote/scheme rejection and
 * query/fragment stripping; and frames (issue #124, WI-15): `src`, `srcdoc` and
 * a backslash in a frame's `src`.
 */
import { describe, it, expect } from 'vitest'
import { extractFrameSources, extractStaticLinks } from './linkExtract'

/** A document that mixes every collected kind, plus a remote link that is dropped. */
const MIXED_DOCUMENT = `<html>
      <head>
        <link rel="stylesheet" href="theme.css">
        <style>.hero{background:url(hero.png)}</style>
        <script src="lib.js"></script>
      </head>
      <body style="background:url(page-bg.jpg)">
        <img src="logo.png" srcset="logo.png 1x, logo@2x.png 2x">
        <link href="https://cdn/skip.css">
      </body>
    </html>`

/**
 * Nesting deep enough to overflow the former recursive walk on Node's default
 * stack (it did at 10,000 levels, not at 8,000), yet shallow enough that
 * parse5 – quadratic in nesting depth – still parses it in a few hundred
 * milliseconds.
 */
const DEEP_NESTING = 10_000

describe('extractStaticLinks', () => {
  it('collects <link href>', () => {
    const html = '<html><head><link rel="stylesheet" href="style.css"></head></html>'
    expect(extractStaticLinks(html)).toEqual(['style.css'])
  })

  it('collects <script src>', () => {
    const html = '<html><body><script src="app.js"></script></body></html>'
    expect(extractStaticLinks(html)).toEqual(['app.js'])
  })

  it('collects <img src>', () => {
    const html = '<html><body><img src="pics/logo.png"></body></html>'
    expect(extractStaticLinks(html)).toEqual(['pics/logo.png'])
  })

  it('expands <img srcset> via parseSrcset', () => {
    const html = '<html><body><img src="a.png" srcset="a.png 1x, b.png 2x"></body></html>'
    expect(extractStaticLinks(html).sort()).toEqual(['a.png', 'b.png'])
  })

  it('collects url() in a <style> element body', () => {
    const html =
      '<html><head><style>body{background:url("bg.png")} .h{background:url(hero.jpg)}</style></head></html>'
    expect(extractStaticLinks(html).sort()).toEqual(['bg.png', 'hero.jpg'])
  })

  it('collects url() in a style="" attribute on any element', () => {
    const html = '<html><body><div style="background: url(\'panel.png\')"></div></body></html>'
    expect(extractStaticLinks(html)).toEqual(['panel.png'])
  })

  it('handles all three url() quoting forms', () => {
    const html =
      '<html><head><style>a{background:url(one.png)}b{background:url("two.png")}c{background:url(\'three.png\')}</style></head></html>'
    expect(extractStaticLinks(html).sort()).toEqual(['one.png', 'three.png', 'two.png'])
  })

  it('deduplicates repeated links', () => {
    const html =
      '<html><head><link href="style.css"><link href="style.css"></head><body><img src="style.css"></body></html>'
    expect(extractStaticLinks(html)).toEqual(['style.css'])
  })

  it('keeps relative paths and strips query and fragment', () => {
    const html =
      '<html><head><link href="./a.css?v=2"><link href="../b.css#top"><link href="/abs/c.css"></head></html>'
    expect(extractStaticLinks(html).sort()).toEqual(['../b.css', './a.css', '/abs/c.css'])
  })

  it.each([
    ['http', '<link href="http://cdn/x.css">'],
    ['https', '<link href="https://cdn/x.css">'],
    ['protocol-relative', '<link href="//cdn/x.css">'],
    ['data uri', '<img src="data:image/png;base64,AAAA">'],
    ['blob', '<img src="blob:abc-123">'],
    ['fragment only', '<link href="#section">'],
    ['empty href', '<link href="">'],
    ['javascript scheme', '<script src="javascript:void(0)"></script>']
  ])('drops non-local link (%s)', (_label, fragment) => {
    const html = `<html><head>${fragment}</head></html>`
    expect(extractStaticLinks(html)).toEqual([])
  })

  it('mixes element types, style body and style attr in one document', () => {
    const html = MIXED_DOCUMENT
    expect(extractStaticLinks(html).sort()).toEqual([
      'hero.png',
      'lib.js',
      'logo.png',
      'logo@2x.png',
      'page-bg.jpg',
      'theme.css'
    ])
  })

  it('does not desync on a > inside a quoted attribute value', () => {
    const html = '<html><body><img alt="a > b" src="ok.png"></body></html>'
    expect(extractStaticLinks(html)).toEqual(['ok.png'])
  })

  it('lists the links of a mixed document in document order', () => {
    // An element's own `style=""` comes before its children's links.
    expect(extractStaticLinks(MIXED_DOCUMENT)).toEqual([
      'theme.css',
      'hero.png',
      'lib.js',
      'page-bg.jpg',
      'logo.png',
      'logo@2x.png'
    ])
  })

  it(`walks a ${DEEP_NESTING}-deep nest without overflowing the stack`, () => {
    const html = `${'<div>'.repeat(DEEP_NESTING)}<img src="a.png">`
    expect(extractStaticLinks(html)).toEqual(['a.png'])
  })
})

/** Frame `src` values that name no project file, as `[label, src]`. */
const NON_LOCAL_FRAME_SRC: readonly (readonly [string, string])[] = [
  ['about:blank', 'about:blank'],
  ['https', 'https://cdn.example/page.html'],
  ['protocol-relative', '//cdn.example/page.html'],
  ['backslash protocol-relative', '\\\\cdn.example\\page.html'],
  ['data uri', 'data:text/html,<p>x</p>'],
  ['fragment only', '#top'],
  ['empty', '']
]

describe('extractStaticLinks — frames (issue #124, WI-15)', () => {
  it('collects <iframe src>, the frame document, as a watch candidate', () => {
    const html = '<html><body><iframe src="pages/child.html"></iframe></body></html>'
    expect(extractStaticLinks(html)).toEqual(['pages/child.html'])
  })

  it('reads a backslash in a frame src as a slash, as Chromium does', () => {
    const html = '<iframe src="pages\\child.html"></iframe>'
    expect(extractStaticLinks(html)).toEqual(['pages/child.html'])
  })

  it('leaves a backslash in every other link kind as it is', () => {
    const html = '<link href="css\\a.css"><img src="pics\\logo.png">'
    expect(extractStaticLinks(html).sort()).toEqual(['css\\a.css', 'pics\\logo.png'])
  })

  it('skips the src of a srcdoc frame, which loads no file', () => {
    const html = '<iframe srcdoc="<p>inline</p>" src="ignored.html"></iframe>'
    expect(extractStaticLinks(html)).toEqual([])
  })

  it('leaves the links inside srcdoc markup to the frame-source walk', () => {
    const html =
      '<iframe srcdoc="&lt;link rel=&quot;stylesheet&quot; href=&quot;in.css&quot;&gt;"></iframe>'
    expect(extractStaticLinks(html)).toEqual([])
  })

  it.each(NON_LOCAL_FRAME_SRC)(
    'drops a frame src that names no project file (%s)',
    (_label, src) => {
      expect(extractStaticLinks(`<iframe src="${src}"></iframe>`)).toEqual([])
    }
  )
})

describe('extractFrameSources (issue #124, WI-15)', () => {
  it('finds no frames in a page without any', () => {
    const html = '<html><head><link href="a.css"></head><body><img src="b.png"></body></html>'
    expect(extractFrameSources(html)).toEqual({ src: [], srcdocHtml: [] })
  })

  it('lists each frame src once, in first-seen order, wherever the frame sits', () => {
    const html =
      '<body><iframe src="b.html"></iframe><div><p><iframe src="a.html"></iframe></p></div>' +
      '<iframe src="b.html"></iframe></body>'
    expect(extractFrameSources(html).src).toEqual(['b.html', 'a.html'])
  })

  it('strips query and fragment from a frame src', () => {
    const html = '<iframe src="child.html?view=phone#top"></iframe>'
    expect(extractFrameSources(html).src).toEqual(['child.html'])
  })

  it('reads a backslash in src as a slash before telling local from remote', () => {
    const html = '<iframe src="sub\\page.html"></iframe><iframe src="\\\\cdn\\page.html"></iframe>'
    expect(extractFrameSources(html).src).toEqual(['sub/page.html'])
  })

  it.each(NON_LOCAL_FRAME_SRC)(
    'drops a frame src that names no project file (%s)',
    (_label, src) => {
      expect(extractFrameSources(`<iframe src="${src}"></iframe>`).src).toEqual([])
    }
  )

  it('returns srcdoc markup entity-decoded, in document order', () => {
    const html =
      '<iframe srcdoc="&lt;img src=&quot;one.png&quot;&gt;"></iframe>' +
      `<iframe srcdoc='<link href="two.css">'></iframe>`
    expect(extractFrameSources(html).srcdocHtml).toEqual([
      '<img src="one.png">',
      '<link href="two.css">'
    ])
  })

  it('lets srcdoc win over src, as the browser does', () => {
    const html = '<iframe srcdoc="<p>x</p>" src="ignored.html"></iframe>'
    expect(extractFrameSources(html)).toEqual({ src: [], srcdocHtml: ['<p>x</p>'] })
  })

  it('keeps an empty srcdoc out of both lists', () => {
    const html = '<iframe srcdoc="" src="ignored.html"></iframe>'
    expect(extractFrameSources(html)).toEqual({ src: [], srcdocHtml: [] })
  })
})
