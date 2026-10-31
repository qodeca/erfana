// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Other tools' comments in an HTML file (spec 024 024-FR-023, the rule
 * Markdown follows in design `markdown-format.md` § 4.4).
 *
 * - DIRECTIVE RUN. The comments right before an element, with only
 *   whitespace between (`<!-- prettier-ignore -->`), govern it. A new block
 *   goes before the run's first comment that is not an Erfana block – never
 *   between a directive and its element; an END comment is never part of a
 *   run. With no other tool's comment there, the slot is the start tag, as
 *   in v0.23.1.
 * - GENERATED REGION. An element between a START comment and its END
 *   comment (`foreignComments.ts`) is refused: the tool would drop the
 *   block on its next run. Regions pair among the comments of one parent,
 *   as Markdown pairs them among one container's blocks.
 * - RE-ATTACH is unchanged: HTML's position rule skips only Erfana blocks
 *   (§5.9 step 1, U-081), as v0.23.1's does, so a block before a directive
 *   run finds its element through the stored id, path or quote – the same way
 *   in both versions (024-FR-009).
 *
 * Only real `<!--` comments count – not a bogus `<?…>` or `<!x>` one – and
 * none inside template content.
 */
import { isBlockHeader } from '../comments/blocks'
import {
  inAnyRegion,
  pairGeneratedRegions,
  regionEndName,
  type GeneratedRegion
} from '../comments/foreignComments'
import type { HtmlIndex, IndexedComment, IndexedElement } from './htmlIndex'

/** The whitespace a directive run may hold between its comments and the element (HTML's set). */
const HTML_WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\f', '\r'])

/** What the other-tools rules read of a file, worked out once per parse. */
interface ForeignCommentIndex {
  /** Every counted comment by the offset just after its `-->`. */
  readonly byEnd: ReadonlyMap<number, IndexedComment>
  readonly regions: readonly GeneratedRegion[]
}

const cache = new WeakMap<HtmlIndex, ForeignCommentIndex>()

function foreignIndexOf(index: HtmlIndex): ForeignCommentIndex {
  const cached = cache.get(index)
  if (cached !== undefined) return cached
  const byEnd = new Map<number, IndexedComment>()
  const byParent = new Map<IndexedComment['parent'], IndexedComment[]>()
  for (const comment of index.comments) {
    if (comment.inTemplate || !index.text.startsWith('<!--', comment.start)) continue
    byEnd.set(comment.end, comment)
    const siblings = byParent.get(comment.parent)
    if (siblings === undefined) byParent.set(comment.parent, [comment])
    else siblings.push(comment)
  }
  const regions = [...byParent.values()].flatMap(siblings => pairGeneratedRegions(siblings))
  const built = { byEnd, regions }
  cache.set(index, built)
  return built
}

/** True when `el` lies inside a generated START/END region (024-FR-023). */
export function inHtmlGeneratedRegion(index: HtmlIndex, el: IndexedElement): boolean {
  return inAnyRegion(foreignIndexOf(index).regions, el.start)
}

/**
 * Where the directive run before `el` starts – the `<!--` of its first
 * comment that is not an Erfana block – or `undefined` when no other tool's
 * comment directly precedes `el` (module comment).
 */
export function directiveRunStart(index: HtmlIndex, el: IndexedElement): number | undefined {
  const { text, bomLength } = index
  const { byEnd } = foreignIndexOf(index)
  let foreign: number | undefined
  for (let pos = el.start; ; ) {
    let gap = pos
    while (gap > bomLength && HTML_WHITESPACE.has(text[gap - 1])) gap -= 1
    const comment = byEnd.get(gap)
    if (comment === undefined || regionEndName(comment.data) !== undefined) return foreign
    if (!isBlockHeader(comment.data)) foreign = comment.start
    pos = comment.start
  }
}
