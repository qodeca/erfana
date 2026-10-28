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
    ['a hex stop-color', GOOD.replace('<path d="M0 0h24"/>', '<stop stop-color="#000"/>'), /literal colour in stop-color/],
    ['no CSP', GOOD.replace(CSP_META, ''), /Content-Security-Policy/],
    ['a CSP that is not first', GOOD.replace(`${CSP_META}\n<meta charset="utf-8">`, `<meta charset="utf-8">\n${CSP_META}`), /first element in <head>/],
    ['a weakened CSP', GOOD.replace("script-src 'none'", "script-src 'self'"), /Content-Security-Policy/]
  ])('rejects %s', (_label, html, problem) => {
    expect(messages(html)).toMatch(problem)
  })

  it.each([
    ['an em dash in prose', '<p>One — two</p>', /an em dash/],
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
    ['a position through --ds-*', '<div style="--ds-left: 82px; left: var(--ds-left)"></div>']
  ])('accepts %s', (_name, mutation) => {
    expect(messages(GOOD.replace('</main>', `${mutation}\n</main>`))).toBe('')
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

  it('finds relative references in markup and CSS', () => {
    const refs = referencesOf('x.html', '<link href="a.css"><img src="b.png"><div style="background: url(c.svg)"></div>').map(r => r.ref)
    expect(refs).toEqual(['a.css', 'b.png', 'c.svg'])
    expect(referencesOf('x.css', "@import url('./fonts.css');\n@import 'b.css';").map(r => r.ref)).toEqual(['./fonts.css', 'b.css'])
  })
})
