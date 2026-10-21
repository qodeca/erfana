// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Rehype plugins that move per-document bookkeeping out of the preview's
 * React renderers and into the parse.
 *
 * Both used to live in the `components` map handed to react-markdown: the
 * frontmatter line offset was baked into each renderer, and heading ids came
 * from a counter shared by every render of the same map. That forced the map to
 * be rebuilt whenever the offset or the link state changed – and a new map is a
 * new component type for every element, so React threw the whole preview away
 * and rebuilt it, Mermaid diagrams included. Done here instead, the work is
 * pure per parse and the renderers can stay the same objects for the life of
 * the panel.
 *
 * @module components/Editor/previewRehypePlugins
 */

/** The slice of a hast node these plugins read and write. */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: {
    start: { line: number; column?: number; offset?: number }
    end: { line: number; column?: number; offset?: number }
  }
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/**
 * GitHub-style base slug for a heading's text (no de-duplication).
 *
 * Lower-cases, keeps Unicode letters and digits, spaces and hyphens, turns
 * runs of whitespace into one hyphen and trims hyphens from both ends.
 *
 * @param text - The heading's plain text
 * @returns The slug, possibly empty
 *
 * @example
 * ```ts
 * slugifyHeading('Hello, World?') // 'hello-world'
 * slugifyHeading('Café')          // 'café'
 * ```
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

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

function walk(node: HastNode, visit: (node: HastNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/**
 * Give every `h1`–`h6` a unique, GitHub-compatible `id`, in document order.
 *
 * Duplicates get `-2`, `-3`, … (`example`, `example-2`), skipping any id already
 * taken, so no two headings share an anchor. The counter belongs to
 * one parse, so re-rendering the same document always yields the same ids –
 * a counter kept in the renderer map counts on across renders that reuse the
 * map – and the map is now kept for the panel's life – which would move every
 * anchor (`#example` becoming `#example-2`) on the next re-render.
 * Runs after sanitisation, so the ids are not given the `user-content-` prefix.
 *
 * @returns A unified transformer
 */
export function rehypeHeadingIds(): (tree: HastNode) => void {
  return (tree) => {
    // id -> highest suffix handed out for it as a base (1 = only the bare id).
    const used = new Map<string, number>()
    const unique = (base: string): string => {
      const seen = used.get(base)
      if (seen === undefined) {
        used.set(base, 1)
        return base
      }
      // Keep counting past ids that are already taken – including ones a
      // heading earned by its own text ("Example 2" is `example-2`) – so two
      // headings can never share an anchor.
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
    walk(tree, (node) => {
      if (node.type !== 'element' || !node.tagName || !HEADING_TAGS.has(node.tagName)) return
      node.properties = { ...node.properties, id: unique(slugifyHeading(textOf(node))) }
    })
  }
}

/** Options for {@link rehypeShiftLines}. */
export interface RehypeShiftLinesOptions {
  /** Lines to add to every source position; the front-matter block's height. */
  offset: number
}

/**
 * Shift every node's source line numbers by `offset`.
 *
 * The preview renders the body with its front matter stripped, so parser
 * positions count from the first body line. Adding the front matter's height
 * here makes `data-line-start` / `data-line-end` real file lines for scroll
 * sync and for mapping a preview selection back to the source.
 *
 * @param options - The offset; `0` makes the plugin a no-op
 * @returns A unified transformer
 */
export function rehypeShiftLines(options: RehypeShiftLinesOptions): (tree: HastNode) => void {
  const { offset } = options
  return (tree) => {
    if (!offset) return
    walk(tree, (node) => {
      const pos = node.position
      if (!pos) return
      // Replace rather than mutate: position objects can be shared with the
      // mdast tree they were copied from.
      node.position = {
        start: { ...pos.start, line: pos.start.line + offset },
        end: { ...pos.end, line: pos.end.line + offset }
      }
    })
  }
}

/** Options for {@link rehypeCollectLinks}. */
export interface RehypeCollectLinksOptions {
  /** Emptied and refilled with every link `href`, exactly as the renderer will see it. */
  sink: Set<string>
}

/**
 * Collect the `href` of every link, as it stands after parsing and sanitising.
 *
 * Link checks must key their results by the very string the link renderer
 * later looks up. Scanning the Markdown source cannot promise that: the parser
 * percent-encodes spaces, backslashes and non-ASCII (`.\docs\a.md` arrives as
 * `.%5Cdocs%5Ca.md`) and strips `<...>` wrappers and titles. Reading the tree
 * does. Runs after sanitisation so only links that survive it are listed.
 *
 * @param options - The set to fill
 * @returns A unified transformer
 */
export function rehypeCollectLinks(options: RehypeCollectLinksOptions): (tree: HastNode) => void {
  const { sink } = options
  return (tree) => {
    sink.clear()
    walk(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'a') return
      const href = node.properties?.href
      if (typeof href === 'string' && href !== '') sink.add(href)
    })
  }
}
