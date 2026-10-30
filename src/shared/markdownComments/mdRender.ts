// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown comment kind's view of the preview pipeline (spec 024
 * architecture note 001 § 5, § 8 C19; design `markdown-format.md` § 4.5):
 * one parse that yields both the CommonMark/GFM syntax tree (mdast, with
 * positions – where blocks and comments are) and the preview's tree after
 * parse and sanitize (hast – what the preview renders, and the paths anchors
 * name), and the render signature the render check compares.
 *
 * The chain is built from the shared pipeline's own constants
 * (`previewRemarkPlugins`, `PREVIEW_REMARK_REHYPE_OPTIONS`,
 * `PREVIEW_REHYPE_CORE`), in `previewTree`'s order, so the tree is the
 * preview's; a test pins that it equals `previewTree`. Parse and compare
 * only: nothing in the document is executed, and no YAML is loaded.
 *
 * The signature is the tree with positions dropped, comment nodes dropped
 * (the sanitizer drops them already), adjacent text merged, whitespace runs
 * collapsed outside `pre`, and whitespace at the edges of block-level
 * elements trimmed – the differences a browser does not render. A block
 * inserted between two blocks adds such whitespace and nothing else.
 */
import type { Element, ElementContent, Root as HastRoot, RootContent } from 'hast'
import type { Root as MdastRoot } from 'mdast'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import {
  PREVIEW_REHYPE_CORE,
  PREVIEW_REMARK_REHYPE_OPTIONS,
  previewRemarkPlugins
} from '../markdown/previewPipeline'

/** The two trees of one Markdown body. */
export interface MarkdownTrees {
  readonly mdast: MdastRoot
  readonly hast: HastRoot
}

function processorOf(breaks: boolean) {
  return unified()
    .use(remarkParse)
    .use(previewRemarkPlugins(breaks))
    .use(remarkRehype, PREVIEW_REMARK_REHYPE_OPTIONS)
    .use(PREVIEW_REHYPE_CORE)
}

/**
 * Parse a Markdown body (no BOM, no frontmatter) into its syntax tree and the
 * preview's tree. `remark-breaks` is off: it rewrites the syntax tree, and
 * the index needs the tree as written. The block structure, the paths and the
 * text the quotes read do not depend on it.
 */
export function parseMarkdownBody(body: string): MarkdownTrees {
  const processor = processorOf(false)
  const mdast = processor.parse(body)
  // remark-rehype builds a new tree; with breaks off nothing rewrites `mdast`.
  const hast = processor.runSync(mdast) as HastRoot
  return { mdast, hast }
}

/** The preview's tree of a body with the user's "preserve line breaks" setting. */
export function renderMarkdownBody(body: string, breaks: boolean): HastRoot {
  const processor = processorOf(breaks)
  return processor.runSync(processor.parse(body)) as HastRoot
}

/** Elements whose edge whitespace is rendered (inline formatting context). */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'input',
  'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'
])
const PREFORMATTED = new Set(['pre', 'textarea', 'listing', 'plaintext'])
const WHITESPACE_RUN = /[ \t\n\f\r]+/g

type Child = RootContent | ElementContent

function propertiesKey(element: Element): string {
  const props = element.properties
  const keys = Object.keys(props).sort()
  return keys.map(key => `${key}=${JSON.stringify(props[key])}`).join(' ')
}

/** The normalized children of a node: text merged and collapsed, edges trimmed for a block. */
function normalizedChildren(children: readonly Child[], pre: boolean, block: boolean): Array<string | Element> {
  const out: Array<string | Element> = []
  for (const child of children) {
    if (child.type === 'text') {
      const last = out.length - 1
      if (last >= 0 && typeof out[last] === 'string') out[last] = (out[last] as string) + child.value
      else out.push(child.value)
    } else if (child.type === 'element') {
      out.push(child)
    }
  }
  const texts = out.map(item => (typeof item === 'string' && !pre ? item.replace(WHITESPACE_RUN, ' ') : item))
  if (block && !pre) {
    if (typeof texts[0] === 'string') texts[0] = texts[0].trimStart()
    const last = texts.length - 1
    if (last >= 0 && typeof texts[last] === 'string') texts[last] = (texts[last] as string).trimEnd()
  }
  return texts.filter(item => item !== '')
}

function signatureOf(children: readonly Child[], pre: boolean, block: boolean, out: string[]): void {
  for (const item of normalizedChildren(children, pre, block)) {
    if (typeof item === 'string') {
      out.push(JSON.stringify(item))
      continue
    }
    const childPre = pre || PREFORMATTED.has(item.tagName)
    out.push(`<${item.tagName} ${propertiesKey(item)}>`)
    signatureOf(item.children, childPre, !INLINE.has(item.tagName), out)
    out.push(`</${item.tagName}>`)
  }
}

/**
 * What the preview renders of a tree, as one string: equal for two trees
 * exactly when they render the same (module comment).
 */
export function renderSignature(tree: HastRoot): string {
  const out: string[] = []
  signatureOf(tree.children, false, true, out)
  return out.join('\n')
}
