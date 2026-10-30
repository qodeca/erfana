// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The corpus round trip's oracle (spec 024 024-NFR-003): checks that do not
 * use the writer's own parse, splice planner or checks.
 *
 * - **Permitted range** – found by plain text search for the thread's id: an
 *   add may insert only the block with blanks before it and one line break
 *   plus blanks after it; a thread change may rewrite only its block. Every
 *   other character must be the character that was there.
 * - **Render** – the Markdown file rendered by the preview's pipeline
 *   (`previewTree`, line breaks off and on), and by markdown-it, a CommonMark
 *   parser that shares no code with it, both with comments dropped. HTML is
 *   compared as its parse5 DOM without comment nodes and with whitespace
 *   runs collapsed outside `pre` (`domSignature`).
 * - **Older readers** – the frozen v0.23.1 parser reads one more `ok` block
 *   and nothing else after an add.
 *
 * cmark-gfm, which GitHub uses, is not a dependency of the repository, so
 * markdown-it stands in for "a second, independent CommonMark parser"; the
 * report says so.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { domSignature } from '../../../../../shared/comments/__fixtures__/commentTestData'
import { analyzeCommentDocument as frozenAnalyze } from '../../../../../shared/comments/__fixtures__/frozen-v0.23.1/parse'
import { previewTree, splitFrontmatter } from '../../../../../shared/markdown/previewPipeline'
import { renderSignature } from '../../../../../shared/markdownComments/mdRender'
import type { CorpusKind } from './corpusSources'

/** The bit of markdown-it the oracle uses; the package ships no types. */
interface MarkdownIt {
  render(source: string): string
}

let markdownIt: MarkdownIt | null | undefined

/**
 * markdown-it, from the repository's installed packages (it comes with
 * markdownlint-cli2), or `null` when it is not installed: the check is then
 * recorded as not run.
 */
export function loadMarkdownIt(repoRoot: string): MarkdownIt | null {
  if (markdownIt !== undefined) return markdownIt
  try {
    const create = createRequire(join(repoRoot, 'package.json'))('markdown-it') as (options: object) => MarkdownIt
    markdownIt = create({ html: true })
  } catch {
    markdownIt = null
  }
  return markdownIt
}

/** markdown-it's installed version, or `undefined`. */
export function markdownItVersion(repoRoot: string): string | undefined {
  try {
    return (createRequire(join(repoRoot, 'package.json'))('markdown-it/package.json') as { version: string }).version
  } catch {
    return undefined
  }
}

const BOM = '﻿'
const withoutBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text)
/** A comment with the whitespace around it: a block sits on its own lines, so its line breaks go with it. */
const COMMENT = /\s*<!--[\s\S]*?-->\s*/g
/**
 * Whitespace on either side of a tag. Dropped before comparing: where a
 * removed comment's line breaks were differs only there, and a structural
 * change (a paragraph split, a list turned loose) still shows in the tags.
 */
const AROUND_TAG = /\s*(<[^>]*>)\s*/g

/** The Markdown body the previews render: no BOM, no frontmatter. */
const bodyOf = (text: string): string => splitFrontmatter(withoutBom(text)).body

/** What each renderer makes of a file, compared before and after a write. */
export interface RenderPrint {
  readonly preview: string
  readonly previewBreaks: string
  /** markdown-it's HTML with comments and whitespace between tags dropped; `undefined` when not run. */
  readonly markdownIt?: string
  /** HTML files: the DOM without comments. */
  readonly dom?: string
}

/** `text` rendered by every renderer that applies to `kind`. */
export function renderPrint(text: string, kind: CorpusKind, md: MarkdownIt | null): RenderPrint {
  if (kind === 'html') return { preview: '', previewBreaks: '', dom: domSignature(withoutBom(text)).join('\n') }
  const body = bodyOf(text)
  const it = md === null ? undefined : md.render(body).replace(COMMENT, ' ').replace(AROUND_TAG, '$1').replace(/\s+/g, ' ').trim()
  return {
    preview: renderSignature(previewTree(body, { breaks: false })),
    previewBreaks: renderSignature(previewTree(body, { breaks: true })),
    ...(it === undefined ? {} : { markdownIt: it })
  }
}

