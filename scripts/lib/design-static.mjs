// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The static-by-rule guard for docs/design-system/ and docs/designs/.
 *
 * WHY. The design system is a reference people open over file:// and copy from.
 * It used to fill its numbers with a generated claims.js at page load and drive
 * its demos with inline scripts, so a card could look right in a browser while
 * its committed HTML said nothing, and every card was a place to run code. The
 * rule now is: HTML, CSS and image formats only. Numbers are baked into the
 * text at build time (scripts/design-sync.mjs) and interaction is CSS
 * (:hover, :focus-visible, :checked + label, <details>, :target, popover) or
 * drawn as separate static states.
 *
 * This file is the mechanical half of that rule. It is read by
 * `npm run design -- --check` and by scripts/design-static.test.mjs, which also
 * proves every check below fires on a mutated page. A page that slips a script
 * past it is a bug in THIS file – add the case to the test first.
 *
 * Also here, because they walk the same two trees: the relative-link checker.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'parse5'

/** The two trees the rule covers, repo-relative. */
export const STATIC_TREES = ['docs/design-system', 'docs/designs']

/** File types a static tree may hold. Anything else – a .js above all – fails. */
export const ALLOWED_EXTENSIONS = new Set([
  'html', 'css', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif',
  'woff', 'woff2', 'license', 'md', 'json', 'txt'
])

/** The policy every page carries as the FIRST element of <head>. With it, a
 * script that slipped past this guard still cannot run in the browser. */
export const CSP_CONTENT = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">`

