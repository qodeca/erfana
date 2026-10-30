// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Finding a Markdown target: the one a pick names, and the one a block is
 * about (spec 024 024-FR-003, 024-FR-013; design `markdown-format.md` § 4.4;
 * architecture note 001 § 8 C7).
 *
 * A PICK carries the hash of the text the preview rendered and the target's
 * quote. When the hash still matches the file, the pick's line, tag and
 * ordinal name the target. Otherwise the target moves only when exactly one
 * target of its tag has the pick's text; two – an identical block inserted
 * above it, say – or none refuse the save as moved (024-AC-014 d).
 *
 * A BLOCK finds its target by position first: the next line after it, past
 * blank lines and every comment-only HTML block (Erfana's or another tool's),
 * holds a target of the stored tag – for a block at the end of item n − 1,
 * item n. Position alone is not enough: the target's text must still be the
 * stored quote. Without a position the quote alone may find it, when exactly
 * one target of the tag matches. A target with no text (a divider, an image's
 * paragraph) cannot be matched by text; its stored path must agree instead.
 */
import { anchorLookupOf } from '../comments/anchorLookup'
import { hashText, type BlockTargetResolver } from '../comments/blocks'
import type { KindRefusal, PickedTarget } from '../comments/fileKind'
import type { CommentAnchor } from '../comments/format'
import { exactOf } from '../comments/quoteText'
import type { TargetResolution } from '../comments/reattach'
import type { MdBlock, MdIndex, MdTarget } from './mdIndex'
import { inGeneratedRegion } from './mdSlots'

const BOM = '\uFEFF'

/**
 * The hash a Markdown pick carries (`PickedTarget.baseHash`): SHA-256 (hex)
 * of the UTF-8 bytes of the text the preview rendered, without a leading
 * BOM – the editor buffer and the decoded file agree on it whether or not
 * the file has one.
 */
export function markdownTextHash(text: string): string {
  return hashText(text.startsWith(BOM) ? text.slice(1) : text)
}

const refused = (reason: KindRefusal['refused']): KindRefusal => ({ refused: reason })

/** The target a pick names (module comment), or why there is none. */
export function locateMarkdownTarget(index: MdIndex, pick: PickedTarget): MdTarget | KindRefusal {
  let found: MdTarget | undefined
  if (pick.baseHash !== undefined && pick.baseHash === markdownTextHash(index.text)) {
    const line = pick.lineStart - 1
    if (index.bodyStart > index.bomLength && line >= 0 && line < index.bodyLine) return refused('frontmatter')
    const onLine = index.elements.filter(target => target.line === pick.lineStart && target.tag === pick.tag)
    found = onLine[pick.ordinal - 1]
  } else if (pick.quote !== undefined) {
    const exact = pick.quote.exact
    const matches = index.elements.filter(target => target.tag === pick.tag && exactOf(index, target) === exact)
    found = matches.length === 1 ? matches[0] : undefined
  }
  if (found === undefined) return refused('not-found')
  return inGeneratedRegion(index, found) ? refused('generated-region') : found
}

/** True when `target` has no rendered text, so only its path can corroborate it. */
function textless(index: MdIndex, target: MdTarget): boolean {
  return exactOf(index, target) === ''
}

/** True when `target` is still what `anchor` stored: its text, or for a textless target its path. */
function corroborates(index: MdIndex, target: MdTarget, anchor: CommentAnchor): boolean {
  if (target.tag !== anchor.tag) return false
  if (anchor.quote !== undefined) return exactOf(index, target) === anchor.quote.exact
  return textless(index, target) && anchor.path !== '' && target.path === anchor.path
}

/** Where an anchor's target is now, without the position rule (module comment). */
export function findMarkdownTarget(index: MdIndex, anchor: CommentAnchor): TargetResolution {
  if (anchor.quote !== undefined) {
    const found = anchorLookupOf(index).byQuote(anchor.tag, anchor.quote) as MdTarget | undefined
    return found !== undefined && corroborates(index, found, anchor)
      ? { state: 'attached', startOffset: found.start, via: 'quote' }
      : { state: 'orphaned' }
  }
  const byPath = anchor.path === '' ? undefined : index.elementAtPath(anchor.path)
  return byPath !== undefined && corroborates(index, byPath, anchor)
    ? { state: 'attached', startOffset: byPath.start, via: 'path' }
    : { state: 'orphaned' }
}

/** Comment-only HTML blocks by first line, for the position rule's skip. */
function commentOnlyByLine(root: MdBlock | undefined): Map<number, MdBlock> {
  const byLine = new Map<number, MdBlock>()
  const stack = root === undefined ? [] : [root]
  for (let block = stack.pop(); block; block = stack.pop()) {
    if (block.type === 'html' && block.commentOnly && !byLine.has(block.line)) byLine.set(block.line, block)
    stack.push(...block.children)
  }
  return byLine
}

/** The first line after offset `end` that is not blank and does not start a comment-only HTML block. */
function lineAfter(index: MdIndex, end: number, skip: ReadonlyMap<number, MdBlock>): number {
  const { lines, text } = index
  let line = lines.lineOf(end)
  if (text.slice(end, lines.contentEnd(line)).trim() === '') line += 1
  while (line < lines.count) {
    const block = skip.get(line)
    if (block !== undefined) line = block.endLine + 1
    else if (lines.isBlank(line)) line += 1
    else break
  }
  return line
}

/** The block target resolver of a Markdown file: a corroborated position, then the text alone. */
export function markdownBlockResolver(index: MdIndex): BlockTargetResolver {
  const skip = commentOnlyByLine(index.root)
  const byLine = new Map<number, MdTarget[]>()
  for (const target of index.elements) {
    const list = byLine.get(target.line - 1)
    if (list) list.push(target)
    else byLine.set(target.line - 1, [target])
  }
  return (node, data) => {
    const line = lineAfter(index, node.end, skip)
    const next = (byLine.get(line) ?? []).find(target => corroborates(index, target, data.anchor))
    return next !== undefined
      ? { state: 'attached', startOffset: next.start, via: 'position' }
      : findMarkdownTarget(index, data.anchor)
  }
}
