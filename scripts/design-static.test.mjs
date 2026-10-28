// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The static-by-rule guard: docs/design-system/ and docs/designs/ hold HTML, CSS
 * and images only – no JavaScript in any form. The tree check below is the
 * rule; the mutation cases prove each branch of the guard actually fires, so a
 * green tree check means something.
 *
 * @see scripts/lib/design-static.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  CSP_META,
  brokenLinks,
  cssProblems,
  extensionOf,
  fileProblems,
  markupProblems,
  referencesOf,
  smallTextProblems,
  staticProblems
} from './lib/design-static.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** A page that passes every check; each mutation below breaks exactly one rule. */
const GOOD = `<!DOCTYPE html>
<html lang="en">
<head>
${CSP_META}
<meta charset="utf-8">
<title>Good</title>
<style>.x { color: var(--color-text-primary); }</style>
</head>
<body>
<main>
<a href="#top" id="top">Top</a>
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M0 0h24"/></svg>
<details><summary>More</summary><p>Static.</p></details>
<button popovertarget="p">Open</button><div popover id="p">Popover</div>
</main>
</body>
</html>`

const messages = html => markupProblems(html).map(p => p.message).join('\n')

describe('the design trees are static', () => {
  it('has no script, handler, script URL or active content anywhere', () => {
    expect(staticProblems(ROOT)).toEqual([])
  })

  it('has no broken relative link', () => {
    expect(brokenLinks(ROOT)).toEqual([])
  })
})

