// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a new block goes in a Markdown file (spec 024 design
 * `markdown-format.md` § 2–4; 024-FR-003, 024-FR-023; architecture note 001
 * § 8 C2, C4, C9).
 *
 * Every Markdown block is written in the `line-start` shape: `indent + block
 * + eol` at the start of a line, `indent` being spaces only, exactly the
 * container column – never a tab, never a `> ` prefix. The line is the first
 * line of the SLOT CARRIER, which starts as the target and climbs (§ 4.1):
 *
 * 1. out of block quotes, to the outermost one;
 * 2. from a table row or cell to the table;
 * 3. from an image alone in its paragraph to the paragraph (its block);
 * 4. from the first block of a list item, on the marker line, to the item;
 * 5. from list item 1 to the whole list (then rule 4 again). Item n ≥ 2 stays:
 *    its slot is its own marker line at item n − 1's content column, so the
 *    block is item n − 1's last child.
 *
 * A save tries the carrier's slot, then for a list item or a block inside one
 * the slot before the whole list, then the same one level up – at most
 * {@link MARKDOWN_COMMENT_MAX_SLOTS} (§ 4.5). Each slot moves before any
 * directive run of other tools' comments (§ 4.4), and is dropped when it
 * lies inside a generated START/END region or right after a line a block
 * must not follow (§ 4.3: inside a fence, an open type-6/7 HTML block, a
 * table). Whether the rendering survives is the render check's call.
 */
import { isBlockHeader } from '../comments/blocks'
import { inAnyRegion } from '../comments/foreignComments'
import type { Slot } from '../comments/fileKind'
import { MARKDOWN_COMMENT_MAX_SLOTS } from './markdownLimits'
import type { MdBlock, MdIndex, MdTarget } from './mdIndex'
import { regionEndName } from './mdCommentScan'

/** A Markdown slot and the carrier whose first line it precedes. */
export type MdSlot = Extract<Slot, { readonly shape: 'line-start' }> & { readonly carrier: MdTarget }

/** The outermost block quote holding `block` (itself included), if any. */
function outermostQuote(block: MdBlock): MdBlock | undefined {
  let found: MdBlock | undefined
  for (let at: MdBlock | undefined = block; at; at = at.parent) if (at.type === 'blockquote') found = at
  return found
}

function ancestorOfType(block: MdBlock, type: string): MdBlock | undefined {
  for (let at: MdBlock | undefined = block; at; at = at.parent) if (at.type === type) return at
  return undefined
}

/** The slot carrier of `block` (module comment, rules 1–5). */
export function carrierBlockOf(block: MdBlock): MdBlock {
  let carrier = outermostQuote(block) ?? block
  if (carrier.type === 'tableRow' || carrier.type === 'tableCell') carrier = ancestorOfType(carrier, 'table') ?? carrier
  for (;;) {
    const parent = carrier.parent
    if (parent?.type === 'listItem' && carrier.index === 0 && carrier.line === parent.line) carrier = parent
    else if (carrier.type === 'listItem' && carrier.index === 0 && carrier.parent) carrier = carrier.parent
    else return carrier
  }
}

/** The first carrier of `target`: its own block climbed. */
export function primaryCarrierOf(target: MdTarget): MdTarget | undefined {
  return carrierBlockOf(target.block).target
}

/** The column the content of `block`'s container starts at (design § 1). */
function containerColumnOf(block: MdBlock): number {
  return block.parent?.type === 'listItem' ? block.parent.contentColumn : 0
}

/** The blocks a slot before `carrier` sits after, nearest first, in its own container. */
function blocksBefore(carrier: MdBlock): readonly MdBlock[] {
  const container = containerOf(carrier)
  if (container === undefined) return []
  return container === carrier.parent ? container.children.slice(0, carrier.index).reverse() : [...container.children].reverse()
}

const isErfanaBlock = (block: MdBlock): boolean => block.comments.every(comment => isBlockHeader(comment.data))
const isRegionEnd = (block: MdBlock): boolean => block.comments.some(comment => regionEndName(comment.data) !== undefined)

/**
 * The line a slot before `carrier` starts on, after the directive run
 * (§ 4.4): the comment-only HTML blocks right before the carrier form a run,
 * an END comment never part of it; the block goes before the run's first
 * member that is not an Erfana block, so after any Erfana blocks at its head.
 */
function slotLineOf(carrier: MdBlock): number {
  const run: MdBlock[] = []
  for (const before of blocksBefore(carrier)) {
    if (before.type !== 'html' || !before.commentOnly || isRegionEnd(before)) break
    run.unshift(before)
  }
  const foreign = run.find(member => !isErfanaBlock(member))
  return foreign === undefined ? carrier.line : foreign.line
}

/** The container a slot before `carrier` writes into: item n − 1 for item n ≥ 2, else the carrier's parent. */
function containerOf(carrier: MdBlock): MdBlock | undefined {
  if (carrier.type === 'listItem' && carrier.index > 0) return carrier.parent!.children[carrier.index - 1]
  return carrier.parent
}

/**
 * True when a slot on `line` would land on its container's marker line –
 * before the list marker itself, as when a directive run starts on it.
 */
function onMarkerLine(carrier: MdBlock, line: number): boolean {
  const container = containerOf(carrier)
  return container?.type === 'listItem' && container.line === line
}

/** The indent of a slot before `carrier`: item n ≥ 2 writes at item n − 1's content column. */
function indentOf(carrier: MdBlock): number {
  const container = containerOf(carrier)
  return container !== carrier.parent ? container!.contentColumn : containerColumnOf(carrier)
}

/** True when a slot on line `line` may be tried (§ 4.3, § 4.4). */
function slotAllowed(index: MdIndex, line: number): boolean {
  const offset = index.lines.starts[line]
  if (index.regions.some(region => region.start < offset && offset < region.end)) return false
  const before = line - 1
  return before < index.bodyLine || index.unsafeLines[before] !== 1
}

/** The carriers to try for `target`, in order (§ 4.5). */
function carriersOf(target: MdTarget): MdBlock[] {
  const first = carrierBlockOf(target.block)
  const carriers = [first]
  for (let at = first; ; ) {
    const item = at.type === 'listItem' ? at : at.parent?.type === 'listItem' ? at.parent : undefined
    if (item?.parent === undefined) return carriers
    const up = carrierBlockOf(item.parent)
    if (!carriers.includes(up)) carriers.push(up)
    at = up
  }
}

/** Where a block about `target` may go, in try order; empty when nowhere. */
export function markdownSlots(index: MdIndex, target: MdTarget): MdSlot[] {
  const slots: MdSlot[] = []
  for (const carrier of carriersOf(target)) {
    if (carrier.target === undefined) continue
    const line = slotLineOf(carrier)
    const offset = index.lines.starts[line]
    if (onMarkerLine(carrier, line) || !slotAllowed(index, line) || slots.some(slot => slot.offset === offset)) continue
    slots.push({ offset, shape: 'line-start', indent: ' '.repeat(indentOf(carrier)), carrier: carrier.target })
    if (slots.length === MARKDOWN_COMMENT_MAX_SLOTS) break
  }
  return slots
}

/** True when `target` lies inside a generated START/END region (024-FR-023). */
export function inGeneratedRegion(index: MdIndex, target: MdTarget): boolean {
  return inAnyRegion(index.regions, target.start)
}
