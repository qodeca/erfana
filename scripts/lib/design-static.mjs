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
export const CSP_CONTENT =
  "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'"
export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">`

const BANNED_ELEMENTS = new Set(['object', 'embed', 'frame', 'frameset', 'applet'])
const SVG_PAINT_ATTRS = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'])
/** The only values an SVG paint attribute may take: a token comes in through
 * CSS or var(), never as a literal or a named colour. */
const PAINT_VALUE = /^(?:none|currentColor|url\(\s*#[^)]*\)|var\(\s*--[\w-]+\s*(?:,[^)]*)?\))$/i
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i
/** A url(...) reference is stripped before the colour test: url(#a1b2c3) names
 * a fragment, not a colour. */
const withoutUrls = value => value.replace(/url\(\s*(['"]?)[^)]*?\1\s*\)/gi, 'url()')
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
/* The same rule judged where the value is USED: a margin, padding or gap whose
 * value reads a --ds-* property, whatever that property is called. Positions
 * (top, left, inset-*) may still go through --ds-*, as above – a drawn popover
 * pinned at a spot is a position, not spacing. */
const SPACING_FROM_DS = /(?:^|[;{\s])((?:margin|padding)(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:\s*[^;}]*var\(\s*--ds-/gi
const EM_DASH = '\u2014'
/** An em dash as the source spells it: the character or any entity for it. */
const EM_DASH_SOURCE = /\u2014|&mdash;?|&#0*8212;?|&#x0*2014;?/gi
const FOCUSABLE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'summary'])

/*
 * READABILITY. Documentation text – prose, captions, notes, table labels, meta
 * lines, code in prose – never goes below --ds-text-small (13px). The two
 * label sizes, --text-xs (10px) and --text-sm (11px), are for the app's own
 * chrome, so a rule may use them only when it draws the app at real scale:
 * its selector names an erf- class, or the rule carries a mockup comment
 * (any comment starting "mockup") before its selector or inside its body.
 * Applies to ds.css and to every <style> block in the two trees; component
 * CSS files (which ship verbatim) are out of scope.
 */
export const DOC_TEXT_CSS = new Set(['docs/design-system/ds.css'])
const SMALL_TEXT = /\bfont(?:-size)?\s*:[^;}]*var\(\s*--text-(?:xs|sm)\s*\)/gi
const MOCKUP_MARK = /\/\*\s*mockup\b/i

/**
 * Rules whose font-size is --text-xs or --text-sm without an erf- selector or a
 * mockup comment, as [{ line, message }] with lines relative to `baseLine`.
 */
export function smallTextProblems(css, baseLine = 1) {
  const problems = []
  // Walk the text once, keeping each block's prelude (with any comments that
  // precede it). An at-rule's block (@media, @supports, @container) is entered,
  // so the style rules inside it are checked like any other.
  let i = 0
  let preludeStart = 0
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 2
      continue
    }
    const ch = css[i]
    if (ch === '{') {
      const prelude = css.slice(preludeStart, i)
      const selector = prelude.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
      if (selector.startsWith('@')) {
        i += 1
        preludeStart = i
        continue
      }
      // A style rule: find its matching close, skipping comments.
      let j = i + 1
      let inner = 1
      while (j < css.length && inner > 0) {
        if (css.startsWith('/*', j)) {
          const end = css.indexOf('*/', j + 2)
          j = end < 0 ? css.length : end + 2
          continue
        }
        if (css[j] === '{') inner += 1
        else if (css[j] === '}') inner -= 1
        j += 1
      }
      const body = css.slice(i + 1, j - 1)
      const marked = MOCKUP_MARK.test(prelude) || MOCKUP_MARK.test(body)
      // Every selector in the list must draw the app – one erf- selector does
      // not excuse a documentation selector beside it.
      const appScale = selector
        .split(',')
        .every(part => /\.erf-|\[class[*^|~]?=['"]?erf-/.test(part))
      if (!marked && !appScale) {
        const cleanBody = body.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
        for (const hit of cleanBody.matchAll(SMALL_TEXT)) {
          problems.push({
            line: baseLine + lineAt(css, i + 1 + hit.index) - 1,
            message: `documentation text below 13px in "${selector.replace(/\s+/g, ' ')}" – use var(--ds-text-small), or mark an app-scale drawing with /* mockup: app scale */`
          })
        }
      }
      i = j
      preludeStart = i
      continue
    }
    i += 1
    // A closing at-rule brace or an at-statement (@import …;) ends a prelude.
    if (ch === '}' || ch === ';') preludeStart = i
  }
  return problems
}

/**
 * A style= value that sets --text-xs or --text-sm on documentation: the
 * element and every ancestor are outside a drawing of the app (no erf- class,
 * no inert, no aria-hidden="true") and the value carries no mockup comment.
 * The same READABILITY rule as smallTextProblems, for inline styles.
 */
export function smallInlineText(node, value) {
  if (MOCKUP_MARK.test(value)) return false
  const clean = value.replace(/\/\*[\s\S]*?\*\//g, ' ')
  if (!new RegExp(SMALL_TEXT.source, 'i').test(clean)) return false
  for (let n = node; n && n.attrs; n = n.parentNode) {
    const attr = name => n.attrs.find(a => a.name.toLowerCase() === name)?.value
    if (/(?:^|\s)erf-/.test(attr('class') ?? '')) return false
    if (attr('inert') !== undefined) return false
    if ((attr('aria-hidden') ?? '').toLowerCase() === 'true') return false
  }
  return true
}

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

/** Literal colours in an SVG image's CSS (its <style> and style= values), as [{ line, message }]. */
function svgColourProblems(css, baseLine, where) {
  const problems = []
  const clean = withoutUrls(css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' ')))
  const global = new RegExp(LITERAL_COLOUR.source, 'gi')
  for (const hit of clean.matchAll(global)) {
    problems.push({ line: baseLine + lineAt(clean, hit.index) - 1, message: `literal colour "${hit[0]}" in ${where} – paint SVG with currentColor or a token` })
  }
  return problems
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
  for (const hit of clean.matchAll(SPACING_FROM_DS)) {
    problems.push({
      line: baseLine + lineAt(clean, hit.index + hit[0].length - hit[0].trimStart().length) - 1,
      message: `${hit[1]} reads a --ds-* custom property – spacing takes a --space-* token (only positions may go through --ds-*)`
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
export function markupProblems(text, { requireCsp = true, image = false } = {}) {
  const problems = []
  const parseErrors = []
  const doc = parse(text, { sourceCodeLocationInfo: true, onParseError: error => parseErrors.push(error) })
  const at = node => node.sourceCodeLocation?.startLine ?? 1

  // Malformed markup. A browser recovers from it silently, and the recovery is
  // rarely what the author meant: a missing quote turns the rest of a tag into
  // attribute NAMES (aria-hidden="true><div class="x" once hid a whole frame's
  // worth of markup inside one attribute). A fragment (an SVG image, a srcdoc)
  // has no doctype by design, so that one code is not a problem there.
  const seen = new Set()
  for (const error of parseErrors) {
    if (!requireCsp && error.code === 'missing-doctype') continue
    const key = `${error.startLine}:${error.code}`
    if (seen.has(key)) continue
    seen.add(key)
    problems.push({ line: error.startLine ?? 1, message: `malformed markup (${error.code}) – a browser would guess what this means` })
  }

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
        if (smallInlineText(node, value)) {
          problems.push({
            line,
            message: `documentation text below 13px in a style= value on <${tag}> – use var(--ds-text-small), or draw the app inside an erf-, inert or aria-hidden frame, or add /* mockup: app scale */ to the value`
          })
        }
      }
      if (SVG_PAINT_ATTRS.has(lower) && !PAINT_VALUE.test(value.trim())) {
        problems.push({
          line,
          message: LITERAL_COLOUR.test(withoutUrls(value))
            ? `literal colour in ${name}="${value}" – paint SVG with currentColor or a token through CSS`
            : `${name}="${value}" – an SVG paint attribute takes none, currentColor, url(#id) or var(--token) only`
        })
      }
      if (lower.includes('><') || /[<>"'=]/.test(lower) || value.includes('><')) {
        problems.push({ line, message: `malformed attribute ${name}="${value.slice(0, 40)}" – a quote is missing` })
      }
      if (image && lower === 'style') {
        for (const p of svgColourProblems(value, line, 'a style= value')) problems.push(p)
      }
    }

    if ((tag === 'iframe' || tag === 'frame') && attr('src') !== undefined) {
      problems.push({ line, message: `<${tag} src> is banned – a frame loads a page this guard never reads (and the CSP sets frame-src 'none')` })
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
      for (const p of smallTextProblems(css, first)) problems.push(p)
      if (image) for (const p of svgColourProblems(css, first, '<style>')) problems.push(p)
    }
  }

  if (requireCsp) {
    for (const line of emDashLines(doc, text)) {
      problems.push({ line, message: 'an em dash – use an en dash (–), as the Writing card decides' })
    }
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

/**
 * Lines holding an em dash, judged on the DECODED text: parse5 turns &mdash;
 * and &#8212; into the character, so a text node, comment or attribute value
 * that renders one is found however it was spelled. The line is then found in
 * the node's own source slice, one entry per occurrence.
 */
function emDashLines(doc, text) {
  const lines = []
  const report = (decoded, loc) => {
    if (!decoded.includes(EM_DASH) || !loc) return
    const raw = text.slice(loc.startOffset, loc.endOffset)
    let found = false
    for (const hit of raw.matchAll(EM_DASH_SOURCE)) {
      found = true
      lines.push(loc.startLine + lineAt(raw, hit.index) - 1)
    }
    if (!found) lines.push(loc.startLine)
  }
  for (const node of nodesOf(doc)) {
    if (node.nodeName === '#text' || node.nodeName === '#comment') report(node.value ?? node.data ?? '', node.sourceCodeLocation)
    for (const { name, value } of node.attrs ?? []) report(value, node.sourceCodeLocation?.attrs?.[name])
  }
  return [...new Set(lines)].sort((a, b) => a - b)
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
  else if (ext === 'svg') found = markupProblems(text, { requireCsp: false, image: true })
  else if (ext === 'css') {
    found = cssProblems(text)
    if (DOC_TEXT_CSS.has(file)) found = found.concat(smallTextProblems(text))
  }
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
        let resolved
        let anchor
        try {
          resolved = target === '' ? abs : path.resolve(path.dirname(abs), decodeURIComponent(target))
          anchor = fragment ? decodeURIComponent(fragment) : fragment
        } catch {
          problems.push(`${file}:${line} malformed link "${ref}" – a % escape that does not decode`)
          continue
        }
        if (!existsSync(resolved)) {
          problems.push(`${file}:${line} broken link "${ref}"`)
          continue
        }
        if (anchor && resolved.endsWith('.html') && !ids(resolved).has(anchor)) {
          problems.push(`${file}:${line} link "${ref}" names an anchor the target does not have`)
        }
      }
    }
  }
  return problems
}
