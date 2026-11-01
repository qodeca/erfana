// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one rule for the Comment button and for a menu's subject, in both
 * previews (comments-v2 C-16; I-10, I-12, I-22; differences table D-51, D-52).
 *
 * Boxes are the selection's line boxes as the host reads them, in the same
 * coordinates as its view. Nothing here reads a page or a selection.
 *
 * A comment mark's key lives here too, because the page and main must agree on
 * it: a mark is its pin's key plus the place of its words in the pin (I-13). No
 * thread id reaches the page, so this is how a click names one thread.
 */

/** The wait after a mouse selection before the Comment button shows (C-16 "about 150 ms"). */
export const SELECTION_BUTTON_DELAY_MS = 150

/** Below this distance from the view's top, the button goes under the line (C-16 "flipped below"). */
export const SELECTION_BUTTON_FLIP_PX = 48

/** A line box, or a view. */
export interface LineBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** A point in the same coordinates. */
export interface LinePoint {
  readonly x: number
  readonly y: number
}

/**
 * The last line of the selection that shows in `view`: what the button sits
 * on. `null` when none does, and the selection is ignored (C-16): no button,
 * and no key acts on words the reader cannot see.
 */
export function lastLineInView<B extends LineBox>(lines: readonly B[], view: LineBox): B | null {
  const shows = (line: B): boolean => line.bottom > view.top && line.top < view.bottom && line.right > view.left && line.left < view.right
  return [...lines].reverse().find(shows) ?? null
}

/** Whether the button goes under a line whose top is `top`, in a view starting at `viewTop`. */
export function buttonGoesBelow(top: number, viewTop: number): boolean {
  return top - viewTop < SELECTION_BUTTON_FLIP_PX
}

/** The key of the words at place `word` of the pin `pin`, for a pick from their mark. */
export function markKeyOf(pin: string, word: number): string {
  return `${pin}-w${word}`
}

/** A mark's pin and words, or `null` when `key` is no mark's. */
export function parseMarkKey(key: string): { readonly pin: string; readonly word: number } | null {
  const at = key.lastIndexOf('-w')
  const digits = key.slice(at + 2)
  return at < 1 || !/^\d{1,3}$/.test(digits) ? null : { pin: key.slice(0, at), word: +digits }
}

/** Whether `point` is on the selection: the pointer decides a menu's subject (I-22). */
export function pointerOnLines(lines: readonly LineBox[], point: LinePoint): boolean {
  return lines.some(line => point.x >= line.left && point.x < line.right && point.y >= line.top && point.y < line.bottom)
}
