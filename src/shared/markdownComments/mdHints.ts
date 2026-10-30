// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown target hint (spec 024 design `markdown-format.md` § 6;
 * 024-FR-008): `target in Markdown (when commented): {target} starting
 * "{text}"`, written in the note area for agents, never read back.
 *
 * `@data` holds no source line, so the hint is RE-DERIVED from the file at
 * every write (decision of the owner's delegate, 2026-10-30): the kind finds
 * the block's carrier – the block's own attached target on a reply or a
 * resolve, the anchor's path when the block is being added – and the inner
 * target `anchor.runtime` names below it. When the target cannot be found,
 * the hint is left out; the words hint never needs the file.
 */
import type { KindDocument } from '../comments/fileKind'
import type { CommentData } from '../comments/format'
import { markdownTargetHint, selectionHints } from '../comments/noteLines'
import { innerTargetOf } from './mdAnchor'
import { MdIndex, type MdTarget } from './mdIndex'

const NOUNS: Readonly<Record<MdTarget['kind'], string>> = {
  paragraph: 'paragraph',
  heading: 'heading',
  list: 'list',
  item: 'item',
  table: 'table',
  row: 'row',
  cell: 'cell',
  quote: 'block quote',
  code: 'code block',
  diagram: 'diagram',
  divider: 'divider',
  html: 'HTML block',
  image: 'image'
}

/** The kind noun of a target: `paragraph`, `H2 heading`, `code block`. */
function nounOf(target: MdTarget): string {
  return target.kind === 'heading' ? `H${target.depth ?? 1} heading` : NOUNS[target.kind]
}

/** True when the target's block sits inside a block quote. */
function insideQuote(target: MdTarget): boolean {
  for (let at = target.block.parent; at; at = at.parent) if (at.type === 'blockquote') return true
  return false
}

/** The target a sibling block stands for in the count: its image when it holds one alone. */
function standIn(index: MdIndex, target: MdTarget): MdTarget | undefined {
  return index.elements.find(t => t.block === target.block && t.kind === 'image') ?? target.block.target
}

/** `{noun} {n} inside the block quote`: `n` counts that noun among the target's siblings. */
function positionInQuote(index: MdIndex, target: MdTarget): string {
  const noun = nounOf(target)
  const siblings = target.block.parent?.children ?? []
  let n = 0
  for (const sibling of siblings.slice(0, target.block.index + 1)) {
    const standing = sibling.target === undefined ? undefined : standIn(index, sibling.target)
    if (standing !== undefined && nounOf(standing) === noun) n += 1
  }
  return `${noun} ${Math.max(n, 1)} inside the block quote`
}

/** The name of a target in the hint (§ 6): its kind noun, or its position. */
export function targetNameOf(index: MdIndex, target: MdTarget): string {
  const { block } = target
  switch (target.kind) {
    case 'item':
      return `item ${block.index + 1} of the list`
    case 'row':
      return block.index === 0 ? 'header row of the table' : `row ${block.index} of the table`
    case 'cell': {
      const row = block.parent!
      return `${row.index === 0 ? 'header row' : `row ${row.index}`}, column ${block.index + 1} of the table`
    }
    default:
      return insideQuote(target) ? positionInQuote(index, target) : nounOf(target)
  }
}

/**
 * The source line a hint quotes: the target's first line, its leading blanks
 * removed and everything else as written; for a fenced code block or diagram
 * the first line inside the fence, or the fence line when it is empty.
 */
export function targetLineOf(index: MdIndex, target: MdTarget): string {
  const { block } = target
  let line = target.line - 1
  if (block.fenced && (target.kind === 'code' || target.kind === 'diagram')) {
    const inside = block.line + 1
    const closing = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.test(index.lines.lineText(block.endLine))
    if (inside < block.endLine || (inside === block.endLine && !closing)) line = inside
  }
  return index.lines.lineText(line).replace(/^[ \t]+/, '')
}

/**
 * The carrier a block's `@data` names in `doc`: on a reply or a resolve the
 * block's own target, when it is still attached; on an add – the block not
 * yet in the file – the target at the anchor's path, which was just read.
 */
function carrierOf(index: MdIndex, doc: KindDocument, data: CommentData): MdTarget | undefined {
  const own = doc.state.blocks.find(block => block.kind === 'ok' && block.data.id === data.id)
  const tagged = (list: readonly MdTarget[]): MdTarget | undefined =>
    list.find(t => t.tag === data.anchor.tag && t.path === data.anchor.path) ?? list.find(t => t.tag === data.anchor.tag)
  if (own?.kind === 'ok') return own.target.state === 'attached' ? tagged(index.targetsAt(own.target.startOffset)) : undefined
  const byPath = data.anchor.path === '' ? undefined : index.elementAtPath(data.anchor.path)
  return byPath?.tag === data.anchor.tag ? byPath : undefined
}

/** The hint lines of a Markdown block: the target hint when its target is found, then the words hint. */
export function markdownHints(data: CommentData, doc?: KindDocument): readonly string[] {
  const words = selectionHints(data)
  if (doc === undefined || !(doc.index instanceof MdIndex)) return words
  const index = doc.index
  const carrier = carrierOf(index, doc, data)
  const runtime = data.anchor.runtime
  const target = carrier === undefined || runtime === undefined ? carrier : innerTargetOf(index, carrier, runtime)
  if (target === undefined) return words
  return [markdownTargetHint(targetNameOf(index, target), targetLineOf(index, target)), ...words]
}
