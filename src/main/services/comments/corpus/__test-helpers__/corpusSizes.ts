// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The size data of the Markdown corpus that sets the Markdown limits (spec
 * 024 024-NFR-008: "about 10 times its 99th percentile, and never less than
 * 2 MB"; architecture note 001 § 8 C19). Measured independently of
 * `markdownLimits.ts`:
 *
 * - bytes and lines (CR, LF and CRLF each end one);
 * - container nesting – block quotes and list items around a block – and
 *   emphasis nesting (`*`, `_`, `~~` spans inside each other), from a
 *   remark parse, so only real containers count;
 * - raw-HTML constructs and their element nesting, counted over the whole
 *   text as the limit scanner counts them (code included).
 */
import type { Nodes as MdNode } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { utf8Length } from '../../../../../shared/comments/encoding'
import { splitFrontmatter } from '../../../../../shared/markdown/previewPipeline'
import * as limits from '../../../../../shared/markdownComments/markdownLimits'
import { percentile } from './corpusReport'

/** One Markdown file's measures. */
export interface MarkdownSize {
  readonly bytes: number
  readonly lines: number
  readonly nesting: number
  readonly emphasisNesting: number
  readonly htmlNodes: number
  readonly htmlNesting: number
}

const HTML_OPEN = /<(?:[!?]|(\/?)([A-Za-z][A-Za-z0-9-]*)(?![A-Za-z0-9-])(?=[\s/>]|$))/g
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const CONTAINERS = new Set(['blockquote', 'listItem'])
const EMPHASIS = new Set(['emphasis', 'strong', 'delete'])

function htmlShape(text: string): { nodes: number; depth: number } {
  let nodes = 0
  let depth = 0
  let max = 0
  for (const match of text.matchAll(HTML_OPEN)) {
    nodes += 1
    const [whole, closing, name] = match
    if (name === undefined) continue
    if (closing === '/') depth = Math.max(0, depth - 1)
    else if (!VOID.has(name.toLowerCase()) && !/\/\s*>/.test(text.slice(match.index + whole.length, text.indexOf('>', match.index) + 1))) {
      depth += 1
      max = Math.max(max, depth)
    }
  }
  return { nodes, depth: max }
}

/** Deepest container and emphasis nesting in `tree`, iteratively (a deep file must not overflow the stack). */
function treeDepths(tree: MdNode): { nesting: number; emphasis: number } {
  let nesting = 0
  let emphasis = 0
  const stack: Array<readonly [MdNode, number, number]> = [[tree, 0, 0]]
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, containers, spans] = item
    const c = containers + (CONTAINERS.has(node.type) ? 1 : 0)
    const s = spans + (EMPHASIS.has(node.type) ? 1 : 0)
    nesting = Math.max(nesting, c)
    emphasis = Math.max(emphasis, s)
    if ('children' in node) for (const child of node.children) stack.push([child, c, s])
  }
  return { nesting, emphasis }
}

/** `text`'s measures. */
export function markdownSizeOf(text: string): MarkdownSize {
  const body = splitFrontmatter(text.startsWith('﻿') ? text.slice(1) : text).body
  const depths = treeDepths(unified().use(remarkParse).use(remarkGfm).parse(body))
  const html = htmlShape(text)
  return {
    bytes: utf8Length(text),
    lines: text.split(/\r\n|\r|\n/).length,
    nesting: depths.nesting,
    emphasisNesting: depths.emphasis,
    htmlNodes: html.nodes,
    htmlNesting: html.depth
  }
}

const MEASURES: ReadonlyArray<readonly [keyof MarkdownSize, string, number]> = [
  ['bytes', 'Size (UTF-8 bytes)', limits.MARKDOWN_COMMENT_MAX_BYTES],
  ['lines', 'Lines', limits.MARKDOWN_COMMENT_MAX_LINES],
  ['nesting', 'Container nesting', limits.MARKDOWN_COMMENT_MAX_NESTING],
  ['htmlNesting', 'Raw-HTML nesting', limits.MARKDOWN_COMMENT_MAX_HTML_NESTING],
  ['htmlNodes', 'Raw-HTML constructs', limits.MARKDOWN_COMMENT_MAX_HTML_NODES],
  ['emphasisNesting', 'Emphasis nesting', limits.MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING]
]

/** 2 MB, the floor 024-NFR-008 sets for the size limit. */
const MIN_BYTES = 2 * 1024 * 1024

/** The limits table: P50, P99, max, 10 × P99 and the limit in force, per measure. */
export function sizeTable(sizes: readonly MarkdownSize[]): string[] {
  const rows = MEASURES.map(([key, label, limit]) => {
    const values = sizes.map(size => size[key])
    const p99 = percentile(values, 0.99)
    const tenfold = key === 'bytes' ? Math.max(MIN_BYTES, 10 * p99) : 10 * p99
    const over = values.filter(v => v > limit).length
    return `| ${label} | ${percentile(values, 0.5)} | ${p99} | ${percentile(values, 1)} | ${tenfold} | ${limit} | ${over} |`
  })
  return [
    `Measured on ${sizes.length} Markdown files.`,
    '',
    '| Measure | P50 | P99 | Max | 10 × P99 (size: at least 2 MB) | Limit now | Files over the limit |',
    '|---|---|---|---|---|---|---|',
    ...rows
  ]
}
