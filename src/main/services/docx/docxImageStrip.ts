// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'

/**
 * Remove image elements that reference a remote resource, before the HTML is
 * handed to `@turbodocx/html-to-docx`.
 *
 * The library fetches any `http(s)` image URL at export time (bundled axios), so
 * a user-authored `<img src="http://internal-host/...">` in an exported document
 * becomes a server-side request from the main process (SSRF). We strip those
 * images here so the library never issues the request.
 *
 * This uses a real HTML parser (parse5) rather than a tag regex: a regex over
 * `<img[^>]*>` desynchronises from the library's own quote-aware parser (a legal
 * `>` inside a quoted attribute, or a decoy `data-src` attribute, defeats it),
 * which reopens the SSRF bypass. Parsing once, inspecting parsed attribute
 * values, closes that class of bypass by construction.
 *
 * Preserved: empty, `data:` URI, and relative-path sources (incl. pre-rendered
 * Mermaid diagrams, which arrive as `data:` PNGs). Stripped: any explicit URL
 * scheme other than `data:` (http, https, file, ftp, ...) and protocol-relative
 * `//host` sources — fail-closed.
 */

type ChildNode = DefaultTreeAdapterMap['childNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type Element = DefaultTreeAdapterMap['element']

/**
 * Fail-closed classifier: a src is "remote" (strip it) unless it is clearly
 * local — empty, a `data:` URI, or a relative path.
 */
export function isRemoteImageSrc(src: string): boolean {
  const s = src.trim()
  if (s === '') return false
  if (/^data:/i.test(s)) return false
  if (s.startsWith('//')) return true // protocol-relative
  // Any explicit URL scheme (other than the data: handled above) is remote.
  return /^[a-z][a-z0-9+.-]*:/i.test(s)
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value
}

/** A `srcset` is remote if any of its candidate URLs is remote. */
function srcsetHasRemote(srcset: string): boolean {
  return srcset.split(',').some((candidate) => {
    const url = candidate.trim().split(/\s+/)[0] ?? ''
    return isRemoteImageSrc(url)
  })
}

/**
 * Strip remote `<img>` / `<source>` elements from an HTML fragment.
 *
 * @param html - inner HTML fragment (markdown-preview content, pre-wrapping)
 * @returns the sanitized HTML and the number of images removed
 */
export function stripRemoteImages(html: string): { html: string; removed: number } {
  const fragment = parseFragment(html)
  let removed = 0

  const visit = (parent: ParentNode): void => {
    // Snapshot the list: we mutate childNodes while iterating.
    for (const node of [...parent.childNodes]) {
      if (!isElement(node)) continue

      if (node.tagName === 'img' || node.tagName === 'source') {
        const src = getAttr(node, 'src') ?? ''
        const srcset = getAttr(node, 'srcset') ?? ''
        if (isRemoteImageSrc(src) || (srcset !== '' && srcsetHasRemote(srcset))) {
          const idx = parent.childNodes.indexOf(node)
          if (idx !== -1) {
            parent.childNodes.splice(idx, 1)
            removed++
          }
          continue
        }
      }

      // Recurse into element children (elements are also parent nodes in parse5).
      if ('childNodes' in node) {
        visit(node)
      }
    }
  }

  visit(fragment)
  return { html: serialize(fragment), removed }
}
