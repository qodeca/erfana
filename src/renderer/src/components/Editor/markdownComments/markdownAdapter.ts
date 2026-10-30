// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview's comment adapter (spec 024 architecture note 001 § 1
 * "markdownAdapter", § 3, § 8 C7; 024-FR-003; design `markdown-format.md`).
 *
 * The preview stamps every block it renders with `data-line-start`, the real
 * file line (`MarkdownPreview.tsx`, `rehypeShiftLines`). This module reads
 * those stamps to answer the overlay host's questions, in the words the
 * Markdown file kind (`src/shared/markdownComments/`) uses:
 *
 * - **Targets** are the blocks main indexes (`mdIndex.ts`): paragraphs,
 *   headings, lists and items, block quotes, code blocks and diagrams,
 *   tables, rows and cells, dividers, an image alone in its paragraph, and
 *   the outermost element of a raw-HTML section the sanitizer kept. A target
 *   sits directly in the content or inside containers only (lists, items,
 *   quotes, tables); anything inside a paragraph, a heading or raw HTML is
 *   part of that target, never one of its own.
 * - The preview wraps two blocks: a table in `div.table-wrapper` (main's
 *   `table`) and a diagram in `div.mermaid-wrapper` (main's `pre`).
 * - The frontmatter is drawn but never commentable (M-18).
 * - **A pick** is `{ lineStart, lineEnd, tag, ordinal, quote, baseHash }`:
 *   the ordinal counts targets of the tag that start on the line (1-based,
 *   document order – main's walk order), the quote is the target's text with
 *   whitespace collapsed, NFC, cut to {@link PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS}
 *   (`quoteText.ts`'s rule), and `baseHash` is `markdownTextHash` of the text
 *   the preview rendered. Main uses the line while the hash matches its own
 *   parse, else the one target with that quote (C7).
 * - **A known refusal** (W-08): main refuses a target inside a generated
 *   START/END region (024-FR-023). The preview drops those comments, so the
 *   adapter runs main's own index and locate rules (`mdIndex.ts`,
 *   `mdLocate.ts`) on the rendered text – once per text, and only when a
 *   new comment is opened – so the window opens with the refusal instead of
 *   after the reader typed. A text past the comment limits is not indexed
 *   (main makes it read-only anyway).
 *
 * @module Editor/markdownComments/markdownAdapter
 */
import { markdownLimitBreach } from '../../../../../shared/markdownComments/markdownLimits'
import { indexMarkdown, type MdIndex } from '../../../../../shared/markdownComments/mdIndex'
import { locateMarkdownTarget, markdownTextHash } from '../../../../../shared/markdownComments/mdLocate'
import { PREVIEW_LIMITS } from '../../../../../shared/preview-limits'
import type { PickedTargetRequest, ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { MARKDOWN_COPY, MARKDOWN_WORDS } from '../../Comments/commentCopyWords'
import type { CanComment, PreviewCommentAdapter } from '../../Comments/overlay/previewAdapter'

/** Tags that are a target wherever a container holds them. */
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'TR', 'TH', 'TD'])
/** Raw-HTML tags the preview stamps with a line: a target when outermost. */
const RAW_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'DETAILS', 'FIGURE', 'ADDRESS'])
/** Elements a target may sit inside. */
const CONTAINER_TAGS = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR'])
const TABLE_WRAPPER = 'table-wrapper'
const DIAGRAM_WRAPPER = 'mermaid-wrapper'
const FRONTMATTER = '.frontmatter-wrapper, .frontmatter-error-wrapper'
const IMAGE_PLACEHOLDER = 'markdown-image-placeholder'

/** The tag main indexes a rendered element by, or `null` when it is no target kind at all. */
function kindTag(el: Element): string | null {
  if (!el.hasAttribute('data-line-start')) return null
  if (el.matches(FRONTMATTER)) return 'frontmatter'
  const tag = el.tagName
  if (tag === 'DIV' && el.classList.contains(TABLE_WRAPPER)) return 'table'
  if (tag === 'DIV' && el.classList.contains(DIAGRAM_WRAPPER)) return 'pre'
  if (tag === 'PRE' && el.classList.contains('code-block')) return 'pre'
  if (tag === 'IMG' || el.classList.contains(IMAGE_PLACEHOLDER)) return 'img'
  if (BLOCK_TAGS.has(tag) || RAW_TAGS.has(tag)) return tag.toLowerCase()
  return null
}

/**
 * A container a target may sit inside: a list, an item, a quote, a table and
 * its parts – and the bare `<pre>` react-markdown puts around the preview's
 * own code block or diagram, which carries no line of its own.
 */
function isContainer(el: Element): boolean {
  if (CONTAINER_TAGS.has(el.tagName)) return true
  if (el.tagName === 'DIV') return el.classList.contains(TABLE_WRAPPER)
  return el.tagName === 'PRE' && !el.hasAttribute('data-line-start')
}

/** An image that is the only thing in its paragraph, optionally inside a link (`mdIndex.ts` § image). */
function isLoneImage(el: Element, root: Element): boolean {
  let holder = el.parentElement
  if (holder?.tagName === 'A') {
    if (holder.childElementCount !== 1 || (holder.textContent ?? '').trim() !== '') return false
    holder = holder.parentElement
  }
  if (holder?.tagName !== 'P' || holder.childElementCount !== 1) return false
  return (holder.textContent ?? '').trim() === '' && holder.parentElement !== null && inContainers(holder, root)
}

/** Every ancestor of `el` below `root` is a container. */
function inContainers(el: Element, root: Element): boolean {
  for (let up = el.parentElement; up !== null && up !== root; up = up.parentElement) {
    if (!isContainer(up)) return false
  }
  return true
}

