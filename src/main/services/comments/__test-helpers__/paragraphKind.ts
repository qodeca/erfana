// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A TEST-ONLY comment file kind: `.txt` files of paragraphs, with
 * `<!-- … -->` comments (spec 024 architecture note 001 § 3 "`.txt` test
 * preview", 024-AC-038 "faults are injected through a test-registered file
 * kind"). Never in a production registry (`fileCommentKinds.test.ts`).
 *
 * - A target is a paragraph: a run of non-blank lines that are not comment
 *   lines, tag `p`, path `p:nth(n)`. Its quote is its text.
 * - A leading `---` … `---` block is "frontmatter": never a target, a pick on
 *   it is refused as `frontmatter`.
 * - Paragraphs between `<!-- START -->` and `<!-- END -->` are a generated
 *   region: a pick there is refused as `generated-region`.
 * - One `line-start` slot before the paragraph, no indent; the shared checks
 *   are the only checks unless a test forces the kind's own check to fail
 *   ({@link ParagraphKindOptions.failVerify}) or offers extra slots.
 */
import { isAnchorSelection } from '../../../../shared/comments/anchorSel'
import { classifyIndexedBlocks } from '../../../../shared/comments/blocks'
import type { CommentFileKind, KindDocument, Slot } from '../../../../shared/comments/fileKind'
import type { CommentAnchor } from '../../../../shared/comments/format'
import { selectionHints } from '../../../../shared/comments/noteLines'
import { exactOf, prefixOf, suffixOf } from '../../../../shared/comments/quoteText'
import { findAnchorTarget, resolveBlockTarget } from '../../../../shared/comments/reattach'
import { sharedOriginOf } from '../../../../shared/comments/splice'
import type { IndexedCommentNode, IndexedTarget, TargetIndex } from '../../../../shared/comments/targetIndex'

/** The test kind's agent note: printable ASCII, first line `note to agents:`. */
export const PARAGRAPH_AGENT_NOTE: readonly string[] = [
  'note to agents: a review comment on the paragraph after this block (test kind).',
  '  Change that paragraph; keep this block byte for byte.'
]

/** A paragraph target, with its 1-based first line and its region. */
export interface ParagraphTarget extends IndexedTarget {
  readonly line: number
  readonly generated: boolean
}

/** Faults a suite injects. */
export interface ParagraphKindOptions {
  /** The kind's own check fails for this many plans, then passes (`Infinity`: always). */
  readonly failVerify?: number
  /** The kind's own check fails on the calls this says (1-based); wins over `failVerify`. */
  readonly verifyFails?: (call: number) => boolean
  /** Slots offered per target (each one more line-start before the paragraph, all equal); 1 by default. */
  readonly slotCount?: number
}

interface Line {
  readonly start: number
  /** End of the text, before the line break. */
  readonly end: number
  readonly number: number
}

function linesOf(text: string, bomLength: number): Line[] {
  const lines: Line[] = []
  let start = bomLength
  let number = 1
  for (let i = bomLength; i <= text.length; i += 1) {
    const ch = text[i]
    if (i === text.length || ch === '\n' || ch === '\r') {
      lines.push({ start, end: i, number })
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      start = i + 1
      number += 1
    }
  }
  return lines
}

function commentsOf(text: string): IndexedCommentNode[] {
  const nodes: IndexedCommentNode[] = []
  let at = text.indexOf('<!--')
  while (at !== -1) {
    const close = text.indexOf('-->', at + 4)
    const end = close === -1 ? text.length : close + 3
    nodes.push({ start: at, end, data: text.slice(at + 4, close === -1 ? text.length : close), inTemplate: false })
    at = close === -1 ? -1 : text.indexOf('<!--', end)
  }
  return nodes
}

/** The lines of a leading `---` … `---` block, or 0. */
function frontmatterLines(text: string, lines: readonly Line[]): number {
  if (lines.length === 0 || text.slice(lines[0].start, lines[0].end) !== '---') return 0
  const close = lines.findIndex((line, i) => i > 0 && text.slice(line.start, line.end) === '---')
  return close === -1 ? 0 : close + 1
}

class ParagraphIndex implements TargetIndex<ParagraphTarget> {
  readonly comments: readonly IndexedCommentNode[]
  readonly elements: readonly ParagraphTarget[]
  readonly visibleText: string
  readonly frontmatterEnd: number

  constructor(
    readonly text: string,
    readonly bomLength: number
  ) {
    this.comments = commentsOf(text)
    const lines = linesOf(text, bomLength)
    this.frontmatterEnd = frontmatterLines(text, lines)
    const inComment = (offset: number): boolean => this.comments.some(node => offset >= node.start && offset < node.end)
    const elements: ParagraphTarget[] = []
    let visible = ''
    let run: Line[] = []
    const flush = (): void => {
      if (run.length === 0) return
      const first = run[0]
      const lead = first.start + (text.slice(first.start, first.end).length - text.slice(first.start, first.end).trimStart().length)
      const body = run.map(line => text.slice(line.start, line.end).trim()).join(' ')
      const textStart = visible.length
      visible += body + '\n'
      elements.push({ tag: 'p', start: lead, id: undefined, textStart, textEnd: textStart + body.length, line: first.number, generated: this.inRegion(lead) })
      run = []
    }
    for (const line of lines.slice(this.frontmatterEnd)) {
      const content = text.slice(line.start, line.end)
      const lead = line.start + content.length - content.trimStart().length
      if (content.trim() === '' || inComment(lead)) flush()
      else run.push(line)
    }
    flush()
    this.elements = elements
    this.visibleText = visible
  }

  /** True when `offset` lies between a `<!-- START -->` and the next `<!-- END -->`. */
  private inRegion(offset: number): boolean {
    let open = false
    for (const node of this.comments) {
      if (node.start > offset) break
      const word = node.data.trim()
      if (word === 'START') open = true
      else if (word === 'END') open = false
    }
    return open
  }

  elementAt(offset: number): ParagraphTarget | undefined {
    return this.elements.find(el => el.start === offset)
  }

  elementAtPath(path: string): ParagraphTarget | undefined {
    const match = /^p:nth\((\d+)\)$/.exec(path)
    return match === null ? undefined : this.elements[Number(match[1]) - 1]
  }

  pathOfTarget(target: ParagraphTarget): string {
    return `p:nth(${this.elements.indexOf(target) + 1})`
  }

  /** The start of the line `offset` is on. */
  lineStartOf(offset: number): number {
    let at = offset
    while (at > this.bomLength && this.text[at - 1] !== '\n' && this.text[at - 1] !== '\r') at -= 1
    return at
  }
}

function indexOf(doc: KindDocument): ParagraphIndex {
  if (!(doc.index instanceof ParagraphIndex)) throw new Error('The paragraph test kind was given another kind\'s document')
  return doc.index
}

function anchorFor(index: ParagraphIndex, target: ParagraphTarget): CommentAnchor {
  const exact = exactOf(index, target)
  return {
    tag: 'p',
    path: index.pathOfTarget(target),
    ...(exact ? { quote: { exact, prefix: prefixOf(index, target), suffix: suffixOf(index, target) } } : {})
  }
}

/** Build a paragraph kind; `id` and `extensions` let a suite register a second one. */
export function createParagraphKind(
  options: ParagraphKindOptions = {},
  identity: { readonly id?: string; readonly extensions?: readonly string[] } = {}
): CommentFileKind & { readonly verifyCalls: () => number } {
  let verifyCalls = 0
  return {
    id: identity.id ?? 'txt',
    extensions: identity.extensions ?? ['.txt'],
    agentNote: PARAGRAPH_AGENT_NOTE,
    verifyCalls: () => verifyCalls,

    parse(text, bomLength) {
      const index = new ParagraphIndex(text, bomLength)
      const state = classifyIndexedBlocks(index, 'line-start', (node, data, blockEnds) =>
        resolveBlockTarget(index, { after: node.end, anchor: data.anchor, blockEnds })
      )
      return { text, index, state }
    },

    locate(doc, pick) {
      const index = indexOf(doc)
      if (pick.lineStart <= index.frontmatterEnd) return { refused: 'frontmatter' }
      const target = index.elements.find(el => el.line === pick.lineStart && el.tag === pick.tag)
      if (target === undefined) return { refused: 'not-found' }
      return target.generated ? { refused: 'generated-region' } : target
    },

    slots(doc, target): readonly Slot[] {
      const index = indexOf(doc)
      const slot: Slot = { offset: index.lineStartOf(target.start), shape: 'line-start', indent: '' }
      return Array.from({ length: options.slotCount ?? 1 }, () => slot)
    },

    anchorOf(doc, target, sel) {
      const anchor = anchorFor(indexOf(doc), target as ParagraphTarget)
      return isAnchorSelection(sel) ? { ...anchor, sel: { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } } : anchor
    },

    hints: selectionHints,

    reattach(doc, anchor) {
      return findAnchorTarget(indexOf(doc), anchor)
    },

    originOf(doc) {
      return sharedOriginOf(doc)
    },

    verify() {
      verifyCalls += 1
      const fails = options.verifyFails?.(verifyCalls) ?? verifyCalls <= (options.failVerify ?? 0)
      return fails ? { ok: false, reason: 'elements' } : { ok: true }
    }
  }
}
