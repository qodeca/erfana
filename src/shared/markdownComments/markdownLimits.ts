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
 * overflow the stack, and 10,000 raw-HTML tags inline in one paragraph take
 * seconds (see {@link MARKDOWN_COMMENT_MAX_HTML_NODES}). So a file past any limit below is read-only "too
 * large", decided by one linear scan of the text – the parser is never
 * called on it. Real files stay far inside: the limits are about ten times
 * what a long hand-written document uses (the corpus run of 024-NFR-003 will
 * set them from its 99th percentile; these are the values until then).
 *
 * The scan over-counts rather than under-counts: it does not know which
 * lines are code, so a fence full of `<div>`s counts as raw HTML. A file
 * refused that way is read-only, never damaged. The one thing it leaves out
 * of the HTML count is the inside of Erfana's own comment blocks, and only
 * where the parser cannot read it as anything but a comment or code (see
 * `ownBlockInteriors`).
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
/**
 * Most raw-HTML constructs in a file: start, end, void and self-closing tags,
 * and `<!`/`<?` openers (comments, declarations, CDATA, processing
 * instructions). The parse is superlinear in them – 10,000 tags inline in
 * one paragraph took 1.3 s to index and up to 5.8 s for a full add (Windows
 * 11, 2026-10-30), too close to the parse worker's 10 s budget on a slower
 * box; at 5,000 the worst shape measured indexed in 0.5 s and added in
 * about 2 s. A hand-written document uses a few hundred.
 */
export const MARKDOWN_COMMENT_MAX_HTML_NODES = 5_000
/** Most emphasis delimiters (`*`, `_`) left open at once in one paragraph. */
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
/** {@link LIST_MARKER} at `lastIndex`, so a line is never sliced per marker. */
const LIST_MARKER_AT = /(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/y
/**
 * A raw-HTML construct's start: `<!` or `<?` (no groups), or a start or end
 * tag's `<name`, ended by a blank, `/`, `>` or the end of the text – the rest
 * of the tag may be on later lines. The negative lookahead stops the name
 * from backtracking, so a long `<aaaa…` costs one pass.
 */
const HTML_OPEN = /<(?:[!?]|(\/?)([A-Za-z][A-Za-z0-9-]*)(?![A-Za-z0-9-])(?=[\s/>]|$))/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** The column of index `end` of `line`, tab stops of 4 counted from the line's start. */
function columnAt(line: string, end: number): number {
  let column = 0
  for (let i = 0; i < end; i += 1) column += line[i] === '\t' ? 4 - (column % 4) : 1
  return column
}

/**
 * Columns of the blanks from index `from` of `line`, and where they end. Tab
 * stops are counted from the line's start, not from `from`: a tab after a
 * `>` marker is as wide as it is on screen.
 */
function leadingColumns(line: string, from = 0): { readonly columns: number; readonly end: number } {
  const start = columnAt(line, from)
  let column = start
  let i = from
  for (; i < line.length; i += 1) {
    if (line[i] === ' ') column += 1
    else if (line[i] === '\t') column += 4 - (column % 4)
    else break
  }
  return { columns: column - start, end: i }
}

/**
 * Block quote markers and list markers this line opens, read left to right.
 * Every one counts whatever the blanks between them: CommonMark nests a list
 * item after up to four spaces and a quote after its optional space plus
 * three, and over-counting is this module's policy.
 */
function markersOnLine(line: string): number {
  let count = 0
  let i = 0
  for (;;) {
    while (line[i] === ' ' || line[i] === '\t') i += 1
    if (line[i] === '>') {
      count += 1
      i += 1
      continue
    }
    LIST_MARKER_AT.lastIndex = i
    const marker = LIST_MARKER_AT.exec(line)
    if (marker === null) return count
    count += 1
    i += marker[0].length
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

/**
 * Whether the tag whose name ends at `from` closes itself (`<x … />`): its
 * end is the first `>` before the next `<`. No end counts as an open tag
 * (over-counting). Each call stops at the next `<`, where the next tag
 * starts, so the calls of one scan cover the text once.
 */
function selfCloses(text: string, from: number): boolean {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '<') return false
    if (text[i] === '>') return text[i - 1] === '/'
  }
  return false
}

/** Raw HTML over the whole text: its deepest element nesting, and how many constructs it holds. */
interface HtmlShape {
  readonly depth: number
  readonly nodes: number
}

/** A range of the text the HTML count skips: `[start, end)`. */
type SkippedRange = readonly [number, number]

/**
 * Raw HTML over the whole text, in one scan: the depth is start tags minus
 * end tags, the count every construct {@link HTML_OPEN} finds. A tag split
 * over lines counts – `<div` then `>` on the next line is still a `<div>` to
 * the parser. Constructs inside `skipped` (sorted, disjoint) are not counted.
 */
function htmlShape(text: string, skipped: readonly SkippedRange[]): HtmlShape {
  let depth = 0
  let max = 0
  let nodes = 0
  let next = 0
  for (const match of text.matchAll(HTML_OPEN)) {
    while (next < skipped.length && skipped[next][1] <= match.index) next += 1
    if (next < skipped.length && skipped[next][0] <= match.index) continue
    nodes += 1
    const [whole, closing, name] = match
    if (name === undefined) continue
    if (closing === '/') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (VOID_TAGS.has(name.toLowerCase()) || selfCloses(text, match.index + whole.length)) continue
    depth += 1
    max = Math.max(max, depth)
  }
  return { depth: max, nodes }
}

const isEmphasis = (ch: string | undefined): boolean => ch === '*' || ch === '_'
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch)
/** CommonMark's punctuation: ASCII punctuation and Unicode P and S categories. */
const isPunctuation = (ch: string | undefined): boolean => ch !== undefined && /[\p{P}\p{S}]/u.test(ch)

