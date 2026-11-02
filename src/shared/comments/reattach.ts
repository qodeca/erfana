// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Re-attachment: how a block finds its target again, whatever kind of file
 * holds it (docs/designs/comments/html-preview-comments.md §5.9, §19 R3-10,
 * §19 Rev 4; spec 024 architecture note 001 § 1 `anchor`).
 *
 * A block normally sits right before its target, so the first rule –
 * POSITION – is "the next target in the SOURCE TEXT after the block,
 * skipping whitespace and other erfana blocks, has the stored tag, and it
 * corroborates the anchor" (§19 Rev 4: same `id`, matching text or same path,
 * and nothing that contradicts – the decision table is in
 * `anchorEvidence.ts`). Source order, not tree order: in HTML an implied
 * `tbody` or an unclosed `<p>`/`<li>` puts the comment node somewhere else in
 * the tree than its element (spike S7, 7 of 9 cases), but never somewhere
 * else in the text.
 *
 * When the file was edited around the block, the backups are tried in order,
 * cheapest first: a unique `id` + tag, the unique path, a unique text quote
 * (exact text, then the text around it). The path and quote backups refuse a
 * target with another `id`, and the path backup the target that slid into a
 * removed target's place. Two equal candidates leave the block ORPHANED – a
 * guess is worse than "element not found" – and nothing here ever moves or
 * deletes a block (decision 21). The `id` and quote tiers answer from tables
 * built once per parse (`anchorLookup.ts`), so many orphaned blocks cost
 * about as much as one.
 *
 * Everything here reads the file through {@link TargetIndex}, so it serves
 * every kind; the HTML anchor builder stays in `htmlComments/anchor.ts`.
 */
import { pathBackupRefuses, positionCorroborated, quoteBackupRefuses } from './anchorEvidence'
import { anchorLookupOf } from './anchorLookup'
import type { CommentAnchor } from './format'
import type { IndexedTarget, TargetIndex } from './targetIndex'

/** The whitespace the position rule skips between a block and its target (HTML's set). */
const BLOCK_GAP_WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\f', '\r'])

/** Which rule attached a block to its target. */
export type TargetVia = 'position' | 'id' | 'path' | 'quote'

/** Where a block's target is now (§5.7). */
export type TargetResolution =
  | { readonly state: 'attached'; readonly startOffset: number; readonly via: TargetVia }
  | { readonly state: 'orphaned' }

function attached(el: IndexedTarget, via: TargetVia): TargetResolution {
  return { state: 'attached', startOffset: el.start, via }
}

/**
 * Find an anchor's target without the position rule – for a block whose
 * position no longer matches or is not corroborated, or for a draft
 * re-anchored at Save (§7.6).
 */
export function findAnchorTarget<T extends IndexedTarget>(
  index: TargetIndex<T>,
  anchor: CommentAnchor
): TargetResolution {
  const lookup = anchorLookupOf(index)
  if (anchor.id) {
    const el = lookup.byId(anchor.tag, anchor.id)
    if (el) return attached(el, 'id')
  }
  if (anchor.path) {
    const el = index.elementAtPath(anchor.path)
    if (el && el.tag === anchor.tag && !pathBackupRefuses(lookup, el, anchor)) {
      return attached(el, 'path')
    }
  }
  const el = anchor.quote && lookup.byQuote(anchor.tag, anchor.quote)
  return el && !quoteBackupRefuses(el, anchor) ? attached(el, 'quote') : { state: 'orphaned' }
}

/** Input for {@link resolveBlockTarget}. */
export interface BlockTargetQuery {
  /** Offset just after the block's `-->`. */
  readonly after: number
  readonly anchor: CommentAnchor
  /** Start → end of every erfana block in the file, skipped by the position rule. */
  readonly blockEnds: ReadonlyMap<number, number>
}

/**
 * Where a block's target is: a corroborated position first, then the
 * backups (§5.9, §19 Rev 4).
 */
export function resolveBlockTarget<T extends IndexedTarget>(
  index: TargetIndex<T>,
  query: BlockTargetQuery
): TargetResolution {
  const { text } = index
  const { anchor } = query
  let pos = query.after
  for (;;) {
    while (pos < text.length && BLOCK_GAP_WHITESPACE.has(text[pos])) pos += 1
    const end = query.blockEnds.get(pos)
    if (end === undefined) break
    pos = end
  }
  const next = index.elementAt(pos)
  if (
    next?.tag === anchor.tag &&
    positionCorroborated(index, anchorLookupOf(index), next, anchor)
  ) {
    return attached(next, 'position')
  }
  return findAnchorTarget(index, anchor)
}