/** Whether `el` is a target of the preview rooted at `root`. */
function isTarget(el: Element, root: Element): boolean {
  const tag = kindTag(el)
  // The frontmatter is never outlined or reached by Tab (M-20); `targetAt` still names it, for its menu.
  if (tag === null || tag === 'frontmatter') return false
  if (tag === 'img') return isLoneImage(el, root)
  return inContainers(el, root)
}

/** Whitespace runs to one space, trimmed, NFC, at most the quote limit – `quoteText.ts`'s rule. */
export function collapsedText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim().normalize('NFC')
  const max = PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS
  if (collapsed.length <= max) return collapsed
  const end = /[\uD800-\uDBFF]/.test(collapsed[max - 1]) ? max - 1 : max
  return collapsed.slice(0, end).trimEnd()
}

/** What the adapter reads from the preview. */
export interface MarkdownAdapterSource {
  /** The rendered content element (`.markdown-preview-content`), when mounted. */
  readonly root: () => HTMLElement | null
  /** The Markdown text the preview rendered: its hash is the pick's `baseHash`. */
  readonly text: () => string
}

/**
 * The Markdown Preview's adapter.
 *
 * @param source - {@link MarkdownAdapterSource}
 * @returns The adapter the overlay host drives.
 *
 * @example
 * ```ts
 * const adapter = createMarkdownAdapter({ root: () => contentEl, text: () => buffer })
 * adapter.describe(adapter.targetAt(event.target as Node)!) // { lineStart: 12, tag: 'li', ordinal: 1, … }
 * ```
 */
export function createMarkdownAdapter(source: MarkdownAdapterSource): PreviewCommentAdapter {
  // The rendered text's hash, recomputed only when the text changes.
  let hashed: { text: string; hash: string } | null = null
  const hashOf = (text: string): string => {
    if (hashed?.text !== text) hashed = { text, hash: markdownTextHash(text) }
    return hashed.hash
  }

  // Main's index of the rendered text, for the W-08 refusal; rebuilt only when the text changes.
  let indexed: { text: string; index: MdIndex | null } | null = null
  const indexOf = (text: string): MdIndex | null => {
    if (indexed?.text !== text) {
      indexed = { text, index: markdownLimitBreach(text) === undefined ? indexMarkdown(text, text.startsWith('﻿') ? 1 : 0) : null }
    }
    return indexed.index
  }

  const targetsInOrder = (): HTMLElement[] => {
    const root = source.root()
    if (root === null) return []
    return [...root.querySelectorAll<HTMLElement>('[data-line-start]')].filter(el => isTarget(el, root))
  }

  const targetAt = (node: Node | null): HTMLElement | null => {
    const root = source.root()
    if (root === null || node === null || !root.contains(node)) return null
    // The nearest target on the way up: text inside a paragraph is the
    // paragraph's, a paragraph inside raw HTML is the raw section's.
    for (let el: Element | null = node instanceof Element ? node : node.parentElement; el !== null && el !== root; el = el.parentElement) {
      if (el.matches(FRONTMATTER) || isTarget(el, root)) return el as HTMLElement
    }
    return null
  }

  const tagOf = (target: HTMLElement): string => kindTag(target) ?? target.tagName.toLowerCase()
  const lineOf = (target: HTMLElement): number => Number.parseInt(target.dataset.lineStart ?? '', 10) || 1

  const parentOf = (target: HTMLElement): HTMLElement | null => {
    const root = source.root()
    for (let up = target.parentElement; up !== null && up !== root; up = up.parentElement) {
      if (root !== null && isTarget(up, root)) return up
    }
    return null
  }

  const childOf = (target: HTMLElement): HTMLElement | null => {
    const root = source.root()
    if (root === null) return null
    for (const el of target.querySelectorAll<HTMLElement>('[data-line-start]')) if (isTarget(el, root)) return el
    return null
  }

  const canComment = (target: HTMLElement): CanComment =>
    tagOf(target) === 'frontmatter' ? { ok: false, reason: MARKDOWN_COPY.frontmatter } : { ok: true }

  const describe = (target: HTMLElement): PickedTargetRequest | null => {
    const tag = tagOf(target)
    if (tag === 'frontmatter') return null
    const lineStart = lineOf(target)
    const lineEnd = Math.max(lineStart, Number.parseInt(target.dataset.lineEnd ?? '', 10) || lineStart)
    const sameLine = targetsInOrder().filter(el => lineOf(el) === lineStart && tagOf(el) === tag)
    const ordinal = Math.max(1, sameLine.indexOf(target) + 1)
    const exact = collapsedText(target.textContent ?? '')
    return {
      lineStart,
      lineEnd,
      tag,
      ordinal,
      ...(exact === '' ? {} : { quote: { exact, prefix: '', suffix: '' } }),
      baseHash: hashOf(source.text())
    }
  }

  const attach = (placement: ThreadPlacement): HTMLElement | null =>
    targetsInOrder().find(el => lineOf(el) === placement.line && tagOf(el) === placement.tag) ?? null

  const refusalOf = (target: HTMLElement): 'generated-region' | null => {
    const pick = describe(target)
    const index = pick === null ? null : indexOf(source.text())
    if (pick === null || index === null) return null
    const found = locateMarkdownTarget(index, pick)
    return 'refused' in found && found.refused === 'generated-region' ? 'generated-region' : null
  }

  return {
    words: MARKDOWN_WORDS,
    targetAt,
    targetsInOrder,
    parentOf,
    childOf,
    tagOf,
    lineOf,
    canComment,
    describe,
    attach,
    root: source.root,
    refusalOf
  }
}