/**
 * What a delimiter run between `before` and `after` does, by CommonMark's
 * flanking rules: +1 opens, -1 closes, 0 neither. A run flanking both ways
 * between two punctuation marks (`(*(`) may open, so it counts as opening;
 * one inside a word (`a*b`) pairs with its neighbour and counts as neither.
 */
function emphasisRole(before: string | undefined, after: string | undefined): 1 | -1 | 0 {
  const left = !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before))
  const right = !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after))
  if (left && !right) return 1
  if (right && !left) return -1
  return left && isPunctuation(before) && isPunctuation(after) ? 1 : 0
}

/**
 * Emphasis delimiters left open in one paragraph. Each delimiter of a run
 * counts, not the run: `*`×6000 before a word nests about 3000 deep.
 */
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
      const role = emphasisRole(line[i - 1], line[end])
      this.depth = Math.max(0, this.depth + role * (end - i))
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
    const lead = leadingColumns(line, prefix.length)
    const fence = FENCE.exec(rest)
    const open = this.open
    if (open !== undefined) {
      const left = quotes < open.quotes || (lead.end < line.length && lead.columns < open.columns)
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

/** The first line of a block Erfana writes (`format.ts`): blanks, then the header and nothing else. */
const OWN_OPENER = /^([ \t]*)<!-- erfana:comment v1 id=[\w-]+$/
/** The last line of one, after the opener's blanks. */
const OWN_CLOSER = '-->'
/**
 * Never inside a block Erfana writes (its text holds no `--`): an end of the
 * comment in HTML (`--!>`) or Markdown (`-->`), and every way out of a
 * raw-text or escapable raw-text element, of a Markdown HTML block of type 1,
 * of a processing instruction or of CDATA. Any other end tag (`</b>` in a
 * message) leaves none of them.
 */
const OWN_INTERIOR_BANNED =
  /--|<\/(?:pre|script|style|textarea|title|xmp|iframe|noembed|noframes|noscript|plaintext)(?![A-Za-z0-9-])|\?>|\]\]>/i