describe('the guard itself', () => {
  it('accepts a static page with details, popover and inline SVG', () => {
    expect(markupProblems(GOOD)).toEqual([])
  })

  it.each([
    ['an inline script', GOOD.replace('<main>', '<main><script>alert(1)</script>'), /<script> is banned/],
    ['an external script', GOOD.replace('<main>', '<main><script src="x.js"></script>'), /<script> is banned/],
    ['a script inside SVG', GOOD.replace('<path d="M0 0h24"/>', '<script>alert(1)</script>'), /<script> is banned/],
    ['a script inside a template', GOOD.replace('<main>', '<main><template><script>1</script></template>'), /<script> is banned/],
    ['an onclick handler', GOOD.replace('<button ', '<button onclick="x()" '), /event attribute onclick/],
    ['an SVG onload handler', GOOD.replace('<svg ', '<svg onload="x()" '), /event attribute onload/],
    ['a javascript: link', GOOD.replace('href="#top"', 'href="javascript:alert(1)"'), /script URL in href/],
    ['an obfuscated javascript: link', GOOD.replace('href="#top"', 'href=" java\tscript:alert(1)"'), /script URL in href/],
    ['a vbscript: link', GOOD.replace('href="#top"', 'href="vbscript:x"'), /script URL in href/],
    ['an iframe to an outside page', GOOD.replace('<main>', '<main><iframe src="https://example.com/"></iframe>'), /<iframe src> is banned/],
    ['an iframe to a relative page', GOOD.replace('<main>', '<main><iframe src="other.html"></iframe>'), /<iframe src> is banned/],
    ['an external iframe with a protocol-relative src', GOOD.replace('<main>', '<main><iframe src="//evil.example/x"></iframe>'), /<iframe src> is banned/],
    ['an iframe srcdoc with script', GOOD.replace('<main>', '<main><iframe srcdoc="&lt;script&gt;1&lt;/script&gt;"></iframe>'), /iframe srcdoc/],
    ['an object', GOOD.replace('<main>', '<main><object data="x.svg"></object>'), /<object> is banned/],
    ['an embed', GOOD.replace('<main>', '<main><embed src="x.svg">'), /<embed> is banned/],
    ['a modulepreload', GOOD.replace('<title>', '<link rel="modulepreload" href="x.mjs"><title>'), /modulepreload/],
    ['a preload as=script', GOOD.replace('<title>', '<link rel="preload" as="script" href="x"><title>'), /as=script/],
    ['SMIL animating href', GOOD.replace('<path d="M0 0h24"/>', '<a><set attributeName="href" to="javascript:alert(1)"/></a>'), /SMIL/],
    ['a meta refresh to javascript:', GOOD.replace('<title>', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><title>'), /meta refresh/],
    ['a CSS expression()', GOOD.replace('.x {', '.x { width: expression(alert(1));'), /expression/],
    ['a -moz-binding', GOOD.replace('.x {', '.x { -moz-binding: url(x.xml#y);'), /-moz-binding/],
    ['a behavior:', GOOD.replace('.x {', '.x { behavior: url(x.htc);'), /behavior/],
    ['a script URL in a style attribute', GOOD.replace('<main>', '<main style="background: url(javascript:x)">'), /script URL in url\(\)/],
    ['a hex fill on SVG', GOOD.replace('fill="none"', 'fill="#ff0000"'), /literal colour in fill/],
    ['an rgb stroke on SVG', GOOD.replace('stroke="currentColor"', 'stroke="rgb(1,2,3)"'), /literal colour in stroke/],
    ['a named colour on SVG', GOOD.replace('fill="none"', 'fill="red"'), /an SVG paint attribute takes none, currentColor/],
    ['a hex colour after a url() on SVG', GOOD.replace('fill="none"', 'fill="url(#g) #ff0000"'), /literal colour in fill/],
    ['a hex stop-color', GOOD.replace('<path d="M0 0h24"/>', '<stop stop-color="#000"/>'), /literal colour in stop-color/],
    ['no CSP', GOOD.replace(CSP_META, ''), /Content-Security-Policy/],
    ['a CSP that is not first', GOOD.replace(`${CSP_META}\n<meta charset="utf-8">`, `<meta charset="utf-8">\n${CSP_META}`), /first element in <head>/],
    ['a weakened CSP', GOOD.replace("script-src 'none'", "script-src 'self'"), /Content-Security-Policy/],
    ['a CSP without frame-src', GOOD.replace(" frame-src 'none';", ''), /Content-Security-Policy/],
    // The permission-band pattern (A11Y-01): a missing closing quote turns the rest of the tag into attribute names.
    [
      'a missing quote that swallows the next tag',
      GOOD.replace('<main>', '<main><div class="erf-band" aria-hidden="true><div class="erf-band__bar"></div>'),
      /malformed/
    ],
    ['attributes run together', GOOD.replace('<main>', '<main><div class="a"id="b"></div>'), /malformed markup \(missing-whitespace-between-attributes\)/]
  ])('rejects %s', (_label, html, problem) => {
    expect(messages(html)).toMatch(problem)
  })

  it.each([
    ['an em dash in prose', '<p>One — two</p>', /an em dash/],
    ['an em dash as &mdash;', '<p>One &mdash; two</p>', /an em dash/],
    ['an em dash as &#8212;', '<p>One &#8212; two</p>', /an em dash/],
    ['an em dash as &#x2014; in an attribute', '<p title="a &#x2014; b">x</p>', /an em dash/],
    ['margin from a --ds-* property', '<div style="margin-top: var(--ds-anything)"></div>', /margin-top reads a --ds-\* custom property/],
    ['a gap from a --ds-* property', '<div style="gap: var(--ds-step)"></div>', /gap reads a --ds-\* custom property/],
    ['padding from a --ds-* property in a style block', '<style>.y { padding: 0 var(--ds-pad); }</style>', /padding reads a --ds-\* custom property/],
    ['a button inside aria-hidden', '<div aria-hidden="true"><button>Go</button></div>', /focusable element inside aria-hidden/],
    ['a link inside aria-hidden', '<div aria-hidden="true"><a href="#top">x</a></div>', /focusable element inside aria-hidden/],
    ['tabindex 0 inside aria-hidden', '<div aria-hidden="true"><span tabindex="0">x</span></div>', /focusable element inside aria-hidden/],
    ['spacing through --ds-*', '<div style="--ds-margin-top: 14px; margin-top: var(--ds-margin-top)"></div>', /spacing through a --ds-\* custom property/]
  ])('refuses %s', (_name, mutation, problem) => {
    expect(messages(GOOD.replace('</main>', `${mutation}\n</main>`))).toMatch(problem)
  })

  it.each([
    ['an inert picture', '<div inert aria-hidden="true"><button>Go</button></div>'],
    ['a control taken out of the tab order', '<div aria-hidden="true"><button tabindex="-1">Go</button></div>'],
    ['a position through --ds-*', '<div style="--ds-left: 82px; left: var(--ds-left)"></div>'],
    ['an inset position through --ds-*', '<div style="inset-block-start: var(--ds-inset-block-start)"></div>'],
    ['an SVG paint from a fragment that looks like hex', '<svg><path fill="url(#abc123)" stroke="var(--color-text-primary)" d="M0 0"/></svg>'],
    ['an en dash and an &ndash;', '<p>One – two &ndash; three</p>']
  ])('accepts %s', (_name, mutation) => {
    expect(messages(GOOD.replace('</main>', `${mutation}\n</main>`))).toBe('')
  })

  it('reports every em dash on its own line, however it is spelled', () => {
    const page = GOOD.replace('</main>', '<p>a — b</p>\n<p>c &mdash; d</p>\n<p>e &#8212; f</p>\n</main>')
    const lines = markupProblems(page).filter(p => /em dash/.test(p.message)).map(p => p.line)
    const first = page.split('\n').findIndex(l => l.includes('a — b')) + 1
    expect(lines).toEqual([first, first + 1, first + 2])
  })

  it('checks the colours in an SVG image\'s <style> and style= values', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>path { fill: #f00; }</style><path style="stroke: rgb(1,2,3)" d="M0 0"/></svg>'
    const found = fileProblems('docs/designs/x/pic.svg', svg).join('\n')
    expect(found).toMatch(/literal colour "#f00" in <style>/)
    expect(found).toMatch(/literal colour "rgb\(" in a style= value/)
    expect(fileProblems('docs/designs/x/pic.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill: url(#a1b2c3)" d="M0 0"/></svg>')).toEqual([])
  })

  it('does not require a CSP inside an SVG image', () => {
    expect(markupProblems('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', { requireCsp: false })).toEqual([])
  })

  it('reports CSS problems with their line', () => {
    expect(cssProblems('a {}\n/* expression( in a comment is fine */\nb { width: expression(1) }')).toEqual([
      { line: 3, message: 'CSS expression() is banned in a static tree' }
    ])
  })

  it.each([
    ['docs/design-system/x.js', /\.js files are not allowed/],
    ['docs/designs/a/demo.mjs', /\.mjs files are not allowed/],
    ['docs/designs/a/run.sh', /\.sh files are not allowed/],
    ['docs/designs/a/Makefile', /\.\(none\) files are not allowed/]
  ])('rejects the file %s by extension', (file, problem) => {
    expect(fileProblems(file, '').join('\n')).toMatch(problem)
  })

  it.each(['x.html', 'x.css', 'x.svg', 'x.png', 'x.woff2', 'CascadiaMono-Regular.woff2.license', 'README.md', 'claims.json', 'x.native.txt'])(
    'allows %s by extension',
    file => {
      expect(extensionOf(file)).not.toBe('js')
      expect(fileProblems(`docs/design-system/${file}`, file.endsWith('.html') ? GOOD : '')).toEqual([])
    }
  )

  it('reports a link whose % escape does not decode, instead of crashing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-links-'))
    try {
      mkdirSync(path.join(dir, 'docs/designs'), { recursive: true })
      writeFileSync(path.join(dir, 'docs/designs/a.html'), '<a href="b%E0%A4%A.html">x</a><a href="a.html#%ZZ">y</a>')
      expect(brokenLinks(dir, ['docs/designs'])).toEqual([
        'docs/designs/a.html:1 malformed link "b%E0%A4%A.html" – a % escape that does not decode',
        'docs/designs/a.html:1 malformed link "a.html#%ZZ" – a % escape that does not decode'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('finds relative references in markup and CSS', () => {
    const refs = referencesOf('x.html', '<link href="a.css"><img src="b.png"><div style="background: url(c.svg)"></div>').map(r => r.ref)
    expect(refs).toEqual(['a.css', 'b.png', 'c.svg'])
    expect(referencesOf('x.css', "@import url('./fonts.css');\n@import 'b.css';").map(r => r.ref)).toEqual(['./fonts.css', 'b.css'])
  })
})

describe('documentation text never goes below 13px', () => {
  const page = css => GOOD.replace('.x { color: var(--color-text-primary); }', css)

  it.each([
    ['a caption at --text-sm', '.caption { font-size: var(--text-sm); }'],
    ['a label at --text-xs', '.label { color: red; font-size: var(--text-xs); }'],
    ['a font shorthand with --text-sm', '.note { font: var(--text-sm) var(--font-sans); }'],
    ['a rule inside @media', '@media (min-width: 1px) { .caption { font-size: var(--text-sm); } }'],
    ['a list where only one selector is a component', '.erf-tab, .caption { font-size: var(--text-xs); }'],
    ['a class that merely contains erf-', '.not-erf-thing { font-size: var(--text-sm); }']
  ])('rejects %s', (_name, css) => {
    expect(messages(page(css))).toMatch(/documentation text below 13px/)
  })

  it.each([
    ['the floor token', '.caption { font-size: var(--ds-text-small); }'],
    ['a component selector', '.erf-tab__label { font-size: var(--text-sm); }'],
    ['a component descendant', '.ds-frame .erf-badge { font-size: var(--text-xs); }'],
    ['an attribute selector on erf-', ":where([class*='erf-']) code { font-size: var(--text-sm); }"],
    ['a mockup comment before the selector', '/* mockup: app scale */\n.mock__row { font-size: var(--text-sm); }'],
    ['a mockup comment inside the rule', '.mock__row { /* mockup: app scale */ font-size: var(--text-sm); }'],
    ['a comment that mentions the token', '.x { /* was var(--text-sm) */ font-size: var(--text-base); }']
  ])('accepts %s', (_name, css) => {
    expect(messages(page(css))).toBe('')
  })

  it('reports the line of the declaration', () => {
    expect(smallTextProblems('a { color: red; }\n.caption {\n  font-size: var(--text-sm);\n}').map(p => p.line)).toEqual([3])
  })

  const inline = html => GOOD.replace('<main>', `<main>${html}`)

  it.each([
    ['a caption styled inline', '<p style="font-size: var(--text-sm)">A note</p>'],
    ['an inline shorthand at --text-xs', '<span style="font: var(--text-xs) var(--font-sans)">A label</span>']
  ])('rejects %s', (_name, html) => {
    expect(messages(inline(html))).toMatch(/documentation text below 13px in a style= value/)
  })

  it.each([
    ['inside an inert frame', '<div inert><p style="font-size: var(--text-sm)">A hint</p></div>'],
    ['inside an aria-hidden frame', '<div aria-hidden="true"><p style="font-size: var(--text-sm)">A hint</p></div>'],
    ['inside an erf- component', '<div class="erf-toolbar"><span style="font-size: var(--text-sm)">x</span></div>'],
    ['with a mockup comment in the value', '<span style="font-size: var(--text-xs) /* mockup: the step */">x</span>'],
    ['at the floor token', '<p style="font-size: var(--ds-text-small)">A note</p>']
  ])('accepts an inline style %s', (_name, html) => {
    expect(messages(inline(html))).toBe('')
  })

  it('checks ds.css but not a component stylesheet', () => {
    const css = '.caption { font-size: var(--text-sm); }'
    expect(fileProblems('docs/design-system/ds.css', css).join('\n')).toMatch(/ds\.css:1 documentation text below 13px/)
    expect(fileProblems('docs/design-system/system/components/tabs/tabs.css', css)).toEqual([])
  })
})
