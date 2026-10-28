// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tree-free extractor finds what the former tree walk found (issue #124,
 * security audit): the same links in the same order, and the same frames, on
 * every page of the preview corpus (`e2e/fixtures/html-preview-corpus/**`), of
 * the design system and of the capture demo project, and on every `srcdoc`
 * document inside them. The oracle is the extractor as it was, frozen in
 * `__test-helpers__/linkExtractTreeReference.ts`.
 *
 * What only a tree builder repairs can read differently (`htmlElementScan.ts`);
 * each such difference is pinned at the end, with what it costs.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  referenceFrameSources,
  referenceStaticLinks
} from './__test-helpers__/linkExtractTreeReference'
import { extractFrameSources, extractStaticLinks } from './linkExtract'

const ROOT = join(__dirname, '..', '..', '..', '..')
const CORPUS = join(ROOT, 'e2e', 'fixtures', 'html-preview-corpus')
const MORE_PAGES = [join(ROOT, 'docs', 'design-system'), join(ROOT, 'scripts', 'capture', 'demo-project')]
/** The corpus held 45 pages when this was written: a much smaller count means a wrong path. */
const MIN_CORPUS_PAGES = 40

function htmlFilesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()))
    .map((file) => join(folder, file))
    .sort()
}

/** A page and each `srcdoc` document in it, as deep as frames are followed. */
function documentsOf(label: string, html: string, depth = 0): { label: string; html: string }[] {
  const nested =
    depth < PREVIEW_LIMITS.MAX_FRAME_DEPTH
      ? referenceFrameSources(html).srcdocHtml.flatMap((srcdoc, index) =>
          documentsOf(`${label} › srcdoc ${index}`, srcdoc, depth + 1)
        )
      : []
  return [{ label, html }, ...nested]
}

function expectParity(label: string, html: string): void {
  expect(extractStaticLinks(html), label).toEqual(referenceStaticLinks(html))
  expect(extractFrameSources(html), label).toEqual(referenceFrameSources(html))
}

describe('extractStaticLinks / extractFrameSources – parity with the former tree walk', () => {
  it('agrees on every page of the preview corpus and each srcdoc in it', () => {
    const pages = htmlFilesUnder(CORPUS)
    expect(pages.length).toBeGreaterThanOrEqual(MIN_CORPUS_PAGES)

    let documents = 0
    let links = 0
    let frames = 0
    for (const page of pages) {
      for (const document of documentsOf(relative(ROOT, page), readFileSync(page, 'utf8'))) {
        expectParity(document.label, document.html)
        documents += 1
        links += referenceStaticLinks(document.html).length
        frames += referenceFrameSources(document.html).src.length
      }
    }
    // Links, frame files and srcdoc documents really were compared.
    expect(documents).toBeGreaterThan(pages.length)
    expect(links).toBeGreaterThan(0)
    expect(frames).toBeGreaterThan(0)
  })

  it('agrees on the design-system and demo-project pages', () => {
    const pages = MORE_PAGES.flatMap(htmlFilesUnder)
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      for (const document of documentsOf(relative(ROOT, page), readFileSync(page, 'utf8'))) {
        expectParity(document.label, document.html)
      }
    }
  })

  it.each([
    ['markup in a script', `<script>document.write('<img src="no.png">'); if (a<b) {}</script><img src="yes.png">`],
    ['an escaped script', `<script><!--<script>'<img src="no.png">'</script>--></script><img src="yes.png">`],
    ['markup in a textarea and a title', '<textarea><link href="no.css"></textarea><title><img src="no.png"></title><link href="yes.css">'],
    ['markup in noscript, xmp and iframe', '<noscript><img src="a.png"></noscript><xmp><img src="b.png"></xmp><iframe src="f.html"><img src="c.png"></iframe>'],
    ['everything after plaintext', '<img src="a.png"><plaintext><img src="no.png">'],
    ['markup in a comment', '<!-- <img src="no.png"> --><img src="yes.png">'],
    ['template content', '<template style="background:url(t.png)"><img src="no.png"><template><img src="no.png"></template></template><img src="yes.png">'],
    ['an <image> tag', '<image src="i.png">'],
    ['an SVG style and CDATA', '<svg><style><![CDATA[ .a{background:url(c.png)} ]]></style><image href="x.png"/></svg><img src="yes.png">'],
    ['xlink:href in SVG', '<svg><link xlink:href="x.css"/><script xlink:href="no.js"/></svg>'],
    ['a self-closed svg', '<svg/><style><img src="no.png"></style><img src="yes.png">'],
    ['a breakout from SVG', '<svg><img src="b.png"><style><img src="no.png"></style></svg>'],
    ['HTML in foreignObject', '<svg><foreignObject><style><img src="no.png"></style><img src="fo.png"></foreignObject><style><rect style="fill:url(r.png)"/></style></svg>'],
    ['HTML in MathML', '<math><mi><style><img src="no.png"></style></mi><mtext><img src="m.png"></mtext></math>'],
    ['a repeated html tag', '<html><body><html style="background:url(h.png)"><img src="i.png">'],
    ['a link after the body', '<body><img src="b.png"></body><link href="late.css">'],
    ['a repeated attribute', '<img src="first.png" src="second.png">'],
    ['upper-case tags', '<IMG SRC="up.png"><LINK HREF="up.css">'],
    ['formatting re-created in a new block', '<p><b style="background:url(b.png)">x<p>y<img src="i.png">'],
    ['misnested formatting', '<a href="x"><div><img src="1.png"></a><img src="2.png"></div>'],
    ['frames of every kind', '<iframe srcdoc="<img src=&quot;in.png&quot;>"></iframe><iframe src="f.html"></iframe><iframe src="sub\\g.html"></iframe>'],
    ['a NUL in a style', '<style>a{background:url(n\u0000.png)}</style><svg><style>a{background:url(m\u0000.png)}</style></svg>']
  ])('agrees on %s', (_label, html) => {
    expectParity(_label, html)
  })
})

