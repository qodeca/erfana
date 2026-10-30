// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment tokenizer for Markdown `html` nodes, and what the placement
 * rules read from a comment's words (spec 024 024-FR-003, 024-FR-023;
 * design `markdown-format.md` § 4.3, § 4.4, § 4.6; architecture note 001
 * § 8 C3, C4).
 *
 * A block is an HTML comment inside an `html` node of the CommonMark/GFM
 * parse – never comment-shaped text in code, a code span or frontmatter,
 * because those are not `html` nodes. Inside a node, `<!--` opens a comment
 * and the first `-->` after it closes it, as CommonMark's type-2 HTML block
 * ends: `--!>` does NOT close a comment in Markdown, so a block that relies
 * on it is unterminated and makes the file read-only. `<!-->` and `<!--->`
 * are complete (empty) comments, as both HTML and CommonMark read them.
 */

/** One comment found in a source range. */
export interface ScannedComment {
  /** Offset of `<!--`. */
  readonly start: number
  /** Offset just after `-->`; the end of the range when unterminated. */
  readonly end: number
  /** The text between `<!--` and `-->` (to the range's end when unterminated). */
  readonly data: string
  readonly terminated: boolean
}

const OPEN = '<!--'
const CLOSE = '-->'

/** Every comment in `text[from, to)`, in order. An unterminated one is last and runs to `to`. */
export function scanComments(text: string, from: number, to: number): ScannedComment[] {
  const found: ScannedComment[] = []
  let at = text.indexOf(OPEN, from)
  while (at !== -1 && at + OPEN.length <= to) {
    const close = text.indexOf(CLOSE, at + 2)
    if (close === -1 || close + CLOSE.length > to) {
      found.push({ start: at, end: to, data: text.slice(at + OPEN.length, to), terminated: false })
      break
    }
    const end = close + CLOSE.length
    found.push({ start: at, end, data: close >= at + OPEN.length ? text.slice(at + OPEN.length, close) : '', terminated: true })
    at = text.indexOf(OPEN, end)
  }
  return found
}

/** True when `value` holds at least one comment and nothing else but whitespace. */
export function isCommentOnly(value: string): boolean {
  const comments = scanComments(value, 0, value.length)
  if (comments.length === 0) return false
  let rest = ''
  let at = 0
  for (const comment of comments) {
    rest += value.slice(at, comment.start)
    at = comment.end
  }
  return (rest + value.slice(at)).trim() === ''
}

/** CommonMark § 4.6 HTML block types, as the placement rules need them. */
export type HtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7

const TYPE_1 = /^<(?:pre|script|style|textarea)(?:[\s>]|$)/i
const TYPE_1_END = /<\/(?:pre|script|style|textarea)>/i
const TYPE_6 = /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\s/>]|$)/i

/** The type of an HTML block whose value (container prefixes removed) is `value`. */
export function htmlBlockType(value: string): HtmlBlockType {
  if (TYPE_1.test(value)) return 1
  if (value.startsWith('<!--')) return 2
  if (value.startsWith('<?')) return 3
  if (/^<![A-Za-z]/.test(value)) return 4
  if (value.startsWith('<![CDATA[')) return 5
  return TYPE_6.test(value) ? 6 : 7
}

/**
 * True when the block's own end condition was met, so the line after it
 * starts afresh. Types 6 and 7 end at a blank line, which is never part of
 * the node: they are open whenever a line follows them directly.
 */
export function htmlBlockClosed(value: string, type: HtmlBlockType): boolean {
  switch (type) {
    case 1:
      return TYPE_1_END.test(value)
    case 2:
      return value.includes(CLOSE, 2)
    case 3:
      return value.includes('?>', 2)
    case 4:
      return value.includes('>', 2)
    case 5:
      return value.includes(']]>', 9)
    default:
      return false
  }
}

const REGION_START = /^(?:(.*)[:-])?(?:START|BEGIN)$/
const REGION_END = /^(?:(.*)[:-])?END$/

function firstWord(data: string): string {
  return data.trim().split(/\s+/, 1)[0] ?? ''
}

/**
 * The leading name of a comment that opens a generated region – `START` or
 * `BEGIN` as its first word, or as the suffix of its first word after `:` or
 * `-` (`ALL-CONTRIBUTORS-LIST:START` → `ALL-CONTRIBUTORS-LIST`; `START` → '')
 * – or `undefined` when it opens none.
 */
export function regionStartName(data: string): string | undefined {
  const match = REGION_START.exec(firstWord(data))
  return match === null ? undefined : (match[1] ?? '')
}

/** The leading name of a comment that closes a region (`END`, `…:END`, `…-END`), or `undefined`. */
export function regionEndName(data: string): string | undefined {
  const match = REGION_END.exec(firstWord(data))
  return match === null ? undefined : (match[1] ?? '')
}
