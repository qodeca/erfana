// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment mark in renderer-hosted previews (spec 024 architecture note
 * 001 § 1 "commentHighlights"; 024-FR-004 "the words are underlined while
 * they can be found"; comments-v2 C-12; Text highlights card).
 *
 * The mark is painted with the CSS Custom Highlight API under the name
 * {@link COMMENT_HIGHLIGHT}: no element is added to the rendered content, so
 * an export, a copy and Find never meet it (024-FR-024). The registry is per
 * document, and dockview keeps every panel mounted, so each overlay adds its
 * ranges under its own owner key and the one highlight holds them all.
 *
 * Where the API is missing (a test DOM), nothing is painted.
 *
 * @module components/Comments/overlay/commentHighlights
 */

/** The highlight name the stylesheet paints (`CommentOverlayLayer.css`). */
export const COMMENT_HIGHLIGHT = 'erf-comment'
/** Below Find's highlights, which keep the default priority 0 (Text highlights card, "Paint order"). */
export const COMMENT_HIGHLIGHT_PRIORITY = -1

/** The parts of the Custom Highlight API this module uses. */
interface HighlightLike {
  priority: number
}
interface HighlightRegistryLike {
  set(name: string, highlight: HighlightLike): void
  delete(name: string): boolean
}

const owners = new Map<string, readonly Range[]>()

function registry(): { readonly highlights: HighlightRegistryLike; readonly create: (ranges: Range[]) => HighlightLike } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => HighlightLike }).Highlight
  if (css?.highlights === undefined || Highlight === undefined) return null
  return { highlights: css.highlights, create: ranges => new Highlight(...ranges) }
}

function repaint(): void {
  const api = registry()
  if (api === null) return
  const all = [...owners.values()].flat()
  if (all.length === 0) {
    api.highlights.delete(COMMENT_HIGHLIGHT)
    return
  }
  const highlight = api.create(all)
  highlight.priority = COMMENT_HIGHLIGHT_PRIORITY
  api.highlights.set(COMMENT_HIGHLIGHT, highlight)
}

/**
 * Replace `owner`'s marked ranges; an empty list removes them.
 *
 * @param owner - One overlay's stable key (its panel id).
 * @param ranges - The words to mark.
 */
export function setCommentMarks(owner: string, ranges: readonly Range[]): void {
  if (ranges.length === 0) owners.delete(owner)
  else owners.set(owner, ranges)
  repaint()
}

/** `owner`'s marked ranges (for tests and hit-testing). */
export function commentMarksOf(owner: string): readonly Range[] {
  return owners.get(owner) ?? []
}
