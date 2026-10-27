// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Framework pages (docs/designs/html-preview-comments.md §19 R3-11, spike S7;
 * U-044): inside a hydrated region a block goes before the region's root
 * container, and the clicked element becomes a runtime path inside it.
 */
import { describe, expect, it } from 'vitest'
import { elementOf } from './__fixtures__/commentTestData'
import { detectFrameworkRegions, frameworkPlacementFor } from './frameworkMarkers'
import { indexHtml } from './htmlIndex'

const page = (body: string): string =>
  `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`

describe('detectFrameworkRegions', () => {
  const cases: Array<[string, string, string[], string]> = [
    [
      'Vue 3 fragment comments',
      '<div id="app"><!--[--><ul><li>a</li><li>b</li></ul><!--]--></div>',
      ['vue'],
      'div'
    ],
    [
      'Vue 2 data-server-rendered',
      '<div id="app" data-server-rendered="true"><ul><li>a</li><li>b</li></ul></div>',
      ['vue'],
      'div'
    ],
    [
      'Vue data-v-ssr',
      '<section data-v-ssr><ul><li>a</li><li>b</li></ul></section>',
      ['vue'],
      'section'
    ],
    [
      'Svelte 5 fragments',
      '<div style="display: contents"><!--[--><!--[!--><ul><li>a</li><li>b</li></ul><!--]--></div>',
      ['svelte'],
      'div'
    ],
    [
      'Svelte data-svelte-h',
      '<main><ul data-svelte-h="svelte-1x2y"><li>a</li><li>b</li></ul><!--[--><!--]--></main>',
      ['svelte'],
      'main'
    ],
    [
      'Angular ng-version',
      '<app-root ng-version="17.3.0"><ul><li>a</li><li>b</li></ul></app-root>',
      ['angular'],
      'app-root'
    ],
    [
      'Angular ngh',
      '<app-root><ul ngh="0"><li>a</li><li>b</li></ul></app-root>',
      ['angular'],
      'app-root'
    ]
  ]

  it.each(cases)(
    'U-044 %s → a region rooted at the body child',
    (_name, body, frameworks, rootTag) => {
      const index = indexHtml(page(`<header><p>static</p></header>${body}`))
      const regions = detectFrameworkRegions(index)
      expect(regions.frameworks).toEqual(frameworks)
      expect(regions.roots.map(root => root.tagName)).toEqual([rootTag])
      const li = elementOf(index, 'li', 1)
      expect(frameworkPlacementFor(index, li, regions)).toEqual({
        kind: 'framework',
        container: elementOf(index, rootTag),
        runtimePath: 'ul:nth-of-type(1) > li:nth-of-type(2)'
      })
      // Outside the region, and the container itself, nothing changes.
      expect(frameworkPlacementFor(index, elementOf(index, 'p'), regions)).toEqual({
        kind: 'plain'
      })
      expect(frameworkPlacementFor(index, elementOf(index, rootTag), regions)).toEqual({
        kind: 'plain'
      })
    }
  )

  it('U-044 React markers and ordinary comments are not a framework region', () => {
    const index = indexHtml(page('<div id="root"><!--$--><p>x</p><!--/$--><!-- [ note ] --></div>'))
    expect(detectFrameworkRegions(index)).toEqual({ frameworks: [], roots: [] })
    expect(frameworkPlacementFor(index, elementOf(index, 'p'))).toEqual({ kind: 'plain' })
  })

  it('reports several frameworks in a fixed order, and ignores template content and head', () => {
    const index = indexHtml(
      '<!doctype html><html><head><!--[--><meta ng-version="1"></head><body>' +
        '<template><div data-server-rendered="true"></div></template>' +
        '<app-root ng-version="1"><p>a</p></app-root><div data-svelte-h="s"><p>b</p></div></body></html>'
    )
    const regions = detectFrameworkRegions(index)
    expect(regions.frameworks).toEqual(['svelte', 'angular'])
    expect(regions.roots.map(root => root.tagName).sort()).toEqual(['app-root', 'div'])
  })

  it('markers directly in an explicit <body> make the body the container', () => {
    const index = indexHtml(page('<!--[--><nav><a href="#">x</a></nav><!--]-->'))
    expect(detectFrameworkRegions(index).roots.map(root => root.tagName)).toEqual(['body'])
    expect(frameworkPlacementFor(index, elementOf(index, 'a'))).toEqual({
      kind: 'framework',
      container: elementOf(index, 'body'),
      runtimePath: 'nav:nth-of-type(1) > a:nth-of-type(1)'
    })
  })

  it('markers in an implied <body> leave no container to place a block before', () => {
    const index = indexHtml('<p>first</p><!--[--><p>x</p><!--]-->')
    expect(detectFrameworkRegions(index)).toMatchObject({ frameworks: ['vue'] })
    expect(frameworkPlacementFor(index, elementOf(index, 'p', 1))).toEqual({ kind: 'no-container' })
  })

  it('markers outside <html> content make no region', () => {
    const index = indexHtml('<!--[--><!doctype html><p>x</p>')
    expect(detectFrameworkRegions(index)).toEqual({ frameworks: ['vue'], roots: [] })
    expect(frameworkPlacementFor(index, elementOf(index, 'p'))).toEqual({ kind: 'plain' })
  })

  it('walks an element with 300,000 children without overflowing the stack (a flat 25 MB list, §19 Rev 4)', () => {
    const index = indexHtml(page(`<div data-v-ssr>${'<br>'.repeat(300_000)}</div>`))
    expect(detectFrameworkRegions(index)).toEqual({ frameworks: ['vue'], roots: [elementOf(index, 'div').node] })
  })
})