/** Which renderers saw a difference; empty when none did. */
export function renderDifferences(before: RenderPrint, after: RenderPrint): Array<'preview' | 'preview-breaks' | 'markdown-it' | 'dom'> {
  const out: Array<'preview' | 'preview-breaks' | 'markdown-it' | 'dom'> = []
  if (before.preview !== after.preview) out.push('preview')
  if (before.previewBreaks !== after.previewBreaks) out.push('preview-breaks')
  if (before.markdownIt !== after.markdownIt) out.push('markdown-it')
  if (before.dom !== after.dom) out.push('dom')
  return out
}

/** Where the block of thread `id` is in `text`, by text search: `<!--` to its first `-->`. */
export function blockRangeOf(text: string, id: string): readonly [number, number] | undefined {
  const lead = `<!-- erfana:comment v1 id=${id}`
  const header = text.indexOf(lead)
  if (header < 0 || text.indexOf(`id=${id}`, header + lead.length) >= 0) return undefined
  const close = text.indexOf('-->', header + 4)
  return close < 0 ? undefined : [header, close + 3]
}

/** The block holds one comment: no `<!--` or `-->` inside it. */
function isOneComment(block: string): boolean {
  return block.startsWith('<!--') && block.endsWith('-->') && block.indexOf('<!--', 4) < 0 && block.indexOf('-->') === block.length - 3
}

const BLANKS = /^[ \t]*$/
const TAIL = /^(?:\r\n|\r|\n)?[ \t]*$/

/**
 * Null when `after` is `before` with only thread `id`'s new block inserted
 * (blanks before it; one line break and blanks after it), else why not.
 */
export function addOutsideRangeProblem(before: string, after: string, id: string): string | null {
  const range = blockRangeOf(after, id)
  if (range === undefined) return 'the new block is not found once by its id'
  const [blockStart, blockEnd] = range
  if (!isOneComment(after.slice(blockStart, blockEnd))) return 'the new block is not exactly one comment'
  const grown = after.length - before.length
  for (let start = blockStart; start >= 0 && BLANKS.test(after.slice(start, blockStart)); start -= 1) {
    const end = start + grown
    if (end < blockEnd || !TAIL.test(after.slice(blockEnd, end))) continue
    if (before.slice(0, start) === after.slice(0, start) && before.slice(start) === after.slice(end)) return null
  }
  return 'characters outside the inserted block changed'
}

/** Null when `after` differs from `before` only inside thread `id`'s block, else why not. */
export function changeOutsideRangeProblem(before: string, after: string, id: string): string | null {
  const was = blockRangeOf(before, id)
  const now = blockRangeOf(after, id)
  if (was === undefined || now === undefined) return 'the block is not found once by its id'
  if (!isOneComment(after.slice(now[0], now[1]))) return 'the rewritten block is not exactly one comment'
  if (was[0] !== now[0] || before.slice(0, was[0]) !== after.slice(0, now[0])) return 'characters before the block changed'
  return before.slice(was[1]) === after.slice(now[1]) ? null : 'characters after the block changed'
}

/** The first message's id in a block's `@data` (the `-` is written `-`). */
export function firstMessageId(block: string): string | undefined {
  const found = /"msgs":\[\{"id":"m\\u002d([a-z2-7]{16})"/.exec(block)
  return found === null ? undefined : `m-${found[1]}`
}

/** The v0.23.1 reading: how many blocks, how many `ok`, and where its HTML parse found comment nodes. */
export interface FrozenCount {
  readonly blocks: number
  readonly ok: number
  /** Start offsets of every comment node v0.23.1's HTML parse found, block or not. */
  readonly commentStarts: ReadonlySet<number>
}

/**
 * How the frozen v0.23.1 parser reads `text`. It reads every file as HTML,
 * so in a Markdown file the text before a block can hide it: a `<script>`
 * mentioned in prose turns the rest into script text, a `<!` opens a bogus
 * comment, a `<` opens a tag. Such a block has no comment node at its start
 * in {@link FrozenCount.commentStarts}.
 */
export function frozenCount(text: string): FrozenCount {
  const doc = frozenAnalyze(text)
  const blocks = doc.state.blocks
  return { blocks: blocks.length, ok: blocks.filter(block => block.kind === 'ok').length, commentStarts: new Set(doc.index.comments.map(c => c.start)) }
}
