// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How much Markdown the comment kind will parse, and the cheap checks that
 * hold it there BEFORE any parse (spec 024 024-NFR-008, 024-AC-036;
 * architecture note 001 § 8 C19).
 *
 * The Markdown pipeline is not linear in every input. Measured on the repo's
 * pipeline (Windows 11, 2026-10-30): nested list items 1,000 deep take 52 s,
 * block quotes 5,000 deep, raw `<div>`s 2,000 deep and emphasis 3,000 deep
 * overflow the stack. So a file past any limit below is read-only "too
 * large", decided by one linear scan of the text – the parser is never
 * called on it. Real files stay far inside: the limits are about ten times
 * what a long hand-written document uses (the corpus run of 024-NFR-003 will
 * set them from its 99th percentile; these are the values until then).
 *
 * The scan over-counts rather than under-counts: it does not know which
 * lines are code, so a fence full of `<div>`s counts as raw HTML. A file
 * refused that way is read-only, never damaged.
 */
import { utf8Length } from '../comments/encoding'

/** Largest commentable Markdown file, in UTF-8 bytes (≥ 2 MB, 024-NFR-008). */
export const MARKDOWN_COMMENT_MAX_BYTES = 2 * 1024 * 1024
/** Most lines a commentable Markdown file may have (CR, LF and CRLF each end one). */
export const MARKDOWN_COMMENT_MAX_LINES = 100_000
/** Deepest container nesting – block quotes and list items together – on any line. */
export const MARKDOWN_COMMENT_MAX_NESTING = 32
/** Deepest raw-HTML element nesting, counted over the whole file. */
export const MARKDOWN_COMMENT_MAX_HTML_NESTING = 256
/** Most emphasis delimiter runs left open at once in one paragraph. */
export const MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING = 64
/** Slots one save tries at most (design § 4.5). */
export const MARKDOWN_COMMENT_MAX_SLOTS = 4
/** Characters of a target's rendered text a selection is searched in; past it the words are dropped. */
export const MARKDOWN_SELECTION_SEARCH_MAX_CHARS = 100_000

/** Elements that never take an end tag, so never nest. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
])

const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)[^<>]*?(\/?)>/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Columns of leading blanks, tab stops of 4, and where the blanks end. */
function leadingColumns(line: string): { readonly columns: number; readonly end: number } {
  let columns = 0
  let i = 0
  for (; i < line.length; i += 1) {
    if (line[i] === ' ') columns += 1
    else if (line[i] === '\t') columns += 4 - (columns % 4)
    else break
  }
  return { columns, end: i }
}

/** Block quote markers and list markers this line opens, read left to right. */
function markersOnLine(line: string): number {
  let rest = line
  let count = 0
  for (;;) {
    const lead = leadingColumns(rest)
    if (lead.columns > 3 && count > 0) return count
    const after = rest.slice(lead.end)
    if (after.startsWith('>')) {
      count += 1
      rest = after.slice(1)
      continue
    }
    const marker = LIST_MARKER.exec(after)
    if (marker === null) return count
    count += 1
    rest = after.slice(marker[0].length)
  }
}

/**
 * Nesting of list items by indentation: a stack of the columns items opened
 * at. A line's own markers are added on top, so `- - - x` and a staircase of
 * items both count.
 */
class ContainerDepth {
  private readonly columns: number[] = []
  max = 0

  line(line: string): void {
    const lead = leadingColumns(line)
    if (lead.end === line.length) return
    while (this.columns.length > 0 && this.columns[this.columns.length - 1] >= lead.columns) this.columns.pop()
    const markers = markersOnLine(line)
    // A line that opens an item at its indentation counts it once: on the stack, not again as a marker.
    const opens = markers > 0 && LIST_MARKER.test(line.slice(lead.end))
    if (opens) this.columns.push(lead.columns)
    this.max = Math.max(this.max, this.columns.length + markers - (opens ? 1 : 0))
  }
}

/** Running raw-HTML element depth over the whole file: start tags minus end tags. */
class HtmlDepth {
  private depth = 0
  max = 0

