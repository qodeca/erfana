// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure static-link extractor for the HTML preview (Issue #74, work item 8;
 * design §1.4, §5(a)).
 *
 * Given the entry HTML of a previewed page, this collects the set of LOCAL,
 * relative subresource links so the watch coordinator can watch each one and
 * hot-swap / reload the page when the file on disk changes. It parses the HTML
 * once with parse5 rather than scanning with regexes — a tag regex desynchs
 * from a real parser (a `>` inside a quoted attribute, a decoy attribute), the
 * same reason `docx/docxImageStrip.ts` uses parse5.
 *
 * What is collected:
 *   - `<link href>`   (stylesheets, icons, preloads, …)
 *   - `<script src>`
 *   - `<img src>` and `<img srcset>` (the latter via `parseSrcset`, item 7)
 *   - every `url()` reference in a `<style>` element body
 *   - every `url()` reference in a `style=""` attribute on any element
 *
 * What is returned: the DEDUPLICATED set of relative links, with any query
 * string and fragment stripped. Absolute-scheme URLs (`http:`, `https:`,
 * `data:`, `blob:`, `javascript:`, …), protocol-relative `//host` URLs and
 * in-page `#fragment` references are dropped — none of them map to a watchable
 * project file.
 *
 * LIMITATION — this discovers STATIC links only. Links a page injects at
 * runtime (a script that appends a `<link>`, sets `img.src`, calls
 * `import()`, or writes `background-image` from JavaScript) are invisible to a
 * static parse and are therefore NOT watched. A change to such an asset will
 * not trigger an automatic swap/reload; the user must reload manually. This is
 * an accepted bound of a no-execution extractor, not a bug.
 *
 * Files are DATA, never instructions: attribute and CSS text are parsed and
 * classified, never evaluated.
 */
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { parseSrcset } from './previewSrcset'

type ChildNode = DefaultTreeAdapterMap['childNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type Element = DefaultTreeAdapterMap['element']
type TextNode = DefaultTreeAdapterMap['textNode']

/**
 * Matches a CSS `url(...)` reference, capturing the inner target for the three
 * quoting forms: single-quoted, double-quoted, and unquoted.
 */
const CSS_URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")]*))\s*\)/gi

/** An explicit URL scheme such as `http:`, `data:`, `blob:`, `javascript:`. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === '#text'
}

function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value
}

/**
 * Normalise a raw link to a watchable relative path, or return `null` if it is
 * not a local relative resource. Query string and fragment are stripped.
 */
function toRelativeLink(raw: string): string | null {
  let s = raw.trim()
  if (s === '') return null
  if (s.startsWith('#')) return null // in-page fragment
  if (s.startsWith('//')) return null // protocol-relative (remote)
  if (SCHEME_RE.test(s)) return null // explicit scheme (http/data/blob/…)

  const hashIdx = s.indexOf('#')
  if (hashIdx !== -1) s = s.slice(0, hashIdx)
  const queryIdx = s.indexOf('?')
  if (queryIdx !== -1) s = s.slice(0, queryIdx)

  s = s.trim()
  return s === '' ? null : s
}

/**
 * Extract the deduplicated set of static, relative subresource links from a
 * page's entry HTML.
 *
 * @param html - the entry HTML document
 * @returns relative links (query/fragment stripped), in first-seen order
 */
export function extractStaticLinks(html: string): string[] {
  const document = parse(html)
  const links = new Set<string>()

  const addLink = (raw: string | undefined): void => {
    if (raw === undefined) return
    const rel = toRelativeLink(raw)
    if (rel !== null) links.add(rel)
  }

  const addCssUrls = (css: string): void => {
    for (const match of css.matchAll(CSS_URL_RE)) {
      addLink(match[1] ?? match[2] ?? match[3] ?? '')
    }
  }

  const visit = (parent: ParentNode): void => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue

      switch (node.tagName) {
        case 'link':
          addLink(getAttr(node, 'href'))
          break
        case 'script':
          addLink(getAttr(node, 'src'))
          break
        case 'img': {
          addLink(getAttr(node, 'src'))
          const srcset = getAttr(node, 'srcset')
          if (srcset !== undefined && srcset !== '') {
            for (const url of parseSrcset(srcset)) addLink(url)
          }
          break
        }
        case 'style':
          for (const child of node.childNodes) {
            if (isTextNode(child)) addCssUrls(child.value)
          }
          break
      }

      // A `url()` can hide in a `style=""` attribute on ANY element.
      const styleAttr = getAttr(node, 'style')
      if (styleAttr !== undefined && styleAttr !== '') {
        addCssUrls(styleAttr)
      }

      // Elements are also parent nodes in parse5; recurse into their children.
      if ('childNodes' in node) {
        visit(node)
      }
    }
  }

  visit(document)
  return [...links]
}
