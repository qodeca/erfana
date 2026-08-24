// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the pure static-link extractor (Issue #74, work item 8).
 *
 * Covers each collected element type, `url()` in `<style>` bodies and `style=""`
 * attributes, srcset expansion, deduplication, remote/scheme rejection and
 * query/fragment stripping.
 */
import { describe, it, expect } from 'vitest'
import { extractStaticLinks } from './linkExtract'

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
    const html = `<html>
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
})