  line(line: string): void {
    if (!line.includes('<')) return
    for (const match of line.matchAll(TAG)) {
      const [, closing, name, selfClosing] = match
      if (VOID_TAGS.has(name.toLowerCase()) || selfClosing === '/') continue
      this.depth = closing === '/' ? Math.max(0, this.depth - 1) : this.depth + 1
      this.max = Math.max(this.max, this.depth)
    }
  }
}

const isEmphasis = (ch: string | undefined): boolean => ch === '*' || ch === '_'
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch)

/** Emphasis runs left open in one paragraph: a run before a word opens, a run after one closes. */
class EmphasisDepth {
  private depth = 0
  max = 0

  line(line: string): void {
    if (line.trim() === '') {
      this.depth = 0
      return
    }
    for (let i = 0; i < line.length; ) {
      if (!isEmphasis(line[i])) {
        i += 1
        continue
      }
      let end = i
      while (isEmphasis(line[end])) end += 1
      const opens = isSpace(line[i - 1]) && !isSpace(line[end])
      const closes = !isSpace(line[i - 1]) && isSpace(line[end])
      if (opens) this.depth += 1
      else if (closes) this.depth = Math.max(0, this.depth - 1)
      this.max = Math.max(this.max, this.depth)
      i = end
    }
  }
}

const QUOTE_PREFIX = /^(?:[ \t]{0,3}>)*/

interface OpenFence {
  readonly marker: string
  readonly quotes: number
  readonly columns: number
}

/**
 * Fenced code, so its lines do not count as containers or emphasis. A fence
 * ends at its closing line, and also – erring towards counting – at any
 * line with fewer `>` markers or less indentation than the fence line,
 * which may have closed its container. Only a fence at most 3 columns in
 * (after the `>` markers) is seen; any other is counted as text.
 */
class FenceTracker {
  private open: OpenFence | undefined

  /** True when `line` is part of a fence (its opening and closing lines included). */
  line(line: string): boolean {
    const prefix = QUOTE_PREFIX.exec(line)![0]
    const quotes = prefix.split('>').length - 1
    const rest = line.slice(prefix.length)
    const lead = leadingColumns(rest)
    const fence = FENCE.exec(rest)
    const open = this.open
    if (open !== undefined) {
      const left = quotes < open.quotes || (lead.end < rest.length && lead.columns < open.columns)
      if (!left) {
        const closes = fence !== null && fence[1][0] === open.marker[0] && fence[1].length >= open.marker.length
        if (closes && rest.slice(fence![0].length).trim() === '') this.open = undefined
        return true
      }
      this.open = undefined
    }
    if (fence === null || (fence[1][0] === '`' && rest.slice(fence[0].length).includes('`'))) return false
    this.open = { marker: fence[1], quotes, columns: lead.columns }
    return true
  }
}

/** Why a Markdown file is past a limit, or `undefined` when it may be parsed. */
export type MarkdownLimitBreach = 'bytes' | 'lines' | 'nesting' | 'html-nesting' | 'emphasis-nesting'

/**
 * Whether `text` may be parsed for comments: one linear pass, before any
 * parse (module comment). Fenced code lines are skipped by the container and
 * emphasis counts, never by the HTML count.
 */
export function markdownLimitBreach(text: string): MarkdownLimitBreach | undefined {
  if (text.length > MARKDOWN_COMMENT_MAX_BYTES || utf8Length(text) > MARKDOWN_COMMENT_MAX_BYTES) return 'bytes'
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > MARKDOWN_COMMENT_MAX_LINES) return 'lines'
  const containers = new ContainerDepth()
  const html = new HtmlDepth()
  const emphasis = new EmphasisDepth()
  const fences = new FenceTracker()
  for (const line of lines) {
    html.line(line)
    if (fences.line(line)) continue
    containers.line(line)
    emphasis.line(line)
  }
  if (containers.max > MARKDOWN_COMMENT_MAX_NESTING) return 'nesting'
  if (html.max > MARKDOWN_COMMENT_MAX_HTML_NESTING) return 'html-nesting'
  if (emphasis.max > MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING) return 'emphasis-nesting'
  return undefined
}