const BANNED_ELEMENTS = new Set(['object', 'embed', 'frame', 'frameset', 'applet'])
const SVG_PAINT_ATTRS = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'])
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i
const SCRIPT_URL = /^(?:javascript|vbscript):/i
const CSS_BANNED = [
  [/expression\s*\(/i, 'CSS expression()'],
  [/-moz-binding\s*:/i, '-moz-binding'],
  [/(?:^|[;{\s])behavior\s*:/i, 'behavior:'],
  [/url\(\s*['"]?\s*(?:javascript|vbscript):/i, 'a script URL in url()']
]

/*
 * HYGIENE, not security. Three rules that walk the same pages and that a
 * reviewer kept finding broken by hand:
 *  - spacing routed through a `--ds-*` custom property to get past the token
 *    lint (positions may go that way; margins, padding and gaps may not);
 *  - an em dash anywhere in a page (the Writing card: en dash, never em);
 *  - a focusable element inside aria-hidden="true" that is not also inert –
 *    it takes focus and is announced as nothing (a frame is a picture).
 */
const SMUGGLED_SPACING = /--ds-(?:margin|padding|gap)[a-z-]*\s*:/gi
const EM_DASH = '\u2014'
const FOCUSABLE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'summary'])

/** Every file under `dir`, repo-relative and posix, dot-files included. */
export function walkAll(root, dir) {
  const found = []
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else found.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  const abs = path.join(root, dir)
  if (statSync(abs, { throwIfNoEntry: false })) visit(abs)
  return found.sort()
}

/** The extension the allowlist judges: the last one, so `x.woff2.license` is "license". */
export function extensionOf(file) {
  const base = path.posix.basename(file)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** 1-based line of a character offset. */
function lineAt(text, offset) {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

/** Depth-first walk of a parse5 tree, template content included. */
export function* nodesOf(node) {
  yield node
  for (const child of node.childNodes ?? []) yield* nodesOf(child)
  if (node.content) yield* nodesOf(node.content)
}

/** Strip the whitespace and control characters a browser ignores inside a URL scheme. */
function schemeOf(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000- \u007f]+/g, '')
}

/** Problems in a CSS text, as [{ line, message }] with lines relative to `baseLine`. */
export function cssProblems(css, baseLine = 1) {
  const problems = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  for (const hit of clean.matchAll(SMUGGLED_SPACING)) {
    problems.push({
      line: baseLine + lineAt(clean, hit.index) - 1,
      message: 'spacing through a --ds-* custom property – use a --space-* token (only positions may go through --ds-*)'
    })
  }
  for (const [re, what] of CSS_BANNED) {
    const global = new RegExp(re.source, 'gi')
    for (const hit of clean.matchAll(global)) {
      problems.push({ line: baseLine + lineAt(clean, hit.index) - 1, message: `${what} is banned in a static tree` })
    }
  }
  return problems
}

/**
 * Problems in one HTML or SVG document, as [{ line, message }].
 * `requireCsp` is true for a page (.html) and false for an image (.svg).
 */
export function markupProblems(text, { requireCsp = true } = {}) {
  const problems = []
  const doc = parse(text, { sourceCodeLocationInfo: true })
  const at = node => node.sourceCodeLocation?.startLine ?? 1

  for (const node of nodesOf(doc)) {
    if (!node.tagName) continue
    const tag = node.tagName.toLowerCase()
    const line = at(node)
    const attr = name => node.attrs.find(a => a.name.toLowerCase() === name)?.value

    if (tag === 'script') problems.push({ line, message: '<script> is banned – the design system runs no JavaScript' })
    if (BANNED_ELEMENTS.has(tag)) problems.push({ line, message: `<${tag}> is banned – it can load active content` })

    for (const { name, value } of node.attrs) {
      const lower = name.toLowerCase()
      const local = lower.includes(':') ? lower.slice(lower.indexOf(':') + 1) : lower
      if (/^on/.test(local)) problems.push({ line, message: `event attribute ${name}= is banned` })
      if (SCRIPT_URL.test(schemeOf(value))) problems.push({ line, message: `a script URL in ${name}= is banned` })
      if (lower === 'style') {
        for (const p of cssProblems(value, line)) problems.push(p)
      }
      if (SVG_PAINT_ATTRS.has(lower) && LITERAL_COLOUR.test(value)) {
        problems.push({ line, message: `literal colour in ${name}="${value}" – paint SVG with currentColor or a token through CSS` })
      }
    }

    if (tag === 'iframe' && attr('srcdoc') !== undefined) {
      for (const p of markupProblems(attr('srcdoc'), { requireCsp: false })) {
        problems.push({ line, message: `iframe srcdoc: ${p.message}` })
      }
    }
    if (tag === 'link') {
      const rel = (attr('rel') ?? '').toLowerCase().split(/\s+/)
      if (rel.includes('modulepreload')) problems.push({ line, message: 'link rel=modulepreload is banned' })
      if ((attr('as') ?? '').toLowerCase() === 'script') problems.push({ line, message: 'link as=script is banned' })
    }
    if ((tag === 'set' || tag === 'animate') && /^(?:xlink:)?href$/i.test(attr('attributename') ?? '')) {
      problems.push({ line, message: `SMIL <${tag}> animating href is banned` })
    }
    if (tag === 'meta' && (attr('http-equiv') ?? '').toLowerCase() === 'refresh') {
      const target = /url\s*=\s*['"]?(.*)$/i.exec(attr('content') ?? '')?.[1] ?? ''
      if (SCRIPT_URL.test(schemeOf(target))) problems.push({ line, message: 'meta refresh to a script URL is banned' })
    }
    if (tag === 'style') {
      const css = node.childNodes.map(c => c.value ?? '').join('')
      const first = node.childNodes[0]?.sourceCodeLocation?.startLine ?? line
      for (const p of cssProblems(css, first)) problems.push(p)
    }
  }

  if (requireCsp) {
    const offset = text.indexOf(EM_DASH)
    if (offset >= 0) problems.push({ line: lineAt(text, offset), message: 'an em dash – use an en dash (–), as the Writing card decides' })
    for (const line of focusableInsideHidden(doc)) {
      problems.push({ line, message: 'a focusable element inside aria-hidden="true" – add inert to the frame, or tabindex="-1" to the control' })
    }
  }

  if (requireCsp) {
    const html = doc.childNodes.find(n => n.tagName === 'html')
    const head = html?.childNodes.find(n => n.tagName === 'head')
    const first = head?.childNodes.find(n => n.tagName)
    const ok =
      first?.tagName === 'meta' &&
      first.sourceCodeLocation && // parse5 invents a <head> when the page has none
      (first.attrs.find(a => a.name === 'http-equiv')?.value ?? '').toLowerCase() === 'content-security-policy' &&
      (first.attrs.find(a => a.name === 'content')?.value ?? '').replace(/\s+/g, ' ').trim() === CSP_CONTENT
    if (!ok) {
      problems.push({
        line: first ? at(first) : 1,
        message: `the first element in <head> must be ${CSP_META}`
      })
    }
  }
  return problems
}

/** Lines of focusable elements that sit inside aria-hidden="true" without an inert ancestor. */
function focusableInsideHidden(doc) {
  const lines = []
  const visit = (node, hidden, inert) => {
    if (node.tagName) {
      const attr = name => node.attrs.find(a => a.name === name)?.value
      if (attr('inert') !== undefined) inert = true
      if (attr('aria-hidden') === 'true') hidden = true
      if (hidden && !inert) {
        const tabindex = attr('tabindex')
        const focusable =
          tabindex !== undefined
            ? Number(tabindex) >= 0
            : (FOCUSABLE_TAGS.has(node.tagName) && attr('disabled') === undefined && attr('type') !== 'hidden') ||
              (node.tagName === 'a' && attr('href') !== undefined)
        if (focusable) lines.push(node.sourceCodeLocation?.startLine ?? 1)
      }
    }
    for (const child of node.childNodes ?? []) visit(child, hidden, inert)
    if (node.content) visit(node.content, hidden, inert)
  }
  visit(doc, false, false)
  return lines
}

/** Problems in one file of a static tree, as "path:line message" strings. */
export function fileProblems(file, text) {
  const ext = extensionOf(file)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return [`${file}: .${ext || '(none)'} files are not allowed in a static tree – HTML, CSS, images, fonts and docs only`]
  }
  let found = []
  if (ext === 'html') found = markupProblems(text, { requireCsp: true })
  else if (ext === 'svg') found = markupProblems(text, { requireCsp: false })
  else if (ext === 'css') found = cssProblems(text)
  return found.map(p => `${file}:${p.line} ${p.message}`)
}

/** Every static-rule problem across both trees. */
export function staticProblems(root, trees = STATIC_TREES) {
  const problems = []
  for (const tree of trees) {
    for (const file of walkAll(root, tree)) {
      const ext = extensionOf(file)
      const readable = ['html', 'svg', 'css'].includes(ext)
      const text = readable ? readFileSync(path.join(root, file), 'utf8') : ''
      problems.push(...fileProblems(file, text))
    }
  }
  return problems
}

/* ---------- relative links ---------- */

const URL_ATTRS = new Set(['href', 'src', 'poster', 'data', 'xlink:href'])

/** Ids (and legacy name anchors) a page declares, for #fragment checks. */
function idsOf(text) {
  const ids = new Set()
  for (const node of nodesOf(parse(text))) {
    for (const { name, value } of node.attrs ?? []) if (name === 'id' || (name === 'name' && node.tagName === 'a')) ids.add(value)
  }
  return ids
}

/** Relative references in a page or stylesheet, as [{ line, ref }]. */
export function referencesOf(file, text) {
  const refs = []
  const fromCss = (css, base) => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    for (const hit of clean.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g)) {
      refs.push({ line: base + lineAt(clean, hit.index) - 1, ref: (hit[2] ?? hit[4]).trim() })
    }
  }
  if (file.endsWith('.css')) {
    fromCss(text, 1)
    return refs
  }
  for (const node of nodesOf(parse(text, { sourceCodeLocationInfo: true }))) {
    if (!node.tagName) continue
    const line = node.sourceCodeLocation?.startLine ?? 1
    for (const { name, value } of node.attrs) {
      if (URL_ATTRS.has(name.toLowerCase())) refs.push({ line, ref: value.trim() })
      if (name === 'style') fromCss(value, line)
    }
    if (node.tagName === 'style') fromCss(node.childNodes.map(c => c.value ?? '').join(''), node.childNodes[0]?.sourceCodeLocation?.startLine ?? line)
  }
  return refs
}

/** Every relative href/src in both trees that does not resolve, as strings. */
export function brokenLinks(root, trees = STATIC_TREES) {
  const problems = []
  const idCache = new Map()
  const ids = abs => {
    if (!idCache.has(abs)) idCache.set(abs, idsOf(readFileSync(abs, 'utf8')))
    return idCache.get(abs)
  }
  for (const tree of trees) {
    for (const file of walkAll(root, tree)) {
      if (!/\.(html|css|svg)$/.test(file)) continue
      const abs = path.join(root, file)
      for (const { line, ref } of referencesOf(file, readFileSync(abs, 'utf8'))) {
        if (ref === '' || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue
        const [beforeHash, fragment] = ref.split('#')
        const target = beforeHash.split('?')[0]
        const resolved = target === '' ? abs : path.resolve(path.dirname(abs), decodeURIComponent(target))
        if (!existsSync(resolved)) {
          problems.push(`${file}:${line} broken link "${ref}"`)
          continue
        }
        if (fragment && resolved.endsWith('.html') && !ids(resolved).has(decodeURIComponent(fragment))) {
          problems.push(`${file}:${line} link "${ref}" names an anchor the target does not have`)
        }
      }
    }
  }
  return problems
}
