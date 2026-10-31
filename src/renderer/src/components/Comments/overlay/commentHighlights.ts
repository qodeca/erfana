// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment mark in renderer-hosted previews (spec 024 architecture note
 * 001 § 1 "commentHighlights"; 024-FR-004 "the words are underlined while
 * they can be found"; comments-v2 C-12, C-17, R-01; Text highlights card).
 *
 * The mark is painted with the CSS Custom Highlight API under the name
 * {@link COMMENT_HIGHLIGHT}, and the words of a thread whose window is open
 * under {@link COMMENT_ACTIVE_HIGHLIGHT} (the same fill, a double bar – R-01):
 * no element is added to the rendered content, so an export, a copy and Find
 * never meet it (024-FR-024). The registry is per document, and dockview
 * keeps every panel mounted, so each overlay adds its marks under its own
 * owner key and the two highlights hold them all.
 *
 * The words of a thread whose target changed since the comment (C-06) are
 * painted under {@link COMMENT_CHANGED_HIGHLIGHT} – a dashed bar – unless
 * their window is open, when the active mark wins.
 *
 * Each mark keeps its thread key, so a click inside one opens that thread
 * (C-17, {@link commentMarkAt}).
 *
 * Where the API is missing (a test DOM), nothing is painted.
 *
 * @module components/Comments/overlay/commentHighlights
 */

/** The highlight name the stylesheet paints (`CommentOverlayLayer.css`). */
export const COMMENT_HIGHLIGHT = 'erf-comment'
/** The open thread's words (Text highlights card, "Open thread's mark"). */
export const COMMENT_ACTIVE_HIGHLIGHT = 'erf-comment-active'
/** The words of a Changed thread (C-06 "'now' words get a dashed accent underline"). */
export const COMMENT_CHANGED_HIGHLIGHT = 'erf-comment-changed'
/** Below Find's highlights, which keep the default priority 0 (Text highlights card, "Paint order"). */
export const COMMENT_HIGHLIGHT_PRIORITY = -1

/** One marked range: a selection comment's words. */
export interface CommentMark {
  readonly range: Range
  readonly threadKey: string
  /** Its thread's window is open. */
  readonly active?: boolean
  /** Its target changed since the comment (C-06). */
  readonly changed?: boolean
}

/** The parts of the Custom Highlight API this module uses. */
interface HighlightLike {
  priority: number
}
interface HighlightRegistryLike {
  set(name: string, highlight: HighlightLike): void
  delete(name: string): boolean
}

const owners = new Map<string, readonly CommentMark[]>()

function registry(): { readonly highlights: HighlightRegistryLike; readonly create: (ranges: Range[]) => HighlightLike } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => HighlightLike }).Highlight
  if (css?.highlights === undefined || Highlight === undefined) return null
  return { highlights: css.highlights, create: ranges => new Highlight(...ranges) }
}

function paint(api: NonNullable<ReturnType<typeof registry>>, name: string, ranges: Range[]): void {
  if (ranges.length === 0) {
    api.highlights.delete(name)
    return
  }
  const highlight = api.create(ranges)
  highlight.priority = COMMENT_HIGHLIGHT_PRIORITY
  api.highlights.set(name, highlight)
}

function repaint(): void {
  const api = registry()
  if (api === null) return
  const all = [...owners.values()].flat()
  const rest = all.filter(mark => mark.active !== true)
  paint(api, COMMENT_ACTIVE_HIGHLIGHT, all.filter(mark => mark.active === true).map(mark => mark.range))
  paint(api, COMMENT_CHANGED_HIGHLIGHT, rest.filter(mark => mark.changed === true).map(mark => mark.range))
  paint(api, COMMENT_HIGHLIGHT, rest.filter(mark => mark.changed !== true).map(mark => mark.range))
}

/**
 * Replace `owner`'s marks; an empty list removes them.
 *
 * @param owner - One overlay's stable key.
 * @param marks - The words to mark, with their threads.
 */
export function setCommentMarks(owner: string, marks: readonly CommentMark[]): void {
  if (marks.length === 0) owners.delete(owner)
  else owners.set(owner, marks)
  repaint()
}

/** `owner`'s marked ranges (for tests and hit-testing). */
export function commentMarksOf(owner: string): readonly Range[] {
  return (owners.get(owner) ?? []).map(mark => mark.range)
}

/** Where the caret would land at a point: Chromium's `caretRangeFromPoint`; `null` where it is missing. */
function caretAt(x: number, y: number): { readonly node: Node; readonly offset: number } | null {
  const fromPoint = (document as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint
  const caret = typeof fromPoint === 'function' ? fromPoint.call(document, x, y) : null
  return caret === null ? null : { node: caret.startContainer, offset: caret.startOffset }
}

/**
 * The thread whose marked words are at a point (C-17: a plain click inside
 * an underline opens its thread), or `null`.
 *
 * @param owner - The overlay's key.
 * @param x - Viewport x.
 * @param y - Viewport y.
 * @returns The thread key of the first mark holding the caret position there.
 */
export function commentMarkAt(owner: string, x: number, y: number): string | null {
  const marks = owners.get(owner)
  if (marks === undefined) return null
  const caret = caretAt(x, y)
  if (caret === null) return null
  const hit = marks.find(mark => {
    try {
      return mark.range.isPointInRange(caret.node, caret.offset)
    } catch {
      // A node in another document, or a range whose nodes were re-rendered away.
      return false
    }
  })
  return hit?.threadKey ?? null
}
