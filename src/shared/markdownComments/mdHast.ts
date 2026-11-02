// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the Markdown Preview renders of a file, as the comment anchors name it
 * (spec 024 design `markdown-format.md` § 5): every element of the preview's
 * tree after parse and sanitize, with its path, its source offset and the
 * range of its text in the page's text.
 *
 * - A path is `tag:nth-of-type(n)` steps from below the rendered root,
 *   counted among same-tag element siblings – before any presentation plugin,
 *   so the heading ids and line attributes the preview adds later never
 *   change a path.
 * - The page's text is the root's `textContent`: every text node in tree
 *   order, the whitespace between blocks included. A quote read from it
 *   (`quoteText.ts`) collapses whitespace, as the preview's own reads do.
 * - A heading's id is the one the preview gives it (`rehypeHeadingIds` in
 *   `previewRehypePlugins.ts`, mirrored by {@link assignHeadingIds}; a test
 *   pins the two together).
 */
import type { Element, ElementContent, Root as HastRoot, RootContent } from 'hast'

/** One rendered element. */
export interface HastRecord {
  readonly tag: string
  /** Its path below the rendered root. */
  readonly path: string
  /** Offset of its first source character in the file, or -1 when it has none. */
  readonly start: number
  /** Index in tree order. */
  readonly order: number
  readonly parent: HastRecord | undefined
  readonly textStart: number
  textEnd: number
  /** The id the preview gives a heading. */
  id?: string
}

/** The rendered elements of one file and the page's text. */
export interface RenderedPage {
  /** Every element, in tree order. */
  readonly records: readonly HastRecord[]
  readonly visibleText: string
}

const HEADING = /^h[1-6]$/

function stepOf(tag: string, n: number): string {
  return `${tag}:nth-of-type(${n})`
}

/**
 * Walk the preview's tree of a body whose first character sits at file
 * offset `base`.
 */
export function renderedPage(tree: HastRoot, base: number): RenderedPage {
  const records: HastRecord[] = []
  const parts: string[] = []
  let length = 0
  const visit = (children: ReadonlyArray<RootContent | ElementContent>, parentPath: string, parent: HastRecord | undefined): void => {
    const counts = new Map<string, number>()
    for (const child of children) {
      if (child.type === 'text') {
        parts.push(child.value)
        length += child.value.length
        continue
      }
      if (child.type !== 'element') continue
      const element: Element = child
      const n = (counts.get(element.tagName) ?? 0) + 1
      counts.set(element.tagName, n)
      const step = stepOf(element.tagName, n)
      const offset = element.position?.start.offset
      const record: HastRecord = {
        tag: element.tagName,
        path: parentPath === '' ? step : `${parentPath} > ${step}`,
        start: offset === undefined ? -1 : base + offset,
        order: records.length,
        parent,
        textStart: length,
        textEnd: length
      }
      records.push(record)
      visit(element.children, record.path, record)
      record.textEnd = length
    }
  }
  visit(tree.children, '', undefined)
  const visibleText = parts.join('')
  assignHeadingIds(records, visibleText)
  return { records, visibleText }
}

/**
 * GitHub-style base slug for a heading's text, exactly as the preview's
 * `slugifyHeading` (`previewRehypePlugins.ts`).
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Give every heading the unique id the preview gives it, in document order (`rehypeHeadingIds`). */
export function assignHeadingIds(records: readonly HastRecord[], visibleText: string): void {
  const used = new Map<string, number>()
  const unique = (base: string): string => {
    const seen = used.get(base)
    if (seen === undefined) {
      used.set(base, 1)
      return base
    }
    let n = seen
    let candidate: string
    do {
      n += 1
      candidate = `${base}-${n}`
    } while (used.has(candidate))
    used.set(base, n)
    used.set(candidate, 1)
    return candidate
  }
  for (const record of records) {
    if (HEADING.test(record.tag)) record.id = unique(slugifyHeading(visibleText.slice(record.textStart, record.textEnd)))
  }
}
