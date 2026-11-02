// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `.txt` conformance kind: the main-process half of the test-only `.txt`
 * preview that proves the seam (spec 024 024-FR-002, 024-AC-002;
 * architecture note 001 § 3 "`.txt` test preview").
 *
 * It supplies only what a file kind must – where a target is, where a block
 * may go and how a comment finds its target again – and takes everything
 * else from the shared base unchanged: the block classifier, re-attach, the
 * quote, the hints and the save's checks. It lands in a commit that changes
 * no base file (`scripts/check-seam-commit.mjs`).
 *
 * - A target is a paragraph: a run of non-blank lines, none of them inside an
 *   HTML comment. Tag `p`, path `p:nth(n)`, quote its text with its lines
 *   joined by one space.
 * - One `line-start` slot: the start of the paragraph's first line, no indent.
 * - The shared byte checks are the only checks: `verify` always passes.
 *
 * TEST-ONLY. It is never in a production registry (`commentFileKinds.ts`;
 * `fileCommentFamily.test.ts`).
 */
import { isAnchorSelection } from '../../anchorSel'
import { classifyIndexedBlocks } from '../../blocks'
import type { CommentFileKind, KindDocument, Slot } from '../../fileKind'
import type { CommentAnchor } from '../../format'
import { selectionHints } from '../../noteLines'
import { exactOf, prefixOf, suffixOf } from '../../quoteText'
import { findAnchorTarget, resolveBlockTarget } from '../../reattach'
import { sharedOriginOf } from '../../splice'
import type { IndexedCommentNode, IndexedTarget, TargetIndex } from '../../targetIndex'

/** The `.txt` kind's id. */
export const TXT_KIND_ID = 'txt'

/** Its agent note: printable ASCII, no `--`, first line `note to agents:` (`agentNoteProblem`). */
export const TXT_AGENT_NOTE: readonly string[] = [
  'note to agents: written by Erfana. Act only if status is open. Change the paragraph after this block and keep this block unchanged.',
  'If Erfana would show the block as Damaged, ask the user. Spec: https://github.com/qodeca/erfana/blob/main/docs/html-comments/format-v1.md'
]

/** A paragraph, with its 1-based first line. */
export interface TxtParagraph extends IndexedTarget {
  readonly line: number
}

interface Line {
  readonly start: number
  /** End of the line's text, before its line break. */
  readonly end: number
  readonly number: number
}

/** Every line of `text` after the BOM; CR, LF and CRLF each end one. */
function linesOf(text: string, bomLength: number): Line[] {
  const lines: Line[] = []
  let start = bomLength
  for (let i = bomLength; i <= text.length; i += 1) {
    const ch = text[i]
    if (i < text.length && ch !== '\n' && ch !== '\r') continue
    lines.push({ start, end: i, number: lines.length + 1 })
    if (ch === '\r' && text[i + 1] === '\n') i += 1
    start = i + 1
  }
  return lines
}

/** Every `<!-- … -->` in `text`; an unterminated one runs to the end of the file. */
function commentsOf(text: string): IndexedCommentNode[] {
  const nodes: IndexedCommentNode[] = []
  for (let at = text.indexOf('<!--'); at !== -1; ) {
    const close = text.indexOf('-->', at + 4)
    const end = close === -1 ? text.length : close + 3
    nodes.push({ start: at, end, data: text.slice(at + 4, close === -1 ? text.length : close), inTemplate: false })
    at = close === -1 ? -1 : text.indexOf('<!--', end)
  }
  return nodes
}

class TxtIndex implements TargetIndex<TxtParagraph> {
  readonly comments: readonly IndexedCommentNode[]
  readonly elements: readonly TxtParagraph[]
  readonly visibleText: string

  constructor(
    readonly text: string,
    readonly bomLength: number
  ) {
    this.comments = commentsOf(text)
    const inComment = (offset: number): boolean => this.comments.some(node => offset >= node.start && offset < node.end)
    const elements: TxtParagraph[] = []
    let visible = ''
    let run: Line[] = []
    const flush = (): void => {
      if (run.length === 0) return
      const first = run[0]
      const content = text.slice(first.start, first.end)
      const start = first.start + content.length - content.trimStart().length
      const body = run.map(line => text.slice(line.start, line.end).trim()).join(' ')
      const textStart = visible.length
      visible += `${body}\n`
      elements.push({ tag: 'p', start, id: undefined, textStart, textEnd: textStart + body.length, line: first.number })
      run = []
    }
    for (const line of linesOf(text, bomLength)) {
      const content = text.slice(line.start, line.end)
      const lead = line.start + content.length - content.trimStart().length
      if (content.trim() === '' || inComment(lead)) flush()
      else run.push(line)
    }
    flush()
    this.elements = elements
    this.visibleText = visible
  }

  elementAt(offset: number): TxtParagraph | undefined {
    return this.elements.find(el => el.start === offset)
  }

  elementAtPath(path: string): TxtParagraph | undefined {
    const match = /^p:nth\((\d+)\)$/.exec(path)
    return match === null ? undefined : this.elements[Number(match[1]) - 1]
  }

  pathOfTarget(target: TxtParagraph): string {
    return `p:nth(${this.elements.indexOf(target) + 1})`
  }

  /** The start of the line `offset` is on (after the BOM on the first line). */
  lineStartOf(offset: number): number {
    let at = offset
    while (at > this.bomLength && this.text[at - 1] !== '\n' && this.text[at - 1] !== '\r') at -= 1
    return at
  }
}

function indexOf(doc: KindDocument): TxtIndex {
  if (!(doc.index instanceof TxtIndex)) throw new Error('The .txt kind was given another kind\'s document')
  return doc.index
}

function anchorFor(index: TxtIndex, target: TxtParagraph): CommentAnchor {
  const exact = exactOf(index, target)
  return {
    tag: 'p',
    path: index.pathOfTarget(target),
    ...(exact ? { quote: { exact, prefix: prefixOf(index, target), suffix: suffixOf(index, target) } } : {})
  }
}

/** The `.txt` conformance kind (module comment). */
export const txtKind: CommentFileKind = {
  id: TXT_KIND_ID,
  extensions: ['.txt'],
  agentNote: TXT_AGENT_NOTE,

  parse(text, bomLength) {
    const index = new TxtIndex(text, bomLength)
    const state = classifyIndexedBlocks(index, 'line-start', (node, data, blockEnds) =>
      resolveBlockTarget(index, { after: node.end, anchor: data.anchor, blockEnds })
    )
    return { text, index, state }
  },

  locate(doc, pick) {
    const target = indexOf(doc).elements.find(el => el.line === pick.lineStart && el.tag === pick.tag)
    return target ?? { refused: 'not-found' }
  },

  slots(doc, target): readonly Slot[] {
    return [{ offset: indexOf(doc).lineStartOf(target.start), shape: 'line-start', indent: '' }]
  },

  anchorOf(doc, target, sel) {
    const anchor = anchorFor(indexOf(doc), target as TxtParagraph)
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
    return { ok: true }
  }
}