/** A line that could close a fence the block sits in. */
const FENCE_LEAD = /^(?:`{3}|~{3})/
/** A line that could end or split a paragraph the block sits in: any block start, or a setext or table underline. */
const BLOCK_LEAD = /^[-#>`~*+_=|:<\d]/
/** Text that could carry an inline construct of a paragraph over the opener: a tag, a code span, a table, a link or definition. */
const PARAGRAPH_HAZARD = /[<`|[]/

/** How sure the scan is that an opener starts a comment: after a blank line, or inside a paragraph so far free of hazards. */
type OwnContext = 'after-blank' | 'in-paragraph'

/**
 * The index of the last line of the block Erfana wrote whose opener is line
 * `i`, or -1 when line `i` is not one or a line of it could reach the parser
 * as anything but comment or code text ({@link ownBlockInteriors}).
 */
function ownBlockEnd(lines: readonly string[], i: number, context: OwnContext): number {
  const opener = OWN_OPENER.exec(lines[i])
  if (opener === null || lines[i].includes('--', opener[1].length + 4)) return -1
  const indent = opener[1]
  for (let j = i + 1; j < lines.length; j += 1) {
    const line = lines[j]
    if (line.trim() === '') {
      if (context === 'in-paragraph') return -1
      continue
    }
    if (!line.startsWith(indent)) return -1
    const rest = line.slice(indent.length)
    if (rest.trimEnd() === OWN_CLOSER) return j
    // Every opener holds `--`, so a look-ahead stops at the next one: the look-aheads never overlap.
    if (OWN_INTERIOR_BANNED.test(rest)) return -1
    const lead = rest.trimStart()
    if (FENCE_LEAD.test(lead) || (context === 'in-paragraph' && BLOCK_LEAD.test(lead))) return -1
  }
  return -1
}

/** The offset of each line's first character; `lines` is `text` split at CR, LF and CRLF. */
function lineStartsOf(text: string, lines: readonly string[]): number[] {
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length
    offset += text[offset] === '\r' && text[offset + 1] === '\n' ? 2 : 1
  }
  return starts
}

/**
 * The inside of every block Erfana wrote – after its `<!--`, to the end of
 * its `-->` line – that the parser can read only as comment or code text, so
 * the tags its readable lines name (`target: <li>`) and its messages hold are
 * not counted as raw HTML. Without this, about 250 comments made a file
 * "too large". The `<!--` itself still counts as one construct.
 *
 * Crafted text can make a block-shaped run of lines reach the parser as
 * something else – inside a fence, an attribute value, a raw-text element, a
 * declaration or a code span – and end there, so that the rest of it is
 * Markdown with real tags. A block is skipped only when that cannot happen:
 *
 * - its opener is the line's blanks and the header alone, outside every fence
 *   the scan sees, and no `<` before it is left without a `>` after it (no
 *   tag, declaration or processing instruction is still open);
 * - every line up to its `-->` line starts with the opener's blanks and holds
 *   no {@link OWN_INTERIOR_BANNED} and no fence line;
 * - after a blank line (or another block skipped that way) the opener starts
 *   an HTML block or indented code, and both run to the `-->` line;
 * - otherwise it sits in a paragraph (a list item's text, say). It may be an
 *   inline comment then, so nothing since the blank line may hold a
 *   {@link PARAGRAPH_HAZARD}, and no line of the block may be blank or start
 *   with anything that could end the paragraph ({@link BLOCK_LEAD}).
 *
 * Any other block is counted as before: over-counted, never under-counted. A
 * real block whose message has a blank line or starts a line with `-` is
 * counted that way when it sits in a paragraph. One linear pass.
 */
function ownBlockInteriors(text: string, lines: readonly string[], fenced: Uint8Array): SkippedRange[] {
  const starts = lineStartsOf(text, lines)
  const skipped: SkippedRange[] = []
  let afterBlank = true
  let hazard = false
  let tagOpen = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') {
      afterBlank = true
      hazard = false
      continue
    }
    const context: OwnContext | undefined =
      fenced[i] === 1 || tagOpen ? undefined : afterBlank ? 'after-blank' : hazard ? undefined : 'in-paragraph'
    const end = context === undefined ? -1 : ownBlockEnd(lines, i, context)
    if (end !== -1) {
      // A block skipped in a paragraph has already cleared `afterBlank`; one after a blank line keeps it.
      skipped.push([starts[i] + line.indexOf('<!--') + 4, starts[end] + lines[end].length])
      i = end
      continue
    }
    afterBlank = false
    if (PARAGRAPH_HAZARD.test(line)) hazard = true
    const lt = line.lastIndexOf('<')
    const gt = line.lastIndexOf('>')
    if (lt !== gt) tagOpen = lt > gt
  }
  return skipped
}

/** Why a Markdown file is past a limit, or `undefined` when it may be parsed. */
export type MarkdownLimitBreach = 'bytes' | 'lines' | 'nesting' | 'html-nesting' | 'html-nodes' | 'emphasis-nesting'

/**
 * Whether `text` may be parsed for comments: linear passes, before any
 * parse (module comment). Fenced code lines are skipped by the container and
 * emphasis counts, never by the HTML count; the inside of Erfana's own
 * comment blocks is skipped by the HTML count only ({@link ownBlockInteriors}).
 */
export function markdownLimitBreach(text: string): MarkdownLimitBreach | undefined {
  if (text.length > MARKDOWN_COMMENT_MAX_BYTES || utf8Length(text) > MARKDOWN_COMMENT_MAX_BYTES) return 'bytes'
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > MARKDOWN_COMMENT_MAX_LINES) return 'lines'
  const containers = new ContainerDepth()
  const emphasis = new EmphasisDepth()
  const fences = new FenceTracker()
  const fenced = new Uint8Array(lines.length)
  lines.forEach((line, i) => {
    if (fences.line(line)) {
      fenced[i] = 1
      return
    }
    containers.line(line)
    emphasis.line(line)
  })
  if (containers.max > MARKDOWN_COMMENT_MAX_NESTING) return 'nesting'
  const html = htmlShape(text, ownBlockInteriors(text, lines, fenced))
  if (html.depth > MARKDOWN_COMMENT_MAX_HTML_NESTING) return 'html-nesting'
  if (html.nodes > MARKDOWN_COMMENT_MAX_HTML_NODES) return 'html-nodes'
  if (emphasis.max > MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING) return 'emphasis-nesting'
  return undefined
}
