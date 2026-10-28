// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure static-link extractor for the HTML preview (Issue #74, work item 8;
 * design §1.4, §5(a)).
 *
 * Given the entry HTML of a previewed page, this collects the set of LOCAL,
 * relative subresource links so the watch coordinator can watch each one and
 * hot-swap / reload the page when the file on disk changes. It reads the HTML
 * once with parse5's spec tokenizer rather than with regexes — a tag regex
 * desynchs from a real parser (a `>` inside a quoted attribute, a decoy
 * attribute), the same reason `docx/docxImageStrip.ts` uses parse5.
 *
 * Bounded (issue #124, security audit). This runs on the main thread at every
 * preview load, on up to `PREVIEW.MAX_ENTRY_HTML_BYTES` of a page the user did
 * not necessarily write, so its work is linear in the page: the scan builds no
 * tree and caps the attributes it keeps per tag (`htmlElementScan.ts`), and
 * `url()` is found by a linear scanner (`cssUrlTargets.ts`). A bound the scan
 * reaches is passed to the optional `onLimit` – the links found are still
 * returned, and nothing is thrown.
 *
 * What is collected:
 *   - `<link href>`   (stylesheets, icons, preloads, …)
 *   - `<script src>`
 *   - `<img src>` and `<img srcset>` (the latter via `parseSrcset`, item 7)
 *   - `<iframe src>` – the frame's own document (issue #124, WI-15)
 *   - every `url()` reference in a `<style>` element body
 *   - every `url()` reference in a `style=""` attribute on any element
 *
 * What is returned: the DEDUPLICATED set of relative links, with any query
 * string and fragment stripped. Absolute-scheme URLs (`http:`, `https:`,
 * `data:`, `blob:`, `javascript:`, …), protocol-relative `//host` URLs and
 * in-page `#fragment` references are dropped — none of them map to a watchable
 * project file.
 *
 * Frames (issue #124, WI-15; design part 2 §2.9). A `\` in a frame's `src` is
 * read as `/` before anything else, as Chromium does in standard URLs, so
 * `sub\page.html` is `sub/page.html` and `\\host\page.html` is the remote
 * `//host/page.html`; every other link kind keeps its backslashes. A frame with
 * a `srcdoc` attribute loads no file – `srcdoc` wins over `src` – so its `src`
 * is skipped. `extractFrameSources` lists what each frame shows: its `src`
 * link, or its `srcdoc` markup, which the caller parses with this same
 * extractor, resolving its links against the parent document's folder
 * (`previewFrameSources.ts`).
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
import { cssUrlTargets } from './cssUrlTargets'
import { scanHtmlElements, type HtmlScanLimit, type ScannedElement } from './htmlElementScan'
import { parseSrcset } from './previewSrcset'

export type { HtmlScanLimit } from './htmlElementScan'

/** Told each bound a scan reached (`HtmlScanLimit`), once per scan. */
export type OnScanLimit = (limit: HtmlScanLimit) => void

/** What the frames of one HTML document show (see `extractFrameSources`). */
export interface ExtractedFrameSources {
  /** Relative `src` links, normalised as in `extractStaticLinks`, in first-seen order. */
  readonly src: string[]
  /** The markup of each non-empty `srcdoc`, entity-decoded, in document order. */
  readonly srcdocHtml: string[]
}

/** An explicit URL scheme such as `http:`, `data:`, `blob:`, `javascript:`. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/** Every backslash, which a frame's `src` reads as `/` (Chromium, standard URLs). */
const BACKSLASH_RE = /\\/g

function getAttr(el: ScannedElement, name: string): string | undefined {
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
 * The raw link a frame loads, with `\` read as `/`; `undefined` for a `srcdoc`
 * frame, which loads no file whatever its `src` says.
 */
function frameSrc(el: ScannedElement): string | undefined {
  if (getAttr(el, 'srcdoc') !== undefined) return undefined
  return getAttr(el, 'src')?.replace(BACKSLASH_RE, '/')
}

/**
 * Call `onElement` for every element of the document, in document order, then
 * tell `onLimit` each bound the scan reached.
 *
 * No tree and no recursion: a page nested some thousands of levels deep costs
 * no stack (issue #124, QG-11a Q12), and no tree-building step can multiply the
 * work (the #124 security audit; see `htmlElementScan.ts`).
 */
function forEachElement(
  html: string,
  onElement: (el: ScannedElement) => void,
  onLimit: OnScanLimit | undefined
): void {
  const limits = scanHtmlElements(html, onElement)
  if (onLimit !== undefined) {
    for (const limit of limits) onLimit(limit)
  }
}

/**
 * Extract the deduplicated set of static, relative subresource links from a
 * page's entry HTML.
 *
 * @param html - the entry HTML document
 * @param onLimit - told each bound the scan reached; the links found are returned all the same
 * @returns relative links (query/fragment stripped), in first-seen order
 */
export function extractStaticLinks(html: string, onLimit?: OnScanLimit): string[] {
  const links = new Set<string>()

  const addLink = (raw: string | undefined): void => {
    if (raw === undefined) return
    const rel = toRelativeLink(raw)
    if (rel !== null) links.add(rel)
  }

  const addCssUrls = (css: string): void => {
    for (const target of cssUrlTargets(css)) addLink(target)
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
        for (const css of node.texts) addCssUrls(css)
        break
    }

    // A `url()` can hide in a `style=""` attribute on ANY element.
    const styleAttr = getAttr(node, 'style')
    if (styleAttr !== undefined && styleAttr !== '') {
      addCssUrls(styleAttr)
    }
  }, onLimit)

  return [...links]
}

/**
 * List what the frames of an HTML document show (issue #124, WI-15): the
 * relative `src` link of each `<iframe>` that loads a file, and the markup of
 * each `srcdoc` frame. A remote, scheme or fragment-only `src` names no project
 * file and is dropped, as in `extractStaticLinks`.
 *
 * @param html - an HTML document, or a `srcdoc` frame's markup
 * @param onLimit - told each bound the scan reached; the frames found are returned all the same
 */
export function extractFrameSources(html: string, onLimit?: OnScanLimit): ExtractedFrameSources {
  const src = new Set<string>()
  const srcdocHtml: string[] = []

  forEachElement(html, (node) => {
    if (node.tagName !== 'iframe') return
    const srcdoc = getAttr(node, 'srcdoc')
    if (srcdoc !== undefined) {
      // An empty `srcdoc` shows an empty document: nothing to follow.
      if (srcdoc !== '') srcdocHtml.push(srcdoc)
      return
    }
    const raw = frameSrc(node)
    const link = raw === undefined ? null : toRelativeLink(raw)
    if (link !== null) src.add(link)
  }, onLimit)

  return { src: [...src], srcdocHtml }
}
