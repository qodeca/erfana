// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The link extractor as it was before issue #124's audit fix, kept as the
 * oracle for `linkExtract.parity.test.ts`: it builds the full parse5 tree and
 * walks it, and it finds `url()` with the original regex.
 *
 * Test-only and UNBOUNDED – the very thing the fix removed from the main
 * thread (see `htmlElementScan.ts`). Feed it ordinary pages only. Do not edit
 * it to follow the extractor: it is the behaviour the extractor must keep.
 */
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { parseSrcset } from '../previewSrcset'

type ChildNode = DefaultTreeAdapterMap['childNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type Element = DefaultTreeAdapterMap['element']
type TextNode = DefaultTreeAdapterMap['textNode']

const CSS_URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")]*))\s*\)/gi
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const BACKSLASH_RE = /\\/g

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === '#text'
}

function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value
}

function toRelativeLink(raw: string): string | null {
  let s = raw.trim()
  if (s === '' || s.startsWith('#') || s.startsWith('//') || SCHEME_RE.test(s)) return null
  const hashIdx = s.indexOf('#')
  if (hashIdx !== -1) s = s.slice(0, hashIdx)
  const queryIdx = s.indexOf('?')
  if (queryIdx !== -1) s = s.slice(0, queryIdx)
  s = s.trim()
  return s === '' ? null : s
}

function frameSrc(el: Element): string | undefined {
  if (getAttr(el, 'srcdoc') !== undefined) return undefined
  return getAttr(el, 'src')?.replace(BACKSLASH_RE, '/')
}

function forEachElement(html: string, onElement: (el: Element) => void): void {
  const pending: ChildNode[] = []
  const pushChildren = (parent: ParentNode): void => {
    for (let index = parent.childNodes.length - 1; index >= 0; index -= 1) {
      pending.push(parent.childNodes[index])
    }
  }
  pushChildren(parse(html))
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (!isElement(node)) continue
    onElement(node)
    if ('childNodes' in node) pushChildren(node)
  }
}

/** `extractStaticLinks` before the fix. */
export function referenceStaticLinks(html: string): string[] {
  const links = new Set<string>()
  const addLink = (raw: string | undefined): void => {
    if (raw === undefined) return
    const rel = toRelativeLink(raw)
    if (rel !== null) links.add(rel)
  }
  const addCssUrls = (css: string): void => {
    for (const match of css.matchAll(CSS_URL_RE)) addLink(match[1] ?? match[2] ?? match[3] ?? '')
  }
  forEachElement(html, (node) => {
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
      case 'iframe':
        addLink(frameSrc(node))
        break
      case 'style':
        for (const child of node.childNodes) {
          if (isTextNode(child)) addCssUrls(child.value)
        }
        break
    }
    const styleAttr = getAttr(node, 'style')
    if (styleAttr !== undefined && styleAttr !== '') addCssUrls(styleAttr)
  })
  return [...links]
}

/** `extractFrameSources` before the fix. */
export function referenceFrameSources(html: string): { src: string[]; srcdocHtml: string[] } {
  const src = new Set<string>()
  const srcdocHtml: string[] = []
  forEachElement(html, (node) => {
    if (node.tagName !== 'iframe') return
    const srcdoc = getAttr(node, 'srcdoc')
    if (srcdoc !== undefined) {
      if (srcdoc !== '') srcdocHtml.push(srcdoc)
      return
    }
    const raw = frameSrc(node)
    const link = raw === undefined ? null : toRelativeLink(raw)
    if (link !== null) src.add(link)
  })
  return { src: [...src], srcdocHtml }
}

/** Every `url()` target the original regex captured, in order. */
export function referenceCssUrlTargets(css: string): string[] {
  return [...css.matchAll(CSS_URL_RE)].map((match) => match[1] ?? match[2] ?? match[3] ?? '')
}