/**
 * Where the scan and the tree walk differ, as `[markup, scan, tree walk]`: only
 * on markup a tree builder repairs. A difference adds or reorders a watch
 * candidate – each still confined to the project before it is watched or read –
 * or, for the SVG style, leaves one file unwatched.
 */
const KNOWN_DIFFERENCES: readonly (readonly [string, string, string[], string[]])[] = [
  [
    'SVG style text after a child element is not read',
    '<svg><style>.a{background:url(one.png)}<rect style="fill:url(r.png)"/>.b{background:url(two.png)}</style></svg>',
    ['one.png', 'r.png'],
    ['one.png', 'two.png', 'r.png']
  ],
  [
    'table content keeps its place ahead of the table',
    '<table style="background:url(t.png)"><img src="i.png"><tr><td><img src="c.png"></td></tr></table>',
    ['t.png', 'i.png', 'c.png'],
    ['i.png', 't.png', 'c.png']
  ],
  [
    'content of a <select> parse5 drops is read',
    '<select><img src="s.png"><style>a{background:url(st.png)}</style><option style="background:url(o.png)">x</option></select>',
    ['s.png', 'st.png', 'o.png'],
    ['o.png']
  ],
  [
    'a repeated <body> keeps its own attributes',
    '<body style="background:url(a.png)"><body style="background:url(b.png)">',
    ['a.png', 'b.png'],
    ['a.png']
  ],
  [
    'a nested <form> parse5 drops is read',
    '<form><form style="background:url(f.png)"></form></form>',
    ['f.png'],
    []
  ],
  [
    'content of a <frameset> parse5 drops is read',
    '<frameset><frame src="f.html"><img src="no.png"></frameset>',
    ['no.png'],
    []
  ]
]

describe('extractStaticLinks – known differences from the former tree walk', () => {
  it.each(KNOWN_DIFFERENCES)('%s', (_label, html, scan, tree) => {
    expect(extractStaticLinks(html)).toEqual(scan)
    expect(referenceStaticLinks(html)).toEqual(tree)
  })
})
